/**
 * @file Manages browser automation with Playwright to scrape and interact with Instagram DMs.
 * 
 * WORKFLOW (like Outreach agent):
 * - Uses persistent browser context (session saved to ./browser-data)
 * - Single login, multiple tabs for each lead
 * - Types response and leaves tab open for manual send
 */

import { chromium } from 'playwright';
import path from 'path';
import dotenv from 'dotenv';
import { createInterface } from 'readline';
import { getCredentialsForProfile } from '../../../shared/credentials.js';
import { getStealthContextOptions, applyStealthToPage, humanDelay, TIMING } from '../../../shared/stealth.js';
import { verifyProfilePage, verifyHomePage, checkForChallenge } from '../../../shared/pageVerification.js';
import { getBrowserDataDir, cleanupBrowserLocks } from '../../../shared/paths.js';
import { gotoWithRetry } from '../../collector/src/utils.js';

dotenv.config();

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  HEADLESS: process.env.HEADLESS === 'true',
  SLOW_MO: parseInt(process.env.SLOW_MO, 10) || 80,
  PAGE_TIMEOUT: parseInt(process.env.PAGE_TIMEOUT, 10) || 60000,
  
  SELECTORS: {
    CONTACT_BUTTON: [
      'div[role="button"]:has-text("Contacter")',
      'div[role="button"]:has-text("Message")',
      'button:has-text("Contacter")',
      'button:has-text("Message")'
    ],
    MESSAGE_INPUT: [
      'div[contenteditable="true"][role="textbox"]',
      'div[aria-label*="message" i][contenteditable="true"]',
      'div[aria-label*="Message" i][contenteditable="true"]',
      'div[aria-placeholder*="message" i][contenteditable="true"]',
      'div[data-lexical-editor="true"]'
    ]
  }
};

// ============================================
// BROWSER STATE (Module-level)
// ============================================
let browserContext = null;
let workingPage = null;
let messageTabs = [];

// ============================================
// UTILITIES
// ============================================
function delay(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Type text with human-like variations
 */
async function typeHumanLike(page, text) {
  for (const char of text) {
    let charDelay = 30 + Math.random() * 50;
    
    if (['.', '!', '?', '\n'].includes(char)) {
      charDelay += Math.random() * 400 + 200;
    } else if ([',', ';', ':'].includes(char)) {
      charDelay += Math.random() * 200 + 100;
    } else if (char === ' ') {
      charDelay += Math.random() * 50 + 20;
    }
    
    if (Math.random() < 0.01) {
      charDelay += Math.random() * 1000 + 500;
    }
    
    await page.keyboard.type(char);
    await delay(charDelay * 0.8, charDelay * 1.2);
  }
}

// ============================================
// BROWSER INIT & SESSION
// ============================================

/**
 * Initialize browser with persistent session.
 * Requires manual login on first run.
 * 
 * @param {Object} options
 * @returns {Promise<{browser, page}>}
 */
export async function initBrowser(options = {}) {
  const {
    profile = process.env.IG_PROFILE,
    headless = CONFIG.HEADLESS
  } = options;
  
  if (!profile) {
    throw new Error('Profile name is required. Use --profile <name> or set IG_PROFILE env var.');
  }

  const userDataDir = getBrowserDataDir(profile);
  console.log('\n=== Initializing Browser ===');
  console.log(`   Profile: ${profile}`);
  console.log(`   User data: ${userDataDir}`);
  console.log(`   Headless: ${headless}`);
  
  // 🧹 Clean up stale locks before launch (prevents macOS SIGTRAP crashes)
  cleanupBrowserLocks(profile);
  
  const timeout = CONFIG.PAGE_TIMEOUT;
  
  const stealthOptions = getStealthContextOptions(userDataDir, {
    headless,
    slowMo: CONFIG.SLOW_MO,
    timeout
  });
  
  browserContext = await chromium.launchPersistentContext(userDataDir, stealthOptions);
  
  messageTabs = [];
  
  workingPage = await browserContext.newPage();
  workingPage.setDefaultTimeout(timeout);
  
  // Apply stealth init script
  await applyStealthToPage(workingPage);
  
  // Navigate to Instagram
  console.log(`   Loading Instagram...`);
  try {
    await gotoWithRetry(workingPage, 'https://www.instagram.com/', { 
      waitUntil: 'domcontentloaded',
      timeout
    });
  } catch (error) {
    console.log(`   ⚠️ Initial navigation error (non-fatal): ${error.message}`);
  }
  await delay(2000, 3000);
  
  // Check for challenge immediately after loading home
  if (await checkForChallenge(workingPage)) {
    console.log('   Note: Challenge check completed on home page load.');
  }

  // Check if logged in
  const isLoggedIn = await workingPage.evaluate(() => {
    return !!(
      document.querySelector('svg[aria-label="Home"]') ||
      document.querySelector('a[href="/direct/inbox/"]') ||
      document.querySelector('[aria-label="New post"]')
    );
  });
  
  if (!isLoggedIn) {
    const { username, password } = getCredentialsForProfile(profile);
    
    if (!username || !password) {
      console.log('\n   ⚠️  MANUAL LOGIN REQUIRED');
      console.log('   (Set INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD in .env for auto-login)');
      console.log('   Please log in to Instagram in the browser window.');
      console.log('   Press Enter in this terminal when done...');
      
      await new Promise(resolve => {
        process.stdin.once('data', resolve);
      });
    } else {
      console.log('   Logging in automatically...');
      
      // --- COOKIE POPUP HANDLING ---
      try {
        console.log('   Checking for cookie consent popup...');
        const cookieSelectors = [
          'button:has-text("Allow all cookies")',
          'button:has-text("Autoriser tous les cookies")',
          'button:has-text("Allow essential and optional cookies")',
          'button:has-text("Uniquement les cookies essentiels")',
          'button._a9--._ap36._asz1', 
          'button._a9--._a9_0',
          'div[role="dialog"] button:has-text("Allow")',
          'div[role="dialog"] button:has-text("Autoriser")'
        ];

        let cookieHandled = false;
        for (const selector of cookieSelectors) {
          try {
            const button = await workingPage.$(selector);
            if (button && await button.isVisible()) {
              console.log(`   Found cookie button: ${selector}`);
              await button.click();
              cookieHandled = true;
              await delay(1000, 1500);
              break;
            }
          } catch (e) {
            // Ignore
          }
        }

        if (!cookieHandled) {
          // Fallback: JavaScript click
          await workingPage.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const target = buttons.find(b => 
              b.innerText.includes('Allow all cookies') || 
              b.innerText.includes('Autoriser tous les cookies') ||
              b.innerText.includes('Decline optional cookies') ||
              b.innerText.includes('Refuser')
            );
            if (target) target.click();
          });
          await delay(1000, 1500);
        }
      } catch (error) {
        console.log('   Cookie popup check failed (or none present)');
      }
      // ----------------------------
      
      // Wait for login form
      try {
        await workingPage.waitForSelector('input[name="username"]', { timeout: 10000 });
      } catch (e) {
        console.log('   Login form not found, waiting longer...');
        await delay(2000, 3000);
      }
      
      // Type credentials
      await workingPage.type('input[name="username"]', username, { delay: 50 + Math.random() * 100 });
      await delay(500, 1000);
      await workingPage.type('input[name="password"]', password, { delay: 50 + Math.random() * 100 });
      await workingPage.click('button[type="submit"]');
      
      // Wait for login to complete
      try {
        await workingPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (e) {
        console.log('   Login navigation slow, continuing...');
      }
      await delay(2000, 3000);
      
      // Handle "Save Login Info?" popup
      try {
        const notNowBtn = workingPage.locator('text=Not Now').or(workingPage.locator('button:has-text("Not Now")'));
        await notNowBtn.click({ timeout: 5000 });
        console.log('   Dismissed "Save Login" popup.');
      } catch (e) {
        // No popup
      }
      
      console.log('   ✅ Login successful!');
    }
    
    await workingPage.reload({ waitUntil: 'domcontentloaded' });
    await delay(2000, 3000);
  }
  
  console.log('   ✅ Browser ready\n');
  
  return { browser: browserContext, page: workingPage };
}

/**
 * Create a new tab
 */
async function createNewTab() {
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
async function goToProfileAndOpenDM(page, profileUrl) {
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
    const selectors = CONFIG.SELECTORS.CONTACT_BUTTON;
    
    for (const selector of selectors) {
      const button = await page.$(selector).catch(() => null);
      if (button) {
        const isVisible = await button.isVisible().catch(() => false);
        if (isVisible) {
          console.log(`      Found: ${selector}`);
          await button.click();
          await delay(2000, 3000);
          return { success: true };
        }
      }
    }
    
    return { success: false, error: 'no_contact_button' };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Find and focus the message input
 */
async function findMessageInput(page) {
  const selectors = CONFIG.SELECTORS.MESSAGE_INPUT;
  
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
 */
async function typeMessageOnly(page, message) {
  try {
    const input = await findMessageInput(page);
    
    if (!input) {
      return { success: false, error: 'message_input_not_found' };
    }
    
    await input.click();
    await delay(300, 500);
    
    await typeHumanLike(page, message);
    
    await delay(300, 500);
    
    return { success: true };
    
  } catch (error) {
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
    // Wait a bit for messages to load
    await delay(1000, 1500);
    
    const messages = await page.evaluate(() => {
      const result = [];
      
      // Find all message containers using the "Double tap to like" button
      const messageButtons = document.querySelectorAll('[role="button"][aria-label*="Double tap"]');
      
      messageButtons.forEach(button => {
        // Find the text content inside this message
        const textElement = button.querySelector('div[dir="auto"]');
        if (!textElement) return;
        
        const text = textElement.innerText?.trim();
        if (!text || text.length < 2) return;
        
        // Skip UI elements
        if (text.includes('Message...') || text.includes('Votre message')) return;
        if (text === 'Seen' || text === 'Vu' || text === 'Active now') return;
        if (text === 'Envoyer' || text === 'Send') return;
        
        // ----- ROLE DETECTION -----
        // Key insight: Messages FROM the prospect have a profile link as a SIBLING
        // at some parent level. We need to check siblings, not child search.
        
        let isUser = false;
        
        // Walk up parents and at each level, check SIBLINGS for profile link
        let currentEl = button;
        for (let depth = 0; depth < 8; depth++) {
          const parent = currentEl.parentElement;
          if (!parent) break;
          
          // Check siblings of currentEl (not children of parent which includes currentEl)
          const siblings = Array.from(parent.children);
          for (const sibling of siblings) {
            if (sibling === currentEl) continue; // Skip self
            
            // Check if this sibling contains a profile link
            const profileLink = sibling.querySelector('a[aria-label*="Open the profile page"]');
            if (profileLink) {
              isUser = true;
              break;
            }
            
            // Also check if the sibling IS the profile link
            if (sibling.matches && sibling.matches('a[aria-label*="Open the profile page"]')) {
              isUser = true;
              break;
            }
          }
          
          if (isUser) break;
          currentEl = parent;
        }
        
        result.push({
          role: isUser ? 'user' : 'assistant',
          text: text
        });
      });
      
      return result;
    });
    
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
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function typeInOpenTab(tab, message) {
  console.log(`      Typing message...`);
  const typeResult = await typeMessageOnly(tab, message);
  
  if (typeResult.success) {
    console.log(`      ✅ Message typed! Waiting for manual send.`);
  }
  
  return typeResult;
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
  return messageTabs;
}

/**
 * Register an open tab for tracking (used by cron_worker)
 */
export function registerOpenTab(username, tab, message) {
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
            
            // 1. Full Name Search
            let fullName = '';
            
            // Candidate 1: Real name usually in a header section span that is NOT the username
            const spans = Array.from(document.querySelectorAll('header section span'));
            const nameCandidate = spans.find(s => {
                const txt = s.innerText?.trim();
                return txt && txt.length > 0 && 
                       txt.toLowerCase() !== targetUsername.toLowerCase() && 
                       !txt.includes('@') &&
                       !txt.includes('publications') &&
                       !txt.includes('followers') &&
                       !txt.includes('suivi');
            });
            if (nameCandidate) fullName = nameCandidate.innerText.trim();

            // Candidate 2: Specifically look for the div structure usually holding the name
            if (!fullName) {
                const h2 = document.querySelector('h2');
                if (h2) {
                    // Search for a span that is a sibling or in a parallel div to the username h2
                    // In many layouts, name is in a span near the h2
                    const allSpans = Array.from(document.querySelectorAll('span[dir="auto"]'));
                    for (const s of allSpans) {
                        const txt = s.innerText?.trim();
                        if (txt && txt.length > 0 && txt.toLowerCase() !== targetUsername.toLowerCase() && txt.length < 50) {
                            // Basic heuristic: it's a name if it's not a stat
                            if (!/\d+/.test(txt)) {
                                fullName = txt;
                                break;
                            }
                        }
                    }
                }
            }

            // 2. Bio Search
            let bio = '';
            // Bio is often the last span in the header section before stats or in a specific block
            const headerSection = document.querySelector('header section');
            if (headerSection) {
                const bioCandidate = headerSection.querySelector('div:last-child span');
                if (bioCandidate) bio = bioCandidate.innerText || '';
            }
            
            // Fallback for bio: look for description meta tag (if available in DOM)
            if (!bio) {
                const metaDesc = document.querySelector('meta[name="description"]');
                if (metaDesc) bio = metaDesc.getAttribute('content') || '';
            }

            // 3. Following Check
            const buttons = Array.from(document.querySelectorAll('button'));
            const following = buttons.some(b => 
                b.innerText.includes('Following') || 
                b.innerText.includes('Suivi') || 
                b.innerText.includes('S’abonner déjà') ||
                b.innerText.includes('Message')
            );

            return {
                fullName,
                bio,
                isFollowing: following
            };
        }, username);

        return { success: true, ...metadata };
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
        // Strategy: Find the heart icon and look for its nearby count button
        const clicked = await page.evaluate(async () => {
            const findLikersButton = () => {
                // Helper to check if a string is purely numeric (ignoring spaces/commas)
                const isNumeric = (val) => {
                    const cleaned = val.replace(/[\s,.]/g, '');
                    return cleaned.length > 0 && /^\d+$/.test(cleaned);
                };

                // 1. Try to find the Like heart SVG/Icon
                const heart = document.querySelector('svg[aria-label="J’aime"], svg[aria-label="Like"], svg title');
                
                // 2. Search for a button that contains ONLY a number nearby or in sections
                // This handles the structure: <span role="button">12</span>
                const allButtons = Array.from(document.querySelectorAll('[role="button"], [role="link"]'));
                
                // Try to find buttons that are JUST a number
                const numericButtons = allButtons.filter(b => isNumeric(b.innerText.trim()));
                
                if (numericButtons.length > 0) {
                    // If we have a heart, prefer a button close to it
                    if (heart) {
                        const heartBtn = heart.closest('[role="button"]');
                        if (heartBtn) {
                            let current = heartBtn;
                            for (let i = 0; i < 4; i++) {
                                const parent = current.parentElement;
                                if (!parent) break;
                                const nearby = numericButtons.find(nb => parent.contains(nb));
                                if (nearby) return nearby;
                                current = parent;
                            }
                        }
                    }
                    // Otherwise just take the first one that looks like a like count (usually early in the page/post)
                    // We avoid buttons that are too small (like 0 or 1 might be something else) or too big if we want to be safe,
                    // but usually the first numeric button in a post context is the likes.
                    return numericButtons[0];
                }

                return null;
            };

            const btn = findLikersButton();
            if (btn) {
                btn.scrollIntoView();
                btn.click();
                return true;
            }
            return false;
        });

        if (clicked) {
            await delay(2500, 3500);
        } else {
            // Final fallback: Use locator for known patterns or direct numeric button
            const fallback = await page.locator('a[href*="/liked_by/"], span[role="button"]:has-text("likes"), span[role="button"]:has-text("j’aime")').first();
            if (await fallback.count() > 0) {
                await fallback.click();
                await delay(2500, 3500);
            } else {
                // Try searching for any span/div with role="button" that has numeric text via Playwright locator
                const numericFallback = page.locator('[role="button"]').filter({ hasText: /^\d+$/ }).first();
                if (await numericFallback.count() > 0) {
                    await numericFallback.click();
                    await delay(2500, 3500);
                } else {
                    console.log('   ⚠️ Could not find likers button. Maybe 0 likes?');
                    return [];
                }
            }
        }

        // 2. Extract from the modal
        const likers = await page.evaluate(async () => {
            const results = new Set();
            // The modal container usually has role="dialog" or a specific class
            const modal = document.querySelector('div[role="dialog"]') || document.querySelector('div.x1cy8zhl');
            if (!modal) return [];

            // Scroll modal to load more
            const scroller = modal.querySelector('div[style*="overflow-y: auto"]') || modal;
            for (let i = 0; i < 4; i++) {
                scroller.scrollBy(0, 800);
                await new Promise(r => setTimeout(r, 1000));
            }

            // Target links with the specific structure from user
            // <a class="... _a6hd" href="/username/">
            const links = Array.from(modal.querySelectorAll('a[href^="/"]._a6hd, a[href^="/"][role="link"]'));
            links.forEach(link => {
                const href = link.getAttribute('href');
                const username = href.replace(/\//g, '').split('?')[0];
                // Exclude common IG paths
                const blacklisted = ['explore', 'direct', 'reels', 'p', 'stories', 'accounts', 'emails'];
                if (username && username.length > 2 && !blacklisted.includes(username)) {
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
        
        // Basic scroll to load comments
        await page.evaluate(async () => {
            window.scrollBy(0, 500);
            await new Promise(r => setTimeout(r, 1000));
        });

        const comments = await page.evaluate(() => {
            const results = [];
            const seen = new Set();
            
            // Look for profile links and their accompanying text
            // In the new DIV-only structure
            const allDivs = Array.from(document.querySelectorAll('div'));
            
            allDivs.forEach(div => {
                const link = div.querySelector('a[href^="/"]');
                if (!link) return;
                
                const href = link.getAttribute('href');
                const username = href.replace(/\//g, '').split('?')[0];
                if (!username || ['explore', 'direct', 'reels', 'p', 'stories'].includes(username)) return;

                // Find text span in the same div or next sibling
                const textSpan = div.querySelector('span[dir="auto"]');
                if (textSpan) {
                    const text = textSpan.innerText.trim();
                    if (text && text !== username && text.length > 2) {
                        const key = `${username}:${text}`;
                        if (!seen.has(key)) {
                            results.push({ username, text });
                            seen.add(key);
                        }
                    }
                }
            });
            return results;
        });

        console.log(`   Found ${comments.length} comments.`);
        return comments;
    } catch (error) {
        console.error('   Error scraping comments:', error.message);
        return [];
    }
}
