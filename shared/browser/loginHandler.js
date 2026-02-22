/**
 * Login Handler Module
 *
 * Handles Instagram login, 2FA, and cookie popup dismissal.
 * Consolidated from collector/utils.js autoLoginInstagram() and dm_sender.js cookie handling.
 */

import { createInterface } from 'readline';
import { delay, typeHumanLike, gotoWithRetry } from './interactions.js';

/**
 * Handle cookie consent popup
 *
 * @param {Page} page - Playwright page object
 * @returns {Promise<boolean>} True if cookie popup was handled
 */
export async function handleCookiePopup(page) {
  console.log('   → Checking for cookie consent popup...');

  const cookieSelectors = [
    'button:has-text("Allow all cookies")',
    'button:has-text("Autoriser tous les cookies")',
    'button:has-text("Allow essential and optional cookies")',
    'button:has-text("Uniquement les cookies essentiels")',
    'button._a9--._ap36._asz1',
    'button._a9--._a9_0',
    'div[role="dialog"] button:has-text("Allow")',
    'div[role="dialog"] button:has-text("Autoriser")',
    'button:has-text("Accept")',
    'button:has-text("Accepter")',
    'button:has-text("Tout accepter")'
  ];

  // Method 1: Try to find and click button with Playwright selectors
  for (const selector of cookieSelectors) {
    try {
      const button = await page.$(selector);
      if (button && await button.isVisible()) {
        console.log(`   → Found cookie button with selector: ${selector}`);
        try {
          await button.click({ timeout: 3000 });
          console.log('   ✅ Cookie popup handled');
          await delay(1500);
          return true;
        } catch (clickErr) {
          // If regular click fails, try force click
          console.log('   → Retrying with force click...');
          await button.click({ force: true });
          await delay(1500);
          return true;
        }
      }
    } catch (e) {
      // Continue to next selector
      continue;
    }
  }

  // Method 2: JavaScript evaluation fallback
  try {
    const jsClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const cookieButton = buttons.find(btn =>
        btn.textContent.includes('Allow all cookies') ||
        btn.textContent.includes('Autoriser tous les cookies') ||
        btn.textContent.includes('Accept') ||
        btn.textContent.includes('Accepter') ||
        btn.textContent.includes('Decline optional cookies') ||
        btn.textContent.includes('Refuser')
      );

      if (cookieButton) {
        cookieButton.click();
        return true;
      }
      return false;
    });

    if (jsClicked) {
      console.log('   ✅ Cookie popup handled with JavaScript');
      await delay(1500);
      return true;
    }
  } catch (jsErr) {
    // Continue anyway
  }

  console.log('   ⚠️  No cookie popup detected (may already be accepted)');
  return false;
}

/**
 * Check if user is already logged in to Instagram
 *
 * @param {Page} page - Playwright page object
 * @returns {Promise<boolean>} True if logged in
 */
export async function isLoggedIn(page) {
  return await page.evaluate(() => {
    const url = window.location.href;

    // If we are definitely on a login page, we are NOT logged in
    if (url.includes('/accounts/login')) return false;

    // Check for logged-in indicators (language agnostic where possible)
    const hasHomeIcon = !!document.querySelector('svg[aria-label="Home"]') ||
                        !!document.querySelector('svg[aria-label="Accueil"]');

    const hasMessenger = !!document.querySelector('a[href^="/direct/inbox"]') ||
                         !!document.querySelector('a[href="/direct/inbox/"]');

    const hasNewPost = !!document.querySelector('[aria-label="New post"]');

    const hasNav = !!document.querySelector('[role="navigation"]');
    const hasFeed = !!document.querySelector('[role="main"]');

    return hasHomeIcon || hasMessenger || hasNewPost || (hasNav && hasFeed);
  });
}

/**
 * Handle 2FA (Two-Factor Authentication)
 * Waits for user to manually enter the code
 *
 * @param {Page} page - Playwright page object
 * @returns {Promise<boolean>} True if 2FA completed successfully
 */
export async function handle2FA(page) {
  const currentUrl = page.url();
  const is2FAPage = currentUrl.includes('/challenge/') ||
                   currentUrl.includes('/accounts/login/two_factor') ||
                   await page.$('input[name="verificationCode"]').catch(() => null) ||
                   await page.$('text=/Security Code|Code de sécurité|Authentification/i').catch(() => null);

  if (!is2FAPage) return false;

  console.log('\n🔐 [ACTION REQUIRED] Two-Factor Authentication detected!');
  console.log('   1. Enter the code from your authenticator app in the browser.');
  console.log('   2. Click "Log In".');
  console.log('   3. ONCE YOU SEE YOUR INSTAGRAM FEED:');
  console.log('   4. Come back here and press [ENTER] to continue...\n');

  // Wait for manual 2FA completion
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

  // Verify login succeeded after 2FA
  try {
    console.log('   → Verifying login...');
    await page.waitForURL(/instagram\.com\/(reels\/)?(\?|$)/, { timeout: 15000 });
    console.log('   ✅ Login confirmed!');
    return true;
  } catch (err) {
    console.error('   ❌ Still not logged in. Session may have expired or code was incorrect.');
    return false;
  }
}

/**
 * Handle "Save Your Login Info?" and "Turn on Notifications?" popups
 *
 * @param {Page} page - Playwright page object
 */
export async function dismissPostLoginPopups(page) {
  // Handle "Save Login Info?" popup
  const notNowSelectors = [
    'text=/not now|pas maintenant/i',
    'button:has-text("Not Now")',
    'button:has-text("Pas maintenant")',
    '[role="button"]:has-text("Not Now")',
    '[role="button"]:has-text("Pas maintenant")'
  ];

  for (const selector of notNowSelectors) {
    try {
      const popup = await page.$(selector);
      if (popup && await popup.isVisible()) {
        console.log('   → Dismissing "Save Login Info" popup...');
        await popup.click();
        await delay(1000);
        break;
      }
    } catch (e) {
      continue;
    }
  }

  // Handle "Turn on Notifications?" popup
  await delay(1000);
  for (const selector of notNowSelectors) {
    try {
      const notifButton = await page.$(selector);
      if (notifButton && await notifButton.isVisible()) {
        console.log('   → Dismissing "Turn on Notifications" popup...');
        await notifButton.click();
        await delay(1000);
        break;
      }
    } catch (e) {
      continue;
    }
  }
}

/**
 * Auto-login to Instagram using credentials
 * Comprehensive implementation with 2FA support
 *
 * @param {Page} page - Playwright page object
 * @param {string} username - Instagram username
 * @param {string} password - Instagram password
 * @returns {Promise<boolean>} True if login successful
 */
export async function autoLoginInstagram(page, username, password) {
  try {
    console.log('🔐 Checking for existing Instagram session...');

    // Navigate to homepage first to check if already logged in
    try {
      await gotoWithRetry(page, 'https://www.instagram.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
    } catch (e) {
      console.log(`   ⚠️  Initial navigation error (non-fatal): ${e.message}`);
    }

    await delay(3000, 5000);

    // Check if already logged in
    if (await isLoggedIn(page)) {
      console.log('   ✅ Valid session found! (Home/Feed detected)');
      return true;
    }

    console.log('   👤 No active session detected, proceeding to login...');

    // If not on login page, navigate there
    if (!page.url().includes('accounts/login')) {
      await gotoWithRetry(page, 'https://www.instagram.com/accounts/login/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await delay(2000);
    }

    await delay(2000, 4000);

    // Handle cookie consent popup
    await handleCookiePopup(page);

    // Wait for login form (Instagram uses name="email" or name="username")
    console.log('   → Waiting for login form...');
    const usernameSelector = await Promise.race([
      page.waitForSelector('input[name="email"]', { timeout: 10000 }).then(() => 'input[name="email"]'),
      page.waitForSelector('input[name="username"]', { timeout: 10000 }).then(() => 'input[name="username"]')
    ]);

    // Fill username
    console.log('   → Entering username...');
    await typeHumanLike(page, username, { focusSelector: usernameSelector });
    await delay(500, 1000);

    // Fill password (Instagram uses name="pass" or name="password")
    console.log('   → Entering password...');
    const passwordField = await page.$('input[name="pass"]') || await page.$('input[name="password"]');
    const passwordSelector = await page.$('input[name="pass"]') ? 'input[name="pass"]' : 'input[name="password"]';
    await typeHumanLike(page, password, { focusSelector: passwordSelector });
    await delay(500, 1000);

    // Click login button
    console.log('   → Clicking login button...');
    try {
      // Try new Instagram button first (role="button" with aria-label)
      const loginBtn = await page.$('[role="button"][aria-label="Se connecter"]')
        || await page.$('[role="button"][aria-label="Log in"]')
        || await page.$('button[type="submit"]');
      if (loginBtn) {
        await loginBtn.click({ force: true });
      } else {
        await page.click('button[type="submit"]', { force: true });
      }
    } catch (err) {
      // Fallback: try clicking with JavaScript
      console.log('   → Retrying with JavaScript click...');
      await page.evaluate(() => {
        const btn = document.querySelector('[role="button"][aria-label="Se connecter"]')
          || document.querySelector('[role="button"][aria-label="Log in"]')
          || document.querySelector('button[type="submit"]');
        if (btn) btn.click();
      });
    }

    // Wait for login response
    console.log('   → Waiting for login response...');
    await delay(5000, 7000);

    // Check for 2FA
    const handled2FA = await handle2FA(page);
    if (handled2FA === false && page.url().includes('/challenge/')) {
      // 2FA was detected but user failed to complete it
      return false;
    }

    // Check for login errors
    const currentUrl = page.url();
    if (currentUrl.includes('accounts/login') && !currentUrl.includes('two_factor')) {
      const errorElement = await page.$('p[data-testid="login-error-message"]').catch(() => null);
      if (errorElement) {
        const errorText = await errorElement.textContent();
        console.error('   ❌ Login failed:', errorText);
        return false;
      }
    }

    // Dismiss post-login popups
    await dismissPostLoginPopups(page);

    // Final verification
    let loginSuccessful = false;

    // Check if on home page
    try {
      await page.waitForURL(/instagram\.com\/(reels\/)?(\?|$)/, { timeout: 5000 });
      console.log('   ✅ Auto-login successful! (Home page detected)');
      loginSuccessful = true;
    } catch (err) {
      // Not on home page yet, check other indicators
    }

    // Check if login form disappeared
    if (!loginSuccessful) {
      const loginForm = await page.$('input[name="username"]').catch(() => null)
        || await page.$('input[name="email"]').catch(() => null);
      if (!loginForm) {
        console.log('   ✅ Auto-login successful! (Login form disappeared)');
        loginSuccessful = true;
      }
    }

    if (!loginSuccessful) {
      console.error('   ❌ Login verification failed');
      return false;
    }

    return true;

  } catch (error) {
    console.error('   ❌ Auto-login error:', error.message);
    return false;
  }
}

/**
 * Wait for manual login (when credentials are not available)
 *
 * @param {Page} page - Playwright page object
 * @returns {Promise<void>}
 */
export async function waitForManualLogin(page) {
  console.log('\n   ⚠️  MANUAL LOGIN REQUIRED');
  console.log('   (Set INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD in .env for auto-login)');
  console.log('   Please log in to Instagram in the browser window.');
  console.log('   Press Enter in this terminal when done...');

  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });
}
