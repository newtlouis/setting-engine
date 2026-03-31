#!/usr/bin/env node

/**
 * Broadcast CLI
 *
 * Send a campaign message to followers in batches.
 */

import { Command } from 'commander';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPaths = [
  join(__dirname, '../../..', '.env'),
  join(__dirname, '../../outreach', '.env'),
  join(__dirname, '../../dmresponder', '.env')
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

const program = new Command();

program
  .name('broadcast')
  .description('Send a campaign message to followers')
  .requiredOption('--profile <name>', 'Instagram profile/account name')
  .requiredOption('--campaign <id>', 'Campaign ID to send')
  .option('--batch <number>', 'Number of DMs per batch', '20')
  .action(async (options) => {
    try {
      const { runBroadcast } = await import('../src/broadcast_worker.js');
      await runBroadcast({
        profile: options.profile,
        campaignId: parseInt(options.campaign, 10),
        batch: parseInt(options.batch, 10)
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
