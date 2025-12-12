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

import { createInterface } from 'readline';

/**
 * Checks for CAPTCHA presence and pauses execution for manual solving if detected.
 * @param {import('playwright').Page} page 
 */
async function checkForCaptcha(page) {
    try {
        const captchaSelectors = [
            'iframe[src*="google.com/recaptcha"]',
            'iframe[src*="recaptcha"]',
            'div:has-text("Security Check")',
            'div:has-text("Vérifiez que vous n\'êtes pas un robot")',
            'div:has-text("Verify you are not a robot")',
            '#recaptcha_challenge_image',
            'div[role="checkbox"]'
        ];

        let found = false;
        for (const selector of captchaSelectors) {
             if (await page.$(selector)) {
                 found = true;
                 break;
             }
        }

        if (found) {
            console.log('\n⚠️  CAPTCHA / SECURITY CHECK DETECTED! ⚠️');
            console.log('An automated test has paused execution.');
            console.log('👉 Please solve the CAPTCHA manually in the browser window.');
            console.log('⌨️  Press ENTER in this terminal when you are done to continue...');
            
            await new Promise(resolve => {
                const rl = createInterface({ input: process.stdin, output: process.stdout });
                rl.question('', () => {
                    rl.close();
                    resolve();
                });
            });
            console.log('Resuming automation...');
            await page.waitForTimeout(2000);
        }
    } catch (e) {
        // Ignore errors during check
    }
}

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

    // Wait for username input (standard or split layout)
    try {
        await page.waitForSelector('input[name="username"]', { timeout: 10000 });
    } catch (e) {
        console.log('Username input not immediately found. Page might be loading or different layout. Waiting longer...');
        await page.waitForTimeout(2000);
        // Sometimes the split layout holds the form in a specific container
    }
    
    await checkForCaptcha(page);

    await page.type('input[name="username"]', username, { delay: randomDelay(50, 150) });
    await page.waitForTimeout(randomDelay(500, 1200));
    await page.type('input[name="password"]', password, { delay: randomDelay(50, 150) });
    await page.click('button[type="submit"]');

    // Wait for either navigation (success) or potential captcha
    try {
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 8000 });
    } catch (e) {
        console.log('Login navigation slow or blocked, checking for CAPTCHA...');
    }

    await checkForCaptcha(page); // Check again after submit
    
    console.log('Login successful (or proceeded).');

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

    console.log(`Navigating to URL: ${url}`);
    try {
        // networkidle is often too strict for Instagram profile pages
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000); // Give it a moment to render
    } catch (e) {
        console.log('Navigation timeout (non-fatal if content loaded):', e.message);
    }

    // --- CHECK IF PROFILE PAGE OR DM ---
    // If the URL does not contain "/direct/t/", assume it's a profile and try to click "Message"
    if (!page.url().includes('/direct/t/')) {
        console.log('URL appears to be a profile page. Attempting to click "Message" button...');
        try {
            // Wait for partial rendering
            await page.waitForSelector('main', { timeout: 5000 }).catch(() => {});

            // Scope search to the main content area to avoid clicking sidebar navigation
            const mainContent = page.locator('main');

            // Try various selectors for the "Message" button, prioritizing "Contacter"
            // We search significantly inside 'main' to avoid global nav
            const messageButtonSelectors = [
                'button:has-text("Contacter")',
                'div[role="button"]:has-text("Contacter")',
                'button:has-text("Envoyer un message")', 
                'div[role="button"]:has-text("Envoyer un message")',
                'button:has-text("Message")',
                'div[role="button"]:has-text("Message")' // Least specific last
            ];
            
            let clicked = false;
            for (const selector of messageButtonSelectors) {
                // Check visible buttons inside main
                const btn = mainContent.locator(selector).first();
                if (await btn.count() > 0 && await btn.isVisible()) {
                    console.log(`Found Profile Message button: ${selector}`);
                    await btn.click();
                    clicked = true;
                    break;
                }
            }
            
            if (!clicked) {
                console.log('Could not find explicit "Message" text. Checking for typical primary button location...');
                // Fallback: often the first or second button in the header actions
                // This is a last resort attempt
            }

            // After clicking "Contacter", just wait for the page to settle
            // The DM view takes a moment to load
            console.log('Waiting for DM view to settle...');
            await page.waitForTimeout(5000); // Give Instagram 5 seconds to load the DM
            console.log(`Current URL after click: ${page.url()}`);

        } catch (error) {
            console.log('Warning: Transition to DM might have failed or is slow:', error.message);
        }
    }

    // Give a moment for any popups to appear, then dismiss if present
    await page.waitForTimeout(1000);
    
    // Try to dismiss any popup that might block the view (notifications, save info, etc.)
    try {
        const dismissButtons = await page.$$('button:has-text("Not Now"), button:has-text("Plus tard"), button:has-text("Fermer")');
        for (const btn of dismissButtons) {
            if (await btn.isVisible()) {
                await btn.click();
                console.log('Dismissed a popup.');
                await page.waitForTimeout(500);
            }
        }
    } catch (e) {
        // No popups, continue
    }

    // --- EXTRACTION ---
    console.log('Extracting messages from the conversation...');
    const loggedInUsername = username.toLowerCase();

    const conversationHistory = await page.evaluate((loggedInUser) => {
      const messages = [];
      
      // Strategy: Find all potential message text nodes using a stable attribute
      // Instagram uses dir="auto" for user-generated text content
      const textNodes = Array.from(document.querySelectorAll('div[dir="auto"], span[dir="auto"]'));

      textNodes.forEach(node => {
        const text = node.innerText;
        if (!text || text.trim() === '') return;

        // Skip if this is likely not a message (e.g. input box, profile bio visible nearby)
        // We can check if it's inside the message list container.
        // Usually messages are in a scrollable container.
        
        // Determine Role:
        // We traverse up to find a container that has specific alignment styles.
        // "My" messages (assistant) usually align right (flex-end).
        // "Their" messages (user) usually align left (flex-start).
        
        let isAssistant = false;
        let p = node.parentElement;
        let depth = 0;
        const MAX_DEPTH = 15; // Don't go too high

        while (p && depth < MAX_DEPTH) {
            const style = window.getComputedStyle(p);
            
            // IG often uses align-self: flex-end for own messages in a flex column
            if (style.alignSelf === 'flex-end' || style.alignItems === 'flex-end') {
                isAssistant = true;
                break;
            }
            // Sometimes it's a row with justify-content: flex-end
            if (style.flexDirection === 'row' && style.justifyContent === 'flex-end') {
                isAssistant = true;
                break;
            }
            
            p = p.parentElement;
            depth++;
        }
        
        // Filter out generic UI text if possible. 
        // For now, we assume most dir="auto" in the main view are messages.
        // We can filter by "Message..." placeholder if needed, but innerText usually captures value not placeholder.
        
        messages.push({ 
            role: isAssistant ? 'assistant' : 'user', 
            text: text 
        });
      });

      // Deduplicate adjacent identical messages if needed, or rely on timestamp/order.
      // The querySelectorAll returns in document order, which is time order.
      
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
    const messageBoxSelector = 'textarea[placeholder*="Message"], textarea[placeholder*="Votre message"], div[contenteditable="true"], div[role="textbox"]';
    await page.waitForSelector(messageBoxSelector, { timeout: 10000 });
    // If it's a contenteditable div, we might need to click it first often
    await page.click(messageBoxSelector); 
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
