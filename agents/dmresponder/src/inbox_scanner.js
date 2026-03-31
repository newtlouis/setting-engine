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
  getKnownLeadIdentifiers,
  getConversationHistory,
  addMessage,
  setDmThreadStatus,
  getVideoResources
} from './db_integration.js';
import { loadProfileConfig } from '../../../shared/utils/configLoader.js';
import { loadOutreachConfig } from '../../../shared/utils/outreachConfigLoader.js';

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  INBOX_URL: 'https://www.instagram.com/direct/inbox/',
  MAX_SCROLLS: 15, // Scan top conversations
  SCROLL_AMOUNT: 300, // Smaller scrolls for smooth loading
  DELAYS: {
    AFTER_NAVIGATION: 3500,
    AFTER_CLICK: 2500,
    AFTER_SCROLL: 1500, // Wait for conversations to load after scroll
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

      // --- UNREAD DETECTION (multiple strategies) ---

      // 1. Check font-weight of name span (bold = unread)
      const fontWeight = parseInt(window.getComputedStyle(nameSpan).fontWeight, 10);
      const isBold = fontWeight >= 600;

      // 2. Check font-weight of preview text too
      let isPreviewBold = false;
      if (dirSpans.length >= 2) {
        const previewWeight = parseInt(window.getComputedStyle(dirSpans[1]).fontWeight, 10);
        isPreviewBold = previewWeight >= 600;
      }

      // 3. Check for blue dot indicator (small circle with blue background)
      let hasBlueDot = false;
      const allElements = button.querySelectorAll('div, span');
      for (const el of allElements) {
        const style = window.getComputedStyle(el);
        const bg = style.backgroundColor;
        const w = parseInt(style.width, 10);
        const h = parseInt(style.height, 10);
        const radius = style.borderRadius;
        // Blue dot: small element (6-14px), circular, blue-ish background
        if (w >= 6 && w <= 14 && h >= 6 && h <= 14 && radius === '50%' &&
            (bg.includes('0, 149, 246') || bg.includes('0, 100, 224') || bg.includes('rgb(0,'))) {
          hasBlueDot = true;
          break;
        }
      }

      // 4. Check for "Unread" / "Non lu" text indicator
      let hasUnreadText = false;
      const allSpans = button.querySelectorAll('span');
      for (const span of allSpans) {
        const text = (span.textContent || '').trim().toLowerCase();
        if (text === 'unread' || text === 'non lu' || text === 'non lue') {
          hasUnreadText = true;
          break;
        }
      }

      // 5. Check aria-label on the button itself
      const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
      const hasUnreadAria = ariaLabel.includes('unread') || ariaLabel.includes('non lu');

      // Determine if unread
      let isUnread = false;

      // Default mode: Any unread indicator
      if (isBold || isPreviewBold || hasBlueDot || hasUnreadText || hasUnreadAria) {
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
      purpose: 'responder',
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

    // Load outreach config from DB (niche, post_booking_message, etc.)
    let outreachConfig = null;
    try {
      const { getDb } = await import('../../../agents/collector/src/db/core.js');
      const db = getDb();
      if (db) {
        const acc = db.prepare('SELECT id FROM accounts WHERE name = ?').get(profile);
        if (acc) {
          outreachConfig = loadOutreachConfig(acc.id, profileConfig);
        }
      }
    } catch (e) {}

    if (outreachConfig?.niche) {
      console.log(`   🧠 Using niche strategy: ${outreachConfig.niche}`);
    }
    
    await navigateToInbox(workingPage);

    // Load all known lead identifiers for sidebar pre-filtering
    const knownLeads = await getKnownLeadIdentifiers();
    console.log(`   🗂️ Loaded ${knownLeads.usernames.size} known leads for filtering`);

    // --- MAIN LOOP: SCAN -> PROCESS (Single Tab) ---

    for (let scrollIdx = 0; scrollIdx <= CONFIG.MAX_SCROLLS; scrollIdx++) {
      console.log(`\n   📜 Round ${scrollIdx + 1}: Scanning visible conversations...`);

      const visible = await getVisibleConversations(workingPage, allReplies);

      // Filter for actionable items: Unread AND Not Processed AND known in DB
      const actionable = visible.filter(c => {
        if (!c.isUnread || processedNames.has(c.name)) return false;
        // Match display name against known usernames or full_names
        // Instagram sidebar title can include bio/title after the name (e.g. "Carole Delarue Arrighi Coach en...")
        const nameLower = c.name.toLowerCase();
        if (knownLeads.usernames.has(nameLower) || knownLeads.displayNames.has(nameLower)) return true;
        // Normalize display name to username format and check prefix matches
        const nameAsUsername = nameLower.replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_.]/g, '');
        for (const uname of knownLeads.usernames) {
          // Exact match or the sidebar name starts with the username (name + title/bio appended)
          if (nameAsUsername === uname || nameAsUsername.startsWith(uname + '_')) return true;
        }
        return false;
      });
      
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
          
          // Valid statuses for processing
          const validStatuses = ['new', 'conversation', 'outreach', 'contacted', 'replied', 'qualified', 'scheduling'];
          const excludedStatuses = ['already_known', 'not_interested', 'ignored', 'failed'];

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
          if (leadContext.booking_status === 'confirmed' || leadContext.booking_status === 'completed') {
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
              await addMessage(username, msg.role, msg.text, null, null, msg.sentAt);
              updatedHistory.push(msg);
              if (msg.role === 'user' && msg.type === 'voice_note') {
                hasVoiceNote = true;
              }
            }
          }
          
          // 5. Voice note: treat as a normal reply and continue with the script
          if (hasVoiceNote) {
            console.log(`   🎤 VOICE NOTE DETECTED — treating as prospect reply, continuing script.`);
          }

          // 6. Check if response needed
          const lastMsg = updatedHistory.length > 0 ? updatedHistory[updatedHistory.length - 1] : null;

          // If conversation was unread in inbox but last scraped message is ours,
          // the prospect replied with something we can't read (voice note, image, sticker, etc.)
          // Treat it as a user reply so we continue the script.
          if (lastMsg && lastMsg.role === 'assistant' && !hasVoiceNote) {
            console.log(`   🎤 Conversation was unread but last message is ours — prospect likely sent media (voice/image/sticker). Treating as reply.`);
            hasVoiceNote = true;
            // Add a placeholder message so the LLM knows the prospect replied
            await addMessage(username, 'user', '[Message non-texte : vocal, image ou sticker]', null, null, null);
            updatedHistory.push({ role: 'user', text: '[Message non-texte : vocal, image ou sticker]', type: 'media' });
          }

          if (!lastMsg || (lastMsg.role !== 'user' && !hasVoiceNote)) {
            console.log(`   ⏳ Last message was not from user.`);
            continue;
          }

          // 6a. Not interested: only respond if they ask a question
          if (leadContext.status === 'not_interested') {
            const text = (lastMsg.text || '').trim();
            const hasQuestionMark = text.includes('?');
            const questionStarters = ['pourquoi', 'comment', 'quand', 'est-ce', 'peux-tu', 'pouvez-vous', 'est ce', 't\'es qui', 'qui es-tu', 'que proposes', 'c\'est quoi'];
            const startsWithQuestion = questionStarters.some(s => text.toLowerCase().startsWith(s));
            const closingWords = ['merci', 'thanks', 'ok', 'd\'accord', 'ca marche', 'ça marche', 'bonne soirée', 'bonne journée', 'super', 'cool'];
            const isClosing = closingWords.some(w => text.toLowerCase().includes(w)) && text.length < 30 && !hasQuestionMark;
            const isQuestion = (hasQuestionMark || startsWithQuestion) && !isClosing;

            if (!isQuestion) {
              console.log(`   ⏭️ Lead @${username} is 'not_interested' and message is not a question. Skipped.`);
              continue;
            }
            console.log(`   ❓ Lead @${username} is 'not_interested' but asked a question — responding.`);
          }

          // 6b. Auto-advance steps when prospect has replied
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

          // Dedup: skip if identical to last assistant message
          const lastAssistantMsg = [...updatedHistory].reverse().find(m => m.role === 'assistant');
          if (lastAssistantMsg && message.replace(/\[.*?\]\s*/g, '').trim().toLowerCase() === lastAssistantMsg.text.trim().toLowerCase()) {
            console.log(`   ⚠️ Duplicate message detected — marking as not_interested.`);
            await setDmThreadStatus(username, 'not_interested', { booking_status: 'cancelled' });
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
          // If we have a complete booking_intent from LLM, attempt booking via adapter
          if (response.booking_intent && response.booking_intent.slot && response.booking_intent.email) {
              bookingIntent = response.booking_intent;
              bookingStatus = 'pending';
              bookingAttempts++;

              console.log(`   📅 BOOKING INTENT DETECTED (attempt ${bookingAttempts}):`, bookingIntent);

              // Validate email format
              const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
              if (!emailRegex.test(bookingIntent.email)) {
                  console.log(`   ⚠️ Invalid email format: "${bookingIntent.email}" — skipping booking`);
                  bookingStatus = 'pending'; // Keep pending, need valid email
              } else {
                  try {
                      // Resolve the right booking adapter for this account
                      const { resolveBookingAdapter } = await import('../../../shared/infrastructure/booking/BookingAdapterFactory.js');
                      const { getDb } = await import('../../../agents/collector/src/db/core.js');

                      let adapter, adapterProfileName;
                      const acc = getDb().prepare('SELECT id FROM accounts WHERE name = ?').get(profile);
                      if (acc) {
                          const resolved = resolveBookingAdapter(getDb, acc.id);
                          adapter = resolved.adapter;
                          adapterProfileName = resolved.profileName;
                      } else {
                          const { createCalendlyAdapter } = await import('../../../shared/infrastructure/booking/CalendlyAdapter.js');
                          adapter = createCalendlyAdapter();
                          adapterProfileName = profile;
                      }

                      // Generate briefing early so it can be included in the event (Google Calendar)
                      let briefing = null;
                      try {
                          const { generateBriefing } = await import('../../../shared/domain/services/BriefingGenerator.js');
                          briefing = await generateBriefing(updatedHistory, leadContext);
                      } catch (briefingErr) {
                          console.error(`   ⚠️ Briefing generation failed (non-blocking):`, briefingErr.message);
                      }

                      const recentText = updatedHistory.slice(-10).map(m => m.text).join(' ');
                      const profileUrl = `https://www.instagram.com/${username}/`;

                      const bookingResult = await adapter.createBooking(adapterProfileName, {
                          startTime: bookingIntent.slot,
                          email: bookingIntent.email,
                          name: leadContext.fullName || username,
                          phone: bookingIntent.phone || null,
                          conversationHints: recentText,
                          briefing,
                          profileUrl
                      });

                      if (bookingResult.success) {
                          console.log(`   ✅ Booking CONFIRMED: ${bookingResult.message}`);
                          bookingStatus = 'confirmed';
                          bookingUrl = bookingResult.booking_url || null;

                          // Save briefing to lead notes
                          if (briefing) {
                              await setDmThreadStatus(username, leadContext.status || 'scheduling', { notes: briefing });
                              console.log(`   📋 Pre-call briefing saved for @${username}`);
                          }

                          // Format the slot for the confirmation message
                          const slotDate = new Date(bookingIntent.slot);
                          const day = slotDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
                          const hour = slotDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

                          const template = outreachConfig?.postBookingMessage || profileConfig?.post_booking_message || "je te confirme notre rdv du {{day}} à {{hour}} !";
                          finalMessage = template
                              .replace('{{day}}', day)
                              .replace('{{hour}}', hour);

                          // Append targeted video resource based on conversation blocage
                          try {
                              const { matchVideo } = await import('../../../shared/domain/services/VideoMatcher.js');
                              const videoEntries = await getVideoResources(leadContext.account_id);
                              if (videoEntries.length > 0) {
                                  const bestVideo = matchVideo(videoEntries, {
                                      conversationHistory: updatedHistory,
                                      leadContext,
                                      applicableContext: 'post_booking'
                                  });
                                  if (bestVideo) {
                                      finalMessage += `\n\nen attendant, cette vidéo pourrait t'intéresser 👇\n${bestVideo.video_url}`;
                                      console.log(`   🎬 Video resource appended: ${bestVideo.video_url}`);
                                  }
                              }
                          } catch (videoErr) {
                              console.error(`   ⚠️ Video matching failed (non-blocking):`, videoErr.message);
                          }

                          console.log(`   📝 Confirmation message: "${finalMessage}"`);
                      } else {
                          console.log(`   ⚠️ Booking FAILED: ${bookingResult.error}`);

                          // Re-fetch availability and propose alternatives
                          try {
                              const freshAvailability = await adapter.fetchAvailability(adapterProfileName);
                              const allSlots = [
                                  ...(freshAvailability.thisWeek?.primary || []),
                                  ...(freshAvailability.thisWeek?.backup || []),
                                  ...(freshAvailability.nextWeek?.primary || []),
                                  ...(freshAvailability.nextWeek?.backup || [])
                              ];

                              if (allSlots.length > 0) {
                                  const formatAlt = (s) => {
                                      const d = new Date(s.start_time);
                                      return d.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
                                  };
                                  const alternatives = allSlots.slice(0, 3).map(formatAlt);
                                  finalMessage = `Oups, ce créneau n'est plus dispo 😅 Voici d'autres possibilités :\n${alternatives.map(a => `- ${a}`).join('\n')}\nEst-ce qu'un de ces créneaux te conviendrait ? 🌸`;
                                  console.log(`   🔄 Proposing ${alternatives.length} alternative slots`);
                              } else {
                                  finalMessage = `Oups, ce créneau n'est plus disponible 😅 Est-ce que tu aurais d'autres disponibilités cette semaine ? Je regarde de mon côté aussi 🌸`;
                              }
                          } catch (altErr) {
                              console.error(`   ⚠️ Could not fetch alternatives:`, altErr.message);
                              finalMessage = `Oups, ce créneau n'est plus disponible 😅 Est-ce que tu aurais d'autres disponibilités ? 🌸`;
                          }

                          bookingStatus = 'failed';
                          newStatus = 'scheduling';
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
      
      // Notify user that messages are ready for review
      if (getOpenMessageTabs().length > 0) {
        try {
          const { execSync } = await import('child_process');
          execSync('afplay /System/Library/Sounds/Hero.aiff; afplay /System/Library/Sounds/Hero.aiff; afplay /System/Library/Sounds/Hero.aiff');
        } catch { /* ignore sound errors */ }

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
