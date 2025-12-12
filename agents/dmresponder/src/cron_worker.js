import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir, writeFile } from 'fs/promises';
import { generateResponse } from './engine.js';
import { 
  initBrowser, 
  processLeadInNewTab, 
  waitForUserToFinish, 
  closeBrowser,
  getOpenMessageTabs 
} from './scraper.js';
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

/**
 * Main entry point - NEW WORKFLOW
 * 1. Init browser once
 * 2. Process each lead in a new tab
 * 3. Wait for user to review and send manually
 */
export async function runCronWatcher(options = {}) {
  await initDB();
  
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

  console.log(`\n========================================`);
  console.log(`   DM RESPONDER (Multi-Tab Mode)`);
  console.log(`========================================`);
  console.log(`   Found ${threads.length} conversation(s) to process`);
  console.log(`   Messages will be typed but NOT sent automatically.\n`);
  
  let browser = null;
  let successCount = 0;
  
  try {
    // Step 1: Init browser (single login) - ALWAYS visible
    browser = await initBrowser({ 
      userDataDir: './browser-data',
      headless: false // Always visible
    });
    
    // Step 2: Process each thread
    for (const thread of threads) {
      const result = await processThread(thread, options);
      if (result.success) {
        successCount++;
      }
    }
    
    // Step 3: Wait for user to review
    if (getOpenMessageTabs().length > 0) {
      await waitForUserToFinish();
    }
    
  } catch (error) {
    console.error(`Fatal error: ${error.message}`);
  } finally {
    await closeBrowser();
  }
  
  console.log(`\n✅ Done! ${successCount}/${threads.length} messages prepared.`);
}

/**
 * Process a single thread:
 * 1. Get existing conversation history from DB
 * 2. Generate response based on context
 * 3. Open new tab, navigate to profile, type message
 */
async function processThread(thread, options) {
  const username = thread.username;
  const profileUrl = thread.dm_url; // This is the profile URL
  
  console.log(`\n--- Processing @${username} ---`);
  
  try {
    // Get context from DB
    const existingHistory = await getConversationHistory(username);
    const leadContext = await getLeadWithContext(username);
    
    // Generate response
    console.log(`   Generating response...`);
    const response = await generateResponse({
      conversationHistory: existingHistory,
      leadContext
    });
    
    const message = response.next_message || response.message || response.suggested_message;
    
    if (!message) {
      console.log(`   ⚠️  No message generated.`);
      await markThread(username, 'error', thread.metadata, {
        last_error: 'No message generated',
        last_checked_at: new Date().toISOString()
      });
      return { success: false };
    }
    
    console.log(`   Message: "${message.substring(0, 50)}..."`);
    
    // Save suggestion to file
    const suggestionPath = await saveSuggestion(username, response, options.outputDir || DEFAULT_OUTPUT_DIR);
    console.log(`   Suggestion saved: ${suggestionPath}`);
    
    // Process in new tab
    const result = await processLeadInNewTab(
      { username, profile_url: profileUrl },
      message
    );
    
    if (result.success) {
      await markThread(
        username,
        'response_typed',
        thread.metadata,
        {
          last_checked_at: new Date().toISOString(),
          last_suggestion: {
            file: suggestionPath,
            generated_at: new Date().toISOString(),
            stage: response.conversation_stage
          }
        }
      );
      return { success: true };
    } else {
      console.log(`   ❌ Failed: ${result.error}`);
      await markThread(username, 'error', thread.metadata, {
        last_error: result.error,
        last_checked_at: new Date().toISOString()
      });
      return { success: false };
    }
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    await markThread(username, 'error', thread.metadata, {
      last_error: error.message,
      last_checked_at: new Date().toISOString()
    });
    return { success: false };
  }
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
