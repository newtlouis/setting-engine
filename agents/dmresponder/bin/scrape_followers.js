#!/usr/bin/env node

/**
 * Scrape Followers CLI
 *
 * Scrape all followers from an Instagram profile and save them to database.
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
  .name('scrape-followers')
  .description('Scrape all followers from an Instagram profile')
  .requiredOption('--profile <name>', 'Instagram profile/account name')
  .action(async (options) => {
    try {
      const { initDB, getOrCreateAccount } = await import('../src/db_integration.js');
      const { initBrowser, closeBrowser } = await import('../src/scraper.js');
      const { scrapeFollowers } = await import('../src/follower_scraper.js');
      const { getDb } = await import('../../../agents/collector/src/db/core.js');

      await initDB();

      const account = await getOrCreateAccount(options.profile);
      const db = getDb();
      const acc = db.prepare('SELECT ig_username, name FROM accounts WHERE id = ?').get(account.id);
      const igUsername = acc?.ig_username || acc?.name || options.profile;

      console.log(`\n📋 SCRAPE FOLLOWERS`);
      console.log(`================================`);
      console.log(`   Profile: ${options.profile}`);
      console.log(`   Instagram: @${igUsername}`);
      console.log('');

      const { page } = await initBrowser({ profile: options.profile, purpose: 'scrape-followers', headless: false });

      try {
        await scrapeFollowers(page, igUsername, account.id);
        const count = db.prepare('SELECT COUNT(*) as c FROM account_followers WHERE account_id = ?').get(account.id).c;
        console.log(`\n✅ Done. ${count} followers in database.`);
      } finally {
        await closeBrowser();
      }

      process.exit(0);
    } catch (error) {
      console.error(`\n❌ Error: ${error.message}`);
      if (process.env.DEBUG === 'true') console.error(error.stack);
      process.exit(1);
    }
  });

program.parse();
