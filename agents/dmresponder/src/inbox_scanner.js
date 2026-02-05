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
  MAX_SCROLLS: 15, // Increase scrolls to cover deep inbox
  DELAYS: {
    AFTER_NAVIGATION: 3500,
    AFTER_CLICK: 2500,
    AFTER_SCROLL: 1500,
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
async function scrollSidebarOnce(page) {
  return await page.evaluate(() => {
    // Find scrollable container
    const containers = document.querySelectorAll('div[style*="overflow"]');
    for (const container of containers) {
      const style = window.getComputedStyle(container);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        if (container.querySelector('img[alt*="profile" i]')) {
          container.scrollTop += 300;
          return true;
        }
      }
    }
    
    // Fallback
    const firstConv = document.querySelector('div[role="button"] img[alt*="profile" i]');
    if (firstConv) {
      let parent = firstConv.parentElement;
      while (parent) {
        const style = window.getComputedStyle(parent);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          parent.scrollTop += 300;
          return true;
        }
        parent = parent.parentElement;
      }
    }
    return false;
  });
}

/**
 * Get currently visible conversation items
 */
async function getVisibleConversations(page) {
  return await page.evaluate(() => {
    const conversations = [];
    const seenNames = new Set();
    
    const buttons = document.querySelectorAll('div[role="button"]');
    
    buttons.forEach((button) => {
      const hasProfileImage = button.querySelector('img[alt*="profile" i], img[alt*="picture" i]');
      const nameSpan = button.querySelector('span[title]');
      
      if (!hasProfileImage || !nameSpan) return;
      
      const name = nameSpan.getAttribute('title') || nameSpan.textContent || '';
      if (!name || seenNames.has(name)) return;
      seenNames.add(name);
      
      let isUnread = false;
      
      // Check for "Unread" text
      const allSpans = button.querySelectorAll('span');
      for (const span of allSpans) {
        const text = span.textContent || '';
        if (text === 'Unread' || text.includes('Unread')) {
          isUnread = true;
          break;
        }
      }
      
      // Check for blue dot
      const dotIndicator = button.querySelector('span[data-visualcompletion="ignore"] + div, .x6s0dn4.x1iwo8zk');
      if (dotIndicator) {
        isUnread = true;
      }
      
      const dirSpans = button.querySelectorAll('span[dir="auto"]');
      let preview = '';
      if (dirSpans.length >= 2) {
        preview = dirSpans[1]?.textContent?.trim() || '';
      }
      
      conversations.push({
        name,
        isUnread,
        preview: preview.substring(0, 60)
      });
    });
    
    return conversations;
  });
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
  if (!profile) {
    throw new Error('Profile name is required. Use --profile <name>.');
  }
  
  console.log(`\n========================================`);
  console.log(`   DM RESPONDER - INBOX SCANNER MODE`);
  console.log(`========================================`);
  console.log(`   Profile: ${profile}`);
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
      
      const visible = await getVisibleConversations(workingPage);
      
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
          
          // Expanded valid statuses: 'new' = manual outreach, not_interested = question-only check
          const validStatuses = ['new', 'conversation', 'outreach', 'contacted', 'replied', 'qualified', 'not_interested'];
          
          if (!validStatuses.includes(leadContext.status) || leadContext.is_ignored) {
            console.log(`   ⏭️ Lead @${username} (status: '${leadContext.status}', ignored: ${leadContext.is_ignored}) skipped.`);
            skippedCount++;
            continue;
          }

          // Skip booked leads and leads at conversation step 8+
          if (leadContext.booking_status === 'completed' || leadContext.booking_status === 'pending' || (leadContext.conversation_step && leadContext.conversation_step >= 8)) {
            console.log(`   ⏭️ Lead @${username} (booking: '${leadContext.booking_status}', step: ${leadContext.conversation_step}) - already booked or advanced. Skipped.`);
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

          // --- LOGIC: RESTRICT RESPONSES FOR 'NOT INTERESTED' (question-only) ---
          if (leadContext.status === 'not_interested') {
             const text = (lastMsg.text || '').trim();
             
             // Stricter check:
             // 1. Must contain a question mark
             // 2. OR be a common question starter (Est-ce que, Pourquoi, Comment, ...)
             // 3. AND must NOT be a common closing/thanking message
             const hasQuestionMark = text.includes('?');
             const questionStarters = ['pourquoi', 'comment', 'quand', 'est-ce', 'peux-tu', 'pouvez-vous', 'est ce', 't\'es qui', 'qui es-tu'];
             const startsWithQuestion = questionStarters.some(s => text.toLowerCase().startsWith(s));
             
             const closingWords = ['merci', 'thanks', 'ok', 'd\'accord', 'ca marche', 'ça marche', 'bonne soirée', 'bonne journée', 'super', 'cool'];
             const isClosing = closingWords.some(w => text.toLowerCase().includes(w)) && text.length < 30 && !hasQuestionMark;

             const isQuestion = (hasQuestionMark || startsWithQuestion) && !isClosing;
             
             if (!isQuestion) {
                 console.log(`   🛑 Status is '${leadContext.status}' and message is NOT a clear question ("${text}"). Keeping status as is and IGNORING.`);
                 // We do NOT respond. We treat it as "read and handled".
                 continue;
             } else {
                 console.log(`   ✅ Status is '${leadContext.status}' BUT user asked a question ("${text}"). Generating response.`);
             }
          }

          // 7. Generate Response (renumbered)
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

          // --- LOGIC: CALENDLY BOOKING ---
          if (response.booking_intent && response.booking_intent.email && (response.booking_intent.phone || response.booking_intent.email)) {
              console.log(`   📅 BOOKING INTENT DETECTED:`, response.booking_intent);
              try {
                  const { createBooking } = await import('../../../shared/utils/calendly.js');
                  const bookingResult = await createBooking(profile, {
                      startTime: response.booking_intent.slot,
                      email: response.booking_intent.email,
                      name: leadContext.fullName || username,
                      phone: response.booking_intent.phone
                  });
                  
                  if (bookingResult.success) {
                      console.log(`   ✅ Booking success: ${bookingResult.message}`);
                      
                      // Format the slot for the confirmation message
                      const slotDate = new Date(response.booking_intent.slot);
                      const day = slotDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
                      const hour = slotDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                      
                      const template = profileConfig.post_booking_message || "je te confirme notre rdv du {{day}} à {{hour}}";
                      const confirmationMsg = template
                          .replace('{{day}}', day)
                          .replace('{{hour}}', hour);
                      
                      console.log(`   📝 Using confirmation template: "${confirmationMsg}"`);
                      finalMessage = confirmationMsg;
                  }
              } catch (e) {
                  console.error(`   ❌ Booking failed:`, e.message);
              }
          }
          
          const profileUrl = `https://www.instagram.com/${username}/`;
          console.log(`\n   💬 SENDING RESPONSE:`);
          console.log(`   Profile: ${profileUrl}`);
          console.log(`   Message: "${message}"\n`);
          
          // 7. Special Tags Detection
          let finalMessage = message;
          let newStatus = 'conversation';
          let bookingStatus = null;
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
          }
          
          if (finalMessage.includes('[ALERT_BOOKING]')) {
            console.log(`   🚨 BOOKING ALERT!`);
            finalMessage = finalMessage.replace('[ALERT_BOOKING]', '').trim();
            newStatus = 'scheduling';
            bookingStatus = 'pending';
          }

          if (finalMessage.includes('[MANUAL]')) {
            console.log(`   🎤 MANUAL tag detected!`);
            finalMessage = finalMessage.replace('[MANUAL]', '').trim();
            newStatus = 'manual';
          }
          
          // 8. STORE RESULT
          await addMessage(username, 'assistant', finalMessage, response.message_type || 'generated');
          await setDmThreadStatus(username, newStatus, { 
            last_checked_at: new Date().toISOString(),
            booking_status: bookingStatus,
            conversation_step: detectedStep
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
        await scrollSidebarOnce(workingPage);
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
