#!/usr/bin/env node

/**
 * CLI Entry point for Engagement Watcher
 */

import { Command } from 'commander';
import { runEngagementWatcher } from '../src/engagement_watcher.js';
import dotenv from 'dotenv';

dotenv.config();

const program = new Command();

program
  .name('engagement-watcher')
  .description('Monitor Instagram likes and comments on your posts and initiate outreach')
  .option('-p, --profile <name>', 'Profile name to use (required)')
  .option('-w, --track-week', 'Also scan "This Week" section (requires scrolling)', false)
  .option('-d, --dry-run', 'Scan only, do not prepare messages', false)
  .option('-m, --target-message-count <n>', 'Stop after N messages are prepared (default: 10)', parseInt)
  .option('--prepare-only', 'Queue leads without opening browser tabs', false)
  .option('--show-browser', 'Show browser window during operation', true)
  .action(async (options) => {
    try {
      await runEngagementWatcher({
          profile: options.profile,
          trackWeek: options.trackWeek,
          dryRun: options.dryRun,
          targetMessageCount: options.targetMessageCount,
          prepareOnly: options.prepareOnly,
          headless: !options.showBrowser
      });
    } catch (error) {
      console.error('Fatal error:', error.message);
      process.exit(1);
    }
  });

program.parse();
