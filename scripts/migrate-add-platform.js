#!/usr/bin/env node
/**
 * Migration: Add platform column to leads table
 *
 * This script adds the platform column to support multi-platform leads
 * (Instagram, TikTok, LinkedIn).
 *
 * Usage: node scripts/migrate-add-platform.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', 'agents', 'collector', 'permanent-data', 'leads.db');

async function migrate() {
  console.log('=== Migration: Add platform column ===\n');
  console.log(`Database: ${DB_PATH}\n`);

  const db = new Database(DB_PATH);

  try {
    // Check if column already exists
    const columns = db.prepare("PRAGMA table_info(leads)").all();
    const hasPlatform = columns.some(c => c.name === 'platform');

    if (hasPlatform) {
      console.log('✅ Column platform already exists. Nothing to do.\n');
      return;
    }

    console.log('Adding platform column to leads table...');

    db.exec(`
      ALTER TABLE leads ADD COLUMN platform TEXT DEFAULT 'instagram';
    `);

    console.log('✅ Column added successfully.\n');

    // Set all existing leads to instagram
    const result = db.prepare(`
      UPDATE leads SET platform = 'instagram' WHERE platform IS NULL
    `).run();

    console.log(`   Set platform='instagram' for ${result.changes} existing leads.\n`);

    // Show summary
    const summary = db.prepare(`
      SELECT platform, COUNT(*) as count
      FROM leads
      GROUP BY platform
    `).all();

    console.log('Platform distribution:');
    for (const row of summary) {
      console.log(`   ${row.platform}: ${row.count} leads`);
    }
    console.log('');

    console.log('✅ Migration complete!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

migrate();
