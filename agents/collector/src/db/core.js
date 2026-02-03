/**
 * Database Core Module
 *
 * Handles database initialization, singleton management, and migrations.
 * This is the foundation module that all other db modules depend on.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default database path (shared across agents)
const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', 'permanent-data', 'leads.db');

let db = null;

/**
 * Get the raw database instance (for use by other modules)
 * @returns {Database|null} The database instance
 */
export function getDb() {
  return db;
}

/**
 * Initialize the database with all required tables
 *
 * @param {string} dbPath - Path to database file
 * @returns {Database} Database instance
 */
export async function initDatabase(dbPath = DEFAULT_DB_PATH) {
  // Ensure directory exists
  const dbDir = path.dirname(dbPath);
  await fs.mkdir(dbDir, { recursive: true });

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');

  // 1. Create Accounts table first
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      ig_username TEXT,
      description TEXT,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Create tables
  db.exec(`
    -- Leads table: one row per unique Instagram user
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      account_id INTEGER REFERENCES accounts(id),
      full_name TEXT,
      bio TEXT,
      email TEXT,
      profile_url TEXT,
      dm_url TEXT,
      status TEXT DEFAULT 'new',
      warmth TEXT DEFAULT 'cold',
      engagement_score REAL DEFAULT 0,
      total_comments INTEGER DEFAULT 0,
      total_messages_sent INTEGER DEFAULT 0,
      total_messages_received INTEGER DEFAULT 0,
      lead_source TEXT,
      lead_type TEXT DEFAULT 'cold',
      booking_status TEXT, -- pending, completed
      conversation_stage TEXT,
      is_ignored INTEGER DEFAULT 0,
      pain_points TEXT,  -- JSON array
      conversation_step INTEGER DEFAULT 0,
      notes TEXT,
      first_name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(username, account_id)
    );

    -- Comments table: all comments from each lead
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      comment_text TEXT NOT NULL,
      comment_date TEXT,
      post_url TEXT,
      source TEXT,  -- e.g., "hashtag:fitness" or "profile:competitor1"

      -- Quality metrics
      quality_score INTEGER DEFAULT 0,
      is_spam INTEGER DEFAULT 0,
      spam_reason TEXT,

      -- Metadata
      created_at TEXT DEFAULT (datetime('now')),

      FOREIGN KEY (lead_id) REFERENCES leads(id)
    );

    -- Posts table: scraped posts
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_url TEXT UNIQUE NOT NULL,
      account_id INTEGER REFERENCES accounts(id),
      source_type TEXT,  -- hashtag, profile
      source_name TEXT,
      post_date TEXT,
      likes INTEGER,
      comments_count INTEGER,
      caption_excerpt TEXT,

      -- Scraping status
      scraped_at TEXT,
      comments_scraped INTEGER DEFAULT 0,

      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Conversations table: DM history
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      role TEXT NOT NULL,  -- 'user' or 'assistant'
      message_text TEXT NOT NULL,
      message_type TEXT,  -- greeting, question, response, cta, etc.

      sent_at TEXT DEFAULT (datetime('now')),

      FOREIGN KEY (lead_id) REFERENCES leads(id)
    );

    -- Test Scenarios table: saved conversation scenarios for testing
    CREATE TABLE IF NOT EXISTS test_scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      messages TEXT NOT NULL,  -- JSON array of {role, text}
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Test Scenario Results table: results from replaying scenarios
    CREATE TABLE IF NOT EXISTS test_scenario_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario_id INTEGER NOT NULL,
      messages TEXT NOT NULL,  -- JSON array with AI responses
      tested_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (scenario_id) REFERENCES test_scenarios(id) ON DELETE CASCADE
    );

    -- Create indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_leads_username ON leads(username);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_warmth ON leads(warmth);
    CREATE INDEX IF NOT EXISTS idx_leads_account_id ON leads(account_id);
    CREATE INDEX IF NOT EXISTS idx_comments_lead_id ON comments(lead_id);
    CREATE INDEX IF NOT EXISTS idx_comments_post_url ON comments(post_url);
    CREATE INDEX IF NOT EXISTS idx_posts_url ON posts(post_url);
    CREATE INDEX IF NOT EXISTS idx_posts_account_id ON posts(post_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_lead_id ON conversations(lead_id);
    CREATE INDEX IF NOT EXISTS idx_test_scenario_results_scenario_id ON test_scenario_results(scenario_id);
  `);

  // Run migrations
  runMigrations();

  console.log(`📦 Database initialized: ${dbPath}`);

  return db;
}

/**
 * Run self-healing migrations (add columns if missing in existing DB)
 */
function runMigrations() {
  try {
    const leadsColumns = db.prepare("PRAGMA table_info(leads)").all();
    const hasAccountId = leadsColumns.some(col => col.name === 'account_id');
    if (!hasAccountId) {
      console.log('🔄 Migrating: Adding account_id to leads table...');
      db.exec(`ALTER TABLE leads ADD COLUMN account_id INTEGER REFERENCES accounts(id)`);
    }
    const postsColumns = db.prepare("PRAGMA table_info(posts)").all();
    if (!postsColumns.some(col => col.name === 'account_id')) {
      console.log('🔄 Migrating: Adding account_id to posts table...');
      db.exec(`ALTER TABLE posts ADD COLUMN account_id INTEGER REFERENCES accounts(id)`);
    }

    const accountsColumns = db.prepare("PRAGMA table_info(accounts)").all();
    if (!accountsColumns.some(col => col.name === 'is_default')) {
      console.log('🔄 Migrating: Adding is_default to accounts table...');
      db.exec(`ALTER TABLE accounts ADD COLUMN is_default INTEGER DEFAULT 0`);
    }

    if (!leadsColumns.some(col => col.name === 'last_contact_at')) {
      console.log('🔄 Migrating: Adding last_contact_at to leads table...');
      db.exec(`ALTER TABLE leads ADD COLUMN last_contact_at TEXT`);
    }

    if (!leadsColumns.some(col => col.name === 'conversation_step')) {
      console.log('🔄 Migrating: Adding conversation_step to leads table...');
      db.exec(`ALTER TABLE leads ADD COLUMN conversation_step INTEGER DEFAULT 0`);
    }

    // Re-sync distribution based on message counts (Step 1: Sent > 0, Step 2: Recv = 1, Step 3: Recv > 1)
    console.log('🔄 Migrating: Re-syncing conversation_step distribution...');
    db.exec(`
      UPDATE leads
      SET conversation_step = CASE
        WHEN total_messages_received > 1 THEN 3
        WHEN total_messages_received = 1 THEN 2
        WHEN total_messages_sent > 0 THEN 1
        ELSE 0
      END
      WHERE conversation_step <= 3
    `);

    // Ensure composite unique index exists (Crucial for UPSERT)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_username_account_unique ON leads(username, account_id)`);

    // ---------------------------------------------------------
    // FOLLOW-UP SYSTEM TABLES & MIGRATIONS
    // ---------------------------------------------------------

    // Create Follow-up Templates Table
    db.exec(`
      CREATE TABLE IF NOT EXISTS followup_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_text TEXT NOT NULL,
        step_order INTEGER NOT NULL,  -- 1, 2, 3... controls sequence
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // Create Outreach Queue Table (for harvest/send system)
    db.exec(`
      CREATE TABLE IF NOT EXISTS outreach_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        profile_url TEXT,
        dm_url TEXT,
        prepared_message TEXT NOT NULL,
        first_name TEXT,
        source TEXT,  -- 'follower', 'engagement', 'prospect'
        resource_file TEXT,  -- Optional file path for CTA
        resource_url TEXT,   -- Optional URL for CTA
        status TEXT DEFAULT 'pending',  -- 'pending', 'sent', 'failed'
        created_at TEXT DEFAULT (datetime('now')),
        sent_at TEXT,
        error TEXT
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_outreach_queue_status ON outreach_queue(status);`);

    // Migration: Add last_followup_template_id to leads
    if (!leadsColumns.some(col => col.name === 'last_followup_template_id')) {
      console.log('🔄 Migrating: Adding last_followup_template_id to leads table...');
      db.exec(`ALTER TABLE leads ADD COLUMN last_followup_template_id INTEGER REFERENCES followup_templates(id)`);
    }

    if (!leadsColumns.some(col => col.name === 'first_name')) {
      console.log('🔄 Migrating: Adding first_name to leads table...');
      db.exec(`ALTER TABLE leads ADD COLUMN first_name TEXT`);
    }

    const queueColumns = db.prepare("PRAGMA table_info(outreach_queue)").all();
    if (!queueColumns.some(col => col.name === 'first_name')) {
      console.log('🔄 Migrating: Adding first_name to outreach_queue table...');
      db.exec(`ALTER TABLE outreach_queue ADD COLUMN first_name TEXT`);
    }

    // Seed default templates if empty
    const templateCount = db.prepare('SELECT COUNT(*) as count FROM followup_templates').get().count;
    if (templateCount === 0) {
      console.log('🌱 Seeding default follow-up templates...');
      const defaultTemplates = [
        { order: 1, text: "Coucou {{firstName}} 🌸 Je me permets de te relancer tout doucement — parfois les messages se perdent dans la boîte Instagram 😅 Prends ton temps pour répondre bien sûr, je voulais juste m'assurer que tu l'avais bien vu 🌷" },
        { order: 2, text: "Hello {{firstName}} 💫 J'espère que ta semaine se passe bien 🌺 Je repensais à notre échange... Tu as eu un peu de temps pour y repenser ? 💛" },
        { order: 3, text: "Hello {{firstName}} 🌷 Tu veux qu'on regarde ensemble un moment pour ton petit appel de 30 min cette semaine ? J'ai encore quelques créneaux, dis-moi ce qui t'arrange le mieux 🌸" },
        { order: 4, text: "Coucou {{firstName}} ! Juste un petit message pour ne pas perdre le fil 😊 Si tu n'es plus intéressée ou si ce n'est pas le bon moment, dis-le moi simplement, je ne veux pas t'embêter ! Belle journée ☀️" },
        { order: 5, text: "Un dernier petit coucou {{firstName}} 👋 Je suppose que tu es très occupée ! Je ne vais pas insister davantage, mais ma porte reste ouverte si tu veux reprendre notre échange plus tard. Prends soin de toi 🌺" }
      ];

      const insertTpl = db.prepare('INSERT INTO followup_templates (step_order, template_text) VALUES (@order, @text)');
      for (const tpl of defaultTemplates) {
        insertTpl.run(tpl);
      }
    }

  } catch (err) {
    console.error('⚠️ Migration check failed:', err.message);
  }
}

/**
 * Get the database instance (initialize if needed)
 */
export async function getDatabase(dbPath = DEFAULT_DB_PATH) {
  if (!db) {
    await initDatabase(dbPath);
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
