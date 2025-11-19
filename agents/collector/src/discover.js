/**
 * Discovery Module
 * 
 * Handles post discovery from hashtags and competitor profiles.
 */

import { delay, detectChallenge, extractPostMetadata } from './utils.js';
import { CONFIG } from './config.js';

/**
 * Discover posts from hashtag search
 * 
 * @param {Page} page - Playwright page object
 * @param {string[]} hashtags - Array of hashtags (without #)
 * @param {number} maxPosts - Maximum posts to collect per hashtag
 * @returns {Promise<Array>} Array of post objects
 */
export async function discoverFromHashtags(page, hashtags, maxPosts) {
  const allPosts = [];

  for (const hashtag of hashtags) {
    console.log(`   Searching hashtag: #${hashtag}`);

    const cleanTag = hashtag.replace(/^#/, '');
    const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(cleanTag)}/`;

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await delay(2000 + Math.random() * 2000);

      // Check for challenge
      if (await detectChallenge(page)) {
        console.error('   ⚠️  Challenge detected on hashtag page. Skipping.');
        continue;
      }

      // Wait for posts grid to load
      // FIX NOTE: Update selector if Instagram changes their post grid structure
      await page.waitForSelector('article a[href*="/p/"]', { timeout: 10000 }).catch(() => null);

      const posts = [];
      let scrollAttempts = 0;
      const maxScrolls = Math.ceil(maxPosts / 9); // Instagram shows ~9 posts per viewport

      while (posts.length < maxPosts && scrollAttempts < maxScrolls) {
        // Extract post links from current viewport
        // FIX NOTE: Selector 'article a[href*="/p/"]' targets post links - update if layout changes
        const postLinks = await page.$$eval(
          'article a[href*="/p/"], article a[href*="/reel/"]',
          (links) => links.map(a => a.href)
        );

        // Deduplicate
        for (const link of postLinks) {
          if (!posts.find(p => p.post_url === link)) {
            posts.push({
              source_type: 'hashtag',
              source_name: cleanTag,
              post_url: link,
              post_date: '',
              likes: '',
              comments_count: '',
              caption_excerpt: ''
            });
          }
        }

        // Scroll down
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await delay(1500 + Math.random() * 1500);
        scrollAttempts++;
      }

      // Limit to maxPosts
      const limitedPosts = posts.slice(0, maxPosts);
      allPosts.push(...limitedPosts);

      console.log(`      → Found ${limitedPosts.length} posts`);

      // Delay between hashtags
      await delay(CONFIG.MIN_DELAY + Math.random() * CONFIG.MAX_DELAY);

    } catch (error) {
      console.error(`   ⚠️  Error discovering from #${hashtag}:`, error.message);
      continue;
    }
  }

  return allPosts;
}

/**
 * Discover posts from competitor profiles
 * 
 * @param {Page} page - Playwright page object
 * @param {string[]} profiles - Array of Instagram profile URLs or usernames
 * @param {number} maxPosts - Maximum posts to collect per profile
 * @returns {Promise<Array>} Array of post objects
 */
export async function discoverFromProfiles(page, profiles, maxPosts) {
  const allPosts = [];

  for (const profile of profiles) {
    // Extract username from URL or use as-is
    const username = profile.includes('instagram.com') 
      ? profile.split('/').filter(Boolean).pop()
      : profile.replace(/^@/, '');

    console.log(`   Scanning profile: @${username}`);

    const url = `https://www.instagram.com/${username}/`;

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await delay(2000 + Math.random() * 2000);

      // Check for challenge
      if (await detectChallenge(page)) {
        console.error('   ⚠️  Challenge detected on profile page. Skipping.');
        continue;
      }

      // Wait for posts grid
      // FIX NOTE: Selector 'article a[href*="/p/"]' targets profile post grid - update if layout changes
      await page.waitForSelector('article a[href*="/p/"]', { timeout: 10000 }).catch(() => null);

      const posts = [];
      let scrollAttempts = 0;
      const maxScrolls = Math.ceil(maxPosts / 12); // Profiles show ~12 posts per viewport

      while (posts.length < maxPosts && scrollAttempts < maxScrolls) {
        // Extract post links
        // FIX NOTE: Update selectors if Instagram changes post URL patterns
        const postLinks = await page.$$eval(
          'article a[href*="/p/"], article a[href*="/reel/"]',
          (links) => links.map(a => a.href)
        );

        // Deduplicate
        for (const link of postLinks) {
          if (!posts.find(p => p.post_url === link)) {
            posts.push({
              source_type: 'profile',
              source_name: username,
              post_url: link,
              post_date: '',
              likes: '',
              comments_count: '',
              caption_excerpt: ''
            });
          }
        }

        // Scroll down
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await delay(1500 + Math.random() * 1500);
        scrollAttempts++;
      }

      // Limit to maxPosts
      const limitedPosts = posts.slice(0, maxPosts);
      allPosts.push(...limitedPosts);

      console.log(`      → Found ${limitedPosts.length} posts`);

      // Delay between profiles
      await delay(CONFIG.MIN_DELAY + Math.random() * CONFIG.MAX_DELAY);

    } catch (error) {
      console.error(`   ⚠️  Error discovering from @${username}:`, error.message);
      continue;
    }
  }

  return allPosts;
}
