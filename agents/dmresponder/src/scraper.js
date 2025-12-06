/**
 * @file Scrapes conversation history from an Instagram DM URL using Playwright.
 */

import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Scrapes a conversation from a given Instagram DM URL.
 * @param {string} url The URL of the Instagram DM conversation.
 * @returns {Promise<Array<{role: 'user' | 'assistant', text: string}>>} The conversation history.
 */
export async function scrapeConversation(url) {
  const username = process.env.INSTAGRAM_USERNAME;
  const password = process.env.INSTAGRAM_PASSWORD;

  if (!username || !password) {
    throw new Error('INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD must be set in your .env file.');
  }

  console.log('Launching browser to scrape conversation...');
  const browser = await chromium.launch({ headless: false }); // Set to true for production
  const page = await browser.newPage();

  try {
    // Go to login page first
    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle' });

    // Perform login
    console.log('Logging in...');
    await page.waitForSelector('input[name="username"]', { timeout: 10000 });
    await page.fill('input[name="username"]', username);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    
    // Wait for navigation to complete after login
    await page.waitForNavigation({ waitUntil: 'networkidle' });
    console.log('Login successful.');

    // Now, navigate to the target DM conversation
    console.log(`Navigating to conversation: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });

    console.log('Extracting messages...');
    
    // This selector is critical and may change. It targets the container for each message.
    const messageSelector = 'div[role="listitem"]';
    await page.waitForSelector(messageSelector, { timeout: 15000 });

    // Get the logged-in user's username to differentiate messages
    const loggedInUsername = await page.evaluate(() => {
      const profileLink = document.querySelector('header a[role="link"]');
      if (!profileLink) return null;
      const href = profileLink.getAttribute('href');
      // Extracts username from a URL like '/username/'
      return href.split('/').filter(Boolean)[0];
    });

    if (!loggedInUsername) {
      console.warn("Could not determine the logged-in user's username. Message roles might be inaccurate.");
    }

    const conversationHistory = await page.evaluate((loggedInUser) => {
      const messages = [];
      // This selector logic is highly dependent on Instagram's current DOM structure.
      document.querySelectorAll('div[role="listitem"]').forEach(item => {
        const textElement = item.querySelector('span'); // Assuming text is in a span
        if (!textElement) return;

        const text = textElement.innerText;
        
        // Determine role by finding the profile picture link and checking the username
        const profilePicLink = item.querySelector('a[href*="/p/"]')?.parentElement?.previousElementSibling?.querySelector('a');
        const messageUsername = profilePicLink?.href.split('/').filter(Boolean).pop();
        
        const role = (messageUsername === loggedInUser) ? 'assistant' : 'user';
        
        messages.push({ role, text });
      });
      return messages;
    }, loggedInUsername);

    console.log(`Scraped ${conversationHistory.length} messages.`);
    return conversationHistory;

  } catch (error) {
    console.error('Failed to scrape conversation:', error.message);
    await page.screenshot({ path: 'error_screenshot.png' });
    console.log('A screenshot was saved as error_screenshot.png to help with debugging.');
    throw new Error('Could not retrieve the conversation from the URL.');
  } finally {
    await browser.close();
  }
}
