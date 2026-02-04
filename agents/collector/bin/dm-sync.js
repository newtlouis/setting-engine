#!/usr/bin/env node

/**
 * DM Sync CLI
 *
 * Synchronizes actual Instagram DM conversations with the database
 * to enable the feedback loop for AI improvement.
 *
 * Usage:
 *   node bin/dm-sync.js --profile melanie
 *   node bin/dm-sync.js --profile melanie --max 10
 *   node bin/dm-sync.js --profile melanie --stats
 */

import { Command } from 'commander';
import { initDatabase, getDb } from '../src/db/core.js';
import { syncDMs, getCorrectionStats, getLeadsToSync } from '../src/dm-sync.js';
import BrowserService from '../../../shared/browser/BrowserService.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
  .name('dm-sync')
  .description('Synchronize Instagram DM conversations with database')
  .option('-p, --profile <name>', 'Instagram profile name', 'melanie')
  .option('-m, --max <number>', 'Maximum number of leads to sync', '20')
  .option('-s, --stats', 'Show correction statistics only')
  .option('-l, --list', 'List leads that would be synced')
  .option('--include-recent', 'Include recently synced leads')
  .option('--headless', 'Run in headless mode (not recommended)')
  .parse(process.argv);

const options = program.opts();

async function main() {
  console.log('\n🔄 DM Sync Tool');
  console.log('='.repeat(40));

  // Initialize database
  const dbPath = path.join(__dirname, '..', 'permanent-data', 'leads.db');
  await initDatabase(dbPath);
  const db = getDb();

  // Get account ID for profile
  const account = db.prepare('SELECT id FROM accounts WHERE name = ?').get(options.profile);
  if (!account) {
    console.error(`❌ Account "${options.profile}" not found`);
    process.exit(1);
  }
  const accountId = account.id;
  console.log(`📱 Account: ${options.profile} (ID: ${accountId})`);

  // Stats only mode
  if (options.stats) {
    console.log('\n📊 Correction Statistics:');
    console.log('-'.repeat(40));

    const stats = getCorrectionStats(accountId);
    console.log(`   Total corrections: ${stats.total_corrections || 0}`);
    console.log(`   Edited (minor): ${stats.edited || 0}`);
    console.log(`   Rewritten (major): ${stats.rewritten || 0}`);

    if (stats.recentCorrections && stats.recentCorrections.length > 0) {
      console.log('\n   Recent corrections:');
      stats.recentCorrections.slice(0, 5).forEach(c => {
        console.log(`\n   @${c.username} [${c.modification_type}]`);
        console.log(`   AI: "${c.ai_suggested?.substring(0, 60)}..."`);
        console.log(`   Sent: "${c.actually_sent?.substring(0, 60)}..."`);
      });
    }

    process.exit(0);
  }

  // List mode
  if (options.list) {
    console.log('\n📋 Leads to sync:');
    console.log('-'.repeat(40));

    const leads = getLeadsToSync(accountId);
    if (leads.length === 0) {
      console.log('   No leads match sync criteria (funnel_step >= 5 or booked)');
    } else {
      leads.forEach((l, i) => {
        const syncStatus = l.last_dm_sync_at
          ? `Last sync: ${new Date(l.last_dm_sync_at).toLocaleDateString()}`
          : 'Never synced';
        console.log(`   ${i + 1}. @${l.username}`);
        console.log(`      Step: ${l.funnel_step} | Booking: ${l.booking_status || 'none'} | ${syncStatus}`);
        console.log(`      DB messages: ${l.db_message_count}`);
      });
    }

    process.exit(0);
  }

  // Full sync mode - requires browser
  console.log('\n🌐 Starting browser for DM sync...');

  let session;
  try {
    session = await BrowserService.initSession({
      profile: options.profile,
      headless: options.headless || false,
      timeout: 90000
    });

    // Ensure logged in
    console.log('🔐 Checking login status...');
    await session.ensureLoggedIn();

    // Run sync
    const stats = await syncDMs(session, accountId, {
      maxLeads: parseInt(options.max),
      skipRecent: !options.includeRecent
    });

    console.log('\n✅ Sync completed successfully!');

  } catch (error) {
    console.error('\n❌ Sync failed:', error.message);
    process.exit(1);
  } finally {
    if (session) {
      console.log('\n🔒 Closing browser...');
      await session.close();
    }
  }
}

main().catch(console.error);
