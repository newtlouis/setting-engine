/**
 * Instagram DM Sender Module
 * 
 * Handles sending DMs via Playwright with proper rate limiting and safety features.
 * 
 * CRITICAL SAFETY NOTES:
 * - This module requires manual login (no automated login)
 * - Rate limits are enforced to avoid account restrictions
 * - All messages should be reviewed before enabling send mode
 * - Default mode is PREVIEW (no actual sending)
 */

import { chromium } from 'playwright';
import { CONFIG } from './config.js';

/**
 * Wait for a random delay between min and max
 */
function delay(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if page shows any challenge or rate limit
 */
async function detectBlock(page) {
  // Check for challenge form
  const challenge = await page.$(CONFIG.SELECTORS.CHALLENGE_INDICATOR);
  if (challenge) {
    return { blocked: true, reason: 'challenge_detected' };
  }
  
  // Check page text for rate limit messages
  const pageText = await page.textContent('body').catch(() => '');
  if (CONFIG.SELECTORS.RATE_LIMIT_TEXT.test(pageText)) {
    return { blocked: true, reason: 'rate_limit_detected' };
  }
  
  return { blocked: false };
}

/**
 * Initialize browser with existing session
 * Requires manual login on first run
 * 
 * @param {Object} options
 * @returns {Promise<{browser, context, page}>}
 */
export async function initBrowser(options = {}) {
  const {
    userDataDir = './browser-data',
    headless = CONFIG.HEADLESS
  } = options;
  
  console.log('\n=== Initializing Browser ===');
  console.log(`   User data: ${userDataDir}`);
  console.log(`   Headless: ${headless}`);
  
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless,
    slowMo: CONFIG.SLOW_MO,
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await browser.newPage();
  
  // Navigate to Instagram to check login status
  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
  await delay(2000, 3000);
  
  // Check if logged in
  const isLoggedIn = await page.evaluate(() => {
    // Check for elements that only appear when logged in
    return !!(
      document.querySelector('svg[aria-label="Home"]') ||
      document.querySelector('a[href="/direct/inbox/"]') ||
      document.querySelector('[aria-label="New post"]')
    );
  });
  
  if (!isLoggedIn) {
    console.log('\n   MANUAL LOGIN REQUIRED');
    console.log('   Please log in to Instagram in the browser window.');
    console.log('   Press Enter in this terminal when done...');
    
    // Wait for user to log in
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });
    
    // Verify login
    await page.reload({ waitUntil: 'domcontentloaded' });
    await delay(2000, 3000);
  }
  
  console.log('   Browser ready\n');
  
  return { browser, page };
}

/**
 * Navigate to a user's profile
 * 
 * @param {Page} page - Playwright page
 * @param {string} username - Instagram username
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function goToProfile(page, username) {
  const profileUrl = `https://www.instagram.com/${username}/`;
  
  try {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.PAGE_TIMEOUT });
    await delay(1500, 2500);
    
    // Check for blocks
    const blockStatus = await detectBlock(page);
    if (blockStatus.blocked) {
      return { success: false, error: blockStatus.reason };
    }
    
    // Check if profile exists
    const notFound = await page.$('text=/sorry, this page/i');
    if (notFound) {
      return { success: false, error: 'profile_not_found' };
    }
    
    // Check if it's a private account we can't message
    const isPrivate = await page.evaluate(() => {
      return document.body.innerText.toLowerCase().includes('this account is private');
    });
    
    // Private accounts can still be messaged if they have Message button
    // So we just note it but don't fail
    
    return { success: true, isPrivate };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Click the Message button on a profile page
 * 
 * @param {Page} page - Playwright page
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function clickMessageButton(page) {
  try {
    // Try multiple selectors for the Message button
    const selectors = [
      CONFIG.SELECTORS.MESSAGE_BUTTON,
      CONFIG.SELECTORS.MESSAGE_BUTTON_ALT,
      'text="Message"',
      'button >> text="Message"'
    ];
    
    let clicked = false;
    for (const selector of selectors) {
      const button = await page.$(selector);
      if (button) {
        await button.click();
        clicked = true;
        break;
      }
    }
    
    if (!clicked) {
      return { success: false, error: 'message_button_not_found' };
    }
    
    // Wait for DM dialog to open
    await delay(1500, 2500);
    
    // Verify we're in the DM view
    const dmInput = await page.$(CONFIG.SELECTORS.MESSAGE_INPUT) ||
                    await page.$(CONFIG.SELECTORS.MESSAGE_INPUT_ALT) ||
                    await page.$('div[role="textbox"]');
    
    if (!dmInput) {
      return { success: false, error: 'dm_dialog_not_opened' };
    }
    
    return { success: true };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Type and send a DM message
 * 
 * @param {Page} page - Playwright page
 * @param {string} message - Message to send
 * @param {boolean} dryRun - If true, types but doesn't send
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendMessage(page, message, dryRun = true) {
  try {
    // Find message input
    const inputSelectors = [
      CONFIG.SELECTORS.MESSAGE_INPUT,
      CONFIG.SELECTORS.MESSAGE_INPUT_ALT,
      'div[role="textbox"]',
      'div[contenteditable="true"]'
    ];
    
    let input = null;
    for (const selector of inputSelectors) {
      input = await page.$(selector);
      if (input) break;
    }
    
    if (!input) {
      return { success: false, error: 'message_input_not_found' };
    }
    
    // Click to focus
    await input.click();
    await delay(300, 500);
    
    // Type message with human-like delays
    for (const char of message) {
      await page.keyboard.type(char, { delay: 30 + Math.random() * 50 });
    }
    
    await delay(500, 1000);
    
    if (dryRun) {
      console.log('      [DRY RUN] Message typed but not sent');
      // Clear the message
      await page.keyboard.down('Meta');
      await page.keyboard.press('a');
      await page.keyboard.up('Meta');
      await page.keyboard.press('Backspace');
      return { success: true, dryRun: true };
    }
    
    // Find and click send button
    const sendSelectors = [
      CONFIG.SELECTORS.SEND_BUTTON,
      CONFIG.SELECTORS.SEND_BUTTON_ALT,
      'button:has-text("Send")',
      'div[role="button"]:has-text("Send")'
    ];
    
    // Or just press Enter
    await page.keyboard.press('Enter');
    
    await delay(1000, 1500);
    
    // Verify message was sent (input should be empty)
    const inputValue = await input.textContent().catch(() => '');
    if (inputValue.length > 10) {
      // Message might not have sent
      return { success: false, error: 'message_may_not_have_sent' };
    }
    
    return { success: true, sent: true };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Send a DM to a user (full flow)
 * 
 * @param {Page} page - Playwright page
 * @param {string} username - Instagram username
 * @param {string} message - Message to send
 * @param {Object} options
 * @returns {Promise<Object>} Result object
 */
export async function sendDMToUser(page, username, message, options = {}) {
  const {
    dryRun = true,
    onProgress = null
  } = options;
  
  const result = {
    username,
    success: false,
    steps: [],
    error: null,
    timestamp: new Date().toISOString()
  };
  
  try {
    // Step 1: Go to profile
    if (onProgress) onProgress('navigating', username);
    const navResult = await goToProfile(page, username);
    result.steps.push({ step: 'navigate', ...navResult });
    
    if (!navResult.success) {
      result.error = navResult.error;
      return result;
    }
    
    // Step 2: Click Message button
    if (onProgress) onProgress('clicking_message', username);
    const clickResult = await clickMessageButton(page);
    result.steps.push({ step: 'click_message', ...clickResult });
    
    if (!clickResult.success) {
      result.error = clickResult.error;
      return result;
    }
    
    // Step 3: Send message
    if (onProgress) onProgress('sending', username);
    const sendResult = await sendMessage(page, message, dryRun);
    result.steps.push({ step: 'send', ...sendResult });
    
    if (!sendResult.success) {
      result.error = sendResult.error;
      return result;
    }
    
    result.success = true;
    result.dryRun = dryRun;
    
    return result;
    
  } catch (error) {
    result.error = error.message;
    return result;
  }
}

/**
 * Batch send DMs with rate limiting
 * 
 * @param {Page} page - Playwright page
 * @param {Array} targets - Array of { username, message } objects
 * @param {Object} options
 * @returns {Promise<Object>} Results summary
 */
export async function batchSendDMs(page, targets, options = {}) {
  const {
    dryRun = true,
    maxPerSession = CONFIG.MAX_DMS_PER_SESSION,
    onProgress = null,
    onComplete = null
  } = options;
  
  const results = {
    total: targets.length,
    attempted: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    blocked: false,
    details: []
  };
  
  console.log(`\n=== Starting Batch DM ${dryRun ? '(DRY RUN)' : '(LIVE)'} ===`);
  console.log(`   Targets: ${targets.length}`);
  console.log(`   Max per session: ${maxPerSession}`);
  console.log(`   Delay range: ${CONFIG.MIN_DELAY_BETWEEN_DMS/1000}s - ${CONFIG.MAX_DELAY_BETWEEN_DMS/1000}s\n`);
  
  for (let i = 0; i < Math.min(targets.length, maxPerSession); i++) {
    const target = targets[i];
    results.attempted++;
    
    console.log(`   [${i + 1}/${targets.length}] @${target.username}`);
    
    // Check for blocks before each attempt
    const blockStatus = await detectBlock(page);
    if (blockStatus.blocked) {
      console.log(`   BLOCKED: ${blockStatus.reason}. Stopping.`);
      results.blocked = true;
      results.blockReason = blockStatus.reason;
      break;
    }
    
    // Send DM
    const result = await sendDMToUser(page, target.username, target.message, {
      dryRun,
      onProgress
    });
    
    results.details.push(result);
    
    if (result.success) {
      results.successful++;
      console.log(`      OK${dryRun ? ' (dry run)' : ''}`);
    } else {
      results.failed++;
      console.log(`      FAILED: ${result.error}`);
    }
    
    if (onComplete) {
      onComplete(result);
    }
    
    // Rate limiting delay (except for last item)
    if (i < targets.length - 1) {
      const waitTime = CONFIG.MIN_DELAY_BETWEEN_DMS + 
                       Math.random() * (CONFIG.MAX_DELAY_BETWEEN_DMS - CONFIG.MIN_DELAY_BETWEEN_DMS);
      console.log(`      Waiting ${Math.round(waitTime/1000)}s before next...`);
      await delay(waitTime, waitTime + 1000);
    }
  }
  
  // Summary
  console.log('\n=== Batch Complete ===');
  console.log(`   Attempted: ${results.attempted}`);
  console.log(`   Successful: ${results.successful}`);
  console.log(`   Failed: ${results.failed}`);
  if (results.blocked) {
    console.log(`   STOPPED: ${results.blockReason}`);
  }
  
  return results;
}

/**
 * Close browser
 */
export async function closeBrowser(browser) {
  if (browser) {
    await browser.close();
  }
}
