/**
 * Utility Functions
 * 
 * Helper functions for file I/O, delays, detection, and data formatting.
 */

import { createObjectCsvWriter } from 'csv-writer';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * Ensure output directory exists
 */
export async function ensureOutputDir(dir) {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  
  // Create context subdirectory
  const contextDir = join(dir, 'context');
  if (!existsSync(contextDir)) {
    await mkdir(contextDir, { recursive: true });
  }
}

/**
 * Write posts to CSV
 * 
 * CSV columns: source_type,source_name,post_url,post_date,likes,comments_count,caption_excerpt
 */
export async function writePosts(posts, outputDir) {
  const csvWriter = createObjectCsvWriter({
    path: join(outputDir, 'posts.csv'),
    header: [
      { id: 'source_type', title: 'source_type' },
      { id: 'source_name', title: 'source_name' },
      { id: 'post_url', title: 'post_url' },
      { id: 'post_date', title: 'post_date' },
      { id: 'likes', title: 'likes' },
      { id: 'comments_count', title: 'comments_count' },
      { id: 'caption_excerpt', title: 'caption_excerpt' }
    ]
  });

  await csvWriter.writeRecords(posts);
}

/**
 * Save comments to CSV
 * 
 * CSV columns: post_url,username,profile_url,comment_text,comment_date,followers_estimate,source,is_spam,spam_reason,quality_score
 */
export async function writeComments(comments, outputDir) {
  const csvWriter = createObjectCsvWriter({
    path: join(outputDir, 'comments.csv'),
    header: [
      { id: 'post_url', title: 'post_url' },
      { id: 'username', title: 'username' },
      { id: 'profile_url', title: 'profile_url' },
      { id: 'comment_text', title: 'comment_text' },
      { id: 'comment_date', title: 'comment_date' },
      { id: 'followers_estimate', title: 'followers_estimate' },
      { id: 'source', title: 'source' },
      { id: 'is_spam', title: 'is_spam' },
      { id: 'spam_reason', title: 'spam_reason' },
      { id: 'quality_score', title: 'quality_score' },
      { id: 'account_id', title: 'account_id' }
    ]
  });

  await csvWriter.writeRecords(comments);
}

/**
 * Save post context as JSON
 */
export async function saveContextJSON(postUrl, context) {
  const outputDir = process.env.OUTPUT_DIR || './output';
  const contextDir = join(outputDir, 'context');
  
  // Generate filename from post URL
  const postId = postUrl.split('/').filter(Boolean).pop().replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `${postId}.json`;
  
  await writeFile(
    join(contextDir, filename),
    JSON.stringify(context, null, 2)
  );
}

/**
 * Delay execution
 * 
 * @param {number} ms - Milliseconds to delay
 */
export async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Detect Instagram challenge or rate limit page
 * AND pause for manual resolution if detected.
 * 
 * @param {Page} page - Playwright page object
 * @returns {Promise<boolean>} True if challenge persists (script should stop), False if resolved (continue)
 */
export async function detectChallenge(page) {
  const url = page.url();
  
  // Check URL patterns
  let isChallenge = url.includes('/challenge/') || url.includes('/accounts/suspended/');

  // Check for challenge text content
  if (!isChallenge) {
      // FIX NOTE: Challenge detection text may vary by locale - add more patterns if needed
      const challengeText = await page.$('text=/suspicious activity|verify|challenge|confirm|robot|identité/i').catch(() => null);
      if (challengeText) isChallenge = true;
  }
  
  if (isChallenge) {
      console.log('\n🛑 🛑 🛑 CHALLENGE DETECTED 🛑 🛑 🛑');
      console.log('   Instagram has flagged this activity.');
      console.log('   👉 Please go to the browser window NOW.');
      console.log('   👉 Solve the CAPTCHA or enter the SMS code manually.');
      console.log('   👉 Navigate back to the home page or the post.');
      console.log('   ⌨️  Press [ENTER] in this terminal when you are done to continue...');
      
      // Play a sound/bell if possible (terminal bell)
      process.stdout.write('\x07');

      // Wait for manual resolution
      const { createInterface } = await import('readline');
      await new Promise((resolve) => {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout
        });
        rl.question('', () => {
          rl.close();
          resolve();
        });
      });

      console.log('   🔄 Verifying if challenge is cleared...');
      await delay(3000);
      
      // Re-check
      const newUrl = page.url();
      const stillChallenge = newUrl.includes('/challenge/') || 
                             newUrl.includes('/accounts/suspended/') ||
                             (await page.$('text=/suspicious activity|verify|challenge|confirm/i').catch(() => null));
                             
      if (stillChallenge) {
          console.log('   ❌ Challenge still detected. Stopping script to be safe.');
          return true;
      } else {
          console.log('   ✅ Challenge cleared! Resuming...');
          return false;
      }
  }

  return false;
}

/**
 * Extract post metadata (placeholder for future enhancement)
 */
export function extractPostMetadata(postElement) {
  // Future: extract likes, comments count, date from post grid thumbnail
  return {};
}


/**
 * Type text into an input field in a human-like manner
 * 
 * @param {Page} page - Playwright page object
 * @param {string} selector - Selector for the input field
 * @param {string} text - Text to type
 */
async function typeHumanLike(page, selector, text) {
  await page.focus(selector);
  
  // Initial hesitation
  await delay(Math.random() * 500 + 200);
  
  let charsTyped = 0;
  
  for (const char of text) {
    // Variable typing speed (30ms - 150ms)
    // Faster for common letters, slower for others (simulated by random)
    const typingDelay = Math.random() * 120 + 30;
    
    await page.keyboard.type(char, { delay: typingDelay });
    charsTyped++;
    
    // Micro-pauses every 3-7 characters (simulating thinking or repositioning)
    if (Math.random() > 0.8 || (charsTyped % (Math.floor(Math.random() * 4) + 3) === 0)) {
      await delay(Math.random() * 400 + 100);
    }
  }
  
  // Final pause after finishing field
  await delay(Math.random() * 500 + 200);
}

/**
 * Auto-login to Instagram using credentials from environment variables
 * 
 * @param {Page} page - Playwright page object
 * @param {string} username - Instagram username
 * @param {string} password - Instagram password
 * @returns {Promise<boolean>} - True if login successful, false otherwise
 */
export async function autoLoginInstagram(page, username, password) {
  try {
    console.log('🔐 Checking for existing Instagram session...');
    
    // Navigate to homepage first to see if we are already logged in
    await page.goto('https://www.instagram.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    
    await delay(2000 + Math.random() * 2000);

    // If we're on the home page or reels page, check if we're logged in
    // Logged in users usually have a different title or specific navigation elements
    const isLoggedIn = await page.evaluate(() => {
      // Common indicators of being logged in:
      // 1. Presence of "Messages" or "Create" in side nav
      // 2. Absence of login inputs
      const navText = document.body.innerText.toLowerCase();
      const hasMessages = navText.includes('messages') || navText.includes('notifications');
      const hasLoginInput = !!document.querySelector('input[name="username"]');
      
      return hasMessages && !hasLoginInput;
    });

    if (isLoggedIn) {
      console.log('   ✅ Valid session found! Skipping login.');
      return true;
    }

    console.log('   👤 No active session, proceeding to login...');
    
    // If we're not on the login page, go there
    if (!page.url().includes('accounts/login')) {
      await page.goto('https://www.instagram.com/accounts/login/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await delay(2000);
    }
    
    await delay(2000 + Math.random() * 2000);
    
    // Handle cookie consent popup (appears before login form)
    console.log('   → Checking for cookie consent popup...');
    
    // Try multiple methods to find and click the cookie acceptance button
    let cookieHandled = false;
    
    // Method 1: Try new Instagram cookie popup with "Allow all cookies" button
    const cookieSelectors = [
      'button:has-text("Allow all cookies")',
      'button:has-text("Autoriser tous les cookies")',
      'button._a9-- _ap36._asz1', // Class-based selector for "Allow all cookies"
      'button:has-text("Accept")',
      'button:has-text("Allow")',
      'button:has-text("Accept All")',
      'button:has-text("Accepter")',
      'button:has-text("Tout accepter")',
      'button:has-text("Autoriser")',
    ];
    
    for (const selector of cookieSelectors) {
      try {
        const cookieButton = await page.$(selector);
        if (cookieButton && await cookieButton.isVisible()) {
          console.log(`   → Found cookie button with selector: ${selector}`);
          console.log('   → Accepting cookies...');
          
          // Try regular click first
          try {
            await cookieButton.click({ timeout: 3000 });
            cookieHandled = true;
            await delay(1500);
            break;
          } catch (clickErr) {
            // If regular click fails, try force click
            console.log('   → Retrying with force click...');
            await cookieButton.click({ force: true });
            cookieHandled = true;
            await delay(1500);
            break;
          }
        }
      } catch (e) {
        // Continue to next selector
        continue;
      }
    }
    
    // Method 2: If no button found, try JavaScript evaluation
    if (!cookieHandled) {
      try {
        console.log('   → Trying JavaScript-based cookie acceptance...');
        const jsClicked = await page.evaluate(() => {
          // Look for buttons with specific text
          const buttons = Array.from(document.querySelectorAll('button'));
          const cookieButton = buttons.find(btn => 
            btn.textContent.includes('Allow all cookies') ||
            btn.textContent.includes('Autoriser tous les cookies') ||
            btn.textContent.includes('Accept') ||
            btn.textContent.includes('Accepter')
          );
          
          if (cookieButton) {
            cookieButton.click();
            return true;
          }
          return false;
        });
        
        if (jsClicked) {
          console.log('   ✅ Cookie popup handled with JavaScript');
          cookieHandled = true;
          await delay(1500);
        }
      } catch (jsErr) {
        // Continue anyway
      }
    }
    
    if (!cookieHandled) {
      console.log('   ⚠️  No cookie popup detected (may already be accepted)');
    }
    
    // Wait for login form to be visible
    console.log('   → Waiting for login form...');
    await page.waitForSelector('input[name="username"]', { timeout: 10000 });
    
    // Fill username
    console.log('   → Entering username...');
    await typeHumanLike(page, 'input[name="username"]', username);
    await delay(500 + Math.random() * 500);
    
    // Fill password
    console.log('   → Entering password...');
    await typeHumanLike(page, 'input[name="password"]', password);
    await delay(500 + Math.random() * 500);
    
    // Click login button - use force click to bypass any overlays
    console.log('   → Clicking login button...');
    try {
      await page.click('button[type="submit"]', { force: true });
    } catch (err) {
      // Fallback: try clicking with JavaScript
      console.log('   → Retrying with JavaScript click...');
      await page.evaluate(() => {
        const submitBtn = document.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.click();
      });
    }
    
    // Wait for navigation or error
    console.log('   → Waiting for login response...');
    await delay(5000 + Math.random() * 2000); // Increased delay for redirects

    // 1. IMPROVED 2FA DETECTION
    const currentUrl = page.url();
    const is2FAPage = currentUrl.includes('/challenge/') || 
                     currentUrl.includes('/accounts/login/two_factor') ||
                     await page.$('input[name="verificationCode"]').catch(() => null) ||
                     await page.$('text=/Security Code|Code de sécurité|Authentification/i').catch(() => null);

    if (is2FAPage) {
      console.log('\n🔐 [ACTION REQUISH] : Authentification à deux facteurs détectée (2FA) !');
      console.log('   1. Remplissez le code Google Authenticator dans le navigateur.');
      console.log('   2. Cliquez sur "Se connecter".');
      console.log('   3. UNE FOIS QUE VOUS VOYEZ VOTRE FIL D\'ACTUALITÉ INSTAGRAM :');
      console.log('   4. Revenez ici et appuyez sur [ENTRÉE] pour continuer...\n');
      
      // Wait for manual 2FA completion
      const { createInterface } = await import('readline');
      await new Promise((resolve) => {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout
        });
        rl.question('', () => {
          rl.close();
          resolve();
        });
      });

      // After user presses enter, strictly verify we are on the home page
      try {
        console.log('   → Vérification de la connexion finale...');
        await page.waitForURL(/instagram\.com\/(reels\/)?(\?|$)/, { timeout: 15000 });
        console.log('   ✅ Connexion confirmée !');
        return true;
      } catch (err) {
        console.error('   ❌ Toujours pas connecté. La session a peut-être expiré ou le code était faux.');
        return false;
      }
    }
    
    // Check if login was successful strictly (not on login page anymore)
    if (currentUrl.includes('accounts/login') && !currentUrl.includes('two_factor')) {
       // Check for login errors
       const errorElement = await page.$('p[data-testid="login-error-message"]').catch(() => null);
       if (errorElement) {
         const errorText = await errorElement.textContent();
         console.error('   ❌ Login failed:', errorText);
         return false;
       }
    }
    
    // Check if "Save Your Login Info?" popup appears (means login succeeded!)
    console.log('   → Checking for "Save Login Info" popup...');
    await delay(2000);
    
    const saveInfoSelectors = [
      'text=/save info|save your login info|enregistrer/i',
      'text=/not now|pas maintenant/i',
      'button:has-text("Not Now")',
      'button:has-text("Pas maintenant")',
      '[role="button"]:has-text("Not Now")',
      '[role="button"]:has-text("Pas maintenant")'
    ];
    
    let loginSuccessful = false;
    
    // If "Save Info" popup appears, login was successful
    for (const selector of saveInfoSelectors) {
      try {
        const popup = await page.$(selector);
        if (popup && await popup.isVisible()) {
          console.log('   ✅ Login successful! (Save Info popup detected)');
          loginSuccessful = true;
          
          // Click "Not Now"
          const notNowButton = await page.$('text=/not now|pas maintenant/i').catch(() => null);
          if (notNowButton) {
            console.log('   → Dismissing "Save Login Info" popup...');
            await notNowButton.click();
            await delay(1000);
          }
          
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    // Alternative: Check if we're on the home page
    if (!loginSuccessful) {
      try {
        await page.waitForURL(/instagram\.com\/(reels\/)?(\?|$)/, { timeout: 5000 });
        console.log('   ✅ Auto-login successful! (Home page detected)');
        loginSuccessful = true;
      } catch (err) {
        // Not on home page yet, but might still be successful
      }
    }
    
    // Alternative: Check if login form disappeared
    if (!loginSuccessful) {
      const loginForm = await page.$('input[name="username"]').catch(() => null);
      if (!loginForm) {
        console.log('   ✅ Auto-login successful! (Login form disappeared)');
        loginSuccessful = true;
      }
    }
    
    if (!loginSuccessful) {
      console.error('   ❌ Login verification failed');
      return false;
    }
    
    // Handle "Turn on Notifications?" popup (appears after Save Info)
    await delay(1000);
    const notifButton = await page.$('text=/not now|pas maintenant/i').catch(() => null);
    if (notifButton && await notifButton.isVisible().catch(() => false)) {
      console.log('   → Dismissing "Turn on Notifications" popup...');
      await notifButton.click();
      await delay(1000);
    }
    
    return true;
    
  } catch (error) {
    console.error('   ❌ Auto-login error:', error.message);
    return false;
  }
}
