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

// Load environment variables from all .env files in the monorepo
// Later files don't override earlier ones (first value wins)
const envPaths = [
  join(__dirname, '../../..', '.env'),          // Root (if exists)
  join(__dirname, '../../outreach', '.env'),     // Outreach agent (prospector credentials)
  join(__dirname, '../../dmresponder', '.env')   // DM Responder (OpenAI key, other credentials)
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

const program = new Command();

program
  .name('prospect')
  .description('Unified prospecting: scrape posts, qualify leads, send outreach in one browser session')
  .requiredOption('--profile <name>', 'Instagram profile/account name (REQUIRED)')
  .option('--source <value>', 'Source to scrape: hashtag (e.g., "#dependanceaffective") or competitor profile (e.g., "@competitor_username")')
  .option('--posts <number>', 'Batch size: number of posts to scrape at a time before processing', '3')
  .option('--total <number>', 'Maximum total leads to contact in this session', '20')
  .option('--skip-qualification', 'Skip bio qualification check', false)
  .option('--mode <mode>', 'Prospecting mode: "comments" (leads = commenters) or "authors" (leads = post authors)', 'comments')
  .option('--variant <mode>', 'A/B variant mode: "A" (variant A only), "B" (variant B only), "random" (50/50)', 'random')
  .action(async (options) => {
    console.log('\n🚀 UNIFIED PROSPECTING PIPELINE');
    console.log('================================');
    console.log(`   Profile: ${options.profile}`);
    console.log(`   Source: ${options.source}`);
    console.log(`   Batch size: ${options.posts} posts`);
    console.log(`   Total limit: ${options.total}`);
    console.log(`   Mode: ${options.mode}`);
    console.log(`   Variant: ${options.variant}`);
    console.log('');

    try {
      const { runProspector } = await import('../src/prospect_worker.js');
      await runProspector({
        profile: options.profile,
        source: options.source,
        maxPosts: parseInt(options.posts, 10),
        totalLimit: parseInt(options.total, 10),
        skipQualification: options.skipQualification,
        mode: options.mode,
        variantMode: options.variant
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
