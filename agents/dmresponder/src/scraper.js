/**
 * @file Scrapes conversation history from an Instagram DM URL using Playwright.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONTEXT_PATH = join(__dirname, '..', '.playwright_context');

/**
 * Scrapes a conversation from a given Instagram DM URL.
 * @param {string} url The URL of the Instagram DM conversation.
 * @returns {Promise<Array<{role: 'user' | 'assistant', text: string}>>} The conversation history.
 */
export async function scrapeConversation(url) {
  console.log('Launching browser to scrape conversation...');

  const browser = await chromium.launch({ headless: false }); // Headless false for first login
  const context = await browser.newContext({ storageState: CONTEXT_PATH });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle' });

    // Check if login is needed
    if (page.url().includes('login')) {
      console.log('Login required. Please log in to your Instagram account in the browser window.');
      console.log('After you have successfully logged in and are on the DM page, press Enter here to continue...');
      await new Promise(resolve => process.stdin.once('data', resolve));
      // Save the authentication state for future runs
      await context.storageState({ path: CONTEXT_PATH });
      console.log('Authentication state saved.');
    }

    console.log('Extracting messages...');
    
    // This is a placeholder selector. Instagram's selectors can be complex and change often.
    // This will need to be updated with the correct, stable selector for DM messages.
    const messageSelector = 'div[role="listitem"]';
    await page.waitForSelector(messageSelector, { timeout: 15000 });

    const conversationHistory = await page.evaluate(() => {
        const messages = [];
        // This selector logic is highly dependent on Instagram's current DOM structure.
        // It assumes messages sent by the user have a specific alignment or class.
        const myUsername = document.querySelector('header a[href="/_username_/"]')?.href.split('/').filter(Boolean).pop(); // This needs to be dynamically found
        
        document.querySelectorAll('div[role="listitem"]').forEach(item => {
            const text = item.innerText;
            // This is a simplified way to determine the role. A more robust method is needed.
            const isAssistant = item.style.alignSelf === 'flex-end'; // Example logic
            
            messages.push({
                role: isAssistant ? 'assistant' : 'user',
                text: text,
            });
        });
        return messages;
    });

    console.log(`Scraped ${conversationHistory.length} messages.`);
    return conversationHistory;

  } catch (error) {
    console.error('Failed to scrape conversation:', error.message);
    throw new Error('Could not retrieve the conversation from the URL.');
  } finally {
    await browser.close();
  }
}
