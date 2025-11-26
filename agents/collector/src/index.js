/**
 * Collector Agent Main Controller
 * 
 * Orchestrates the discovery and scraping workflow with intelligent
 * post tracking and Excel CRM management for optimal prospect discovery.
 */

import { chromium } from 'playwright';
import { discoverFromHashtags, discoverFromProfiles } from './discover.js';
import { scrapePostComments } from './scrape_post.js';
import { ensureOutputDir, writePosts, writeComments, delay, detectChallenge } from './utils.js';
import { CONFIG } from './config.js';
import { createInterface } from 'readline';
import { PostTracker } from './post_tracker.js';
import { ExcelCRM } from './excel_writer.js';

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
  // Initialize tracking and CRM
  const tracker = new PostTracker(config.outputDir);
  await tracker.load();
  
  const excelCRM = new ExcelCRM(config.outputDir);
  await excelCRM.load();

  console.log('📊 Current stats:');
  const trackerStats = tracker.getStats();
  console.log(`   Total prospects tracked: ${trackerStats.total_prospects}`);
  console.log(`   Posts in database: ${trackerStats.total_posts_tracked}`);
  console.log(`   New today: ${trackerStats.new_today}\n`);

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
  let newProspectsFound = 0;

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

    // Step 3: Intelligent scraping phase
    if (config.mode !== 'only-discover' && allPosts.length > 0) {
      console.log('🧠 Starting intelligent scraping...\n');
      
      // Get source identifier
      const source = config.hashtags?.length > 0 
        ? `hashtag:${config.hashtags[0]}` 
        : `profile:${config.profiles?.[0] || 'unknown'}`;
      
      // Prioritize posts for scraping
      const categorizedPosts = tracker.prioritizePosts(allPosts.map(p => p.post_url), source);
      
      console.log('📊 Post analysis:');
      console.log(`   Never scraped: ${categorizedPosts.never_scraped.length} posts`);
      console.log(`   Recent (< 24h): ${categorizedPosts.recent_rescrape.length} posts`);
      console.log(`   Medium (1-7d): ${categorizedPosts.medium_rescrape.length} posts`);
      console.log(`   Old (> 7d): ${categorizedPosts.old_rescrape.length} posts\n`);
      
      // Target new prospects count (configurable)
      const targetNewProspects = config.targetProspects || 50;
      console.log(`🎯 Target: Find ${targetNewProspects} new prospects\n`);
      
      // Scrape in priority order
      const priorityOrder = [
        { name: 'Phase 1: Never scraped posts', posts: categorizedPosts.never_scraped },
        { name: 'Phase 2: Recent posts (< 24h)', posts: categorizedPosts.recent_rescrape },
        { name: 'Phase 3: Medium aged posts (1-7d)', posts: categorizedPosts.medium_rescrape },
        { name: 'Phase 4: Older posts (> 7d)', posts: categorizedPosts.old_rescrape }
      ];
      
      phaseLoop: for (const phase of priorityOrder) {
        if (phase.posts.length === 0) continue;
        if (newProspectsFound >= targetNewProspects) {
          console.log(`\n✅ Target reached! Found ${newProspectsFound} new prospects.`);
          break;
        }
        
        console.log(`\n📍 ${phase.name}:`);
        
        for (let i = 0; i < phase.posts.length; i++) {
          if (newProspectsFound >= targetNewProspects) break phaseLoop;
          
          const postUrl = phase.posts[i];
          const postData = allPosts.find(p => p.post_url === postUrl);
          
          // Check if we should scrape this post
          if (!tracker.shouldScrapePost(postUrl)) {
            console.log(`   [${i + 1}/${phase.posts.length}] Skipping (too recent): ${postUrl}`);
            continue;
          }
          
          console.log(`   [${i + 1}/${phase.posts.length}] Scraping: ${postUrl}`);
          
          // Check for challenges
          if (await detectChallenge(page)) {
            console.error('⚠️  Challenge detected! Stopping to avoid account restrictions.');
            break phaseLoop;
          }
          
          try {
            const comments = await scrapePostComments(
              page, 
              postUrl, 
              config.maxCommentsPerPost
            );
            
            if (comments.length > 0) {
              // Update Excel CRM
              const stats = await excelCRM.updateWithComments(comments, source);
              newProspectsFound += stats.new_prospects;
              
              console.log(`      → Found ${comments.length} comments (${stats.new_prospects} new prospects)`);
              
              // Mark post as scraped
              tracker.markPostScraped(postUrl, {
                commentCount: comments.length,
                source: source
              });
              
              // Also save to CSV for backup
              allComments.push(...comments);
            } else {
              console.log(`      → No comments found`);
            }
            
            // Random delay between posts
            const delayMs = CONFIG.MIN_DELAY + Math.random() * (CONFIG.MAX_DELAY - CONFIG.MIN_DELAY);
            await delay(delayMs);
            
          } catch (error) {
            console.error(`      ⚠️  Error scraping post: ${error.message}`);
            continue;
          }
        }
      }
      
      // Update tracker stats
      tracker.updateStats(newProspectsFound);
      
      // Save tracking data
      await tracker.save();
      
      // Save Excel CRM
      await excelCRM.save();
      
      // Also write comments to CSV for backup
      if (allComments.length > 0) {
        await writeComments(allComments, config.outputDir);
      }
      
      // Final summary
      console.log('\n📊 Session summary:');
      console.log(`   New prospects found: ${newProspectsFound}`);
      console.log(`   Total comments collected: ${allComments.length}`);
      console.log(`   Excel CRM: ${excelCRM.getStats().total_prospects} total prospects`);
      console.log(`   Output: ${config.outputDir}/instagram_prospects.xlsx`);
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
