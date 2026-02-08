#!/usr/bin/env node

import { Command } from 'commander';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runFollowupWatcher } from '../src/followup_worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const program = new Command();

program
  .name('dmresponder-followup')
  .description('Check for stale threads and generate follow-up messages')
  .option('--profile <name>', 'Browser profile name (REQUIRED)')
  .option('--days <number>', 'Number of days since last message to consider stale', '2')
  .option('--limit <number>', 'Maximum number of threads to process', '500')
  .option('--dry-run', 'List target threads without opening browser', false)
  .option('--slow', 'Type messages letter by letter instead of pasting (default: fast paste)', false)
  .action(async (options) => {
    try {
      await runFollowupWatcher({
        profile: options.profile,
        days: parseInt(options.days, 10),
        limit: parseInt(options.limit, 10),
        dryRun: options.dryRun,
        fast: !options.slow
      });
    } catch (error) {
      console.error('Follow-up run failed:', error.message);
      if (process.env.DEBUG === 'true') {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program.parse();
