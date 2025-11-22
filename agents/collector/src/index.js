/**
 * Collector Agent Main Controller
 * 
 * Orchestrates the discovery and scraping workflow based on selected mode.
 */

import { chromium } from 'playwright';
import { discoverFromHashtags, discoverFromProfiles } from './discover.js';
// Try V3 scraper with ultra-generic brute force
import { scrapePostComments } from './scrape_post_v3.js';
import { ensureOutputDir, writePosts, writeComments, delay, detectChallenge } from './utils.js';
import { CONFIG } from './config.js';
import { createInterface } from 'readline';

/**
 * Main collector entry point
 * 
 * @param {Object} config - Configuration object
 * @param {string} config.mode - Operating mode
 * @param {string[]} config.hashtags - List of hashtags
 * @param {string[]} config.profiles - List of profile URLs
 * @param {number} config.maxPostsPerSource - Max posts per source
 * @param {number} config.maxCommentsPerPost - Max comments per post
 * @param {string} config.outputDir - Output directory path
 * @param {boolean} config.headless - Run headless (not recommended)
 */
export async function runCollector(config) {
  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: CONFIG.SLOW_MO,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: CONFIG.USER_AGENT,
    locale: 'en-US',
    timezoneId: 'America/New_York'
  });

  const page = await context.newPage();

  // Ensure output directory exists
  await ensureOutputDir(config.outputDir);

  let allPosts = [];
  let allComments = [];

  try {
    // Step 1: Manual Login
    console.log('📱 Opening Instagram...');
    await page.goto('https://www.instagram.com/accounts/login/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    console.log('\n⏸️  Please log in manually in the browser window.');
    console.log('   Complete any 2FA or security checks.');
    console.log('   Press ENTER here when you see your Instagram feed...\n');

    // Wait for user input
    await waitForEnter();

    // Verify login success
    await page.waitForURL(/instagram\.com\/(reels\/)?(\?|$)/, { timeout: 10000 }).catch(() => {
      throw new Error('Login verification failed. Please ensure you are logged in.');
    });

    console.log('✅ Login successful!\n');

    // Step 2: Discovery phase
    if (config.mode === 'hashtags' || config.mode === 'both' || config.mode === 'only-discover') {
      if (config.hashtags && config.hashtags.length > 0) {
        console.log('🔍 Discovering posts from hashtags...');
        const hashtagPosts = await discoverFromHashtags(
          page, 
          config.hashtags, 
          config.maxPostsPerSource
        );
        allPosts.push(...hashtagPosts);
        console.log(`   Found ${hashtagPosts.length} posts from hashtags\n`);
      }
    }

    if (config.mode === 'profiles' || config.mode === 'both' || config.mode === 'only-discover') {
      if (config.profiles && config.profiles.length > 0) {
        console.log('🔍 Discovering posts from competitor profiles...');
        const profilePosts = await discoverFromProfiles(
          page, 
          config.profiles, 
          config.maxPostsPerSource
        );
        allPosts.push(...profilePosts);
        console.log(`   Found ${profilePosts.length} posts from profiles\n`);
      }
    }

    // Write posts to CSV
    if (allPosts.length > 0) {
      await writePosts(allPosts, config.outputDir);
      console.log(`✅ Saved ${allPosts.length} posts to posts.csv\n`);
    }

    // Step 3: Scraping phase (if not only-discover)
    if (config.mode !== 'only-discover') {
      if (config.mode === 'scrape-comments') {
        console.log('📖 Loading posts from existing posts.csv...');
        // In production, implement CSV reader here
        // For now, we'll use allPosts from discovery
      }

      if (allPosts.length > 0) {
        console.log('💬 Scraping comments from discovered posts...');
        
        for (let i = 0; i < allPosts.length; i++) {
          const post = allPosts[i];
          console.log(`   [${i + 1}/${allPosts.length}] Scraping: ${post.post_url}`);

          // Check for challenges before each scrape
          if (await detectChallenge(page)) {
            console.error('⚠️  Challenge detected! Stopping to avoid account restrictions.');
            break;
          }

          try {
            const comments = await scrapePostComments(
              page, 
              post.post_url, 
              config.maxCommentsPerPost
            );
            
            allComments.push(...comments);
            console.log(`      → Collected ${comments.length} comments`);

            // Random delay between posts
            const delayMs = CONFIG.MIN_DELAY + Math.random() * (CONFIG.MAX_DELAY - CONFIG.MIN_DELAY);
            await delay(delayMs);

          } catch (error) {
            console.error(`      ⚠️  Error scraping post: ${error.message}`);
            continue;
          }
        }

        // Write comments to CSV
        if (allComments.length > 0) {
          await writeComments(allComments, config.outputDir);
          console.log(`\n✅ Saved ${allComments.length} comments to comments.csv`);
        }
      }
    }

  } catch (error) {
    console.error('\n❌ Error during collection:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

/**
 * Wait for user to press Enter
 */
function waitForEnter() {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
}
