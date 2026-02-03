/**
 * BrowserService - Centralized Browser Session Management
 *
 * Consolidates browser initialization, login, and stealth configuration
 * that was previously duplicated across collector, outreach, and dmresponder.
 *
 * Usage:
 *   const session = await BrowserService.initSession({
 *     profile: 'myprofile',
 *     headless: false,
 *     timeout: 90000
 *   });
 *
 *   const page = session.getWorkingPage();
 *   await session.ensureLoggedIn();
 *   const newTab = await session.createNewTab();
 *   await session.close();
 */

import { chromium } from 'playwright';
import { cleanupBrowserLocks, getBrowserDataDir } from '../paths.js';
import { getStealthContextOptions, applyStealthToPage } from '../stealth.js';
import { getCredentialsForProfile } from '../credentials.js';
import { checkForChallenge } from '../pageVerification.js';
import { delay, gotoWithRetry } from './interactions.js';
import {
  autoLoginInstagram,
  waitForManualLogin,
  isLoggedIn,
  handleCookiePopup,
  dismissPostLoginPopups
} from './loginHandler.js';

/**
 * Browser session instance
 */
class BrowserSession {
  constructor(context, workingPage, profile, options) {
    this.context = context;
    this.workingPage = workingPage;
    this.profile = profile;
    this.options = options;
    this.messageTabs = [];
    this._isLoggedIn = false;
  }

  /**
   * Get the working page (main tab for navigation)
   * @returns {Page}
   */
  getWorkingPage() {
    return this.workingPage;
  }

  /**
   * Get the browser context
   * @returns {BrowserContext}
   */
  getContext() {
    return this.context;
  }

  /**
   * Check if currently logged in
   * @returns {Promise<boolean>}
   */
  async checkLoggedIn() {
    this._isLoggedIn = await isLoggedIn(this.workingPage);
    return this._isLoggedIn;
  }

  /**
   * Ensure the session is logged in to Instagram
   * Will auto-login if credentials are available, otherwise waits for manual login
   *
   * @returns {Promise<boolean>} True if logged in
   */
  async ensureLoggedIn() {
    // Check current login status
    if (await this.checkLoggedIn()) {
      console.log('   ✅ Already logged in');
      return true;
    }

    // Get credentials for this profile
    const { username, password } = getCredentialsForProfile(this.profile);

    if (!username || !password) {
      // No credentials, wait for manual login
      await waitForManualLogin(this.workingPage);
      await this.workingPage.reload({ waitUntil: 'domcontentloaded' });
      await delay(2000, 3000);
      return await this.checkLoggedIn();
    }

    // Auto-login with credentials
    const success = await autoLoginInstagram(this.workingPage, username, password);
    if (success) {
      this._isLoggedIn = true;
    }
    return success;
  }

  /**
   * Create a new tab with stealth applied
   * @returns {Promise<Page>}
   */
  async createNewTab() {
    const page = await this.context.newPage();
    page.setDefaultTimeout(this.options.timeout || 90000);
    await applyStealthToPage(page);
    this.messageTabs.push(page);
    return page;
  }

  /**
   * Get all message tabs (tabs opened for DMs)
   * @returns {Page[]}
   */
  getMessageTabs() {
    return this.messageTabs;
  }

  /**
   * Check for Instagram challenge/block on working page
   * @returns {Promise<boolean>} True if challenge persists
   */
  async checkForChallenge() {
    return await checkForChallenge(this.workingPage);
  }

  /**
   * Navigate working page to a URL with retry
   *
   * @param {string} url - URL to navigate to
   * @param {Object} [options] - Navigation options
   * @returns {Promise}
   */
  async navigateTo(url, options = {}) {
    const defaultOptions = {
      waitUntil: 'domcontentloaded',
      timeout: this.options.timeout || 90000
    };
    return gotoWithRetry(this.workingPage, url, { ...defaultOptions, ...options });
  }

  /**
   * Close the browser session
   */
  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.workingPage = null;
      this.messageTabs = [];
    }
  }
}

/**
 * BrowserService - Static factory for creating browser sessions
 */
const BrowserService = {
  /**
   * Initialize a new browser session
   *
   * @param {Object} options - Session options
   * @param {string} options.profile - Profile name for browser data directory
   * @param {boolean} [options.headless=false] - Run in headless mode
   * @param {number} [options.timeout=90000] - Default page timeout
   * @param {number} [options.slowMo=50] - Slow down operations by this many ms
   * @param {boolean} [options.autoLogin=true] - Automatically attempt login
   * @param {boolean} [options.diagnostic=false] - Use diagnostic mode (minimal args)
   * @returns {Promise<BrowserSession>}
   */
  async initSession(options = {}) {
    const {
      profile = 'default',
      headless = false,
      timeout = 90000,
      slowMo = 50,
      autoLogin = true,
      diagnostic = false
    } = options;

    const userDataDir = getBrowserDataDir(profile);

    console.log('\n=== Initializing Browser Session ===');
    console.log(`   Profile: ${profile}`);
    console.log(`   User data: ${userDataDir}`);
    console.log(`   Headless: ${headless}`);

    // Clean up stale locks before launch (prevents macOS SIGTRAP crashes)
    cleanupBrowserLocks(profile);

    // Get stealth options
    const stealthOptions = getStealthContextOptions(userDataDir, {
      headless,
      slowMo,
      timeout,
      diagnostic
    });

    // Launch persistent context
    const context = await chromium.launchPersistentContext(userDataDir, stealthOptions);

    // Create working page
    const workingPage = await context.newPage();
    workingPage.setDefaultTimeout(timeout);

    // Apply stealth init script
    await applyStealthToPage(workingPage);

    // Navigate to Instagram
    console.log(`   Loading Instagram (timeout: ${timeout / 1000}s)...`);
    try {
      await gotoWithRetry(workingPage, 'https://www.instagram.com/', {
        waitUntil: 'domcontentloaded',
        timeout: timeout
      });
    } catch (error) {
      console.log(`   ⚠️ Initial navigation error (non-fatal): ${error.message}`);
    }
    await delay(2000, 3000);

    // Check for challenge after loading
    await checkForChallenge(workingPage);

    // Create session instance
    const session = new BrowserSession(context, workingPage, profile, {
      headless,
      timeout,
      slowMo,
      diagnostic
    });

    // Auto-login if requested
    if (autoLogin) {
      await session.ensureLoggedIn();
    }

    return session;
  },

  /**
   * Initialize a minimal browser session (for backward compatibility)
   * Returns the raw context, browser, and page objects
   *
   * @param {Object} options
   * @returns {Promise<{context, page}>}
   */
  async initBrowser(options = {}) {
    const session = await this.initSession(options);
    return {
      context: session.getContext(),
      page: session.getWorkingPage(),
      session
    };
  }
};

export { BrowserService, BrowserSession };
export default BrowserService;
