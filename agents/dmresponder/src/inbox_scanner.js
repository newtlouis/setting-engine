/**
 * @file Inbox Scanner for DM Responder
 * 
 * Scans the Instagram inbox directly to find and process unread conversations.
 * Uses a "Process-as-you-Scroll" approach:
 * 1. Scan visible unread conversations
 * 2. Process them immediately (Click -> Respond)
 * 3. Store results in memory
 * 4. At the end, open ALL processed conversations in tabs for manual review/sending
 */

import { 
  initBrowser, 
  scrapeConversationMessages,
  typeInOpenTab,
  registerOpenTab,
  waitForUserToFinish,
  closeBrowser,
  getOpenMessageTabs
} from './scraper.js';
import { generateResponse } from './engine.js';
import {
  initDB,
  getLeadWithContext,
  getConversationHistory,
  addMessage,
  setDmThreadStatus
} from './db_integration.js';
import { loadProfileConfig } from '../../../shared/utils/configLoader.js';

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  INBOX_URL: 'https://www.instagram.com/direct/inbox/',
  MAX_SCROLLS: 50, // Cover deep inbox (position 30+)
  SCROLL_AMOUNT: 300, // Smaller scrolls for smooth loading
  DELAYS: {
    AFTER_NAVIGATION: 3500,
    AFTER_CLICK: 2500,
    AFTER_SCROLL: 1000, // Wait for conversations to load
    BETWEEN_CONVERSATIONS: 1500
  }
};

// ============================================
// UTILITIES
// ============================================
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Navigate to the Instagram inbox
 */
async function navigateToInbox(page) {
  console.log(`   Navigating to inbox...`);
  await page.goto(CONFIG.INBOX_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await delay(CONFIG.DELAYS.AFTER_NAVIGATION);
  
  // Wait for conversation list to load
  try {
    await page.waitForSelector('div[role="listbox"], div[role="list"]', { timeout: 10000 });
    console.log(`   ✅ Inbox loaded`);
    return true;
  } catch (e) {
    console.log(`   ⚠️ Could not detect conversation list, continuing anyway...`);
    return true;
  }
}

/**
 * Perform a single scroll action in the sidebar
 */
async function scrollSidebarOnce(page, amount = 300) {
  return await page.evaluate((scrollAmount) => {
    // Find first scrollable div that contains conversations (span[title])
    const allDivs = document.querySelectorAll('div');

    for (const div of allDivs) {
      // Check if this div is scrollable (scrollHeight > clientHeight)
      if (div.scrollHeight > div.clientHeight + 50) {
        // Check if it contains conversation items
        const hasConversations = div.querySelector('span[title]');
        if (hasConversations) {
          const before = div.scrollTop;
          div.scrollTop += scrollAmount;

          if (div.scrollTop !== before) {
            return { scrolled: true, method: 'conversation-container', scrollTop: div.scrollTop };
          }
        }
      }
    }

    return { scrolled: false, method: 'none' };
  }, amount);
}

/**
 * Get currently visible conversation items
 * @param {Page} page - Playwright page
 * @param {boolean} allReplies - If true, detect all conversations where last msg is not from us
 */
async function getVisibleConversations(page, allReplies = false) {
  return await page.evaluate((detectAllReplies) => {
    const conversations = [];
    const seenNames = new Set();

    // System messages to ignore (not real user messages)
    const SYSTEM_MESSAGE_PATTERNS = [
      'Ce compte ne peut pas recevoir',
      'This account cannot receive',
      'A réagi',
      'Reacted to',
      'a partagé',
      'shared a'
    ];

    const buttons = document.querySelectorAll('div[role="button"]');

    buttons.forEach((button) => {
      const nameSpan = button.querySelector('span[title]');
      if (!nameSpan) return;

      const name = nameSpan.getAttribute('title') || nameSpan.textContent || '';
      if (!name || seenNames.has(name)) return;
      seenNames.add(name);

      // Get preview from dir="auto" spans
      let preview = '';
      const dirSpans = button.querySelectorAll('span[dir="auto"]');
      if (dirSpans.length >= 2) {
        preview = dirSpans[1]?.textContent?.trim() || '';
      }

      // Check font-weight (600 = unread on Instagram)
      const fontWeight = window.getComputedStyle(nameSpan).fontWeight;
      const isBold = fontWeight === '600' || fontWeight === '700';

      // Check for "Unread" text indicator
      let hasUnreadText = false;
      const allSpans = button.querySelectorAll('span');
      for (const span of allSpans) {
        const text = (span.textContent || '').trim().toLowerCase();
        if (text === 'unread' || text === 'non lu' || text === 'non lue') {
          hasUnreadText = true;
          break;
        }
      }

      // Determine if unread
      let isUnread = false;

      // Default mode: Only bold text OR "Unread" indicator (strict)
      if (isBold || hasUnreadText) {
        isUnread = true;
      }
      // --all mode: Also detect replies without "Vous:" prefix
      else if (detectAllReplies && preview && !preview.startsWith('Vous:') && !preview.startsWith('You:') && !preview.startsWith('Vous :')) {
        isUnread = true;
      }

      // Exclude system messages (not real replies)
      if (isUnread && preview) {
        for (const pattern of SYSTEM_MESSAGE_PATTERNS) {
          if (preview.includes(pattern)) {
            isUnread = false;
            break;
          }
        }
      }

      conversations.push({
        name,
        isUnread,
        preview: preview.substring(0, 60)
      });
    });

    return conversations;
  }, allReplies);
}

/**
 * Click on a conversation by its NAME
 */
async function clickConversationByName(page, targetName) {
  const clicked = await page.evaluate((name) => {
    const buttons = document.querySelectorAll('div[role="button"]');
    
    for (const button of buttons) {
      const nameSpan = button.querySelector('span[title]');
      if (nameSpan) {
        const buttonName = nameSpan.getAttribute('title') || nameSpan.textContent || '';
        if (buttonName === name) {
          button.click();
          button.scrollIntoView({ block: 'center', behavior: 'instant' }); 
          return true;
        }
      }
    }
    return false;
  }, targetName);
  
  if (clicked) {
    await delay(CONFIG.DELAYS.AFTER_CLICK);
  }
  
  return clicked;
}

/**
 * Extract username from conversation header
 */
async function extractUsernameFromConversation(page) {
  await delay(800);
  
  const username = await page.evaluate(() => {
    const mainArea = document.querySelector('div[role="main"]');
    if (mainArea) {
      const links = mainArea.querySelectorAll('a[href^="/"]');
      for (const link of links) {
        const href = link.getAttribute('href');
        if (href && href.match(/^\/[a-zA-Z0-9._]+\/?$/) && !href.includes('direct') && !href.includes('explore')) {
          return href.replace(/\//g, '');
        }
      }
    }
    
    // Fallback: aria-labels
    const profileLink = document.querySelector('a[aria-label*="profil" i], a[aria-label*="profile page" i]');
    if (profileLink) {
      const href = profileLink.getAttribute('href');
      if (href) {
        const match = href.match(/\/([a-zA-Z0-9._]+)\/?$/);
        if (match) return match[1];
      }
    }
    
    // Fallback: Header H1
    const headerTitle = document.querySelector('div[role="main"] header h1, div[role="main"] h1');
    if (headerTitle) {
      return headerTitle.textContent?.trim();
    }
    
    return null;
  });
  
  return username;
}

/**
 * Find new messages
 */
function findNewMessages(scrapedMessages, dbHistory) {
  if (!scrapedMessages || scrapedMessages.length === 0) return [];
  if (!dbHistory || dbHistory.length === 0) return scrapedMessages;
  
  const existingTexts = new Set(dbHistory.map(m => m.text?.trim().toLowerCase()));
  
  return scrapedMessages.filter(msg => {
    const normalizedText = msg.text?.trim().toLowerCase();
    return !existingTexts.has(normalizedText);
  });
}

// ============================================
// MAIN INBOX SCANNER
// ============================================

export async function runInboxScanner(options = {}) {
  await initDB();

  const profile = options.profile || process.env.IG_PROFILE;
  const allReplies = options.all || options.allReplies || false;

  if (!profile) {
    throw new Error('Profile name is required. Use --profile <name>.');
  }

  console.log(`\n========================================`);
  console.log(`   DM RESPONDER - INBOX SCANNER MODE`);
  console.log(`========================================`);
  console.log(`   Profile: ${profile}`);
  console.log(`   Detection: ${allReplies ? 'All replies (--all)' : 'Unread only (bold + indicator)'}`);
  console.log(`   Strategy: Process-as-you-Scroll + Manual Review Tabs`);
  
  let browser = null;
  let browserContext = null; // Need context to open new pages
  let workingPage = null;
  let skippedCount = 0;
  
  // Store processed results for final report and review
  const processedResults = [];
  const processedNames = new Set();
  
  try {
    const browserResult = await initBrowser({ 
      profile,
      headless: false
    });
    const contextObj = browserResult.browser;
    
    // Check if it's a Browser (has contexts function) or Context (persistent)
    if (contextObj.contexts && typeof contextObj.contexts === 'function') {
      browser = contextObj;
      browserContext = browserResult.context || browser.contexts()[0];
    } else {
      browserContext = contextObj;
    }
    workingPage = browserResult.page;
    
    // Ensure we have a context
    if (!browserContext && workingPage) {
        browserContext = workingPage.context(); 
    }

    const profileConfig = await loadProfileConfig(profile);
    if (profileConfig?.niche) {
      console.log(`   🧠 Using niche strategy: ${profileConfig.niche}`);
    }
    
    await navigateToInbox(workingPage);
    
    // --- MAIN LOOP: SCAN -> PROCESS (Single Tab) ---
    
    for (let scrollIdx = 0; scrollIdx <= CONFIG.MAX_SCROLLS; scrollIdx++) {
      console.log(`\n   📜 Round ${scrollIdx + 1}: Scanning visible conversations...`);
      
      const visible = await getVisibleConversations(workingPage, allReplies);
      
      // Filter for actionable items: Unread AND Not Processed
      const actionable = visible.filter(c => c.isUnread && !processedNames.has(c.name));
      
      if (actionable.length > 0) {
        console.log(`      Found ${actionable.length} NEW unread conversation(s). Processing...`);
        
        for (const conv of actionable) {
          console.log(`\n   --- Analyzing: ${conv.name} ---`);
          processedNames.add(conv.name); // Mark as processed
          
          // 1. Click (it is visible now)
          const clicked = await clickConversationByName(workingPage, conv.name);
          if (!clicked) {
            console.log(`   ⚠️ Could not click conversation. Skipping.`);
            skippedCount++;
            continue;
          }
          
          // Get current URL to re-open it later
          const conversationUrl = workingPage.url();

          // 2. Extract Username
          const username = await extractUsernameFromConversation(workingPage);
          if (!username) {
            console.log(`   ⚠️ Could not extract username.`);
            skippedCount++;
            continue;
          }
          console.log(`   👤 Username: @${username}`);
          
          // 3. Database Check
          const leadContext = await getLeadWithContext(username);
          if (!leadContext) {
            console.log(`   ⏭️ Not in DB, skipping.`);
            skippedCount++;
            continue;
          }
          
          // Valid statuses for processing (exclude not_interested, already_known)
          const validStatuses = ['new', 'conversation', 'outreach', 'contacted', 'replied', 'qualified'];
          const excludedStatuses = ['not_interested', 'already_known', 'ignored', 'failed'];

          if (excludedStatuses.includes(leadContext.status) || leadContext.is_ignored) {
            console.log(`   ⏭️ Lead @${username} (status: '${leadContext.status}') excluded.`);
            skippedCount++;
            continue;
          }

          if (!validStatuses.includes(leadContext.status)) {
            console.log(`   ⏭️ Lead @${username} (status: '${leadContext.status}') not in valid statuses.`);
            skippedCount++;
            continue;
          }

          // Skip booked leads and leads at funnel step 8+
          if (leadContext.booking_status === 'completed' || leadContext.booking_status === 'pending') {
            console.log(`   ⏭️ Lead @${username} (booking: '${leadContext.booking_status}') - already booked. Skipped.`);
            skippedCount++;
            continue;
          }

          if (leadContext.funnel_step && leadContext.funnel_step >= 8) {
            console.log(`   ⏭️ Lead @${username} (funnel_step: ${leadContext.funnel_step}) - workflow complete. Skipped.`);
            skippedCount++;
            continue;
          }

          // 4. Scrape & Process
          console.log(`   📖 Scraping...`);
          const scrapedMessages = await scrapeConversationMessages(workingPage);
          
          const existingHistory = await getConversationHistory(username);
          const newMessages = findNewMessages(scrapedMessages, existingHistory);
          
          let updatedHistory = [...existingHistory];
          let hasVoiceNote = false;

          if (newMessages.length > 0) {
            console.log(`   💾 Saving ${newMessages.length} new message(s)`);
            for (const msg of newMessages) {
              await addMessage(username, msg.role, msg.text);
              updatedHistory.push(msg);
              if (msg.role === 'user' && msg.type === 'voice_note') {
                hasVoiceNote = true;
              }
            }
          }
          
          // 5. Check if manual response needed (Voice Note)
          if (hasVoiceNote) {
            console.log(`   🎤 VOICE NOTE DETECTED! Setting status to 'manual'.`);
            await setDmThreadStatus(username, 'manual', { 
              last_checked_at: new Date().toISOString(),
              notes: "Vocal reçu - nécessite une réponse manuelle."
            });
            processedResults.push({
               username,
               name: conv.name,
               message: "[VOCAL REÇU - RÉPONSE MANUELLE REQUISE]",
               url: conversationUrl,
               isManual: true
            });
            continue; // Skip AI response generation
          }

          // 6. Check if response needed
          const lastMsg = updatedHistory.length > 0 ? updatedHistory[updatedHistory.length - 1] : null;
          if (!lastMsg || lastMsg.role !== 'user') {
            console.log(`   ⏳ Last message was not from user.`);
            continue;
          }

          // 7. Generate Response
          console.log(`   🤖 Generating response...`);
          const response = await generateResponse({
            conversationHistory: updatedHistory,
            leadContext,
            profileConfig
          });
          
          const message = response.next_message || response.message;
          if (!message) {
            console.log(`   ⚠️ No message generated.`);
            continue;
          }

          const profileUrl = `https://www.instagram.com/${username}/`;
          console.log(`\n   💬 SENDING RESPONSE:`);
          console.log(`   Profile: ${profileUrl}`);
          console.log(`   Message: "${message}"\n`);

          // 7. Special Tags Detection
          let finalMessage = message;
          let newStatus = 'conversation';
          let bookingStatus = null;
          let bookingIntent = null;
          let bookingUrl = null;
          let bookingAttempts = leadContext.booking_attempts || 0;
          let detectedStep = response.step_used || null;

          // Extract [STEP_X] label
          const stepMatch = finalMessage.match(/^\[STEP_([\d.]+)\]/i);
          if (stepMatch) {
            detectedStep = stepMatch[1];
            console.log(`   📍 STEP DETECTED: ${detectedStep}`);
            finalMessage = finalMessage.replace(/^\[STEP_[\d.]+\]\s*/i, '').trim();
          }

          if (finalMessage.includes('[NOT_INTERESTED]')) {
            console.log(`   ⛔ NOT INTERESTED tag detected!`);
            finalMessage = finalMessage.replace('[NOT_INTERESTED]', '').trim();
            newStatus = 'not_interested';
            bookingStatus = 'cancelled';
          }

          if (finalMessage.includes('[ALERT_BOOKING]')) {
            console.log(`   🚨 BOOKING ALERT!`);
            finalMessage = finalMessage.replace('[ALERT_BOOKING]', '').trim();
            newStatus = 'scheduling';
            bookingStatus = 'proposed';
          }

          if (finalMessage.includes('[MANUAL]')) {
            console.log(`   🎤 MANUAL tag detected!`);
            finalMessage = finalMessage.replace('[MANUAL]', '').trim();
            newStatus = 'manual';
          }

          // --- BOOKING STATE MACHINE ---
          // If we have a complete booking_intent from LLM, attempt Calendly booking
          if (response.booking_intent && response.booking_intent.slot && response.booking_intent.email) {
              bookingIntent = response.booking_intent;
              bookingStatus = 'pending';
              bookingAttempts++;

              console.log(`   📅 BOOKING INTENT DETECTED (attempt ${bookingAttempts}):`, bookingIntent);

              // Validate email format
              const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
              if (!emailRegex.test(bookingIntent.email)) {
                  console.log(`   ⚠️ Invalid email format: "${bookingIntent.email}" — skipping Calendly`);
                  bookingStatus = 'pending'; // Keep pending, need valid email
              } else {
                  try {
                      const { createBooking } = await import('../../../shared/utils/calendly.js');
                      const bookingResult = await createBooking(profile, {
                          startTime: bookingIntent.slot,
                          email: bookingIntent.email,
                          name: leadContext.fullName || username,
                          phone: bookingIntent.phone || null
                      });

                      if (bookingResult.success) {
                          console.log(`   ✅ Booking CONFIRMED: ${bookingResult.message}`);
                          bookingStatus = 'confirmed';
                          bookingUrl = bookingResult.booking_url || null;

                          // Format the slot for the confirmation message
                          const slotDate = new Date(bookingIntent.slot);
                          const day = slotDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
                          const hour = slotDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

                          const template = profileConfig.post_booking_message || "je te confirme notre rdv du {{day}} à {{hour}} !";
                          finalMessage = template
                              .replace('{{day}}', day)
                              .replace('{{hour}}', hour);

                          console.log(`   📝 Confirmation message: "${finalMessage}"`);
                      } else {
                          console.log(`   ⚠️ Calendly API returned failure: ${bookingResult.message}`);
                          bookingStatus = 'failed';
                          // Keep original message, don't confirm what didn't happen
                      }
                  } catch (e) {
                      console.error(`   ❌ Booking API error (attempt ${bookingAttempts}):`, e.message);
                      bookingStatus = 'failed';
                      // Keep original message
                  }
              }
          }

          // 8. STORE RESULT
          await addMessage(username, 'assistant', finalMessage, response.message_type || 'generated');
          await setDmThreadStatus(username, newStatus, {
            last_checked_at: new Date().toISOString(),
            booking_status: bookingStatus,
            booking_intent: bookingIntent,
            booking_url: bookingUrl,
            booking_attempts: bookingAttempts,
            funnel_step: detectedStep ? Math.floor(parseFloat(detectedStep)) : null
          });
          
          processedResults.push({
             username,
             name: conv.name,
             message: finalMessage,
             url: conversationUrl
          });

          console.log(`   ✅ Response prepared for review.`);
          
          // Small delay before next item
          await delay(CONFIG.DELAYS.BETWEEN_CONVERSATIONS);
        }
        
      } else {
        // No actionable items found
      }
      
      // Scroll for next round
      if (scrollIdx < CONFIG.MAX_SCROLLS) {
        const scrollResult = await scrollSidebarOnce(workingPage, CONFIG.SCROLL_AMOUNT);
        if (!scrollResult.scrolled && scrollIdx > 5) {
          console.log(`   ⚠️ Scroll stopped working at round ${scrollIdx + 1}`);
          break; // Stop if we can't scroll anymore
        }
        await delay(CONFIG.DELAYS.AFTER_SCROLL);
      }
    }
    
    // --- FINAL REPORT & REVIEW TABS ---
    
    console.log(`\n========================================`);
    console.log(`   🎉 SCAN COMPLETE - SUMMARY`);
    console.log(`========================================`);
    console.log(`Total Scanned: ${processedNames.size}`);
    console.log(`Processed: ${processedResults.length}`);
    console.log(`Skipped: ${skippedCount}\n`);
    
    if (processedResults.length > 0) {
      console.log(`\n--- DETAILED SUMMARY ---`);
      processedResults.forEach((r, i) => {
          console.log(`\n[${i+1}] @${r.username} (${r.name})`);
          console.log(`URL: ${r.url}`);
          console.log(`Response: "${r.message}"`);
          console.log(`----------------------------------------`);
      });
      
      console.log(`\nRequested Action: OPENING TABS FOR MANUAL REVIEW...`);
      console.log(`Each message will be re-typed in a new tab for you to send.\n`);
      
      // Open a tab for each processed result
      for (const result of processedResults) {
          try {
              console.log(`   Opening tab for @${result.username}...`);
              const newPage = await browserContext.newPage();
              await newPage.goto(result.url, { waitUntil: 'domcontentloaded' });
              
              // Re-type the message (only if not manual/voice note)
              await delay(1000);
              
              if (result.isManual) {
                  console.log(`     ℹ️  Manual/Voice Note: Tab opened, but skipping typing.`);
                  // Still register it so it waits for user to close
                  registerOpenTab(result.username, newPage, ""); 
              } else {
                  const typeRes = await typeInOpenTab(newPage, result.message);
                  
                  if (typeRes.success) {
                      console.log(`     ✅ Typed response for ${result.username}`);
                      // Register for the final wait loop
                      registerOpenTab(result.username, newPage, result.message);
                  } else {
                      console.log(`     ❌ Failed to type for ${result.username}`);
                  }
              }
          } catch (err) {
              console.error(`     ❌ Error opening tab for ${result.username}: ${err.message}`);
          }
      }
      
      // Wait for user to act
      if (getOpenMessageTabs().length > 0) {
        await waitForUserToFinish();
      }
      
    } else {
        console.log(`No messages processed to review.`);
    }

    
  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    if (process.env.DEBUG === 'true') {
      console.error(error.stack);
    }
  } finally {
    await closeBrowser();
    // Ensure stdin doesn't keep the process running
    process.stdin.pause();
  }
}
