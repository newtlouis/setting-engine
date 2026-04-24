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
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, cpSync, statSync } from 'fs';
import path from 'path';
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
 * Check if a process with given PID is still running
 */
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0); // Signal 0 = check existence without killing
    return true;
  } catch {
    return false;
  }
}

/**
 * Browser session instance
 */
class BrowserSession {
  constructor(context, workingPage, profile, options) {
    this.context = context;
    this.workingPage = workingPage;
    this.profile = profile;
    this.options = options;
    this.messageTabs = [];      // Raw pages for backward compat
    this.registeredTabs = [];   // Tabs with metadata {username, page, message, timestamp}
    this._isLoggedIn = false;
    this._browserDialogDetected = false;

    // Register browser-level dialog listener (alert/confirm/prompt)
    // These can block script execution, so we auto-dismiss them
    this.workingPage.on('dialog', async (dialog) => {
      const type = dialog.type();
      const message = dialog.message();
      console.log(`🚨 Browser dialog detected: [${type}] "${message}"`);
      console.log(`   → Auto-dismissing to prevent script blockage`);
      
      this._browserDialogDetected = true;
      
      try {
        await dialog.dismiss();
      } catch (e) {
        // Already dismissed or dialog closed
      }
    });
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

    if (username && password) {
      // Try auto-login first
      const success = await autoLoginInstagram(this.workingPage, username, password);
      if (success) {
        this._isLoggedIn = true;
        return true;
      }
      console.log('   ⚠️  Auto-login failed, switching to manual login...');
    }

    // Fallback: wait for user to log in manually in the browser
    await waitForManualLogin(this.workingPage);
    await delay(2000, 3000);
    return await this.checkLoggedIn();
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
   * Get all message tabs (tabs opened for DMs) - raw pages
   * @returns {Page[]}
   */
  getMessageTabs() {
    return this.messageTabs;
  }

  /**
   * Register a message tab with metadata for tracking
   * @param {string} username - Instagram username
   * @param {Page} page - Playwright page
   * @param {string} message - Message that was typed
   * @param {Object} [extra] - Optional extra metadata (dmUrl, etc.)
   */
  registerMessageTab(username, page, message, extra = {}) {
    this.registeredTabs.push({
      username,
      page,
      message,
      timestamp: new Date().toISOString(),
      ...extra
    });
  }

  /**
   * Get all registered tabs with metadata
   * @returns {Array<{username: string, page: Page, message: string, timestamp: string}>}
   */
  getRegisteredTabs() {
    return this.registeredTabs;
  }

  /**
   * Wait for user to finish reviewing messages and close browser
   * Browser stays open until user presses Enter or closes it
   * @returns {Promise<void>}
   */
  async waitForUserToFinish() {
    const tabs = this.registeredTabs;

    if (tabs.length === 0) {
      console.log('\n   No message tabs open. Nothing to review.');
      return;
    }

    // Write pending-review marker so zombie killer knows not to kill this process
    if (this._lockFile) {
      const pendingFile = this._lockFile.replace('.session.pid', '.pending-review');
      try { writeFileSync(pendingFile, `${tabs.length} tabs\n${new Date().toISOString()}`); } catch {}
      this._pendingReviewFile = pendingFile;
    }

    console.log('\n' + '='.repeat(50));
    console.log(`   📨 ${tabs.length} message(s) ready for review`);
    console.log('='.repeat(50));
    tabs.forEach((tab, i) => {
      console.log(`   ${i + 1}. @${tab.username}`);
    });
    console.log('\n   For each tab:');
    console.log('   1. Review the message');
    console.log('   2. Press Enter to send (or edit first)');
    console.log('   3. Move to next tab');
    console.log('\n   When done, press Enter here or close the browser window.');

    return new Promise((resolve) => {
      let resolved = false;

      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        // Remove pending-review marker
        if (this._pendingReviewFile) {
          try { unlinkSync(this._pendingReviewFile); } catch {}
          this._pendingReviewFile = null;
        }
        process.stdin.removeListener('data', onData);
        process.stdin.pause(); // Stop stdin from keeping event loop active
        process.removeListener('SIGINT', onSigInt);
        if (this.context) {
          this.context.removeListener('close', onBrowserClose);
        }
        resolve();
      };

      const onData = () => cleanup();
      const onSigInt = () => {
        console.log('\n   Received Ctrl+C. Finishing up...');
        cleanup();
      };
      const onBrowserClose = () => {
        console.log('\n   Browser window closed. Finishing up...');
        cleanup();
      };

      process.stdin.resume();
      process.stdin.once('data', onData);
      process.on('SIGINT', onSigInt);

      if (this.context) {
        this.context.on('close', onBrowserClose);

        // Also listen on the browser instance (handles manual window close)
        try {
          const browser = this.context.browser?.();
          if (browser) {
            browser.on('disconnected', () => {
              console.log('\n   Browser disconnected. Finishing up...');
              cleanup();
            });
          }
        } catch {}

        // Fallback: poll for closed pages every 10s (catches manual close not detected by events)
        const pollInterval = setInterval(() => {
          if (resolved) { clearInterval(pollInterval); return; }
          try {
            const pages = this.context?.pages() || [];
            if (pages.length === 0) {
              console.log('\n   All browser pages closed. Finishing up...');
              clearInterval(pollInterval);
              cleanup();
            }
          } catch {
            // Context destroyed
            clearInterval(pollInterval);
            cleanup();
          }
        }, 10000);
      } else {
        cleanup();
      }
    });
  }

  /**
   * Close all registered message tabs
   * @returns {Promise<void>}
   */
  async closeAllMessageTabs() {
    for (const tab of this.registeredTabs) {
      await tab.page.close().catch(() => {});
    }
    this.registeredTabs = [];
    this.messageTabs = [];
  }

  /**
   * Check for Instagram challenge/block on working page
   * @returns {Promise<boolean>} True if challenge persists
   */
  async checkForChallenge() {
    // Reset browser dialog flag before check
    this._browserDialogDetected = false;
    return await checkForChallenge(this.workingPage);
  }

  /**
   * Check if a browser-level dialog was detected since last check
   * @returns {boolean}
   */
  wasBrowserDialogDetected() {
    return this._browserDialogDetected;
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
   * Register process signal handlers to close browser gracefully on exit.
   * Prevents Chrome profile corruption when the process is killed.
   */
  _registerShutdownHandlers() {
    const gracefulClose = async (signal) => {
      if (this._shuttingDown) return;
      this._shuttingDown = true;
      console.log(`\n   🛑 ${signal} received — closing browser gracefully...`);
      await this.close();
      process.exit(0);
    };

    this._shutdownHandler = gracefulClose;
    process.on('SIGINT', () => gracefulClose('SIGINT'));
    process.on('SIGTERM', () => gracefulClose('SIGTERM'));
  }

  /**
   * Close the browser session and release PID lock
   */
  async close() {
    // Release pending-review marker
    if (this._pendingReviewFile) {
      try { unlinkSync(this._pendingReviewFile); } catch {}
      this._pendingReviewFile = null;
    }
    // Release PID lock
    if (this._lockFile) {
      try { unlinkSync(this._lockFile); } catch {}
      this._lockFile = null;
    }
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
      this.workingPage = null;
      this.messageTabs = [];
      this.registeredTabs = [];
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
   * @param {string} options.profile - Profile name (used for credentials)
   * @param {string} [options.purpose] - Session purpose (e.g. 'responder', 'sender') for concurrent isolation
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
      purpose = null,
      headless = false,
      timeout = 90000,
      slowMo = 50,
      autoLogin = true,
      diagnostic = false,
      forceAfterMinutes = 0
    } = options;

    // When purpose is provided, isolate browser data dir per purpose
    // but keep profile for credential resolution
    const dataProfile = purpose ? `${profile}-${purpose}` : profile;
    const userDataDir = getBrowserDataDir(dataProfile);

    console.log('\n=== Initializing Browser Session ===');
    console.log(`   Profile: ${profile}${purpose ? ` (${purpose})` : ''}`);
    console.log(`   User data: ${userDataDir}`);
    console.log(`   Headless: ${headless}`);

    // Bootstrap: on first use with purpose, copy session from base profile
    if (purpose) {
      const baseDefaultDir = path.join(getBrowserDataDir(profile), 'Default');
      const purposeDefaultDir = path.join(userDataDir, 'Default');
      if (!existsSync(purposeDefaultDir) && existsSync(baseDefaultDir)) {
        console.log(`   📋 Copying session from base profile...`);
        mkdirSync(userDataDir, { recursive: true });
        cpSync(baseDefaultDir, purposeDefaultDir, { recursive: true });
      }
    }

    // PID lock: prevent two processes from using the same browser data dir
    mkdirSync(userDataDir, { recursive: true });
    const lockFile = path.join(userDataDir, '.session.pid');
    if (existsSync(lockFile)) {
      const existingPid = parseInt(readFileSync(lockFile, 'utf8'), 10);
      if (existingPid && isProcessRunning(existingPid)) {
        // Check if the process has been running too long (zombie detection)
        if (forceAfterMinutes > 0) {
          const lockStat = statSync(lockFile);
          const lockAgeMinutes = (Date.now() - lockStat.mtimeMs) / 60000;
          if (lockAgeMinutes >= forceAfterMinutes) {
            console.log(`   ⚠️ Process ${existingPid} has been running for ${Math.round(lockAgeMinutes)}min (limit: ${forceAfterMinutes}min) — force killing`);
            try { process.kill(existingPid, 'SIGTERM'); } catch {}
            // Wait a moment for the process to exit
            await new Promise(r => setTimeout(r, 3000));
            if (isProcessRunning(existingPid)) {
              try { process.kill(existingPid, 'SIGKILL'); } catch {}
              await new Promise(r => setTimeout(r, 1000));
            }
            try { unlinkSync(lockFile); } catch {}
          } else {
            throw new Error(
              `🔒 Another session is already using this browser (PID: ${existingPid}, profile: ${dataProfile}). ` +
              `Wait for it to finish or kill it (kill ${existingPid}).`
            );
          }
        } else {
          throw new Error(
            `🔒 Another session is already using this browser (PID: ${existingPid}, profile: ${dataProfile}). ` +
            `Wait for it to finish or kill it (kill ${existingPid}).`
          );
        }
      } else {
        console.log(`   🧹 Removed stale lock (PID ${existingPid} no longer running)`);
      }
    }
    writeFileSync(lockFile, String(process.pid));

    // Clean up stale locks before launch (prevents macOS SIGTRAP crashes)
    cleanupBrowserLocks(dataProfile);

    // Get stealth options
    const stealthOptions = getStealthContextOptions(userDataDir, {
      headless,
      slowMo,
      timeout,
      diagnostic
    });

    // Launch persistent context
    let context;
    try {
      context = await chromium.launchPersistentContext(userDataDir, stealthOptions);
    } catch (err) {
      // Clean up PID lock on launch failure
      try { unlinkSync(lockFile); } catch {}
      throw err;
    }

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

    // Handle cookie/consent popups early (before login attempt)
    await handleCookiePopup(workingPage);

    // Check for challenge after loading
    await checkForChallenge(workingPage);

    // Create session instance — use original profile for credentials, not dataProfile
    const session = new BrowserSession(context, workingPage, profile, {
      headless,
      timeout,
      slowMo,
      diagnostic
    });
    session._lockFile = lockFile;

    // Clean up PID lock on process exit (safety net)
    process.on('exit', () => {
      try { unlinkSync(lockFile); } catch {}
      try { unlinkSync(lockFile.replace('.session.pid', '.pending-review')); } catch {}
    });

    // Register graceful shutdown to prevent profile corruption
    session._registerShutdownHandlers();

    // Auto-login if requested
    if (autoLogin) {
      const loggedIn = await session.ensureLoggedIn();
      if (!loggedIn) {
        console.error('\n   ❌ Login failed — cannot continue without an active session.');
        await session.close();
        throw new Error('Instagram login failed. Please check credentials or log in manually first.');
      }
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
