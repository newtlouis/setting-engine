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
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await delay(3000 + Math.random() * 3000);

      // Check for challenge
      if (await detectChallenge(page)) {
        console.error('   ⚠️  Challenge detected on hashtag page. Skipping.');
        continue;
      }

      // Wait for posts grid to load - try multiple selectors
      // FIX NOTE: Update selector if Instagram changes their post grid structure
      const selectors = [
        'article a[href*="/p/"]',
        'a[href*="/p/"]',
        'a[href*="/reel/"]',
        'div[role="button"] a'
      ];
      
      let selectorFound = false;
      for (const selector of selectors) {
        const found = await page.waitForSelector(selector, { timeout: 5000 }).catch(() => null);
        if (found) {
          selectorFound = true;
          console.log(`      ✓ Using selector: ${selector}`);
          break;
        }
      }
      
      if (!selectorFound) {
        console.log(`      ⚠️  No posts found with standard selectors, trying alternative extraction...`);
      }

      const posts = [];
      let scrollAttempts = 0;
      const maxScrolls = Math.ceil(maxPosts / 9); // Instagram shows ~9 posts per viewport
      let previousCount = 0;

      while (posts.length < maxPosts && scrollAttempts < maxScrolls) {
        // Extract post links from current viewport - try multiple methods
        // FIX NOTE: Selector 'article a[href*="/p/"]' targets post links - update if layout changes
        let postLinks = await page.$$eval(
          'a[href*="/p/"], a[href*="/reel/"]',
          (links) => links.map(a => a.href).filter(href => href.includes('/p/') || href.includes('/reel/'))
        ).catch(() => []);
        
        // If no posts found, try a more aggressive selector
        if (postLinks.length === 0) {
          postLinks = await page.evaluate(() => {
            const allLinks = Array.from(document.querySelectorAll('a'));
            return allLinks
              .map(a => a.href)
              .filter(href => href.includes('/p/') || href.includes('/reel/'))
              .filter(href => href.includes('instagram.com'));
          }).catch(() => []);
        }
        
        console.log(`      → Scroll ${scrollAttempts + 1}: Found ${postLinks.length} post links in viewport (total: ${posts.length})`);

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

        // Break if no new posts found after scrolling
        if (posts.length === previousCount && scrollAttempts > 1) {
          console.log(`      ⚠️  No new posts found after scroll, stopping`);
          break;
        }
        previousCount = posts.length;

        // Scroll down slowly to trigger lazy loading
        await page.evaluate(() => {
          window.scrollBy({
            top: window.innerHeight * 0.8,
            behavior: 'smooth'
          });
        });
        await delay(3000 + Math.random() * 2000);
        scrollAttempts++;
      }

      // Limit to maxPosts
      const limitedPosts = posts.slice(0, maxPosts);
      allPosts.push(...limitedPosts);

      console.log(`      → Total found: ${limitedPosts.length} posts`);

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
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await delay(3000 + Math.random() * 3000);

      // Check for challenge
      if (await detectChallenge(page)) {
        console.error('   ⚠️  Challenge detected on profile page. Skipping.');
        continue;
      }

      // Wait for posts grid - try multiple selectors
      const selectors = [
        'article a[href*="/p/"]',
        'a[href*="/p/"]',
        'a[href*="/reel/"]'
      ];
      
      let selectorFound = false;
      for (const selector of selectors) {
        const found = await page.waitForSelector(selector, { timeout: 5000 }).catch(() => null);
        if (found) {
          selectorFound = true;
          console.log(`      ✓ Using selector: ${selector}`);
          break;
        }
      }
      
      if (!selectorFound) {
        console.log(`      ⚠️  No posts found with standard selectors`);
      }

      const posts = [];
      let scrollAttempts = 0;
      const maxScrolls = Math.ceil(maxPosts / 12); // Profiles show ~12 posts per viewport
      let previousCount = 0;

      while (posts.length < maxPosts && scrollAttempts < maxScrolls) {
        // Extract post links - try multiple methods
        let postLinks = await page.$$eval(
          'a[href*="/p/"], a[href*="/reel/"]',
          (links) => links.map(a => a.href)
        ).catch(() => []);
        
        // If no posts found, try more aggressive
        if (postLinks.length === 0) {
          postLinks = await page.evaluate(() => {
            const allLinks = Array.from(document.querySelectorAll('a'));
            return allLinks
              .map(a => a.href)
              .filter(href => href.includes('/p/') || href.includes('/reel/'))
              .filter(href => href.includes('instagram.com'));
          }).catch(() => []);
        }
        
        console.log(`      → Scroll ${scrollAttempts + 1}: Found ${postLinks.length} post links (total: ${posts.length})`);

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

        // Break if no new posts
        if (posts.length === previousCount && scrollAttempts > 1) {
          console.log(`      ⚠️  No new posts found, stopping`);
          break;
        }
        previousCount = posts.length;

        // Scroll down
        await page.evaluate(() => {
          window.scrollBy({
            top: window.innerHeight * 0.8,
            behavior: 'smooth'
          });
        });
        await delay(3000 + Math.random() * 2000);
        scrollAttempts++;
      }

      // Limit to maxPosts
      const limitedPosts = posts.slice(0, maxPosts);
      allPosts.push(...limitedPosts);

      console.log(`      → Total found: ${limitedPosts.length} posts`);

      // Delay between profiles
      await delay(CONFIG.MIN_DELAY + Math.random() * CONFIG.MAX_DELAY);

    } catch (error) {
      console.error(`   ⚠️  Error discovering from @${username}:`, error.message);
      continue;
    }
  }

  return allPosts;
}
