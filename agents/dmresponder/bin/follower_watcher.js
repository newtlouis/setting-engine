#!/usr/bin/env node

/**
 * CLI Entry point for Follower Watcher
 */

import { Command } from 'commander';
import { runFollowerWatcher } from '../src/follower_watcher.js';
import dotenv from 'dotenv';

dotenv.config();

const program = new Command();

program
  .name('follower-watcher')
  .description('Monitor new Instagram followers and initiate outreach')
  .option('-p, --profile <name>', 'Profile name to use (required)')
  .option('-d, --dry-run', 'Scan only, do not prepare messages', false)
  .option('--show-browser', 'Show browser window during operation', true)
  .action(async (options) => {
    try {
      await runFollowerWatcher({
        profile: options.profile,
        dryRun: options.dryRun,
        headless: !options.showBrowser
      });
    } catch (error) {
      console.error('Fatal error:', error.message);
      process.exit(1);
    }
  });

program.parse();
