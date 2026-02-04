/**
 * Instagram Platform Adapter
 *
 * Implements IPlatformAdapter for Instagram.
 * Wraps existing scraper/dm_sender functionality.
 */

import { createPlatformAdapter, Platform } from '../../application/ports/IPlatformAdapter.js';
import { chromium } from 'playwright';
import path from 'path';
import { getStealthContextOptions, applyStealthToPage } from '../../stealth.js';
import { cleanupBrowserLocks } from '../../paths.js';

// Instagram-specific selectors
export const SELECTORS = {
  // Login
  LOGIN_BUTTON: 'button[type="submit"]',
  USERNAME_INPUT: 'input[name="username"]',
  PASSWORD_INPUT: 'input[name="password"]',

  // Cookie popup
  COOKIE_ACCEPT: 'button:has-text("Autoriser"), button:has-text("Allow")',
  COOKIE_DECLINE: 'button:has-text("Refuser"), button:has-text("Decline")',

  // Profile
  PROFILE_HEADER: 'header section',
  BIO_SELECTOR: 'header section > div:nth-child(3)',
  FOLLOWERS_LINK: 'a[href$="/followers/"]',

  // DM
  MESSAGE_BUTTON: 'div[role="button"]:has-text("Message"), div[role="button"]:has-text("Contacter")',
  MESSAGE_INPUT: 'div[role="textbox"][contenteditable="true"]',
  SEND_BUTTON: 'button[type="submit"]:has-text("Send"), div[role="button"]:has-text("Envoyer")',

  // Conversation
  MESSAGE_CONTAINER: 'div[role="listbox"]',
  MESSAGE_ITEM: 'div[role="row"]'
};

/**
 * Create Instagram Platform Adapter
 */
export function createInstagramAdapter() {
  let browser = null;
  let context = null;
  let mainPage = null;

  const implementation = {
    platform: Platform.INSTAGRAM,

    async initSession(options) {
      const { profile, headless = false } = options;

      await cleanupBrowserLocks(profile);

      const userDataDir = path.join(process.cwd(), `browser-data-${profile}`);

      context = await chromium.launchPersistentContext(userDataDir, {
        ...getStealthContextOptions(),
        headless,
        viewport: { width: 1280, height: 800 },
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox'
        ]
      });

      const pages = context.pages();
      mainPage = pages.length > 0 ? pages[0] : await context.newPage();

      await applyStealthToPage(mainPage);

      return {
        browser: context,
        page: mainPage,
        platform: Platform.INSTAGRAM,
        profile
      };
    },

    async login(session) {
      const { page } = session;

      // Navigate to Instagram
      await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      // Handle cookie popup if present
      try {
        const cookieBtn = await page.$(SELECTORS.COOKIE_DECLINE);
        if (cookieBtn) {
          await cookieBtn.click();
          await page.waitForTimeout(1000);
        }
      } catch (e) {
        // Cookie popup not present
      }

      // Check if already logged in
      const isLoggedIn = await page.evaluate(() => {
        return !document.querySelector('input[name="username"]');
      });

      return isLoggedIn;
    },

    async scrapeProfile(session, username) {
      const { page } = session;

      try {
        await page.goto(`https://www.instagram.com/${username}/`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
        await page.waitForTimeout(2000);

        // Check if profile exists
        const notFound = await page.evaluate(() => {
          return document.body.innerText.includes("Cette page n'est pas disponible") ||
                 document.body.innerText.includes("Page Not Found");
        });

        if (notFound) {
          return { success: false, error: 'Profile not found' };
        }

        // Scrape metadata
        const metadata = await page.evaluate(() => {
          const header = document.querySelector('header');
          if (!header) return null;

          // Full name
          const nameEl = header.querySelector('span[class*="x1lliihq"]');
          const fullName = nameEl?.innerText?.trim() || '';

          // Bio
          const bioEl = header.querySelector('h1')?.parentElement?.nextElementSibling;
          const bio = bioEl?.innerText?.trim() || '';

          // Followers count
          const followersLink = document.querySelector('a[href$="/followers/"]');
          const followersText = followersLink?.innerText || '0';
          const followersCount = parseInt(followersText.replace(/[^0-9]/g, '')) || 0;

          // Verified
          const isVerified = !!header.querySelector('svg[aria-label="Verified"]');

          // Private
          const isPrivate = document.body.innerText.includes('Ce compte est privé') ||
                           document.body.innerText.includes('This account is private');

          return { fullName, bio, followersCount, isVerified, isPrivate };
        });

        if (!metadata) {
          return { success: false, error: 'Could not parse profile' };
        }

        return {
          success: true,
          username,
          fullName: metadata.fullName,
          bio: metadata.bio,
          profileUrl: `https://www.instagram.com/${username}/`,
          followersCount: metadata.followersCount,
          isVerified: metadata.isVerified,
          isPrivate: metadata.isPrivate
        };

      } catch (error) {
        return { success: false, error: error.message };
      }
    },

    async openDM(session, username, profileUrl) {
      const { page } = session;

      try {
        // Navigate to profile if not already there
        const currentUrl = page.url();
        if (!currentUrl.includes(`/${username}`)) {
          await page.goto(profileUrl || `https://www.instagram.com/${username}/`, {
            waitUntil: 'domcontentloaded'
          });
          await page.waitForTimeout(2000);
        }

        // Click Message button
        const messageBtn = await page.$(SELECTORS.MESSAGE_BUTTON);
        if (!messageBtn) {
          return { success: false, error: 'Message button not found' };
        }

        await messageBtn.click();
        await page.waitForTimeout(2000);

        // Wait for message input
        const messageInput = await page.waitForSelector(SELECTORS.MESSAGE_INPUT, { timeout: 10000 });
        if (!messageInput) {
          return { success: false, error: 'Message input not found' };
        }

        // Create new tab for this DM
        const dmTab = await context.newPage();
        await dmTab.goto(page.url());
        await dmTab.waitForTimeout(1500);

        // Scrape existing messages
        const messages = await this.scrapeConversation(dmTab);

        return {
          success: true,
          tab: dmTab,
          dmUrl: dmTab.url(),
          scrapedMessages: messages
        };

      } catch (error) {
        return { success: false, error: error.message, scrapedMessages: [] };
      }
    },

    async scrapeConversation(tab) {
      try {
        return await tab.evaluate(() => {
          const messages = [];
          const container = document.querySelector('div[role="listbox"]');
          if (!container) return messages;

          const rows = container.querySelectorAll('div[role="row"]');

          for (const row of rows) {
            const text = row.innerText?.trim();
            if (!text || text.length < 2) continue;

            // Determine role based on position/style
            const isFromMe = row.querySelector('[style*="flex-end"]') !== null ||
                            row.classList.contains('sent');

            messages.push({
              role: isFromMe ? 'assistant' : 'user',
              text: text.substring(0, 500)
            });
          }

          return messages;
        });
      } catch (error) {
        return [];
      }
    },

    async sendMessage(tab, message) {
      try {
        const input = await tab.$(SELECTORS.MESSAGE_INPUT);
        if (!input) {
          return { success: false, error: 'Message input not found' };
        }

        await input.fill(message);
        await tab.waitForTimeout(500);

        // Press Enter to send
        await tab.keyboard.press('Enter');
        await tab.waitForTimeout(1000);

        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },

    async typeMessage(tab, message) {
      try {
        const input = await tab.$(SELECTORS.MESSAGE_INPUT);
        if (!input) return;

        // Type human-like
        for (const char of message) {
          await input.type(char, { delay: 30 + Math.random() * 50 });
        }
      } catch (error) {
        console.error('Error typing message:', error.message);
      }
    },

    async closeSession(session) {
      try {
        if (context) {
          await context.close();
        }
      } catch (error) {
        console.error('Error closing session:', error.message);
      }
    }
  };

  return createPlatformAdapter(implementation);
}

export default createInstagramAdapter;
