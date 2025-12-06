/**
 * @file Manages browser automation with Playwright to scrape and interact with Instagram DMs.
 */

import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Launches a browser, logs into Instagram, navigates to a conversation URL,
 * and scrapes the message history.
 *
 * @param {string} url The URL of the Instagram DM conversation.
 * @returns {Promise<{conversationHistory: Array, page: import('playwright').Page, browser: import('playwright').Browser}>}
 */
export async function scrapeConversation(url) {
  const username = process.env.INSTAGRAM_USERNAME;
  const password = process.env.INSTAGRAM_PASSWORD;

  if (!username || !password) {
    throw new Error('INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD must be set in your .env file.');
  }

  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle' });

    console.log('Logging in...');
    await page.waitForSelector('input[name="username"]', { timeout: 10000 });
    await page.fill('input[name="username"]', username);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle' });
    console.log('Login successful.');

    console.log(`Navigating to conversation: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });

    console.log('Extracting messages...');
    const messageSelector = 'div[role="listitem"]'; // This selector is fragile
    await page.waitForSelector(messageSelector, { timeout: 15000 });

    const loggedInUsername = username.toLowerCase();

    const conversationHistory = await page.evaluate((loggedInUser) => {
      const messages = [];
      // This logic is highly dependent on Instagram's current DOM structure and may break.
      document.querySelectorAll('div[role="listitem"]').forEach(item => {
        const textElement = item.querySelector('div[dir="auto"]');
        if (!textElement || textElement.innerText.trim() === '') return;

        const text = textElement.innerText;
        
        // A simple heuristic: messages aligned to the right are from the logged-in user.
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
    await browser.close(); // Close browser on error
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
    
    // This selector targets the message input area. It's highly likely to change.
    const messageBoxSelector = 'textarea[placeholder*="Message"]';
    await page.waitForSelector(messageBoxSelector, { timeout: 10000 });
    
    // Type the message with a natural delay to mimic human behavior
    await page.type(messageBoxSelector, message, { delay: 100 });
    
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
