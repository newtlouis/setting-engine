
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'permanent-data', 'leads.db');

console.log(`🔌 Opening database at ${DB_PATH}`);
const db = new Database(DB_PATH);

// Disable foreign keys to allow table operations
db.pragma('foreign_keys = OFF');

try {
  console.log('📦 Starting migration...');
  
  // 1. Rename old table
  console.log('   Renaming leads -> leads_old');
  db.exec('ALTER TABLE leads RENAME TO leads_old');
  
  // 2. Create new table with reduced schema
  // (Copied from corrected database.js)
  console.log('   Creating new leads table...');
  db.exec(`
    CREATE TABLE leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      engagement_score REAL DEFAULT 0,
      total_comments INTEGER DEFAULT 0,
      total_messages_sent INTEGER DEFAULT 0,
      total_messages_received INTEGER DEFAULT 0,
      
      status TEXT DEFAULT 'new',
      conversation_stage TEXT DEFAULT 'none',
      first_message_sent_at TEXT,
      last_contact_at TEXT,
      profile_url TEXT,
      
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
  `);
  
  // 3. Copy data
  // We map columns. Columns that were removed are simply omitted.
  console.log('   Copying data...');
  db.exec(`
    INSERT INTO leads (
      id, username, 
      engagement_score, total_comments, total_messages_sent, total_messages_received,
      status, conversation_stage, first_message_sent_at, last_contact_at, profile_url,
      warmth, pain_points, goals, objections, notes,
      first_seen_at, last_seen_at, created_at, updated_at
    )
    SELECT 
      id, username, 
      engagement_score, total_comments, total_messages_sent, total_messages_received,
      status, conversation_stage, first_message_sent_at, last_contact_at, profile_url,
      warmth, pain_points, goals, objections, notes,
      first_seen_at, last_seen_at, created_at, updated_at
    FROM leads_old
  `);
  
  const count = db.prepare('SELECT COUNT(*) as c FROM leads').get().c;
  console.log(`   ✅ Copied ${count} rows.`);

  // 4. Recreate indexes
  console.log('   Recreating indexes...');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_leads_username ON leads(username);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_engagement ON leads(engagement_score); -- Changed from engagement_level
    CREATE INDEX IF NOT EXISTS idx_leads_warmth ON leads(warmth);
  `);

  // 5. Drop old table
  console.log('   Dropping leads_old...');
  db.exec('DROP TABLE leads_old');

  console.log('✅ Migration complete! Database size reduced.');

} catch (err) {
  console.error('❌ Migration failed:', err);
  console.log('   Attempting rollback (renaming leads_old back)...');
  try {
    db.exec('DROP TABLE IF EXISTS leads');
    db.exec('ALTER TABLE leads_old RENAME TO leads');
    console.log('   Rollback successful.');
  } catch (e) {
    console.error('   Rollback failed. You may need to manually restore leads_old.', e);
  }
} finally {
  db.close();
}
