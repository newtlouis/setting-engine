/**
 * Migration Script: Add Multi-Account Support
 * 
 * Creates the `accounts` table and adds `account_id` to leads and posts.
 * Existing data is assigned to a "default" account.
 * 
 * Usage: node scripts/migrate-add-accounts.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', 'permanent-data', 'leads.db');

async function migrate() {
  console.log('🔄 Starting multi-account migration...');
  console.log(`   Database: ${DB_PATH}\n`);

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  try {
    // Step 1: Create accounts table
    console.log('1️⃣  Creating accounts table...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        ig_username TEXT,
        description TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    console.log('   ✅ accounts table created');

    // Step 2: Create default account for existing data
    console.log('\n2️⃣  Creating default account...');
    const existingDefault = db.prepare('SELECT id FROM accounts WHERE name = ?').get('default');
    
    let defaultAccountId;
    if (existingDefault) {
      defaultAccountId = existingDefault.id;
      console.log('   ℹ️  Default account already exists (id: ' + defaultAccountId + ')');
    } else {
      const result = db.prepare(`
        INSERT INTO accounts (name, description) 
        VALUES ('default', 'Compte par défaut (données existantes)')
      `).run();
      defaultAccountId = result.lastInsertRowid;
      console.log('   ✅ Default account created (id: ' + defaultAccountId + ')');
    }

    // Step 3: Add account_id to leads table
    console.log('\n3️⃣  Adding account_id to leads table...');
    const leadsColumns = db.prepare("PRAGMA table_info(leads)").all();
    const hasAccountIdLeads = leadsColumns.some(col => col.name === 'account_id');
    
    if (hasAccountIdLeads) {
      console.log('   ℹ️  Column already exists');
    } else {
      db.exec(`ALTER TABLE leads ADD COLUMN account_id INTEGER REFERENCES accounts(id)`);
      console.log('   ✅ Column added');
      
      // Update existing rows
      const updateResult = db.prepare('UPDATE leads SET account_id = ? WHERE account_id IS NULL').run(defaultAccountId);
      console.log(`   ✅ Updated ${updateResult.changes} existing leads`);
    }

    // Step 4: Add account_id to posts table
    console.log('\n4️⃣  Adding account_id to posts table...');
    const postsColumns = db.prepare("PRAGMA table_info(posts)").all();
    const hasAccountIdPosts = postsColumns.some(col => col.name === 'account_id');
    
    if (hasAccountIdPosts) {
      console.log('   ℹ️  Column already exists');
    } else {
      db.exec(`ALTER TABLE posts ADD COLUMN account_id INTEGER REFERENCES accounts(id)`);
      console.log('   ✅ Column added');
      
      // Update existing rows
      const updateResult = db.prepare('UPDATE posts SET account_id = ? WHERE account_id IS NULL').run(defaultAccountId);
      console.log(`   ✅ Updated ${updateResult.changes} existing posts`);
    }

    // Step 5: Create indexes
    console.log('\n5️⃣  Creating indexes...');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_leads_account_id ON leads(account_id);
      CREATE INDEX IF NOT EXISTS idx_posts_account_id ON posts(account_id);
    `);
    console.log('   ✅ Indexes created');

    // Summary
    console.log('\n' + '═'.repeat(50));
    console.log('✅ Migration complete!');
    
    const accountCount = db.prepare('SELECT COUNT(*) as count FROM accounts').get().count;
    const leadsCount = db.prepare('SELECT COUNT(*) as count FROM leads').get().count;
    const postsCount = db.prepare('SELECT COUNT(*) as count FROM posts').get().count;
    
    console.log(`\n📊 Database summary:`);
    console.log(`   Accounts: ${accountCount}`);
    console.log(`   Leads: ${leadsCount}`);
    console.log(`   Posts: ${postsCount}`);
    console.log('═'.repeat(50));

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    throw error;
  } finally {
    db.close();
  }
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
