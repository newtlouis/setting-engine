/**
 * Discovery Module
 * 
 * Handles post discovery from hashtags and competitor profiles.
 */

import { delay, extractPostMetadata, gotoWithRetry } from './utils.js';
import { verifyHashtagPage, verifyProfilePage } from '../../../shared/pageVerification.js';
import { CONFIG } from './config.js';

/**
 * Discover posts from hashtag search
 * 
 * @param {Page} page - Playwright page object
 * @param {string[]} hashtags - Array of hashtags (without #)
 * @param {number} maxPosts - Maximum NEW posts to collect per hashtag
 * @param {Set<string>} alreadyScraped - Set of already scraped URLs (optional)
 * @returns {Promise<Array>} Array of post objects
 */
export async function discoverFromHashtags(page, hashtags, maxPosts, alreadyScraped = new Set()) {
  const allPosts = [];

  for (const hashtag of hashtags) {
    console.log(`   Searching hashtag: #${hashtag}`);

    const cleanTag = hashtag.replace(/^#/, '');
    const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(cleanTag)}/`;

    try {
      await gotoWithRetry(page, url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await delay(3000 + Math.random() * 3000);

      // Verify we are on the hashtag page and no challenge
      const verifyResult = await verifyHashtagPage(page, cleanTag);
      if (!verifyResult.success) {
        console.error(`   ⚠️  Verification failed for #${hashtag}: ${verifyResult.reason}`);
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

      const posts = []; // Local unique new posts
      const seenUrls = new Set(); // To track duplicates within this session run
      
      let scrollAttempts = 0;
      // Increased max scrolls to allow skipping many duplicates - tripled the multiplier
      const maxScrolls = Math.max(100, maxPosts * 15); 
      let consecutiveNoNewPosts = 0;
      let totalProcessedCandidates = 0;

      console.log(`      🎯 Target: ${maxPosts} NEW posts (ignoring ${alreadyScraped.size} history < 7 days)`);

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
        
        // Count how many we actually added this scroll
        let newAddedThisScroll = 0;

        for (const link of postLinks) {
          // Normalize link (remove query params for comparison)
          const cleanLink = link.split('?')[0];

          // Check if we've already collected it in this session
          if (seenUrls.has(cleanLink)) continue;
          seenUrls.add(cleanLink);
          totalProcessedCandidates++;

          // Check if it's already in our history (persistent DB)
          if (alreadyScraped.has(cleanLink) || alreadyScraped.has(link)) {
            continue; // Skip without adding
          }

          // It's new!
          // Double check we haven't hit limit inside the loop
          if (posts.length >= maxPosts) break;

          posts.push({
            source_type: 'hashtag',
            source_name: cleanTag,
            post_url: link,
            post_date: '',
            likes: '',
            comments_count: '',
            caption_excerpt: ''
          });
          newAddedThisScroll++;
        }
        
        console.log(`      → Scroll ${scrollAttempts + 1}: Found ${newAddedThisScroll} NEW posts (Status: ${posts.length}/${maxPosts} collected, Processed ${totalProcessedCandidates} links)`);

        // Break if we have enough
        if (posts.length >= maxPosts) {
            console.log(`      ✨ Goal reached: ${posts.length} new posts.`);
            break;
        }

        // Logic to stop if we are stuck
        if (newAddedThisScroll === 0) {
            consecutiveNoNewPosts++;
        } else {
            consecutiveNoNewPosts = 0;
        }

        // Break if stuck for too long (scrolling but seeing only old stuff or nothing)
        // Increased threshold to 20 to be much more persistent
        if (consecutiveNoNewPosts > 20 && scrollAttempts > 10) {
          console.log(`      ⚠️  Stopping: No new posts found in last 20 scrolls (likely end of feed or excessive duplicates).`);
          break;
        }

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

      // Limit to maxPosts (just in case)
      const limitedPosts = posts.slice(0, maxPosts);
      allPosts.push(...limitedPosts);

      console.log(`      → Total collected for #${hashtag}: ${limitedPosts.length} posts`);

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
 * @param {number} maxPosts - Maximum NEW posts to collect per profile
 * @param {Map<string, number>|Set<string>} alreadyScraped - History of scraped URLs
 * @returns {Promise<Array>} Array of post objects
 */
export async function discoverFromProfiles(page, profiles, maxPosts, alreadyScraped = new Map()) {
  const allPosts = [];
  const RE_SCRAPE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  for (const profile of profiles) {
    // Extract username from URL or use as-is
    const username = profile.includes('instagram.com') 
      ? profile.split('/').filter(Boolean).pop()
      : profile.replace(/^@/, '');

    console.log(`   Scanning profile: @${username}`);

    const url = `https://www.instagram.com/${username}/`;

    try {
      await gotoWithRetry(page, url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await delay(3000 + Math.random() * 3000);

      // Verify we are on the profile page and no challenge
      const verifyResult = await verifyProfilePage(page, username);
      if (!verifyResult.success) {
        console.error(`   ⚠️  Verification failed for @${username}: ${verifyResult.reason}`);
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

      const posts = []; // Local unique new posts
      const seenUrls = new Set();
      
      let scrollAttempts = 0;
      // Increased max scrolls - tripled the multiplier
      const maxScrolls = Math.max(100, maxPosts * 15);
      let consecutiveNoNewPosts = 0;
      let totalProcessedCandidates = 0;

      console.log(`      🎯 Target: ${maxPosts} NEW posts (ignoring history < 7 days)`);

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
        
        // Count how many we actually added this scroll
        let newAddedThisScroll = 0;

        for (const link of postLinks) {
           // Normalize link (remove query params)
           const cleanLink = link.split('?')[0];

           if (seenUrls.has(cleanLink)) continue;
           seenUrls.add(cleanLink);
           totalProcessedCandidates++;

           // Check logic
           let shouldSkip = false;
           if (alreadyScraped instanceof Map) {
               if (alreadyScraped.has(cleanLink)) {
                   const lastScraped = alreadyScraped.get(cleanLink);
                   if (Date.now() - lastScraped < RE_SCRAPE_INTERVAL_MS) {
                       shouldSkip = true;
                   }
               }
           } else if (alreadyScraped.has(cleanLink)) {
               shouldSkip = true;
           }

           if (shouldSkip) {
             continue; // Skip history
           }

           // Check limit
           if (posts.length >= maxPosts) break;
           
           posts.push({
              source_type: 'profile',
              source_name: username,
              post_url: link,
              post_date: '',
              likes: '',
              comments_count: '',
              caption_excerpt: ''
            });
            newAddedThisScroll++;
        }
        
        console.log(`      → Scroll ${scrollAttempts + 1}: Found ${newAddedThisScroll} new/re-scraphable posts (Status: ${posts.length}/${maxPosts} collected, Processed ${totalProcessedCandidates} links)`);

        if (posts.length >= maxPosts) {
            console.log(`      ✨ Goal reached: ${posts.length} new posts.`);
            break;
        }

        if (newAddedThisScroll === 0) {
            consecutiveNoNewPosts++;
        } else {
            consecutiveNoNewPosts = 0;
        }

         // Stop if stuck
        // Increased threshold to 20 to be much more persistent
        if (consecutiveNoNewPosts > 20 && scrollAttempts > 10) {
          console.log(`      ⚠️  Stopping: No new posts found in last 20 scrolls.`);
          break;
        }

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

      console.log(`      → Total collected for @${username}: ${limitedPosts.length} posts`);

      // Delay between profiles
      await delay(CONFIG.MIN_DELAY + Math.random() * CONFIG.MAX_DELAY);

    } catch (error) {
      console.error(`   ⚠️  Error discovering from @${username}:`, error.message);
      continue;
    }
  }

  return allPosts;
}
