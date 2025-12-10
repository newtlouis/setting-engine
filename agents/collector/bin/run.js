#!/usr/bin/env node

/**
 * Collector Agent CLI Entry Point
 * 
 * Provides command-line interface for Instagram data collection.
 * Supports multiple modes: hashtags, profiles, both, only-discover, scrape-comments
 */

import { program } from 'commander';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runCollector } from '../src/index.js';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

program
  .name('collector')
  .description('Instagram Lead Engine - Collector Agent')
  .version('1.0.0');

program
  .option('-m, --mode <mode>', 'Mode: hashtags|profiles|both|only-discover|scrape-comments|daily|deep', 'both')
  .option('-t, --hashtags <tags...>', 'Hashtags to scrape (space-separated)')
  .option('-p, --profiles <urls...>', 'Competitor profile URLs (space-separated)')
  .option('--max-posts <number>', 'Maximum posts per source', '50')
  .option('--max-comments <number>', 'Maximum comments per post', '100')
  .option('--target-prospects <number>', 'Target number of new prospects to find', '50')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('--headless', 'Run in headless mode (NOT RECOMMENDED - may trigger detection)', false)
  .option('--skip-qualify', 'Skip post pre-qualification (scrape all discovered posts)', false)
  .action(async (options) => {
    try {
      console.log('🚀 Instagram Collector Agent starting...\n');
      
      // Validate mode
      const validModes = ['hashtags', 'profiles', 'both', 'only-discover', 'scrape-comments', 'daily', 'deep'];
      if (!validModes.includes(options.mode)) {
        console.error(`❌ Invalid mode: ${options.mode}`);
        console.error(`   Valid modes: ${validModes.join(', ')}`);
        process.exit(1);
      }
      
      // Map new modes to standard modes
      if (options.mode === 'daily' || options.mode === 'deep') {
        if (!options.hashtags || options.hashtags.length === 0) {
          console.error(`❌ Mode "${options.mode}" requires --hashtags parameter`);
          process.exit(1);
        }
        // Daily and deep modes are variations of hashtag mode
        options.mode = 'hashtags';
      }

      // Validate inputs based on mode
      if (options.mode === 'hashtags' && (!options.hashtags || options.hashtags.length === 0)) {
        console.error('❌ Mode "hashtags" requires --hashtags parameter');
        process.exit(1);
      }

      if (options.mode === 'profiles' && (!options.profiles || options.profiles.length === 0)) {
        console.error('❌ Mode "profiles" requires --profiles parameter');
        process.exit(1);
      }

      if (options.mode === 'both' && 
          (!options.hashtags || options.hashtags.length === 0) && 
          (!options.profiles || options.profiles.length === 0)) {
        console.error('❌ Mode "both" requires at least one of --hashtags or --profiles');
        process.exit(1);
      }

      // Display warnings
      console.log('⚠️  IMPORTANT WARNINGS:');
      console.log('   • Manual Instagram login required');
      console.log('   • You must complete any 2FA or security checks');
      console.log('   • Randomized delays enforced (respect platform ToS)');
      console.log('   • Agent stops on challenge or rate limit detection');
      console.log('   • DO NOT use for automated DM sending\n');

      const config = {
        mode: options.mode,
        hashtags: options.hashtags || [],
        profiles: options.profiles || [],
        maxPostsPerSource: parseInt(options.maxPosts, 10),
        maxCommentsPerPost: parseInt(options.maxComments, 10),
        outputDir: options.output,
        headless: options.headless,
        skipQualification: options.skipQualify
      };

      if (config.headless) {
        console.log('⚠️  Headless mode enabled - this may trigger bot detection!\n');
      }

      await runCollector(config);

      console.log('\n✅ Collection complete!');
      console.log(`📁 Output saved to: ${options.output}/`);
      
    } catch (error) {
      console.error('\n❌ Fatal error:', error.message);
      if (process.env.DEBUG === 'true') {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program.parse();
