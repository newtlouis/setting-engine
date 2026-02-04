#!/usr/bin/env node
/**
 * Migration: Upgrade followup_templates table to new schema
 *
 * The old schema had:
 *   - step_order (generic order)
 *   - No link to funnel_stages
 *
 * The new schema has:
 *   - stage_id (linked to funnel_stages)
 *   - template_order (order within a stage)
 *   - account_id
 *   - template_name
 *   - usage_count, success_count
 *
 * Usage: node scripts/migrate-upgrade-followup-templates.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', 'agents', 'collector', 'permanent-data', 'leads.db');

async function migrate() {
  console.log('=== Migration: Upgrade followup_templates ===\n');
  console.log(`Database: ${DB_PATH}\n`);

  const db = new Database(DB_PATH);

  try {
    // Check current schema
    const columns = db.prepare("PRAGMA table_info(followup_templates)").all();
    const hasStageId = columns.some(c => c.name === 'stage_id');

    if (hasStageId) {
      console.log('✅ Table already has new schema. Nothing to do.\n');
      return;
    }

    console.log('Current schema has old format. Upgrading...\n');

    // Backup old data
    const oldTemplates = db.prepare('SELECT * FROM followup_templates').all();
    console.log(`   Found ${oldTemplates.length} templates to migrate.`);

    // Disable foreign key checks temporarily
    db.exec('PRAGMA foreign_keys = OFF');

    // Drop old table
    console.log('   Dropping old table...');
    db.exec('DROP TABLE IF EXISTS followup_templates');

    // Create new table
    console.log('   Creating new table...');
    db.exec(`
      CREATE TABLE followup_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stage_id INTEGER REFERENCES funnel_stages(id) ON DELETE CASCADE,
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

    // Create index
    db.exec('CREATE INDEX IF NOT EXISTS idx_followup_templates_stage ON followup_templates(stage_id)');

    console.log('   ✅ New table created.');

    // Re-enable foreign key checks
    db.exec('PRAGMA foreign_keys = ON');

    // Note: Old templates were generic, not linked to stages
    // They will be re-imported by migrate-init-funnel-stages.js from config files
    console.log(`\n   ⚠️ Old templates (${oldTemplates.length}) were not migrated.`);
    console.log('   → Run migrate-init-funnel-stages.js to import from config files.\n');

    console.log('✅ Migration complete!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    db.close();
  }
}

migrate();
