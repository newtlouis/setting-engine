#!/usr/bin/env node
/**
 * Migration: Add funnel_stages and followup_templates tables
 *
 * Usage: node scripts/migrate-add-funnel-tables.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', 'agents', 'collector', 'permanent-data', 'leads.db');

async function migrate() {
  console.log('=== Migration: Add Funnel Tables ===\n');
  console.log(`Database: ${DB_PATH}\n`);

  const db = new Database(DB_PATH);

  try {
    // Check if tables already exist
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('funnel_stages', 'followup_templates')
    `).all();

    const existingTables = tables.map(t => t.name);

    if (existingTables.includes('funnel_stages') && existingTables.includes('followup_templates')) {
      console.log('✅ Tables already exist. Nothing to do.\n');
      return;
    }

    // Create funnel_stages table
    if (!existingTables.includes('funnel_stages')) {
      console.log('Creating funnel_stages table...');
      db.exec(`
        CREATE TABLE funnel_stages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER NOT NULL REFERENCES accounts(id),
          stage_order INTEGER NOT NULL,
          stage_name TEXT NOT NULL,
          stage_label TEXT NOT NULL,
          description TEXT,
          max_followups INTEGER DEFAULT 0,
          followup_delay_hours INTEGER DEFAULT 24,
          auto_ignore_after_max INTEGER DEFAULT 0,
          is_active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          UNIQUE(account_id, stage_order)
        )
      `);
      console.log('   ✅ funnel_stages created');
    }

    // Create followup_templates table
    if (!existingTables.includes('followup_templates')) {
      console.log('Creating followup_templates table...');
      db.exec(`
        CREATE TABLE followup_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          stage_id INTEGER NOT NULL REFERENCES funnel_stages(id) ON DELETE CASCADE,
          account_id INTEGER NOT NULL REFERENCES accounts(id),
          template_order INTEGER NOT NULL,
          template_text TEXT NOT NULL,
          template_name TEXT,
          is_active INTEGER DEFAULT 1,
          usage_count INTEGER DEFAULT 0,
          success_count INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          UNIQUE(stage_id, template_order)
        )
      `);
      console.log('   ✅ followup_templates created');
    }

    // Create indexes
    console.log('Creating indexes...');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_funnel_stages_account ON funnel_stages(account_id);
      CREATE INDEX IF NOT EXISTS idx_followup_templates_stage ON followup_templates(stage_id);
    `);
    console.log('   ✅ Indexes created');

    console.log('\n✅ Migration complete!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

migrate();
