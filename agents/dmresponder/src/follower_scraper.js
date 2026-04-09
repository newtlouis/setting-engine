/**
 * Follower Scraper
 *
 * Opens an Instagram profile, clicks "followers", scrolls through the modal
 * and collects all follower usernames. Saves them to account_followers table.
 */

import { getDb } from '../../../agents/collector/src/db/core.js';

const SCROLL_PAUSE = 2000;
const MAX_SCROLL_ATTEMPTS_WITHOUT_NEW = 20;

/**
 * Scrape followers from a profile's followers modal
 * @param {import('playwright').Page} page - Playwright page
 * @param {string} profileUsername - The account's Instagram username
 * @param {number} accountId - Account ID in database
 * @param {Object} options
 * @param {boolean} options.saveToDb - Save to account_followers table (default true)
 * @param {number} options.maxToScrape - Max followers to scrape (0 = unlimited)
 * @returns {Promise<string[]>} Array of follower usernames
 */
export async function scrapeFollowers(page, profileUsername, accountId, { saveToDb = true, maxToScrape = 0 } = {}) {
  console.log(`\n📋 Scraping followers for @${profileUsername}${maxToScrape ? ` (max ${maxToScrape})` : ''}...`);

  // Navigate to profile
  await page.goto(`https://www.instagram.com/${profileUsername}/`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  await page.waitForTimeout(3000);

  // Click on the followers link
  const followersLink = page.locator(`a[href="/${profileUsername}/followers/"]`);
  await followersLink.click();
  await page.waitForTimeout(3000);

  // Wait for the modal to appear and let followers load
  const modal = page.locator('[role="dialog"]');
  await modal.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(5000);

  const allUsernames = new Set();
  let scrollAttemptsWithoutNew = 0;
  let lastLoggedCount = 0;

  console.log('   Scrolling through followers list...');

  while (scrollAttemptsWithoutNew < MAX_SCROLL_ATTEMPTS_WITHOUT_NEW) {
    // Stop if we've reached the max
    if (maxToScrape > 0 && allUsernames.size >= maxToScrape) break;

    // Extract usernames from visible items in the modal
    const newUsernames = await modal.evaluate((el) => {
      const links = el.querySelectorAll('a[href^="/"]');
      const usernames = [];
      for (const link of links) {
        const href = link.getAttribute('href');
        const match = href.match(/^\/([^/]+)\/$/);
        if (match) {
          const username = match[1];
          const excluded = ['explore', 'direct', 'reels', 'p', 'stories', 'notifications', 'accounts'];
          if (!excluded.includes(username)) {
            usernames.push(username);
          }
        }
      }
      return [...new Set(usernames)];
    });

    const prevSize = allUsernames.size;
    for (const u of newUsernames) allUsernames.add(u);

    if (allUsernames.size > prevSize) {
      scrollAttemptsWithoutNew = 0;
      // Log progress every 50
      if (allUsernames.size - lastLoggedCount >= 50) {
        console.log(`   ... ${allUsernames.size} followers found`);
        lastLoggedCount = allUsernames.size;
      }
    } else {
      scrollAttemptsWithoutNew++;
    }

    // Find the scrollable container inside the modal and scroll it
    await modal.evaluate((el) => {
      let bestScrollable = null;
      let bestScrollHeight = 0;

      const candidates = el.querySelectorAll('div');
      for (const div of candidates) {
        if (div.scrollHeight > div.clientHeight + 10 && div.clientHeight > 100) {
          if (div.scrollHeight > bestScrollHeight) {
            bestScrollHeight = div.scrollHeight;
            bestScrollable = div;
          }
        }
      }

      if (bestScrollable) {
        bestScrollable.scrollTop += 800;
      }
    });

    await page.waitForTimeout(SCROLL_PAUSE);
  }

  // Remove the profile's own username
  allUsernames.delete(profileUsername);

  console.log(`   ✅ Total followers scraped: ${allUsernames.size}`);

  // Save to database (only for broadcast — prospector handles its own table)
  if (saveToDb) {
    const db = getDb();
    const insert = db.prepare(
      "INSERT OR REPLACE INTO account_followers (account_id, username, scraped_at) VALUES (?, ?, datetime('now'))"
    );

    const insertMany = db.transaction((usernames) => {
      for (const username of usernames) {
        insert.run(accountId, username);
      }
    });

    insertMany([...allUsernames]);
    console.log(`   💾 Saved ${allUsernames.size} followers to database`);
  }

  // Close modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  return [...allUsernames];
}
