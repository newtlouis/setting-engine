#!/usr/bin/env node

/**
 * Unified Prospecting CLI
 * 
 * Single command to scrape posts, qualify leads, and send outreach messages.
 */

import { Command } from 'commander';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from various possible locations in a monorepo
const envPaths = [
  join(__dirname, '../../..', '.env'),      // Root
  join(__dirname, '../../outreach', '.env')   // Outreach agent (where the key likely is)
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

const program = new Command();

program
  .name('prospect')
  .description('Unified prospecting: scrape posts, qualify leads, send outreach in one browser session')
  .requiredOption('--profile <name>', 'Instagram profile/account name (REQUIRED)')
  .option('--source <value>', 'Source to scrape: hashtag (e.g., "#dependanceaffective") or competitor profile (e.g., "@competitor_username")')
  .option('--posts <number>', 'Batch size: number of posts to scrape at a time before processing', '3')
  .option('--leads <number>', 'Maximum leads to process per post', '10')
  .option('--total <number>', 'Maximum total leads to contact in this session', '20')
  .option('--dry-run', 'List what would be done without opening browser', false)
  .option('--skip-qualification', 'Skip bio qualification check', false)
  .option('--prepare-only', 'Queue leads without opening browser tabs', false)
  .action(async (options) => {
    console.log('\n🚀 UNIFIED PROSPECTING PIPELINE');
    console.log('================================');
    console.log(`   Profile: ${options.profile}`);
    console.log(`   Source: ${options.source}`);
    console.log(`   Batch size: ${options.posts} posts`);
    console.log(`   Max leads/post: ${options.leads}`);
    console.log(`   Total limit: ${options.total}`);
    if (options.dryRun) console.log('   MODE: DRY RUN (no browser)');
    console.log('');

    try {
      const { runProspector } = await import('../src/prospect_worker.js');
      await runProspector({
        profile: options.profile,
        source: options.source,
        maxPosts: parseInt(options.posts, 10),
        maxLeadsPerPost: parseInt(options.leads, 10),
        totalLimit: parseInt(options.total, 10),
        dryRun: options.dryRun,
        skipQualification: options.skipQualification,
        prepareOnly: options.prepareOnly
      });
      process.exit(0);
    } catch (error) {
      console.error(`\n❌ Error: ${error.message}`);
      if (process.env.DEBUG === 'true') {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program.parse();
