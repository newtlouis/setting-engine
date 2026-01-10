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
  setDmThreadStatus,
  getOrCreateAccount
} from './db_integration.js';
import { loadProfileConfig } from '../../../shared/utils/configLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_OUTPUT_DIR = path.join(__dirname, '..', 'output', 'suggestions');
// DM Responder processes active conversations AND checks for new replies from outreach
const DEFAULT_STATUSES = ['conversation', 'outreach', 'contacted'];

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
  
  const profile = options.profile || process.env.IG_PROFILE;
  if (!profile) {
    throw new Error('Profile name is required for DM Responder Cron. Use --profile <name>.');
  }

  // Resolve accountId
  const account = await getOrCreateAccount(profile);
  const accountId = account.id;
  console.log(`👤 Profile: ${profile} (Account ID: ${accountId})`);

  let statuses = Array.isArray(options.statuses) && options.statuses.length > 0
    ? options.statuses
    : DEFAULT_STATUSES;

  if (options.repliedOnly) {
    console.log('   🎯 Filtering for CONVERSATION leads only (prospects who replied)');
    statuses = ['conversation'];
  }
  const limit = options.limit || 5;
  
  const threads = await getTrackedDmThreads({
    statuses,
    onlyWithUrl: true,
    limit,
    accountId // Filter threads by account
  });
  
  if (!threads || threads.length === 0) {
    console.log(`No active DM threads matched the criteria for account ${profile}.`);
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
    // Determine browser data dir
    const userDataDir = path.join(process.cwd(), `browser-data-${profile}`);

    // Step 1: Init browser (single login) - ALWAYS visible
    browser = await initBrowser({ 
      userDataDir,
      profile,
      headless: false // Always visible
    });
    
    // Load Profile Config
    const profileConfig = await loadProfileConfig(profile);
    if (profileConfig && profileConfig.niche) {
        console.log(`🧠 Using Niche strategy: ${profileConfig.niche}`);
    }

    // Step 2: Process each thread
    for (const thread of threads) {
      const result = await processThread(thread, { ...options, accountId, profile, profileConfig });
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
    // OPTIMIZATION: Pass dm_url so scraper can go there directly
    const scrapeResult = await openDMAndScrape({ 
      username, 
      profile_url: profileUrl,
      dm_url: thread.dm_url 
    });
    
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
    
    // Step 4: Determine if we should generate a response
    const lastMsg = updatedHistory.length > 0 ? updatedHistory[updatedHistory.length - 1] : null;
    let shouldGenerate = false;
    let skipReason = "";
    
    if (!lastMsg) {
      // Empty history - this can happen if outreach wasn't tracked properly
      // or if messages failed to scrape from the page. Skip for now.
      shouldGenerate = false;
      skipReason = "No conversation history found (DB empty, scrape 0)";
    } else if (lastMsg.role === 'user') {
      // Last message is from user - Always reply
      shouldGenerate = true;
    } else if (lastMsg.role === 'assistant') {
      // Last message from me - Wait for them to reply
      // The user requested to NOT auto-follow-up here.
      // Follow-ups should be handled by a specific 'relance' script if needed.
      shouldGenerate = false;
      skipReason = "Waiting for user reply (Last msg was assistant)";
    }
    
    if (!shouldGenerate) {
      console.log(`   ⏳ Skipping: ${skipReason}`);
      if (openTab) {
        // Close tab if we're not doing anything
        await openTab.close().catch(() => {});
      }
      return { success: true, skipped: true };
    }

    // Step 5: Generate response with FULL context (including newly saved messages)
    console.log(`   🤖 Generating response with ${updatedHistory.length} messages context...`);
    const response = await generateResponse({
      conversationHistory: updatedHistory,
      leadContext,
      profileConfig: options.profileConfig
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
    // Check for [ALERT_BOOKING] tag
    let finalMessage = message;
    if (finalMessage.includes('[ALERT_BOOKING]')) {
      console.log(`   🚨 BOOKING ALERT DETECTED! Sending system notification...`);
      finalMessage = finalMessage.replace('[ALERT_BOOKING]', '').trim();
      
      // Trigger macOS system notification
      try {
        const { exec } = await import('child_process');
        exec(`osascript -e 'display notification "Un prospect a donné ses disponibilités !" with title "IG Lead Engine: BOOKING ALERT" sound name "Glass"'`);
      } catch (err) {
        console.error('Failed to send notification:', err.message);
      }
      
      // Update lead status to stop automation and mark as booking pending
      await markThread(username, 'scheduling', thread.metadata, {
        booking_status: 'pending',
        last_checked_at: new Date().toISOString()
      });
      console.log(`   📅 Status updated to 'scheduling' (Automation Stopped)`);
    }

    const typeResult = await typeInOpenTab(openTab, finalMessage);
    
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
    registerOpenTab(username, openTab, finalMessage);
    
    // Step 6: Save the typed message as 'assistant' message
    console.log(`   💾 Saving typed message to DB...`);
    await addMessage(username, 'assistant', finalMessage, response.message_type || 'generated');
    
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
