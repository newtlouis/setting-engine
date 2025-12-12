/**
 * @file Manages browser automation with Playwright to scrape and interact with Instagram DMs.
 */

import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Generates a random delay between a min and max value.
 * @param {number} min Minimum delay in milliseconds.
 * @param {number} max Maximum delay in milliseconds.
 * @returns {number} A random delay value.
 */
const randomDelay = (min, max) => Math.random() * (max - min) + min;

/**
 * Launches a browser, logs into Instagram, navigates to a conversation URL,
 * and scrapes the message history.
 *
 * @param {string} url The URL of the Instagram DM conversation.
 * @returns {Promise<{conversationHistory: Array, page: import('playwright').Page, browser: import('playwright').Browser}>}
 */
export async function scrapeConversation(url, options = {}) {
  const username = process.env.INSTAGRAM_USERNAME;
  const password = process.env.INSTAGRAM_PASSWORD;
  const headless = options.headless ?? false;
 
  if (!username || !password) {
    throw new Error('INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD must be set in your .env file.');
  }
 
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage();


  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle' });

    console.log('Logging in with human-like behavior...');
    
    // --- COOKIE POPUP HANDLING ---
    // (Ported from collector/utils.js)
    try {
        console.log('Checking for cookie consent popup...');
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
        
        // 1. Try standard selectors
        for (const selector of cookieSelectors) {
            try {
                const button = await page.$(selector);
                if (button && await button.isVisible()) {
                    console.log(`Found cookie button: ${selector}`);
                    await button.click();
                    cookieHandled = true;
                    await page.waitForTimeout(1000);
                    break;
                }
            } catch (e) {
                // Ignore
            }
        }

        // 2. Fallback: JavaScript click on text content
        if (!cookieHandled) {
             console.log('Trying JS-based cookie click...');
             await page.evaluate(() => {
                 const buttons = Array.from(document.querySelectorAll('button'));
                 const target = buttons.find(b => 
                     b.innerText.includes('Allow all cookies') || 
                     b.innerText.includes('Autoriser tous les cookies') ||
                     b.innerText.includes('Decline optional cookies') || // Sometimes prefer decline to clear it
                     b.innerText.includes('Refuser')
                 );
                 if (target) target.click();
             });
             await page.waitForTimeout(1000);
        }
        
    } catch (error) {
        console.log('Cookie popup check failed (or none present):', error.message);
    }
    // ----------------------------

    await page.waitForSelector('input[name="username"]', { timeout: 10000 });
    
    await page.type('input[name="username"]', username, { delay: randomDelay(50, 150) });
    await page.waitForTimeout(randomDelay(500, 1200));
    await page.type('input[name="password"]', password, { delay: randomDelay(50, 150) });
    await page.click('button[type="submit"]');
    
    await page.waitForNavigation({ waitUntil: 'networkidle' });
    console.log('Login successful.');

    // --- POPUP HANDLING: "Save your login info?" ---
    try {
      console.log('Checking for "Save Info" popup...');
      const notNowButton = page.locator('text=Not Now').or(page.locator('button:has-text("Not Now")'));
      await notNowButton.click({ timeout: 5000 }); // 5 second timeout
      console.log('Dismissed "Save Info" popup.');
    } catch (error) {
      console.log('No "Save Info" popup appeared, continuing.');
    }

    await page.waitForTimeout(randomDelay(1500, 3000));

    console.log(`Navigating to conversation: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });

    // --- POPUP HANDLING: "Turn on Notifications?" ---
    try {
      console.log('Checking for "Notifications" popup...');
      const notNowButton = page.locator('button:has-text("Not Now")');
      await notNowButton.click({ timeout: 5000 });
      console.log('Dismissed "Notifications" popup.');
    } catch (error) {
      console.log('No "Notifications" popup appeared, continuing.');
    }

    // --- HUMAN-LIKE SCROLLING ---
    console.log('Simulating a quick scroll to read history...');
    const messageSelector = 'div[role="listitem"]';
    await page.waitForSelector(messageSelector, { timeout: 15000 });
    await page.evaluate(() => {
      const messagePane = document.querySelector('div[role="listitem"]').parentElement.parentElement;
      if (messagePane) {
        messagePane.scrollTop = 0; // Scroll to top
      }
    });
    await page.waitForTimeout(randomDelay(800, 1500));
    await page.evaluate(() => {
      const messagePane = document.querySelector('div[role="listitem"]').parentElement.parentElement;
      if (messagePane) {
        messagePane.scrollTop = messagePane.scrollHeight; // Scroll to bottom
      }
    });
    await page.waitForTimeout(randomDelay(500, 1000));


    console.log('Extracting messages...');
    const loggedInUsername = username.toLowerCase();

    const conversationHistory = await page.evaluate((loggedInUser) => {
      const messages = [];
      document.querySelectorAll('div[role="listitem"]').forEach(item => {
        const textElement = item.querySelector('div[dir="auto"]');
        if (!textElement || textElement.innerText.trim() === '') return;
        const text = textElement.innerText;
        const isAssistant = item.closest('div[style*="align-self: flex-end"]') !== null;
        const role = isAssistant ? 'assistant' : 'user';
        messages.push({ role, text });
      });
      return messages;
    }, loggedInUsername);

    console.log(`Scraped ${conversationHistory.length} messages.`);
    return { conversationHistory, page, browser };

  } catch (error) {
    console.error('An error occurred during scraping:', error.message);
    await page.screenshot({ path: 'error_screenshot.png' });
    console.log('A screenshot was saved as error_screenshot.png.');
    await browser.close();
    throw new Error('Could not retrieve the conversation from the URL.');
  }
}

/**
 * Types the suggested message into the DM input field and leaves the browser open.
 * @param {import('playwright').Page} page The active Playwright page.
 * @param {string} message The message to type.
 */
export async function fillMessageAndLeaveOpen(page, message) {
  try {
    console.log('Typing suggested response into the browser...');
    const messageBoxSelector = 'textarea[placeholder*="Message"]';
    await page.waitForSelector(messageBoxSelector, { timeout: 10000 });
    await page.type(messageBoxSelector, message, { delay: randomDelay(80, 160) });
    
    console.log('\n✅ The message has been typed for you in the browser window.');
    console.log('   Please review it, then press "Send" manually.');
    console.log('   Close the browser window when you are finished.');

  } catch (error) {
    console.error('Could not type the message into the input field:', error.message);
    await page.screenshot({ path: 'error_typing_screenshot.png' });
    console.log('A screenshot was saved as error_typing_screenshot.png.');
    console.log('Please copy the message from the console and paste it manually.');
  }
}
