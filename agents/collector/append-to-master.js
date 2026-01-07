#!/usr/bin/env node

/**
 * Save Comments to Database
 * 
 * Reads comments from output/comments.csv and saves them to the SQLite database.
 * - Creates leads for new usernames
 * - Stores all comments (deduplicates exact matches)
 * - Recalculates engagement scores
 */

import { promises as fs } from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { fileURLToPath } from 'url';
import {
  initDatabase,
  getOrCreateAccount,
  insertCommentsBatch,
  recalculateAllEngagement,
  getStats,
  closeDatabase
} from './src/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function saveToDatabase() {
  const outputDir = path.join(__dirname, 'output');
  const permanentDir = path.join(__dirname, 'permanent-data');
  const commentsFile = path.join(outputDir, 'comments.csv');
  const dbFile = path.join(permanentDir, 'leads.db');

  try {
    // Check if comments.csv exists
    try {
      await fs.access(commentsFile);
    } catch {
      console.log('❌ No comments.csv found in output/ directory');
      console.log('   Run "npm run scrape" first to collect data');
      return;
    }

    // Read new comments from CSV
    const commentsData = await fs.readFile(commentsFile, 'utf-8');
    const comments = parse(commentsData, {
      columns: true,
      skip_empty_lines: true
    });

    if (comments.length === 0) {
      console.log('⚠️  comments.csv is empty, nothing to save');
      return;
    }

    console.log(`📋 Found ${comments.length} comments to process`);

    // Initialize database
    await initDatabase(dbFile);

    // Get current account from env or default
    const profileName = process.env.IG_PROFILE;
    if (!profileName) {
        throw new Error('IG_PROFILE environment variable missing. Cannot save to database without an account context.');
    }
    const account = getOrCreateAccount(profileName);
    console.log(`📁 Target Account: ${account.name} (id: ${account.id})`);
    
    // Get stats before
    const statsBefore = getStats();
    console.log(`📚 Database has ${statsBefore.total_leads} leads and ${statsBefore.total_comments} comments`);

    // Insert comments in batch
    console.log('\n💾 Saving comments to database...');
    const { inserted, skipped } = insertCommentsBatch(comments, account.id);

    console.log(`   ✅ Inserted ${inserted.length} new comments`);
    console.log(`   ⏭️  Skipped ${skipped.length} duplicates`);

    // Recalculate engagement scores
    if (inserted.length > 0) {
      console.log('\n📊 Recalculating engagement scores...');
      const updatedCount = recalculateAllEngagement();
      console.log(`   Updated ${updatedCount} leads`);
    }

    // Get stats after
    const statsAfter = getStats();
    
    // Format engagement distribution
    const engagementDist = {};
    statsAfter.leads_by_engagement.forEach(e => {
      engagementDist[e.engagement_level] = e.count;
    });

    console.log('\n✅ Database updated successfully!');
    console.log('─'.repeat(50));
    console.log('📊 Current Statistics:');
    console.log(`   Total leads:     ${statsAfter.total_leads}`);
    console.log(`   Total comments:  ${statsAfter.total_comments}`);
    console.log(`   Spam filtered:   ${statsAfter.spam_comments}`);
    console.log('');
    console.log('   Engagement distribution:');
    console.log(`     HIGH:   ${engagementDist.HIGH || 0} leads`);
    console.log(`     MEDIUM: ${engagementDist.MEDIUM || 0} leads`);
    console.log(`     LOW:    ${engagementDist.LOW || 0} leads`);
    console.log('');
    console.log(`   Database: ${dbFile}`);

    closeDatabase();

  } catch (error) {
    console.error('❌ Error:', error.message);
    closeDatabase();
    process.exit(1);
  }
}

// Run the script
saveToDatabase();
