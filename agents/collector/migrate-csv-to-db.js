#!/usr/bin/env node

/**
 * Migrate CSV to SQLite Database
 * 
 * Imports existing master_comments.csv data into the new SQLite database.
 * Run this once to migrate your existing data.
 * 
 * Usage:
 *   node migrate-csv-to-db.js
 */

import { promises as fs } from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { fileURLToPath } from 'url';
import {
  initDatabase,
  closeDatabase,
  insertCommentsBatch,
  recalculateAllEngagement,
  getStats
} from './src/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function migrateCsvToDb() {
  const permanentDir = path.join(__dirname, 'permanent-data');
  const masterCsvFile = path.join(permanentDir, 'master_comments.csv');
  const dbFile = path.join(permanentDir, 'leads.db');
  const backupFile = path.join(permanentDir, 'master_comments.csv.backup');

  console.log('🔄 CSV to SQLite Migration');
  console.log('═'.repeat(50));

  try {
    // Check if CSV exists
    try {
      await fs.access(masterCsvFile);
    } catch {
      console.log('ℹ️  No master_comments.csv found. Nothing to migrate.');
      console.log('   Starting fresh with SQLite database.');
      return;
    }

    // Read CSV
    console.log('\n📖 Reading master_comments.csv...');
    const csvData = await fs.readFile(masterCsvFile, 'utf-8');
    const comments = parse(csvData, {
      columns: true,
      skip_empty_lines: true
    });

    if (comments.length === 0) {
      console.log('⚠️  CSV file is empty. Nothing to migrate.');
      return;
    }

    console.log(`   Found ${comments.length} comments to migrate`);

    // Check if database already has data
    await initDatabase(dbFile);
    const existingStats = getStats();
    
    if (existingStats.total_comments > 0) {
      console.log(`\n⚠️  Database already has ${existingStats.total_comments} comments.`);
      console.log('   Migration will ADD new records (duplicates will be skipped).');
      console.log('   Continue? Press Ctrl+C to cancel, or wait 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Transform CSV data to match database schema
    console.log('\n💾 Migrating to SQLite database...');
    
    const transformedComments = comments.map(c => ({
      username: c.username,
      full_name: c.full_name || null,
      profile_url: c.profile_url || null,
      comment_text: c.comment_text,
      comment_date: c.comment_date || null,
      post_url: c.post_url || null,
      source: c.source || null,
      quality_score: c.quality_score ? parseInt(c.quality_score, 10) : 0,
      is_spam: c.is_spam === 'true' || c.is_spam === true,
      spam_reason: c.spam_reason || null
    }));

    // Insert in batches
    const { inserted, skipped } = insertCommentsBatch(transformedComments);

    console.log(`   ✅ Inserted ${inserted.length} comments`);
    console.log(`   ⏭️  Skipped ${skipped.length} duplicates`);

    // Recalculate engagement
    if (inserted.length > 0) {
      console.log('\n📊 Recalculating engagement scores...');
      const updatedCount = recalculateAllEngagement();
      console.log(`   Updated ${updatedCount} leads`);
    }

    // Get final stats
    const finalStats = getStats();
    
    // Format engagement distribution
    const engagementDist = {};
    finalStats.leads_by_engagement.forEach(e => {
      engagementDist[e.engagement_level] = e.count;
    });

    console.log('\n' + '═'.repeat(50));
    console.log('✅ Migration complete!');
    console.log('─'.repeat(50));
    console.log('📊 Database Statistics:');
    console.log(`   Total leads:     ${finalStats.total_leads}`);
    console.log(`   Total comments:  ${finalStats.total_comments}`);
    console.log(`   Spam filtered:   ${finalStats.spam_comments}`);
    console.log('');
    console.log('   Engagement distribution:');
    console.log(`     HIGH:   ${engagementDist.HIGH || 0} leads`);
    console.log(`     MEDIUM: ${engagementDist.MEDIUM || 0} leads`);
    console.log(`     LOW:    ${engagementDist.LOW || 0} leads`);
    console.log('');
    console.log(`   Database: ${dbFile}`);

    // Backup CSV
    console.log('\n📦 Backing up CSV file...');
    await fs.copyFile(masterCsvFile, backupFile);
    console.log(`   Backup: ${backupFile}`);
    
    console.log('\n💡 You can now delete master_comments.csv if you want.');
    console.log('   The database is your new single source of truth.');

    closeDatabase();

  } catch (error) {
    console.error('\n❌ Migration error:', error.message);
    closeDatabase();
    process.exit(1);
  }
}

// Run migration
migrateCsvToDb();
