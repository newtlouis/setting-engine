#!/usr/bin/env node

import { Command } from 'commander';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runCronWatcher } from '../src/cron_worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const program = new Command();

program
  .name('dmresponder-cron')
  .description('Check Instagram DM threads and generate suggestions when new replies arrive')
  .option('--limit <number>', 'Maximum number of DM threads to scan', '5')
  .option('--statuses <list>', 'Comma-separated lead statuses to process', 'conversation')
  .option('--output-dir <dir>', 'Directory to store suggestion files')
  .option('--show-browser', 'Run Playwright in headed mode (default headless)', false)
  .action(async (options) => {
    const limit = parseInt(options.limit, 10) || 5;
    const statuses = options.statuses
      ? options.statuses.split(',').map(status => status.trim()).filter(Boolean)
      : undefined;

    try {
      await runCronWatcher({
        limit,
        statuses,
        outputDir: options.outputDir,
        headless: !options.showBrowser
      });
    } catch (error) {
      console.error('Cron watcher failed:', error.message);
      if (process.env.DEBUG === 'true') {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program.parse();
