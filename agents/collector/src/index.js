/**
 * Collector Agent Main Controller
 * 
 * Orchestrates the discovery and scraping workflow for Instagram data collection.
 * Outputs data to CSV files for further processing.
 */

import { chromium } from 'playwright';
import { discoverFromHashtags, discoverFromProfiles } from './discover.js';
import { scrapePostComments } from './scrape_post.js';
import { ensureOutputDir, writePosts, writeComments, delay, autoLoginInstagram, gotoWithRetry } from './utils.js';
import { CONFIG } from './config.js';
import { createInterface } from 'readline';
import { filterComments } from './spam_filter.js';
import { loadScrapedPosts, saveScrapedPosts, filterAlreadyScraped } from './post_qualifier.js';
import { initDatabase, getOrCreateAccount } from './database.js';
import { getStealthContextOptions, applyStealthToPage } from '../../../shared/stealth.js';
import { cleanupBrowserLocks } from '../../../shared/paths.js';
import { checkForChallenge } from '../../../shared/pageVerification.js';
import path from 'path';

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
  console.log('🚀 Starting Instagram data collection...\n');

  const profile = process.env.IG_PROFILE || 'anonymous';
  
  // 🧹 Clean up stale locks before launch (prevents macOS SIGTRAP crashes)
  cleanupBrowserLocks(profile);

  // Launch persistent context with stealth options
  const options = getStealthContextOptions(CONFIG.USER_DATA_DIR, {
    headless: config.headless,
    slowMo: CONFIG.SLOW_MO,
    diagnostic: config.diagnostic
  });
  
  const context = await chromium.launchPersistentContext(CONFIG.USER_DATA_DIR, options);

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  
  // Apply stealth init script to hide automation markers
  await applyStealthToPage(page);

  // Ensure output directory exists
  await ensureOutputDir(config.outputDir);

  // Initialize database and get account
  await initDatabase();
  const profileName = process.env.IG_PROFILE;
  if (!profileName) {
    throw new Error('IG_PROFILE environment variable missing. Ensure you passed --profile to the command.');
  }
  const account = getOrCreateAccount(profileName);
  console.log(`📁 Account: ${account.name} (id: ${account.id})\n`);

  let allPosts = [];
  let allComments = [];

  try {
    // Step 1: Login (Auto or Manual)
    const hasCredentials = CONFIG.INSTAGRAM_USERNAME && CONFIG.INSTAGRAM_PASSWORD;
    
    if (hasCredentials) {
      // Auto-login with credentials from .env
      const loginSuccess = await autoLoginInstagram(page, CONFIG.INSTAGRAM_USERNAME, CONFIG.INSTAGRAM_PASSWORD);
      
      if (!loginSuccess) {
        console.log('\n⚠️  Auto-login failed. Falling back to manual login...\n');
        
        // Fallback to manual login
        console.log('📱 Opening Instagram...');
        await gotoWithRetry(page, 'https://www.instagram.com/', {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });

        console.log('\n⏸️  Please log in manually in the browser window.');
        console.log('   Complete any 2FA or security checks.');
        console.log('   Press ENTER here when you see your Instagram feed...\n');

        await waitForEnter();

        await page.waitForURL(/instagram\.com\/(reels\/)?(\?|$)/, { timeout: 10000 }).catch(() => {
          throw new Error('Login verification failed. Please ensure you are logged in.');
        });

        console.log('✅ Login successful!\n');
      }
    } else {
      // Manual login (no credentials provided)
      console.log('📱 Opening Instagram...');
      console.log('💡 Tip: Set INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD in .env for auto-login\n');
      
      await gotoWithRetry(page, 'https://www.instagram.com/accounts/login/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });

      console.log('⏸️  Please log in manually in the browser window.');
      console.log('   Complete any 2FA or security checks.');
      console.log('   Press ENTER here when you see your Instagram feed...\n');

      await waitForEnter();

      await page.waitForURL(/instagram\.com\/(reels\/)?(\?|$)/, { timeout: 10000 }).catch(() => {
        throw new Error('Login verification failed. Please ensure you are logged in.');
      });

      console.log('✅ Login successful!\n');
    }

    // Load already-scraped posts tracking EARLY to filter duplicates during discovery
    const trackingFile = path.join(config.outputDir, '..', 'permanent-data', 'scraped_posts.json');
    const alreadyScraped = await loadScrapedPosts(trackingFile);
    console.log(`ℹ️  Loaded ${alreadyScraped.size} previously scraped posts for duplicate filtering.\n`);

    // Step 2: Discovery phase
    if (config.mode === 'hashtags' || config.mode === 'both' || config.mode === 'only-discover') {
      if (config.hashtags && config.hashtags.length > 0) {
        console.log('🔍 Discovering posts from hashtags...');
        const hashtagPosts = await discoverFromHashtags(
          page, 
          config.hashtags, 
          config.maxPostsPerSource,
          alreadyScraped // Pass tracking set
        );
        allPosts.push(...hashtagPosts);
        console.log(`   Found ${hashtagPosts.length} NEW posts from hashtags\n`);
      }
    }

    if (config.mode === 'profiles' || config.mode === 'both' || config.mode === 'only-discover') {
      if (config.profiles && config.profiles.length > 0) {
        console.log('🔍 Discovering posts from competitor profiles...');
        const profilePosts = await discoverFromProfiles(
          page, 
          config.profiles, 
          config.maxPostsPerSource,
          alreadyScraped // Pass tracking set
        );
        allPosts.push(...profilePosts);
        console.log(`   Found ${profilePosts.length} NEW posts from profiles\n`);
      }
    }

    // Write posts to CSV
    if (allPosts.length > 0) {
      await writePosts(allPosts, config.outputDir);
      console.log(`✅ Saved ${allPosts.length} posts to posts.csv\n`);
    }

    // Step 3: Scraping phase with pre-qualification and tracking
    if (config.mode !== 'only-discover' && allPosts.length > 0) {
      console.log('💬 Starting comment scraping...\n');
      
      // Get source identifier for tracking
      const source = config.hashtags?.length > 0 
        ? `hashtag:${config.hashtags[0]}` 
        : `profile:${config.profiles?.[0] || 'unknown'}`;
      
      // Tracking file already loaded above
      // const trackingFile = ... 
      // const alreadyScraped = ...
      
      // We still filter here just in case, but discovery should have returned only new ones
      if (alreadyScraped.size > 0) {
        // Just a sanity check deduplication
        const { newPosts, skippedCount } = filterAlreadyScraped(allPosts, alreadyScraped);
        if (skippedCount > 0) {
          console.log(`ℹ️  Filtered ${skippedCount} duplicates/scraped posts (sanity check)`);
        }
        allPosts = newPosts;
      }
      
      if (allPosts.length === 0) {
        console.log('ℹ️  All posts have already been scraped. Nothing new to process.');
        return;
      }
      
      // SKIP pre-qualification entirely - it doesn't work reliably with Instagram's current structure
      // Just scrape all discovered posts directly
      const qualifiedPosts = allPosts;
      const qualifyStats = { total: allPosts.length, qualified: allPosts.length };
      
      console.log(`📍 Scraping all ${qualifiedPosts.length} discovered posts (pre-qualification disabled)...`);
      
      if (qualifiedPosts.length === 0) {
        console.log('ℹ️  No posts to scrape.');
        return;
      }
      
      for (let i = 0; i < qualifiedPosts.length; i++) {
        const post = qualifiedPosts[i];
        console.log(`   [${i + 1}/${qualifiedPosts.length}] Scraping: ${post.post_url}`);
        
        // Check for challenges
        if (await checkForChallenge(page)) {
          console.error('⚠️  Challenge detected! Stopping to avoid account restrictions.');
          break;
        }
        
        try {
          const comments = await scrapePostComments(
            page, 
            post.post_url, 
            config.maxCommentsPerPost
          );
          
          if (comments.length > 0) {
            // Add source to each comment
            const commentsWithSource = comments.map(comment => ({
              ...comment,
              source: source,
              account_id: account.id
            }));
            
            allComments.push(...commentsWithSource);
            console.log(`      → Found ${comments.length} comments`);
          } else {
            console.log(`      → No comments found`);
          }
          
          // Mark post as scraped (update timestamp)
          alreadyScraped.set(post.post_url, Date.now());
          
          // Random delay between posts
          const delayMs = CONFIG.MIN_DELAY + Math.random() * (CONFIG.MAX_DELAY - CONFIG.MIN_DELAY);
          await delay(delayMs);
          
        } catch (error) {
          console.error(`      ⚠️  Error scraping post: ${error.message}`);
          continue;
        }
      }
      
      // Save updated tracking file
      await saveScrapedPosts(trackingFile, alreadyScraped);
      console.log(`\n💾 Updated tracking file (${alreadyScraped.size} total posts tracked)`);
      
      // Filter comments for spam and quality
      if (allComments.length > 0) {
        console.log(`\n🔍 Analyzing ${allComments.length} comments for quality...`);
        const { all: processedComments, filtered: qualityComments, stats } = filterComments(allComments);
        
        // Write ALL comments to CSV (with spam flags for transparency)
        await writeComments(processedComments, config.outputDir);
        
        console.log(`\n✅ Saved ${processedComments.length} comments to comments.csv`);
        console.log(`   📊 Quality breakdown:`);
        console.log(`      - High quality: ${qualityComments.length} comments`);
        console.log(`      - Spam filtered: ${stats.spam} comments`);
        
        if (Object.keys(stats.spamReasons).length > 0) {
          console.log(`   🚫 Spam reasons:`);
          for (const [reason, count] of Object.entries(stats.spamReasons)) {
            console.log(`      - ${reason}: ${count}`);
          }
        }
      }
      
      // Final summary
      console.log('\n📊 Session summary:');
      console.log(`   Posts discovered: ${qualifyStats.total}`);
      console.log(`   Posts qualified: ${qualifiedPosts.length}`);
      console.log(`   Posts scraped: ${qualifiedPosts.length}`);
      console.log(`   Total comments collected: ${allComments.length}`);
      console.log(`   Output directory: ${config.outputDir}/`);
    }

  } catch (error) {
    console.error('\n❌ Error during collection:', error.message);
    throw error;
  } finally {
    await context.close();
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
