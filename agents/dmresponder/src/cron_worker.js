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
  fullUpsertLead,
  getOrCreateAccount
} from './db_integration.js';
import { loadProfileConfig } from '../../../shared/utils/configLoader.js';
import { loadOutreachConfig } from '../../../shared/utils/outreachConfigLoader.js';
import { runInboxScanner } from './inbox_scanner.js';

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

  // INBOX SCANNER MODE: Scan inbox directly instead of opening each URL
  if (options.inboxMode) {
    console.log('   📬 INBOX SCANNER MODE ACTIVATED');
    return await runInboxScanner({ profile, ...options });
  }

  // Resolve accountId
  const account = await getOrCreateAccount(profile);
  const accountId = account.id;
  console.log(`👤 Profile: ${profile} (Account ID: ${accountId})`);

  let statuses = Array.isArray(options.statuses) && options.statuses.length > 0
    ? options.statuses
    : DEFAULT_STATUSES;

  if (options.conversationOnly) {
    console.log('   🎯 Filtering for CONVERSATION leads only (prospects who replied)');
    statuses = ['conversation'];
  } else if (options.outreachOnly) {
    console.log('   🎯 Filtering for OUTREACH leads only (waiting for first reply)');
    statuses = ['outreach'];
  }
  const limit = options.limit || 1000;
  
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

  // Pre-process threads for auto-expiration (Outreach only)
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const now = new Date();
  const validThreads = [];

  for (const thread of threads) {
      if (thread.status === 'outreach' && thread.last_contact_at) {
          const lastContact = new Date(thread.last_contact_at);
          const diff = now - lastContact;
          

          if (diff > SEVEN_DAYS_MS) {
              console.log(`   ⏳ @${thread.username}: No response for 7+ days. Deactivating...`);
              await markThread(thread.username, 'failed', thread.metadata, {
                  last_error: 'Auto-expired: No response after 7 days',
                  last_checked_at: now.toISOString()
              });
              continue; // Skip this one
          }
      }
      validThreads.push(thread);
  }

  if (validThreads.length === 0) {
      console.log(`\n✅ Done! No valid threads left to process after expiration check.`);
      return;
  }

  console.log(`\n========================================`);
  console.log(`   DM RESPONDER (Multi-Tab Mode)`);
  console.log(`========================================`);
  console.log(`   Found ${validThreads.length} conversation(s) to process`);
  console.log(`   Messages will be typed but NOT sent automatically.\n`);
  
  let browser = null;
  let successCount = 0;
  
  try {
    // Step 1: Init browser (single login) - ALWAYS visible
    browser = await initBrowser({
      profile,
      purpose: 'responder',
      headless: false // Always visible
    });
    
    // Load Profile Config
    const profileConfig = await loadProfileConfig(profile);
    const outreachConfig = loadOutreachConfig(accountId, profileConfig);
    if (outreachConfig.niche) {
        console.log(`🧠 Using Niche strategy: ${outreachConfig.niche}`);
    }

    // Step 2: Process each thread
    for (const thread of validThreads) {
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
    // Ensure stdin doesn't keep the process running
    process.stdin.pause();
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

    // Skip booked leads
    if (leadContext?.booking_status === 'confirmed' || leadContext?.booking_status === 'completed') {
      console.log(`   ⏭️ Lead @${username} (booking: '${leadContext.booking_status}') - already booked. Skipped.`);
      return { success: false, skipped: true };
    }

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
          await addMessage(username, msg.role, msg.text, null, null, msg.sentAt);
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
      // Last message is from user - Always reply UNLESS it's a 'not_interested' lead without a question
      shouldGenerate = true;
      
      if (leadContext?.status === 'already_known') {
         console.log(`   🛑 Lead is 'already_known' — skipping entirely.`);
         shouldGenerate = false;
      } else if (leadContext?.status === 'not_interested') {
         const text = (lastMsg.text || '').trim();
         const hasQuestionMark = text.includes('?');
         const questionStarters = ['pourquoi', 'comment', 'quand', 'est-ce', 'peux-tu', 'pouvez-vous', 'est ce', 't\'es qui', 'qui es-tu'];
         const startsWithQuestion = questionStarters.some(s => text.toLowerCase().startsWith(s));
         
         const closingWords = ['merci', 'thanks', 'ok', 'd\'accord', 'ca marche', 'ça marche', 'bonne soirée', 'bonne journée', 'super', 'cool'];
         const isClosing = closingWords.some(w => text.toLowerCase().includes(w)) && text.length < 30 && !hasQuestionMark;

         const isQuestion = (hasQuestionMark || startsWithQuestion) && !isClosing;
         
         if (!isQuestion) {
             shouldGenerate = false;
             skipReason = `Lead is '${leadContext.status}' and message is NOT a clear question ("${text}")`;
         }
      }
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

    // Auto-advance steps when prospect has replied
    if (leadContext.funnel_step === 1 && updatedHistory.some(m => m.role === 'user')) {
      console.log(`   📍 Auto-advancing from step 1 → 2 (prospect replied)`);
      leadContext.funnel_step = 2;
      await setDmThreadStatus(username, 'conversation', { funnel_step: 2 });
    }
    // Note: pas d'auto-advance 2→3, le LLM gère la transition
    // (il doit d'abord évaluer si le prospect est intéressé ou non via le script step 2)
    // Auto-advance step 5→6: prospect replied to call proposal → propose slots
    if (leadContext.funnel_step === 5) {
      const lastAssistant = [...updatedHistory].reverse().find(m => m.role === 'assistant');
      const callProposed = lastAssistant && /30 min|appel|se call|on prenne|dispo/.test(lastAssistant.text || '');
      if (callProposed && updatedHistory[updatedHistory.length - 1]?.role === 'user') {
        console.log(`   📍 Auto-advancing from step 5 → 6 (prospect replied to call proposal)`);
        leadContext.funnel_step = 6;
        await setDmThreadStatus(username, 'conversation', { funnel_step: 6 });
      }
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

    // Dedup: skip if identical to last assistant message
    const lastAssistantMsg = [...updatedHistory].reverse().find(m => m.role === 'assistant');
    if (lastAssistantMsg && message.replace(/\[.*?\]\s*/g, '').trim().toLowerCase() === lastAssistantMsg.text.trim().toLowerCase()) {
      console.log(`   ⚠️ Duplicate message detected — marking as not_interested.`);
      await markThread(username, 'not_interested', thread.metadata, { booking_status: 'cancelled' });
      await openTab.close().catch(() => {});
      return { success: false };
    }

    console.log(`\n   💬 SENDING RESPONSE:`);
    console.log(`   Profile: ${profileUrl}`);
    console.log(`   Message: "${message}"\n`);
    
    // Save suggestion to file
    const suggestionPath = await saveSuggestion(username, response, options.outputDir || DEFAULT_OUTPUT_DIR);
    
    // Step 5: Update funnel step if LLM detected one (never go backward)
    if (response.step_used) {
        const newStep = Math.floor(parseFloat(response.step_used));
        const currentStep = leadContext.funnel_step || 0;
        const effectiveStep = Math.max(newStep, currentStep);
        if (effectiveStep !== currentStep) {
            console.log(`   📈 Updating funnel step: ${currentStep} → ${effectiveStep}`);
        }
        await fullUpsertLead(username, options.accountId, {
            funnel_step: effectiveStep
        });
    }

    // Step 6: Type message in the already-open tab
    // Check for special tags
    let finalMessage = message;
    let newStatus = 'conversation';
    let bookingStatus = null;

    if (finalMessage.includes('[NOT_INTERESTED]')) {
      console.log(`   ⛔ NOT INTERESTED tag detected!`);
      finalMessage = finalMessage.replace('[NOT_INTERESTED]', '').trim();
      newStatus = 'not_interested';
      bookingStatus = 'cancelled';
    }

    if (finalMessage.includes('[MANUAL]')) {
      console.log(`   🎤 MANUAL tag detected!`);
      finalMessage = finalMessage.replace('[MANUAL]', '').trim();
      newStatus = 'manual';
    }

    if (finalMessage.includes('[ALERT_BOOKING]')) {
      console.log(`   🚨 BOOKING ALERT DETECTED! Sending system notification...`);
      finalMessage = finalMessage.replace('[ALERT_BOOKING]', '').trim();
      newStatus = 'scheduling';
      bookingStatus = 'proposed';

      // Trigger macOS system notification
      try {
        const { exec } = await import('child_process');
        exec(`osascript -e 'display notification "Un prospect a donné ses disponibilités !" with title "IG Lead Engine: BOOKING ALERT" sound name "Glass"'`);
      } catch (err) {
        console.error('Failed to send notification:', err.message);
      }

      console.log(`   📅 Status update to 'scheduling' — booking_status: proposed`);
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
      newStatus,
      thread.metadata,
      {
        last_checked_at: new Date().toISOString(),
        last_message_preview: finalMessage.substring(0, 100),
        booking_status: bookingStatus
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
