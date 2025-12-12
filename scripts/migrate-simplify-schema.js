/**
 * Migration Script: Simplify Database Schema
 * 
 * This script:
 * 1. Adds dm_url column to leads table
 * 2. Migrates data from dm_threads to leads
 * 3. Converts old statuses to new simplified statuses
 * 4. Drops dm_threads table and conversation_stage column
 * 
 * Run with: node scripts/migrate-simplify-schema.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', 'agents', 'collector', 'permanent-data', 'leads.db');
const BACKUP_PATH = DB_PATH.replace('.db', `-backup-${Date.now()}.db`);

console.log('\n🔧 Schema Simplification Migration\n');
console.log(`   Database: ${DB_PATH}`);

// Create backup
console.log(`   Creating backup: ${BACKUP_PATH}`);
fs.copyFileSync(DB_PATH, BACKUP_PATH);
console.log('   ✅ Backup created\n');

const db = new Database(DB_PATH);

// Status mapping: old -> new
const STATUS_MAP = {
  'new': 'new',
  'contacted': 'outreach',
  'message_ready': 'outreach',
  'response_typed': 'responding',
  'awaiting_reply': 'responding',
  'watching': 'responding',
  'replied': 'replied',
  'qualified': 'replied',
  'failed_outreach': 'failed',
  'uncontactable': 'failed',
  'error': 'failed',
  'closed_won': 'closed',
  'closed_lost': 'closed'
};

try {
  console.log('Step 1: Adding dm_url column to leads...');
  
  // Check if dm_url already exists
  const columns = db.prepare("PRAGMA table_info(leads)").all();
  const hasDmUrl = columns.some(c => c.name === 'dm_url');
  
  if (!hasDmUrl) {
    db.exec('ALTER TABLE leads ADD COLUMN dm_url TEXT');
    console.log('   ✅ dm_url column added');
  } else {
    console.log('   ⏭️  dm_url already exists, skipping');
  }

  console.log('\nStep 2: Migrating data from dm_threads to leads...');
  
  // Check if dm_threads exists
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dm_threads'").all();
  
  if (tables.length > 0) {
    const threads = db.prepare('SELECT * FROM dm_threads').all();
    console.log(`   Found ${threads.length} dm_threads to migrate`);
    
    const updateStmt = db.prepare(`
      UPDATE leads SET 
        dm_url = @dm_url,
        updated_at = datetime('now')
      WHERE username = @username
    `);
    
    let migrated = 0;
    for (const thread of threads) {
      try {
        updateStmt.run({
          dm_url: thread.dm_url,
          username: thread.username
        });
        migrated++;
      } catch (e) {
        console.log(`   ⚠️  Could not migrate thread for ${thread.username}: ${e.message}`);
      }
    }
    console.log(`   ✅ Migrated ${migrated}/${threads.length} dm_urls`);
  } else {
    console.log('   ⏭️  dm_threads table not found, skipping');
  }

  console.log('\nStep 3: Converting statuses to new format...');
  
  // Get current status values
  const statusCounts = db.prepare(`
    SELECT status, COUNT(*) as count FROM leads GROUP BY status
  `).all();
  
  console.log('   Current statuses:');
  for (const s of statusCounts) {
    const newStatus = STATUS_MAP[s.status] || 'new';
    console.log(`     ${s.status} (${s.count}) -> ${newStatus}`);
  }
  
  // Update statuses
  for (const [oldStatus, newStatus] of Object.entries(STATUS_MAP)) {
    db.prepare(`UPDATE leads SET status = ? WHERE status = ?`).run(newStatus, oldStatus);
  }
  console.log('   ✅ Statuses converted');

  console.log('\nStep 4: Dropping dm_threads table...');
  
  if (tables.length > 0) {
    db.exec('DROP TABLE IF EXISTS dm_threads');
    console.log('   ✅ dm_threads table dropped');
  } else {
    console.log('   ⏭️  Already gone');
  }

  console.log('\nStep 5: Removing conversation_stage column...');
  
  // SQLite doesn't support DROP COLUMN in older versions, so we recreate the table
  const hasConvStage = columns.some(c => c.name === 'conversation_stage');
  
  if (hasConvStage) {
    console.log('   Creating new leads table without conversation_stage...');
    
    db.exec(`
      -- Create new table without conversation_stage
      CREATE TABLE leads_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        engagement_score REAL DEFAULT 0,
        total_comments INTEGER DEFAULT 0,
        total_messages_sent INTEGER DEFAULT 0,
        total_messages_received INTEGER DEFAULT 0,
        
        status TEXT DEFAULT 'new',
        first_message_sent_at TEXT,
        last_contact_at TEXT,
        profile_url TEXT,
        dm_url TEXT,
        
        warmth TEXT DEFAULT 'cold',
        pain_points TEXT,
        goals TEXT,
        objections TEXT,
        notes TEXT,
        
        first_seen_at TEXT DEFAULT (datetime('now')),
        last_seen_at TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      
      -- Copy data
      INSERT INTO leads_new (
        id, username, engagement_score, total_comments, total_messages_sent, total_messages_received,
        status, first_message_sent_at, last_contact_at, profile_url, dm_url,
        warmth, pain_points, goals, objections, notes,
        first_seen_at, last_seen_at, created_at, updated_at
      )
      SELECT 
        id, username, engagement_score, total_comments, total_messages_sent, total_messages_received,
        status, first_message_sent_at, last_contact_at, profile_url, dm_url,
        warmth, pain_points, goals, objections, notes,
        first_seen_at, last_seen_at, created_at, updated_at
      FROM leads;
      
      -- Drop old table and rename
      DROP TABLE leads;
      ALTER TABLE leads_new RENAME TO leads;
      
      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_leads_username ON leads(username);
      CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
      CREATE INDEX IF NOT EXISTS idx_leads_warmth ON leads(warmth);
    `);
    
    console.log('   ✅ conversation_stage column removed');
  } else {
    console.log('   ⏭️  conversation_stage already gone');
  }

  console.log('\n✅ Migration complete!\n');
  
  // Show final stats
  const finalStats = db.prepare(`
    SELECT status, COUNT(*) as count FROM leads GROUP BY status ORDER BY count DESC
  `).all();
  
  console.log('Final lead statuses:');
  for (const s of finalStats) {
    console.log(`   ${s.status}: ${s.count}`);
  }
  
  const totalLeads = db.prepare('SELECT COUNT(*) as count FROM leads').get().count;
  console.log(`\nTotal leads: ${totalLeads}`);
  
} catch (error) {
  console.error('\n❌ Migration failed:', error.message);
  console.log(`\n   Restore from backup: ${BACKUP_PATH}`);
  process.exit(1);
} finally {
  db.close();
}
