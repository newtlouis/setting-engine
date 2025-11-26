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
 * Write comments to CSV
 * 
 * CSV columns: post_url,username,profile_url,comment_text,comment_date,followers_estimate
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
      { id: 'followers_estimate', title: 'followers_estimate' }
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
 * 
 * @param {Page} page - Playwright page object
 * @returns {Promise<boolean>} True if challenge detected
 */
export async function detectChallenge(page) {
  const url = page.url();
  
  // Check URL patterns
  if (url.includes('/challenge/') || url.includes('/accounts/suspended/')) {
    return true;
  }

  // Check for challenge text content
  // FIX NOTE: Challenge detection text may vary by locale - add more patterns if needed
  const challengeText = await page.$('text=/suspicious activity|verify|challenge|confirm/i').catch(() => null);
  
  return challengeText !== null;
}

/**
 * Extract post metadata (placeholder for future enhancement)
 */
export function extractPostMetadata(postElement) {
  // Future: extract likes, comments count, date from post grid thumbnail
  return {};
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
    console.log('🔐 Auto-login enabled, logging in to Instagram...');
    
    // Navigate to login page
    await page.goto('https://www.instagram.com/accounts/login/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    
    await delay(2000 + Math.random() * 2000);
    
    // Handle cookie consent popup (appears before login form)
    console.log('   → Checking for cookie consent popup...');
    const cookieButtons = [
      'button:has-text("Accept")',
      'button:has-text("Allow")',
      'button:has-text("Accept All")',
      'button:has-text("Accepter")',
      'button:has-text("Tout accepter")',
      'button:has-text("Autoriser")',
      '[role="button"]:has-text("Accept")',
      '[role="button"]:has-text("Accepter")'
    ];
    
    for (const selector of cookieButtons) {
      try {
        const cookieButton = await page.$(selector);
        if (cookieButton) {
          console.log('   → Accepting cookies...');
          await cookieButton.click();
          await delay(1000);
          break;
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    // Wait for login form to be visible
    console.log('   → Waiting for login form...');
    await page.waitForSelector('input[name="username"]', { timeout: 10000 });
    
    // Fill username
    console.log('   → Entering username...');
    await page.fill('input[name="username"]', username);
    await delay(500 + Math.random() * 500);
    
    // Fill password
    console.log('   → Entering password...');
    await page.fill('input[name="password"]', password);
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
    await delay(3000 + Math.random() * 2000);
    
    // Check if login was successful
    const currentUrl = page.url();
    
    // Check for login errors
    const errorElement = await page.$('p[data-testid="login-error-message"]').catch(() => null);
    if (errorElement) {
      const errorText = await errorElement.textContent();
      console.error('   ❌ Login failed:', errorText);
      return false;
    }
    
    // Check for 2FA challenge
    if (currentUrl.includes('/challenge/') || currentUrl.includes('/accounts/login/two_factor')) {
      console.log('\n⚠️  Two-factor authentication detected!');
      console.log('   Please complete the 2FA verification in the browser.');
      console.log('   Press ENTER here when you see your Instagram feed...\n');
      
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
      
      return true;
    }
    
    // Wait for successful redirect to home page
    try {
      await page.waitForURL(/instagram\.com\/(reels\/)?(\?|$)/, { timeout: 10000 });
      console.log('   ✅ Auto-login successful!');
      
      // Handle "Save Your Login Info?" popup
      await delay(2000);
      const saveInfoButton = await page.$('text=/not now|pas maintenant/i').catch(() => null);
      if (saveInfoButton) {
        console.log('   → Dismissing "Save Login Info" popup...');
        await saveInfoButton.click();
        await delay(1000);
      }
      
      // Handle "Turn on Notifications?" popup
      const notifButton = await page.$('text=/not now|pas maintenant/i').catch(() => null);
      if (notifButton) {
        console.log('   → Dismissing "Turn on Notifications" popup...');
        await notifButton.click();
        await delay(1000);
      }
      
      return true;
    } catch (err) {
      console.error('   ❌ Login verification failed');
      return false;
    }
    
  } catch (error) {
    console.error('   ❌ Auto-login error:', error.message);
    return false;
  }
}
