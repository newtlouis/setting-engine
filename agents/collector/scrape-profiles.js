#!/usr/bin/env node

/**
 * Profile Scraper Script
 * 
 * Scrapes Instagram profile data (followers, bio, etc.) for leads in the database
 * that don't have profile data yet, or whose data is stale.
 * 
 * Usage:
 *   node scrape-profiles.js
 *   node scrape-profiles.js --max-age 24  (only scrape if older than 24 hours)
 *   node scrape-profiles.js --limit 50    (max 50 profiles per run)
 */

import { chromium } from 'playwright';
import { program } from 'commander';
import { createInterface } from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  initDatabase,
  closeDatabase,
  getLeads,
  updateLeadProfile
} from './src/database.js';
import { scrapeProfileData } from './src/profile_scraper.js';
import { delay, detectChallenge, autoLoginInstagram } from './src/utils.js';
import { CONFIG } from './src/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

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

/**
 * Scrape profiles for leads missing profile data
 * Can be called directly or from collect.js
 */
export async function scrapeProfilesForLeads(options = {}) {
  const {
    maxAge = 168, // 7 days in hours
    limit = 100
  } = options;
  
  const dbFile = path.join(__dirname, 'permanent-data', 'leads.db');
  
  try {
    // Initialize database
    await initDatabase(dbFile);
    
    // Get leads that need profile scraping
    const allLeads = getLeads();
    const now = Date.now();
    
    const leadsToScrape = allLeads.filter(lead => {
      // Never scraped
      if (!lead.profile_scraped_at) return true;
      
      // Stale data
      const scrapedAt = new Date(lead.profile_scraped_at).getTime();
      const hoursSinceScrape = (now - scrapedAt) / (1000 * 60 * 60);
      return hoursSinceScrape > maxAge;
    }).slice(0, limit);
    
    if (leadsToScrape.length === 0) {
      console.log('✅ All profiles are up-to-date (within ' + maxAge + 'h)');
      closeDatabase();
      return;
    }
    
    console.log(`📊 Found ${leadsToScrape.length} profiles to scrape`);
    console.log(`   (${allLeads.length - leadsToScrape.length} already up-to-date)\n`);
    
    // Launch browser
    // Launch persistent context
    const context = await chromium.launchPersistentContext(CONFIG.USER_DATA_DIR, {
      headless: false,
      slowMo: CONFIG.SLOW_MO || 50,
      viewport: { width: 1280, height: 720 },
      userAgent: CONFIG.USER_AGENT,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });
    
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    
    try {
      // Login
      const hasCredentials = CONFIG.INSTAGRAM_USERNAME && CONFIG.INSTAGRAM_PASSWORD;
      
      if (hasCredentials) {
        console.log('🔐 Logging in with credentials from .env...');
        const loginSuccess = await autoLoginInstagram(page, CONFIG.INSTAGRAM_USERNAME, CONFIG.INSTAGRAM_PASSWORD);
        
        if (!loginSuccess) {
          console.log('\n⚠️  Auto-login failed. Please log in manually...\n');
          await page.goto('https://www.instagram.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
          });
          console.log('   Press ENTER when you are logged in and see your Instagram feed...\n');
          await waitForEnter();
          
          // Verify login
          await page.waitForURL(/instagram\.com\/(reels\/)?(\?|$)/, { timeout: 10000 }).catch(() => {
            console.error('   ❌ Login verification failed. Please ensure you are logged in.');
          });
        }
      } else {
        console.log('📱 Opening Instagram for manual login...\n');
        await page.goto('https://www.instagram.com/accounts/login/', {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });
        console.log('   Please log in manually.');
        console.log('   Press ENTER when you see your Instagram feed...\n');
        await waitForEnter();

        // Verify login
        await page.waitForURL(/instagram\.com\/(reels\/)?(\?|$)/, { timeout: 10000 }).catch(() => {
          console.error('   ❌ Login verification failed. Please ensure you are logged in.');
        });
      }
      
      console.log('✅ Login successful!\n');
      console.log(`🔍 Scraping ${leadsToScrape.length} profiles...\n`);
      
      let successCount = 0;
      let errorCount = 0;
      
      for (let i = 0; i < leadsToScrape.length; i++) {
        const lead = leadsToScrape[i];
        console.log(`   [${i + 1}/${leadsToScrape.length}] @${lead.username}`);
        
        // Check for challenge
        if (await detectChallenge(page)) {
          console.log('\n⚠️  Challenge detected! Stopping to avoid account restrictions.');
          break;
        }
        
        // Scrape profile (saveToDb = false, we'll save manually)
        const profileData = await scrapeProfileData(page, lead.username, false);
        
        if (profileData.scrape_error) {
          console.log(`      ⚠️  Error: ${profileData.scrape_error}`);
          errorCount++;
        } else {
          // Save to database
          updateLeadProfile(lead.username, profileData);
          
          // Log summary
          const followers = profileData.followers_count 
            ? profileData.followers_count.toLocaleString() 
            : '?';
          const badges = [];
          if (profileData.is_verified) badges.push('✓');
          if (profileData.is_business) badges.push('biz');
          if (profileData.is_private) badges.push('private');
          
          console.log(`      ✅ ${followers} followers ${badges.length ? `[${badges.join(', ')}]` : ''}`);
          successCount++;
        }
        
        // Rate limiting
        if (i < leadsToScrape.length - 1) {
          await delay(2000 + Math.random() * 3000);
        }
      }
      
      console.log('\n' + '─'.repeat(50));
      console.log('📊 Profile Scraping Summary:');
      console.log(`   Successful: ${successCount}`);
      console.log(`   Errors:     ${errorCount}`);
      console.log(`   Skipped:    ${allLeads.length - leadsToScrape.length} (already up-to-date)`);
      
    } finally {
      await context.close();
    }
    
    closeDatabase();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    closeDatabase();
    throw error;
  }
}

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  program
    .name('scrape-profiles')
    .description('Scrape Instagram profile data for leads')
    .option('--max-age <hours>', 'Max age in hours before re-scraping', '168')
    .option('--limit <number>', 'Maximum profiles to scrape per run', '100')
    .parse();
  
  const opts = program.opts();
  
  scrapeProfilesForLeads({
    maxAge: parseInt(opts.maxAge, 10),
    limit: parseInt(opts.limit, 10)
  }).catch(error => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  });
}
