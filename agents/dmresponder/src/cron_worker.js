import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir, writeFile } from 'fs/promises';
import { generateResponse } from './engine.js';
import { 
  initBrowser, 
  openDMAndScrape,
  typeInOpenTab,
  registerOpenTab,
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
// DM Responder only processes leads with active conversations
const DEFAULT_STATUSES = ['conversation'];

/**
 * Find messages in scraped list that are not in DB history
 * Uses text comparison to identify new messages
 */
function findNewMessages(scrapedMessages, dbHistory) {
  if (!scrapedMessages || scrapedMessages.length === 0) return [];
  if (!dbHistory || dbHistory.length === 0) return scrapedMessages;
  
  // Create a set of existing message texts for fast lookup
  const existingTexts = new Set(dbHistory.map(m => m.text?.trim().toLowerCase()));
  
  // Filter scraped messages that don't exist in DB
  const newMessages = scrapedMessages.filter(msg => {
    const normalizedText = msg.text?.trim().toLowerCase();
    return !existingTexts.has(normalizedText);
  });
  
  return newMessages;
}

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
 * Process a single thread with CORRECT workflow:
 * 1. Open DM and scrape messages first
 * 2. Save any new messages to DB
 * 3. Generate response with COMPLETE context (DB + scraped)
 * 4. Type message in already-open tab
 */
async function processThread(thread, options) {
  const username = thread.username;
  const profileUrl = thread.profile_url || thread.dm_url || `https://www.instagram.com/${username}/`;
  
  console.log(`\n--- Processing @${username} ---`);
  
  let openTab = null;
  
  try {
    // Step 1: Get existing conversation history from DB
    const existingHistory = await getConversationHistory(username);
    const leadContext = await getLeadWithContext(username);
    
    console.log(`   📚 Messages in DB: ${existingHistory.length}`);
    
    // Step 2: Open DM and scrape messages FIRST
    console.log(`   🌐 Opening DM conversation...`);
    const scrapeResult = await openDMAndScrape({ username, profile_url: profileUrl });
    
    if (!scrapeResult.success) {
      console.log(`   ❌ Failed to open DM: ${scrapeResult.error}`);
      await markThread(username, 'failed', thread.metadata, {
        last_error: scrapeResult.error,
        last_checked_at: new Date().toISOString()
      });
      return { success: false };
    }
    
    openTab = scrapeResult.tab;
    const scrapedMessages = scrapeResult.scrapedMessages || [];
    
    // Step 3: Save NEW scraped messages to DB
    let updatedHistory = [...existingHistory];
    
    if (scrapedMessages.length > 0) {
      console.log(`   🔍 Scraped ${scrapedMessages.length} messages from Instagram`);
      
      const newMessages = findNewMessages(scrapedMessages, existingHistory);
      
      if (newMessages.length > 0) {
        console.log(`   📥 Saving ${newMessages.length} new message(s) to DB...`);
        for (const msg of newMessages) {
          await addMessage(username, msg.role, msg.text);
          updatedHistory.push({ role: msg.role, text: msg.text });
        }
      } else {
        console.log(`   ✓ DB is up to date`);
      }
    }
    
    // Step 4: Generate response with FULL context (including newly saved messages)
    console.log(`   🤖 Generating response with ${updatedHistory.length} messages context...`);
    const response = await generateResponse({
      conversationHistory: updatedHistory,
      leadContext
    });
    
    const message = response.next_message || response.message || response.suggested_message;
    
    if (!message) {
      console.log(`   ⚠️  No message generated.`);
      await openTab.close().catch(() => {});
      await markThread(username, 'failed', thread.metadata, {
        last_error: 'No message generated',
        last_checked_at: new Date().toISOString()
      });
      return { success: false };
    }
    
    console.log(`   💬 Response: "${message.substring(0, 50)}..."`);
    
    // Save suggestion to file
    const suggestionPath = await saveSuggestion(username, response, options.outputDir || DEFAULT_OUTPUT_DIR);
    
    // Step 5: Type message in the already-open tab
    const typeResult = await typeInOpenTab(openTab, message);
    
    if (!typeResult.success) {
      console.log(`   ❌ Failed to type: ${typeResult.error}`);
      await openTab.close().catch(() => {});
      await markThread(username, 'failed', thread.metadata, {
        last_error: typeResult.error,
        last_checked_at: new Date().toISOString()
      });
      return { success: false };
    }
    
    // Register this tab so it stays open for user review
    registerOpenTab(username, openTab, message);
    
    // Step 6: Save the typed message as 'assistant' message
    console.log(`   💾 Saving typed message to DB...`);
    await addMessage(username, 'assistant', message, response.message_type || 'generated');
    
    await markThread(
      username,
      'conversation',
      thread.metadata,
      {
        last_checked_at: new Date().toISOString(),
        last_message_preview: message.substring(0, 100)
      }
    );
    
    console.log(`   ✅ Ready! Tab open for manual send.`);
    return { success: true, tabKeptOpen: true };
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    if (openTab) await openTab.close().catch(() => {});
    await markThread(username, 'failed', thread.metadata, {
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
  // Now just updates lead status directly
  await setDmThreadStatus(username, status, additions);
}
