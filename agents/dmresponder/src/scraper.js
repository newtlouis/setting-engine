/**
 * @file Manages browser automation with Playwright to scrape and interact with Instagram DMs.
 *
 * WORKFLOW (like Outreach agent):
 * - Uses persistent browser context (session saved to ./browser-data)
 * - Single login, multiple tabs for each lead
 * - Types response and leaves tab open for manual send
 */

import path from 'path';
import dotenv from 'dotenv';
import { createInterface } from 'readline';
import { applyStealthToPage } from '../../../shared/stealth.js';
import { verifyProfilePage, checkForChallenge } from '../../../shared/pageVerification.js';
import { BrowserService, delay, typeFast, typeHumanLike, gotoWithRetry } from '../../../shared/browser/index.js';
import { CONTACT_BUTTON, MESSAGE_INPUT } from '../../../shared/config/selectors.js';

dotenv.config();

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  HEADLESS: process.env.HEADLESS === 'true',
  SLOW_MO: parseInt(process.env.SLOW_MO, 10) || 80,
  PAGE_TIMEOUT: parseInt(process.env.PAGE_TIMEOUT, 10) || 60000
};

// ============================================
// BROWSER STATE (Module-level)
// ============================================
let browserContext = null;
let workingPage = null;
let messageTabs = [];
let browserSession = null; // BrowserService session reference

// ============================================
// BROWSER INIT & SESSION
// ============================================

/**
 * Initialize browser with persistent session.
 * Uses BrowserService for centralized browser management.
 *
 * @param {Object} options
 * @returns {Promise<{browser, page}>}
 */
export async function initBrowser(options = {}) {
  const {
    profile = process.env.IG_PROFILE,
    headless = CONFIG.HEADLESS,
    purpose = null
  } = options;

  if (!profile) {
    throw new Error('Profile name is required. Use --profile <name> or set IG_PROFILE env var.');
  }

  const timeout = CONFIG.PAGE_TIMEOUT;

  // Use BrowserService for initialization
  // purpose enables concurrent sessions (e.g. 'responder' vs 'sender')
  browserSession = await BrowserService.initSession({
    profile,
    purpose,
    headless,
    timeout,
    slowMo: CONFIG.SLOW_MO,
    autoLogin: true
  });

  // Get references for module-level state
  browserContext = browserSession.getContext();
  workingPage = browserSession.getWorkingPage();

  // Reset tab tracking
  messageTabs = [];

  console.log('   ✅ Browser ready\n');

  return { browser: browserContext, page: workingPage };
}

/**
 * Create a new tab
 */
export async function createNewTab() {
  if (!browserContext) {
    throw new Error('Browser not initialized. Call initBrowser() first.');
  }
  const newPage = await browserContext.newPage();
  newPage.setDefaultTimeout(CONFIG.PAGE_TIMEOUT);
  
  // Apply stealth to new tab
  await applyStealthToPage(newPage);
  
  return newPage;
}

// ============================================
// PROFILE & DM ACTIONS
// ============================================

/**
 * Navigate to profile and click "Contacter"
 */
export async function goToProfileAndOpenDM(page, profileUrl) {
  try {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.PAGE_TIMEOUT });
    await delay(2000, 3000);
    
    // Explicitly check for challenges nicely before verifying (blocks if needed)
    if (await checkForChallenge(page)) {
       return { success: false, error: 'challenge_detected_unresolved' };
    }

    // Verify we are on the profile page
    const verifyResult = await verifyProfilePage(page, profileUrl.split('/').filter(Boolean).pop());
    if (!verifyResult.success) {
      return { success: false, error: `verification_failed: ${verifyResult.reason}` };
    }

    // Find and click Contact button
    // ⚠️ CRITICAL START: Avoid clicking the nav bar "Message" icon by ensuring the button is inside the main content
    const specificSelectors = [
        'main header button:has-text("Message")',
        'main header button:has-text("Contacter")',
        'main div[role="button"]:has-text("Message")', 
        'main div[role="button"]:has-text("Contacter")'
    ];
    
    // Add generic fallback selectors but prioritize main content ones
    const allSelectors = [...specificSelectors, ...CONTACT_BUTTON];
    
    let clicked = false;
    
    for (const selector of allSelectors) {
      // Ensure we are selecting things inside 'main' if possible to avoid nav bar
      const finalSelector = selector.startsWith('main') ? selector : `main ${selector}`;
      
      const button = await page.$(finalSelector).catch(() => null);
      if (button) {
        const isVisible = await button.isVisible().catch(() => false);
        if (isVisible) {
          console.log(`      Found: ${finalSelector}`);
          
          await Promise.all([
             page.waitForNavigation({ url: /\/direct\//, timeout: 5000 }).catch(() => null),
             button.click()
          ]);
          
          await delay(2000, 3000);
          clicked = true;
          break;
        }
      }
    }
    
    if (!clicked) {
        // Fallback: Try searching for specific partial matches if semantic selectors fail
        const fallback = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
            const msgBtn = btns.find(b => {
                const txt = b.innerText?.toLowerCase();
                return (txt === 'message' || txt === 'contacter') && b.closest('main');
            });
            if (msgBtn) {
                msgBtn.click();
                return true;
            }
            return false;
        });
        
        if (fallback) {
             await delay(2500, 3500);
             clicked = true;
        }
    }

    if (!clicked) {
        return { success: false, error: 'no_contact_button' };
    }
    
    // ⚠️ CRITICAL CHECK: Verify we actually landed on a DM page OR opened a popup
    const currentUrl = page.url();
    
    // Case 1: URL is a /direct/ page (Best Case)
    if (currentUrl.includes('/direct/')) {
        return { success: true };
    }
    
    // Case 2: URL is still profile, but a "Message" popup opened bottom-right
    // We check for the presence of a message input field
    const messageInput = await page.$(MESSAGE_INPUT.join(', ')).catch(() => null);
    if (messageInput) {
        const isVisible = await messageInput.isVisible().catch(() => false);
        if (isVisible) {
             console.log(`      ✅ Message popup detected (URL didn't change, but input is visible)`);
             return { success: true, isPopup: true };
        }
    }

    // Failure Case
    console.warn(`      ❌ Clicked button but URL is not /direct/ and no popup found: ${currentUrl}`);
    // It might be a "Contact" popup (email/phone). We should close it if so and fail.
    await page.keyboard.press('Escape');
    return { success: false, error: 'click_did_not_open_dm' };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Find and focus the message input
 */
async function findMessageInput(page) {
  const selectors = MESSAGE_INPUT;
  
  for (const selector of selectors) {
    const input = await page.$(selector).catch(() => null);
    if (input) {
      const isVisible = await input.isVisible().catch(() => false);
      if (isVisible) {
        return input;
      }
    }
  }
  return null;
}

/**
 * Type message without sending
 * @param {Page} page - Playwright page
 * @param {string} message - Message to type
 * @param {Object} options - Options
 * @param {boolean} options.fast - If true, paste instantly instead of typing letter by letter
 */
async function typeMessageOnly(page, message, options = {}) {
  try {
    const input = await findMessageInput(page);

    if (!input) {
      return { success: false, error: 'message_input_not_found' };
    }

    await input.click();
    await delay(300, 500);

    if (options.fast) {
      await typeFast(page, message);
    } else {
      await typeHumanLike(page, message);
    }

    await delay(300, 500);

    return { success: true };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Upload a file in the DM conversation
 * Uses Instagram's file input for media/document uploads
 * 
 * @param {Page} page - Playwright page with DM view open
 * @param {string} filePath - Absolute path to the file to upload
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function uploadFileInDM(page, filePath) {
  try {
    // Check if file exists
    const fs = await import('fs');
    if (!fs.existsSync(filePath)) {
      console.log(`   ❌ File not found: ${filePath}`);
      return { success: false, error: 'file_not_found' };
    }
    
    console.log(`   📎 Uploading file: ${filePath}`);
    
    // Instagram has a hidden file input for media uploads
    // We need to find the "+ More" button area and handle file input
    const fileInputSelector = 'input[type="file"]';
    
    // Wait for any file input to be present (Instagram dynamically creates them)
    let fileInput = await page.$(fileInputSelector);
    
    if (!fileInput) {
      // Try clicking the "+" or media button to reveal the file input
      const mediaButtonSelectors = [
        'svg[aria-label="Plus"]',
        'svg[aria-label="Add Photo or Video"]',
        '[aria-label="Plus"]',
        '[aria-label="Open media gallery"]',
        'svg[aria-label="Ajouter une photo ou une vidéo"]', // French
      ];
      
      for (const selector of mediaButtonSelectors) {
        const btn = await page.$(selector);
        if (btn) {
          await btn.click();
          await delay(500, 800);
          break;
        }
      }
      
      // Now try to find the file input again
      await page.waitForSelector(fileInputSelector, { timeout: 5000 }).catch(() => null);
      fileInput = await page.$(fileInputSelector);
    }
    
    if (!fileInput) {
      console.log(`   ❌ Could not find file input element`);
      return { success: false, error: 'file_input_not_found' };
    }
    
    // Upload the file
    await fileInput.setInputFiles(filePath);
    console.log(`   ✅ File selected for upload`);
    
    // Wait for upload to complete (Instagram shows a preview)
    await delay(2000, 3000);
    
    return { success: true };
    
  } catch (error) {
    console.log(`   ❌ File upload error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Scrape all visible messages from the DM conversation
 * Uses Instagram's "Double tap to like" button as reliable message container
 * Detects role by looking for "Open the profile page" link (only in received messages)
 * 
 * @param {Page} page - Playwright page with DM view open
 * @returns {Promise<Array<{role: string, text: string}>>} Array of messages
 */
export async function scrapeConversationMessages(page) {
  try {
    // Wait for messages to load
    await delay(2000, 3000);

    // Check for "Empty Folder" / "Say hi" state first
    const isEmptyState = await page.evaluate(() => {
        const main = document.querySelector('[role="main"]') || document.querySelector('section');
        if (!main) return false;
        const text = main.innerText;
        return text.includes('Say hi to') || text.includes('Envoyez un message à') || text.includes('No messages') || text.includes('Aucun message');
    });

    const messages = await page.evaluate(() => {
      const result = [];
      const windowWidth = window.innerWidth;

      // UI text to skip (exact match or startsWith)
      const SKIP_TEXTS = ['Message...', 'Votre message', 'Seen', 'Vu', 'Active now', 'En ligne',
        'Envoyer', 'Send', 'Envoyez un message', 'Say hi', 'Aucun message', 'No messages'];

      // UI button labels to skip (exact match, case-insensitive)
      const SKIP_LABELS = ['suivre', 'follow', 'suivre en retour', 'follow back', 'suivi(e)',
        'abonné(e)', 's\'abonner', 'subscribe', 'message', 'appeler', 'call',
        'bloquer', 'block', 'signaler', 'report', 'restreindre', 'restrict',
        'publicité', 'marketing', 'artiste', 'créateur', 'entrepreneur'];

      // Collect <time datetime> elements with their Y positions for timestamp attribution
      const timeElements = Array.from(document.querySelectorAll('time[datetime]'));
      const timestamps = timeElements.map(t => ({
        y: t.getBoundingClientRect().top,
        datetime: t.getAttribute('datetime')
      })).sort((a, b) => a.y - b.y);

      // Find all div[dir="auto"] as message candidates
      const dirAutoElements = Array.from(document.querySelectorAll('div[dir="auto"]'));

      for (const el of dirAutoElements) {
        let text = el.innerText?.trim();
        if (!text || text.length < 1) continue;

        // Skip UI elements
        if (SKIP_TEXTS.some(s => text === s || text.startsWith(s))) continue;
        // Skip button labels and profile categories
        const textLower = text.toLowerCase();
        if (SKIP_LABELS.some(l => textLower === l || textLower === l.replace("'", "\u2019"))) continue;
        // Skip category-style text (e.g. "Publicité/marketing", "Coach/thérapeute")
        if (/^[A-ZÀ-Ü][a-zà-ü]+\/[a-zà-ü]+$/i.test(text)) continue;
        // Skip Instagram URLs and web links displayed as text
        if (text.includes('instagram.com/') || text.includes('www.') || text.includes('youtube.com/') || text.match(/^https?:\/\//)) continue;
        // Skip if inside a textbox (message input)
        if (el.closest('[role="textbox"]')) continue;
        // Skip navigation/sidebar elements
        if (el.closest('[role="navigation"]') || el.closest('[role="tablist"]')) continue;
        // Skip if inside a link (profile header links, follow buttons, etc.)
        if (el.closest('a[href]') && !el.closest('[role="gridcell"]')) continue;
        // Skip if inside a header element
        if (el.closest('header')) continue;

        // Voice note detection: check parent containers
        let messageType = 'text';
        let container = el.parentElement;
        for (let d = 0; d < 5; d++) {
          if (!container) break;
          const hasWaveform = container.querySelector('svg clipPath[id*="waveform"]');
          const hasTimer = container.querySelector('[role="timer"]');
          if (hasWaveform || hasTimer) {
            text = "[Vocal]";
            messageType = 'voice_note';
            break;
          }
          container = container.parentElement;
        }

        // Role detection via horizontal position
        // User messages (from prospect): left-aligned (leftRatio < 0.5)
        // Assistant messages (from us): right-aligned (leftRatio > 0.5)
        const rect = el.getBoundingClientRect();
        const leftRatio = rect.left / windowWidth;
        const isUser = leftRatio < 0.5;

        // Find closest <time> element above this message (largest Y <= message Y)
        let sentAt = null;
        const msgY = rect.top;
        for (let i = timestamps.length - 1; i >= 0; i--) {
          if (timestamps[i].y <= msgY) {
            sentAt = timestamps[i].datetime;
            break;
          }
        }

        result.push({
          role: isUser ? 'user' : 'assistant',
          text,
          type: messageType,
          sentAt,
          _y: rect.top
        });
      }

      // Standalone voice note detection: find waveform/timer elements NOT already captured via div[dir="auto"]
      // STRICT: only match elements that are INSIDE a message row — avoids false positives from UI elements
      const messageArea = document.querySelector('[role="grid"]') || document.querySelector('[role="main"]');
      if (messageArea) {
        // Primary: waveform SVG (most reliable indicator of a voice note)
        const waveforms = messageArea.querySelectorAll('svg clipPath[id*="waveform"]');
        // Secondary: timer role inside a message row
        const timers = messageArea.querySelectorAll('[role="row"] [role="timer"]');
        const voiceCandidates = [...waveforms, ...timers];

        for (const vc of voiceCandidates) {
          // REQUIRE a message row parent — if not inside a row, it's a UI element, skip
          const row = vc.closest('[role="row"]');
          if (!row) continue;

          const rect = row.getBoundingClientRect();

          // Skip if we already captured a message at this Y position
          const alreadyCaptured = result.some(r => Math.abs((r._y || 0) - rect.top) < 30);
          if (alreadyCaptured) continue;

          const leftRatio = rect.left / windowWidth;
          const isUser = leftRatio < 0.5;

          // Find closest timestamp
          let sentAt = null;
          for (let i = timestamps.length - 1; i >= 0; i--) {
            if (timestamps[i].y <= rect.top) {
              sentAt = timestamps[i].datetime;
              break;
            }
          }

          result.push({
            role: isUser ? 'user' : 'assistant',
            text: '[Vocal]',
            type: 'voice_note',
            sentAt
          });
        }
      }

      // Clean up internal _y field
      result.forEach(r => delete r._y);

      return result;
    });

    // If we found nothing but it's NOT an empty state, try scrolling up
    if (messages.length === 0 && !isEmptyState) {
        console.log('      ⚠️ No messages found but not empty state. Attempting scroll up...');
        await page.mouse.wheel(0, -500);
        await delay(1500);
        // Retry once with same filters as main block
        const retry = await page.evaluate(() => {
          const result = [];
          const windowWidth = window.innerWidth;
          const SKIP_TEXTS = ['Message...', 'Votre message', 'Seen', 'Vu', 'Active now', 'En ligne',
            'Envoyer', 'Send', 'Envoyez un message', 'Say hi', 'Aucun message', 'No messages'];
          const SKIP_LABELS = ['suivre', 'follow', 'message', 'appel', 'call', 'vidéo', 'video',
            'plus', 'more', 'artiste', 'artist', 'coach', 'auteur', 'auteur(ice)', 'auteure',
            'créateur', 'creator', 'musicien', 'musician', 'blogueur', 'blogger',
            'entrepreneur', 'photographe', 'photographer', 'thérapeute', 'therapist',
            'influenceur', 'influencer', 'consultant', 'designer', 'gamer',
            'journaliste', 'journalist', 'sportif', 'athlete', 'écrivain', 'writer'];
          const timeElements = Array.from(document.querySelectorAll('time[datetime]'));
          const timestamps = timeElements.map(t => ({
            y: t.getBoundingClientRect().top,
            datetime: t.getAttribute('datetime')
          })).sort((a, b) => a.y - b.y);
          const dirAutoElements = Array.from(document.querySelectorAll('div[dir="auto"]'));
          for (const el of dirAutoElements) {
            let text = el.innerText?.trim();
            if (!text || text.length < 1) continue;
            if (SKIP_TEXTS.some(s => text === s || text.startsWith(s))) continue;
            const textLower = text.toLowerCase();
            if (SKIP_LABELS.some(l => textLower === l || textLower === l.replace("'", "\u2019"))) continue;
            if (/^[A-ZÀ-Ü][a-zà-ü]+\/[a-zà-ü]+$/i.test(text)) continue;
            if (text.includes('instagram.com/') || text.includes('www.') || text.includes('youtube.com/') || text.match(/^https?:\/\//)) continue;
            if (el.closest('[role="textbox"]') || el.closest('[role="navigation"]') || el.closest('[role="tablist"]')) continue;
            if (el.closest('a[href]') && !el.closest('[role="gridcell"]')) continue;
            if (el.closest('header')) continue;
            const rect = el.getBoundingClientRect();
            const isUser = (rect.left / windowWidth) < 0.5;
            let sentAt = null;
            const msgY = rect.top;
            for (let i = timestamps.length - 1; i >= 0; i--) {
              if (timestamps[i].y <= msgY) { sentAt = timestamps[i].datetime; break; }
            }
            result.push({ role: isUser ? 'user' : 'assistant', text, type: 'text', sentAt, _y: rect.top });
          }

          // Standalone voice note detection (same as main block — strict: require [role="row"] parent)
          const messageArea = document.querySelector('[role="grid"]') || document.querySelector('[role="main"]');
          if (messageArea) {
            const waveforms = messageArea.querySelectorAll('svg clipPath[id*="waveform"]');
            const timers = messageArea.querySelectorAll('[role="row"] [role="timer"]');
            const voiceCandidates = [...waveforms, ...timers];
            for (const vc of voiceCandidates) {
              const row = vc.closest('[role="row"]');
              if (!row) continue;
              const rect = row.getBoundingClientRect();
              const alreadyCaptured = result.some(r => Math.abs((r._y || 0) - rect.top) < 30);
              if (alreadyCaptured) continue;
              const isUser = (rect.left / windowWidth) < 0.5;
              let sentAt = null;
              for (let i = timestamps.length - 1; i >= 0; i--) {
                if (timestamps[i].y <= rect.top) { sentAt = timestamps[i].datetime; break; }
              }
              result.push({ role: isUser ? 'user' : 'assistant', text: '[Vocal]', type: 'voice_note', sentAt });
            }
          }

          result.forEach(r => delete r._y);
          return result;
        });
        if (retry.length > 0) {
          messages.push(...retry);
        }
    }

    // Deduplicate consecutive identical messages
    const deduped = [];
    for (const msg of messages) {
      const last = deduped[deduped.length - 1];
      if (!last || last.text !== msg.text || last.role !== msg.role) {
        deduped.push(msg);
      }
    }

    console.log(`      Scraped ${deduped.length} messages from conversation`);

    // Log preview for debugging - show roles clearly
    if (deduped.length > 0) {
      console.log(`      Preview (last 3):`);
      deduped.slice(-3).forEach(m => {
        const icon = m.role === 'user' ? '👤' : '🤖';
        const preview = m.text.substring(0, 40) + (m.text.length > 40 ? '...' : '');
        console.log(`        ${icon} [${m.role}] ${preview}`);
      });
    }

    return deduped;

  } catch (error) {
    console.error('      Error scraping messages:', error.message);
    return [];
  }
}

// ============================================
// MAIN WORKFLOW
// ============================================

/**
 * Open a DM conversation and scrape messages WITHOUT typing
 * Use this to get messages first, then generate response, then type
 * 
 * @param {Object} lead - Lead data (must have profile_url or username)
 * @returns {Promise<{success: boolean, tab: Page, scrapedMessages: Array, error?: string}>}
 */
export async function openDMAndScrape(lead) {
  const username = lead.username || lead.profile_url?.split('/').filter(Boolean).pop();
  const profileUrl = lead.profile_url || `https://www.instagram.com/${username}/`;
  
  const result = {
    username,
    success: false,
    error: null,
    tab: null,
    scrapedMessages: [],
    timestamp: new Date().toISOString()
  };
  
  try {
    console.log(`\n   📋 Opening DM for @${username}...`);
    
    // Step 1: Create new tab
    result.tab = await createNewTab();
    
    // Step 2: Navigate to DM
    // OPTIMIZATION: If we have a DM URL, go there directly!
    let dmResult;
    
    if (lead.dm_url && lead.dm_url.includes('/t/')) {
      console.log(`      🚀 Using Direct DM URL: ${lead.dm_url}`);
      dmResult = await goToDirectDM(result.tab, lead.dm_url);
    } else {
       // Fallback: Go to profile and click Contacter
       dmResult = await goToProfileAndOpenDM(result.tab, profileUrl);
    }
    
    if (!dmResult.success) {
      result.error = dmResult.error;
      await result.tab.close().catch(() => {});
      result.tab = null;
      return result;
    }
    
    // Step 3: Scrape existing messages
    console.log(`      Scraping conversation history...`);
    result.scrapedMessages = await scrapeConversationMessages(result.tab);
    
    result.success = true;
    return result;
    
  } catch (error) {
    console.error(`      Error: ${error.message}`);
    result.error = error.message;
    if (result.tab) {
      await result.tab.close().catch(() => {});
      result.tab = null;
    }
    return result;
  }
}

/**
 * Type a message in an already-open DM tab
 *
 * @param {Page} tab - Playwright page with DM open
 * @param {string} message - Message to type
 * @param {Object} options - Options
 * @param {boolean} options.fast - If true, paste instantly instead of typing letter by letter
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function typeInOpenTab(tab, message, options = {}) {
  console.log(`      Typing message${options.fast ? ' (fast mode)' : ''}...`);
  const typeResult = await typeMessageOnly(tab, message, options);

  if (typeResult.success) {
    console.log(`      ✅ Message typed! Waiting for manual send.`);
  }

  return typeResult;
}

/**
 * Send a message in an already-open DM tab (Fully automated)
 * 
 * @param {Page} tab - Playwright page with DM open
 * @param {string} username - Username for verification
 * @param {string} message - Message to send
 * @returns {Promise<{success: boolean, dmUrl?: string, error?: string}>}
 */
export async function sendDM(tab, username, message) {
  try {
    console.log(`      Automated sending to @${username}...`);
    const input = await findMessageInput(tab);
    
    if (!input) {
      return { success: false, error: 'message_input_not_found' };
    }
    
    await input.click();
    await delay(300, 500);
    
    await typeHumanLike(tab, message);
    await delay(800, 1200);
    
    await tab.keyboard.press('Enter');
    await delay(2000, 3000);
    
    // Get DM URL
    const dmUrl = tab.url();
    
    return { success: true, dmUrl };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Process a lead in a new tab (LEGACY - still works):
 * 1. Open new tab
 * 2. Go to profile
 * 3. Click "Contacter"
 * 4. Scrape existing messages
 * 5. Type message
 * 6. Keep tab open for manual send
 * 
 * @param {Object} lead - Lead data (must have profile_url or username)
 * @param {string} message - Message to type
 * @returns {Promise<Object>} Result with scrapedMessages
 */
export async function processLeadInNewTab(lead, message) {
  const username = lead.username || lead.profile_url?.split('/').filter(Boolean).pop();
  const profileUrl = lead.profile_url || `https://www.instagram.com/${username}/`;
  
  const result = {
    username,
    success: false,
    error: null,
    tabKeptOpen: false,
    scrapedMessages: [],
    timestamp: new Date().toISOString()
  };
  
  let tab = null;
  
  try {
    console.log(`\n   📋 Processing @${username}`);
    
    // Step 1: Create new tab
    tab = await createNewTab();
    console.log(`      Opening new tab...`);
    
    // Step 2: Go to profile and click Contacter
    const dmResult = await goToProfileAndOpenDM(tab, profileUrl);
    
    if (!dmResult.success) {
      result.error = dmResult.error;
      await tab.close().catch(() => {});
      return result;
    }
    
    // Step 3: Scrape existing messages
    console.log(`      Scraping conversation history...`);
    result.scrapedMessages = await scrapeConversationMessages(tab);
    
    // Step 4: Type message
    console.log(`      Typing message...`);
    const typeResult = await typeMessageOnly(tab, message);
    
    if (!typeResult.success) {
      result.error = typeResult.error;
      await tab.close().catch(() => {});
      return result;
    }
    
    // Success - keep tab open
    result.success = true;
    result.tabKeptOpen = true;
    result.dmUrl = tab.url();

    // Track this tab (using BrowserSession if available)
    if (browserSession) {
      browserSession.registerMessageTab(username, tab, message, { dmUrl: result.dmUrl, timestamp: result.timestamp });
    }
    // Also keep local array for backward compatibility
    messageTabs.push({
      username,
      page: tab,
      message,
      timestamp: result.timestamp
    });

    console.log(`      ✅ Message typed! Tab kept open.`);
    
    return result;
    
  } catch (error) {
    result.error = error.message;
    if (tab) {
      await tab.close().catch(() => {});
    }
    return result;
  }
}

/**
 * Get list of open message tabs
 */
export function getOpenMessageTabs() {
  // Prefer BrowserSession if available
  if (browserSession) {
    return browserSession.getRegisteredTabs();
  }
  return messageTabs;
}

/**
 * Register an open tab for tracking (used by cron_worker)
 */
export function registerOpenTab(username, tab, message) {
  // Register with BrowserSession if available
  if (browserSession) {
    browserSession.registerMessageTab(username, tab, message);
  }
  // Also keep local array for backward compatibility
  messageTabs.push({
    username,
    page: tab,
    message,
    timestamp: new Date().toISOString()
  });
}

/**
 * Wait for user to finish reviewing messages
 */
export async function waitForUserToFinish() {
  // Delegate to BrowserSession if available
  if (browserSession) {
    return browserSession.waitForUserToFinish();
  }

  // Fallback for backward compatibility
  const tabs = getOpenMessageTabs();

  if (tabs.length === 0) {
    console.log('\n   No tabs with messages. Nothing to review.');
    return;
  }

  console.log('\n' + '='.repeat(50));
  console.log(`   📨 ${tabs.length} message(s) ready for review`);
  console.log('='.repeat(50));
  console.log('   Review each tab, send manually, then press Enter here to close browser.\n');

  await new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question('   Press Enter when done...', () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Close browser
 */
export async function closeBrowser() {
  // Close via BrowserSession if available (preferred)
  if (browserSession) {
    await browserSession.close().catch(() => {});
    browserSession = null;
    browserContext = null;
    workingPage = null;
    messageTabs = [];
    console.log('   Browser closed.');
    return;
  }

  // Fallback: close context directly
  if (browserContext) {
    await browserContext.close().catch(() => {});
    browserContext = null;
    workingPage = null;
    messageTabs = [];
    console.log('   Browser closed.');
  }
}

// ============================================
// LEGACY EXPORTS (for compatibility)
// ============================================

/**
 * Scrape conversation - LEGACY, kept for compatibility
 * Now just returns empty array since we process differently
 */
export async function scrapeConversation(url, options = {}) {
  console.log('⚠️  scrapeConversation is deprecated. Use initBrowser + processLeadInNewTab instead.');
  return { conversationHistory: [], page: null, browser: null };
}

/**
 * Fill message and leave open - LEGACY
 */
export async function fillMessageAndLeaveOpen(page, message) {
  console.log('⚠️  fillMessageAndLeaveOpen is deprecated. Use processLeadInNewTab instead.');
}

/**
 * Go directly to a DM URL
 */
export async function goToDirectDM(page, dmUrl) {
  try {
    await page.goto(dmUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(1500, 2500);

    // Verify we are in the inbox
    // Often DM threads are /direct/t/THREAD_ID
    if (!page.url().includes('/direct/t/')) {
        return { success: false, error: 'not_dm_url' };
    }

    const start = Date.now();
    while (Date.now() - start < 10000) {
        // Check for message bubbles or input area
        const hasMessages = await page.$('div[role="button"][aria-label*="Double tap"]');
        const hasInput = await page.$('div[contenteditable="true"]');
        
        if (hasMessages || hasInput) {
            return { success: true };
        }
        await delay(500);
    }
    
    return { success: true }; // Assume success if URL is correct
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Navigate to the notifications page
 */
export async function goToNotifications(page) {
    console.log('   Navigating to notifications...');
    await page.goto('https://www.instagram.com/notifications/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(3000, 5000);
    return true;
}

/**
 * Scrape basic metadata from a profile page (Bio, Full Name, Following status)
 */
export async function scrapeProfileMetadata(page, username) {
    try {
        console.log(`   Scraping metadata for @${username}...`);
        
        const metadata = await page.evaluate((targetUsername) => {
            const getAltText = (el) => el?.getAttribute('alt') || '';
            const getText = (sel) => document.querySelector(sel)?.innerText?.trim() || '';
            
            // Robust name and bio extraction heuristics
            let fullName = '';
            let bio = '';
            
            function isValidName(text) {
                if (!text || text.length < 2 || text.length > 500) return false; 
                const lower = text.toLowerCase();
                if (/publications|abonnés|suivi|posts|followers|following|views|likes/i.test(lower)) return false;
                if (/^[\d.,\s]+[kKmM]?$/.test(text.trim())) return false;
                if (/^(follow|suivre|message|contacter|edit|modifier|friends|amis|s'abonner|abonné)$/i.test(text.trim())) return false;
                return true;
            }

            const header = document.querySelector('main header') || document.querySelector('header');
            if (header) {
                const candidates = Array.from(header.querySelectorAll('span[dir="auto"]'))
                    .map(s => s.textContent.trim())
                    .filter(text => isValidName(text))
                    .filter(text => !text.includes('@'));

                if (candidates.length > 0) {
                    // Name: Usually the first short non-multiline candidate
                    for (const c of candidates) {
                        if (c.length < 50 && !c.includes('\n')) {
                            fullName = c;
                            break;
                        }
                    }
                    // Bio: Usually the longest remaining candidate
                    const bioCandidates = candidates.filter(c => c !== fullName && c.length > 5);
                    if (bioCandidates.length > 0) {
                        bio = bioCandidates.reduce((a, b) => a.length > b.length ? a : b);
                    }
                }
            }

            // Fallback for Name: Metadata og:title
            if (!fullName) {
                const metaTitle = document.querySelector('meta[property="og:title"]')?.content;
                if (metaTitle) {
                    const match = metaTitle.match(/^(.+?)\s+\(@/);
                    if (match && isValidName(match[1])) fullName = match[1];
                }
            }

            // No fallback for bio — meta description contains Instagram SEO snippet, not the actual bio

            // 3. Following Check
            const buttons = Array.from(document.querySelectorAll('button'));
            const following = buttons.some(b => 
                b.innerText.includes('Following') || 
                b.innerText.includes('Suivi') || 
                b.innerText.includes("S'abonner d\u00e9j\u00e0") ||
                b.innerText.includes('Message')
            );

            // 4. Contact Check
            const contactButtons = Array.from(document.querySelectorAll('button, div[role="button"]'));
            const canContact = contactButtons.some(b => {
                const txt = b.innerText?.trim();
                return txt === 'Message' || txt === 'Contacter' || txt === 'Contact';
            });

            return {
                fullName,
                bio,
                isFollowing: following,
                canContact
            };
        }, username);

        return { success: true, ...metadata };
    } catch (error) {
        console.error('   Error scraping profile metadata:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Scrape usernames of people who liked a post
 * @param {Page} page - Playwright page object (post must be loaded)
 * @returns {Promise<string[]>} Array of usernames
 */
export async function scrapePostLikers(page) {
    try {
        console.log('   Scraping likers...');
        
        // 1. Find and click the "likes" count button
        const clicked = await page.evaluate(async () => {
            const findLikersButton = () => {
                const isNumeric = (val) => {
                    const cleaned = val.replace(/[\s\u00A0\u202F,.]/g, "");
                    return cleaned.length > 0 && /^\d+$/.test(cleaned);
                };
                const isLikeCount = (val) => {
                    const cleaned = val.replace(/[\s\u00A0\u202F]/g, "").trim();
                    return /^[\d,.]+[KkMm]?$/.test(cleaned);
                };
                const containsNumber = (val) => {
                    return /\d+/.test(val.replace(/[\s\u00A0\u202F,.]/g, ""));
                };

                // STRATEGY 1: Find "liked_by" links (posts with many likes)
                const likedByLink = document.querySelector("a[href*=\"/liked_by/\"]");
                if (likedByLink) return likedByLink;

                // STRATEGY 2: Find clickables with "J'aime", "likes", or "autres personne" + a number
                const allClickables = Array.from(document.querySelectorAll("span[role=\"button\"], a[role=\"link\"], [role=\"button\"]"));
                const likesTextBtn = allClickables.find(el => {
                    const text = (el.innerText || "").trim().toLowerCase();
                    return (text.includes("j'aime") || text.includes("like") || text.includes("autres personne")) && containsNumber(text);
                });
                if (likesTextBtn) return likesTextBtn;

                // STRATEGY 3: span[role="button"] with numeric or abbreviated count ("29", "2,5 K")
                const candidates = Array.from(document.querySelectorAll("span[role=\"button\"]"));
                const numericSpans = candidates.filter(span => {
                    const text = span.innerText.trim();
                    return text.length > 0 && (isNumeric(text) || isLikeCount(text));
                });

                const heartIcon = document.querySelector("svg[aria-label*=\"aime\" i], svg[aria-label*=\"like\" i]");
                if (heartIcon && numericSpans.length > 0) {
                    const heartContainer = heartIcon.closest(".x6s0dn4.x78zum5") || heartIcon.closest("div");
                    if (heartContainer) {
                        const parentContainer = heartContainer.parentElement;
                        if (parentContainer) {
                            const nearbyNumeric = numericSpans.find(span => parentContainer.contains(span));
                            if (nearbyNumeric) return nearbyNumeric;
                        }
                    }
                }
                if (numericSpans.length > 0) return numericSpans[0];

                // STRATEGY 4: Legacy fallback
                const allButtons = Array.from(document.querySelectorAll("[role=\"button\"], [role=\"link\"]"));
                const numericButtons = allButtons.filter(b => isNumeric(b.innerText.trim()));
                if (numericButtons.length > 0) return numericButtons[0];

                return null;
            };

            const btn = findLikersButton();
            if (btn) {
                btn.scrollIntoView({ block: "center", behavior: "smooth" });
                await new Promise(r => setTimeout(r, 500));
                btn.click();
                return true;
            }
            return false;
        });

        if (clicked) {
            await delay(2500, 3500);
        } else {
            // Playwright fallback
            const sel = 'a[href*="/liked_by/"], span[role="button"]:has-text("likes"), span[role="button"]:has-text("j\'aime"), a:has-text("autres personnes")';
            const fallback = await page.locator(sel).first();
            if (await fallback.count() > 0) {
                await fallback.click();
                await delay(2500, 3500);
            } else {
                const numericFallback = page.locator('[role="button"]').filter({ hasText: /^\d+$/ }).first();
                if (await numericFallback.count() > 0) {
                    await numericFallback.click();
                    await delay(2500, 3500);
                } else {
                    console.log('   Could not find likers button. Maybe 0 likes?');
                    return [];
                }
            }
        }



        // 2. Extract from the modal with human-like scrolling
        const likers = await page.evaluate(async () => {
            const results = new Set();
            // The modal container usually has role="dialog" or a specific class
            const modal = document.querySelector('div[role="dialog"]');
            if (!modal) return [];

            // Find the scrollable area within the modal
            // Robust strategy: Find the element that is actually scrollable (has content larger than view)
            // and has overflow set.
            const allDivs = Array.from(modal.querySelectorAll('div'));
            
            // 1. Prioritize element from user's HTML snippet style
            let scroller = allDivs.find(el => el.getAttribute('style')?.includes('overflow: hidden auto'));
            
            if (!scroller) {
                // 2. Find any element with scrollable content and explicit overflow style
                scroller = allDivs.find(el => {
                    const style = window.getComputedStyle(el);
                    const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll';
                    const hasOverflow = el.scrollHeight > el.clientHeight;
                    return isScrollable && hasOverflow;
                });
            }

            if (!scroller) {
                 // 3. Fallback: Find largest scrollable element
                 const scrollableCandidates = allDivs.filter(el => el.scrollHeight > el.clientHeight);
                 if (scrollableCandidates.length > 0) {
                     // Pick the one with the biggest scrollHeight (usually the main list)
                     scroller = scrollableCandidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
                 } else {
                     scroller = modal;
                 }
            }
            
            console.log(`      Debugging Scroller: Found element with scrollHeight=${scroller.scrollHeight}, clientHeight=${scroller.clientHeight}`);

            // Helper for human delay
            const randomDelay = (min, max) => new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));

            // Dynamic scrolling loop — scroll until no new usernames are found
            let noNewCount = 0;
            let scrollCount = 0;

            const collectUsernames = () => {
                const links = Array.from(modal.querySelectorAll('a[href^="/"]._a6hd, a[href^="/"][role="link"]'));
                links.forEach(link => {
                    const href = link.getAttribute('href');
                    const username = href.replace(/\//g, '').split('?')[0];
                    if (username && username.length > 2 && username !== 'explore' && username !== 'direct') {
                        results.add(username);
                    }
                });
            };

            while (noNewCount < 5) {
                const sizeBefore = results.size;
                collectUsernames();

                // Scroll
                if (scroller.scrollHeight > scroller.clientHeight) {
                     const scrollAmount = 600 + Math.random() * 400;
                     scroller.scrollBy({ top: scrollAmount, behavior: 'smooth' });
                } else {
                     modal.scrollBy({ top: 600, behavior: 'smooth' });
                }

                await randomDelay(1000, 2500);
                scrollCount++;

                // Collect again after scroll
                collectUsernames();

                if (results.size === sizeBefore) {
                    noNewCount++;
                } else {
                    noNewCount = 0;
                }

                // Occasional micro-scroll to simulate human
                if (Math.random() > 0.8) {
                     scroller.scrollBy({ top: -100, behavior: 'smooth' });
                     await randomDelay(500, 800);
                }

                // Log progress every 10 scrolls
                if (scrollCount % 10 === 0) {
                    console.log(`      → Scroll ${scrollCount}: ${results.size} likers found so far`);
                }
            }
            
            // Final collection pass
            const links = Array.from(modal.querySelectorAll('a[href^="/"]._a6hd, a[href^="/"][role="link"]'));
            links.forEach(link => {
                const href = link.getAttribute('href');
                const username = href.replace(/\//g, '').split('?')[0];
                if (username && username.length > 2 && username !== 'explore' && username !== 'direct') {
                    results.add(username);
                }
            });

            return Array.from(results);
        });

        // Close modal
        await page.keyboard.press('Escape');
        await delay(500, 1000);

        console.log(`   Found ${likers.length} likers.`);
        return likers;
    } catch (error) {
        console.error('   Error scraping likers:', error.message);
        return [];
    }
}

/**
 * Lightweight version of scrapePostComments for DM Responder
 * @param {Page} page - Playwright page object (post must be loaded)
 * @returns {Promise<Object[]>} Array of {username, text}
 */
export async function scrapePostComments(page) {
    try {
        console.log('   Scraping comments...');
        
        // 1. Detect Post Author (so we can exclude them)
        const postAuthor = await page.evaluate(() => {
            const allLinks = document.querySelectorAll('header a[href^="/"]');
            for (const link of allLinks) {
                const href = link.getAttribute('href');
                const match = href.match(/^\/([a-zA-Z0-9._]+)\/?$/);
                if (match && !['explore', 'reels', 'p', 'direct'].includes(match[1])) {
                    return match[1];
                }
            }
            return null;
        });

        if (postAuthor) console.log(`      (Post author detected: @${postAuthor})`);

        // 2. Scrolling and extraction logic
        const comments = await page.evaluate(async (author) => {
            const results = [];
            const seen = new Set();
            const randomDelay = (min, max) => new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
            
            // --- A. FIND SCROLLER ---
            // On desktop, comments are in a right sidebar or modal
            const findScroller = () => {
                const candidates = Array.from(document.querySelectorAll('div, ul'));
                let best = null;
                let maxH = 0;
                for (const el of candidates) {
                    if (el.scrollHeight > el.clientHeight) {
                        const style = window.getComputedStyle(el);
                        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                            if (el.scrollHeight > maxH) {
                                maxH = el.scrollHeight;
                                best = el;
                            }
                        }
                    }
                }
                return best;
            };

            const scroller = findScroller();
            const scrollTarget = scroller || window;
            console.log(scroller ? "Found internal scroller for comments" : "Using window as scroller");

            let previousHeight = 0;
            let noChangeCount = 0;
            const MAX_SCROLL_SESSIONS = 5;

            for (let i = 0; i < MAX_SCROLL_SESSIONS; i++) {
                // --- B. EXTRACT ---
                // Anchor extraction around <time> elements which define a comment/reply
                const timeElements = Array.from(document.querySelectorAll('time'));
                
                timeElements.forEach(timeEl => {
                    // Find the common container for this comment (usually 3-4 levels up)
                    let container = timeEl.parentElement;
                    while (container && container.tagName !== 'DIV') container = container.parentElement;
                    if (!container) return;
                    
                    // We need a container that has both the profile link and the comment text
                    // Looking for the DIV that contains the profile link and the text span
                    let commentBlock = container.closest('div[role="none"]') || container.closest('div.x1cy8zhl') || container.parentElement;
                    
                    if (commentBlock) {
                        // 1. Extract Username
                        const usernameEl = commentBlock.querySelector('span._ap3a, a[href^="/"] span[dir="auto"]');
                        if (!usernameEl) return;
                        
                        const username = usernameEl.innerText.trim();
                        if (!username || username === author || ['explore', 'direct', 'reels', 'p', 'stories'].includes(username)) return;

                        // 2. Extract Comment Text
                        // The text is usually in a span[dir="auto"] that is NOT the username span
                        // and often has specific classes like x1lliihq
                        const allSpans = Array.from(commentBlock.querySelectorAll('span[dir="auto"]'));
                        let commentText = '';
                        
                        for (const span of allSpans) {
                            const text = span.innerText.trim();
                            if (text && text !== username && text.length > 1) {
                                // Skip UI words
                                const uiWords = ['vérifié', 'j\'aime', 'répondre', 'reply', 'like', 'voir', 'view', 'répons', 'replies'];
                                if (uiWords.some(w => text.toLowerCase().includes(w))) continue;
                                if (/^\d+\s*(j'aime|like|réponse|reply)$/i.test(text)) continue;
                                
                                commentText = text;
                                break; 
                            }
                        }

                        if (commentText) {
                            const key = `${username}:${commentText.substring(0, 50)}`;
                            if (!seen.has(key)) {
                                results.push({ username, text: commentText });
                                seen.add(key);
                            }
                        }
                    }
                });

                // --- C. SCROLL ---
                if (scrollTarget === window) {
                   window.scrollBy(0, 800);
                } else {
                   scrollTarget.scrollBy({ top: 500, behavior: 'smooth' });
                }
                
                await randomDelay(1200, 2000);

                const currentHeight = (scrollTarget === window) ? document.body.scrollHeight : scrollTarget.scrollHeight;
                if (currentHeight === previousHeight) {
                    noChangeCount++;
                    if (noChangeCount >= 2) break;
                } else {
                    noChangeCount = 0;
                    previousHeight = currentHeight;
                }
                
                // Click "Load more" if visible
                const loadMore = Array.from(document.querySelectorAll('div[role="button"]'))
                    .find(b => {
                        const t = b.innerText.toLowerCase();
                        return (t.includes('voir') || t.includes('view')) && (t.includes('répons') || t.includes('replies') || t.includes('comment'));
                    });
                if (loadMore) {
                    loadMore.click();
                    await randomDelay(1000, 2000);
                }
            }
            return results;
        }, postAuthor);

        console.log(`   Found ${comments.length} real comments.`);
        return comments;
    } catch (error) {
        console.error('   Error scraping comments:', error.message);
        return [];
    }
}
