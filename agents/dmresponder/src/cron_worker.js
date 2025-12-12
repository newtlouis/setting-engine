import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir, writeFile } from 'fs/promises';
import { generateResponse } from './engine.js';
import { scrapeConversation } from './scraper.js';
import {
  initDB,
  getTrackedDmThreads,
  getConversationHistory,
  getLeadWithContext,
  addMessage,
  parseThreadMetadata,
  setDmThreadStatus
} from './db_integration.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_OUTPUT_DIR = path.join(__dirname, '..', 'output', 'suggestions');
const DEFAULT_STATUSES = ['message_ready', 'awaiting_reply', 'watching', 'error'];

export async function runCronWatcher(options = {}) {
  await initDB();
  const headless = options.headless !== false;
  const statuses = Array.isArray(options.statuses) && options.statuses.length > 0
    ? options.statuses
    : DEFAULT_STATUSES;
  const limit = options.limit || 5;
  const threads = await getTrackedDmThreads({
    statuses,
    onlyWithUrl: true,
    limit
  });
  if (!threads || threads.length === 0) {
    console.log('No DM threads matched the criteria.');
    console.log('Criteria used:');
    console.log(`  Statuses: ${statuses.join(', ')}`);
    console.log(`  With DM URL: true`);
    console.log(`  Limit: ${limit}`);
    return;
  }

  console.log(`Processing ${threads.length} DM thread(s)...`);
  for (const thread of threads) {
    // eslint-disable-next-line no-await-in-loop
    await processThread(thread, { headless, outputDir: options.outputDir || DEFAULT_OUTPUT_DIR });
  }
}

async function processThread(thread, options) {
  const username = thread.username;
  console.log(`\n--- Checking @${username} ---`);
  let browser;
  try {
    const existingHistory = await getConversationHistory(username);
    const scrapeResult = await scrapeConversation(thread.dm_url, { headless: options.headless });
    const scrapedHistory = scrapeResult.conversationHistory || [];
    browser = scrapeResult.browser;

    const newUserMessages = extractNewUserMessages(scrapedHistory, existingHistory);
    if (newUserMessages.length === 0) {
      console.log('No new user replies detected.');
      await markThread(username, 'watching', thread.metadata, { last_checked_at: new Date().toISOString() });
      return;
    }

    for (const message of newUserMessages) {
      // eslint-disable-next-line no-await-in-loop
      await addMessage(username, 'user', message.text);
    }

    const updatedHistory = await getConversationHistory(username);
    const leadContext = await getLeadWithContext(username);

    const response = await generateResponse({
      conversationHistory: updatedHistory,
      leadContext
    });

    const suggestionPath = await saveSuggestion(username, response, options.outputDir);
    console.log(`Suggestion saved to ${suggestionPath}`);

    await markThread(
      username,
      'suggestion_ready',
      thread.metadata,
      {
        last_checked_at: new Date().toISOString(),
        last_user_message: newUserMessages[newUserMessages.length - 1].text,
        last_suggestion: {
          file: suggestionPath,
          generated_at: new Date().toISOString(),
          stage: response.conversation_stage
        }
      }
    );
  } catch (error) {
    console.error(`Failed to process @${username}: ${error.message}`);
    await markThread(username, 'error', thread.metadata, {
      last_error: error.message,
      last_checked_at: new Date().toISOString()
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

function extractNewUserMessages(scrapedHistory, storedHistory) {
  if (!scrapedHistory || scrapedHistory.length === 0) {
    return [];
  }
  if (!storedHistory || storedHistory.length === 0) {
    return scrapedHistory.filter(msg => msg.role === 'user');
  }
  const lastStored = storedHistory[storedHistory.length - 1];
  let startIndex = 0;
  for (let i = scrapedHistory.length - 1; i >= 0; i -= 1) {
    const candidate = scrapedHistory[i];
    if (candidate.role === lastStored.role && candidate.text.trim() === (lastStored.text || '').trim()) {
      startIndex = i + 1;
      break;
    }
    if (i === 0) {
      startIndex = 0;
    }
  }
  const delta = scrapedHistory.slice(startIndex);
  return delta.filter(msg => msg.role === 'user');
}

async function saveSuggestion(username, response, outputDir) {
  await mkdir(outputDir, { recursive: true });
  const safeUsername = username.replace(/[^a-z0-9-_]/gi, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(outputDir, `${timestamp}_${safeUsername}.json`);
  const payload = {
    username,
    generated_at: new Date().toISOString(),
    response
  };
  await writeFile(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

async function markThread(username, status, rawMetadata, additions = {}) {
  const metadata = {
    ...parseThreadMetadata(rawMetadata),
    ...additions
  };
  await setDmThreadStatus(username, status, { metadata });
}
