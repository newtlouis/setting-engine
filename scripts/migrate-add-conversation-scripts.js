#!/usr/bin/env node
/**
 * Migration: Add conversation_script to funnel_stages and create account_personas table
 *
 * This enables storing the LLM conversation script per stage in the database,
 * allowing different accounts to have different conversation flows.
 *
 * Usage: node scripts/migrate-add-conversation-scripts.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', 'agents', 'collector', 'permanent-data', 'leads.db');

async function migrate() {
  console.log('=== Migration: Add Conversation Scripts Support ===\n');
  console.log(`Database: ${DB_PATH}\n`);

  const db = new Database(DB_PATH);

  try {
    // 1. Add conversation_script column to funnel_stages
    const columns = db.prepare("PRAGMA table_info(funnel_stages)").all();
    const hasConversationScript = columns.some(c => c.name === 'conversation_script');

    if (!hasConversationScript) {
      console.log('Adding conversation_script column to funnel_stages...');
      db.exec(`
        ALTER TABLE funnel_stages ADD COLUMN conversation_script TEXT;
      `);
      console.log('   ✅ conversation_script column added');
    } else {
      console.log('✅ conversation_script column already exists');
    }

    // 2. Create account_personas table
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='account_personas'
    `).all();

    if (tables.length === 0) {
      console.log('\nCreating account_personas table...');
      db.exec(`
        CREATE TABLE account_personas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id),
          persona_name TEXT NOT NULL,
          niche TEXT,
          communication_rules TEXT,
          objections_script TEXT,
          knowledge_base TEXT,
          post_booking_message TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);
      console.log('   ✅ account_personas table created');

      // Create index
      db.exec('CREATE INDEX IF NOT EXISTS idx_account_personas_account ON account_personas(account_id)');
      console.log('   ✅ Index created');
    } else {
      console.log('\n✅ account_personas table already exists');
    }

    console.log('\n✅ Migration complete!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    db.close();
  }
}

migrate();
