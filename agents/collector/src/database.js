/**
 * SQLite Database Module
 * 
 * Central database for all lead data, shared across agents.
 * Uses better-sqlite3 for synchronous, fast operations.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default database path (shared across agents)
const DEFAULT_DB_PATH = path.join(__dirname, '..', 'permanent-data', 'leads.db');

let db = null;

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
  
  // 2. SELF-HEALING MIGRATIONS (Add columns if missing in existing DB)
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

    // Migration: Add last_followup_template_id to leads
    if (!leadsColumns.some(col => col.name === 'last_followup_template_id')) {
      console.log('🔄 Migrating: Adding last_followup_template_id to leads table...');
      db.exec(`ALTER TABLE leads ADD COLUMN last_followup_template_id INTEGER REFERENCES followup_templates(id)`);
    }

    // Seed default templates if empty
    const templateCount = db.prepare('SELECT COUNT(*) as count FROM followup_templates').get().count;
    if (templateCount === 0) {
      console.log('🌱 Seeding default follow-up templates...');
      const defaultTemplates = [
        { order: 1, text: "Coucou {{firstName}} 🌸 Je me permets de te relancer tout doucement — parfois les messages se perdent dans la boîte Instagram 😅 Prends ton temps pour répondre bien sûr, je voulais juste m’assurer que tu l’avais bien vu 🌷" },
        { order: 2, text: "Hello {{firstName}} 💫 J’espère que ta semaine se passe bien 🌺 Je repensais à notre échange... Tu as eu un peu de temps pour y repenser ? 💛" },
        { order: 3, text: "Hello {{firstName}} 🌷 Tu veux qu’on regarde ensemble un moment pour ton petit appel de 30 min cette semaine ? J’ai encore quelques créneaux, dis-moi ce qui t’arrange le mieux 🌸" },
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

  console.log(`📦 Database initialized: ${dbPath}`);
  
  return db;
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

// ============================================
// ACCOUNT OPERATIONS
// ============================================

/**
 * Get or create an account by name
 * @param {string} name - Account/profile name
 * @returns {Object} Account with id
 */
export function getOrCreateAccount(name) {
  if (!name) {
    throw new Error('Account name (profile) is required. Please specify it using the --profile flag.');
  }
  
  const existing = db.prepare('SELECT * FROM accounts WHERE name = ?').get(name);
  if (existing) return existing;
  
  const result = db.prepare(`
    INSERT INTO accounts (name) VALUES (?)
    RETURNING *
  `).get(name);
  
  console.log(`📁 Created new account: ${name} (id: ${result.id})`);
  return result;
}

/**
 * Get all accounts
 * @returns {Array} List of accounts
 */
export function getAllAccounts() {
  return db.prepare('SELECT * FROM accounts ORDER BY name').all();
}

/**
 * Get account by ID
 */
export function getAccountById(id) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

/**
 * Set an account as the default dashboard account
 * @param {number} accountId 
 */
export function setDefaultAccount(accountId) {
  const transaction = db.transaction(() => {
    // Reset all
    db.prepare('UPDATE accounts SET is_default = 0').run();
    // Set new default
    if (accountId) {
      db.prepare('UPDATE accounts SET is_default = 1 WHERE id = ?').run(accountId);
    }
  });
  transaction();
  return { success: true };
}

/**
 * Get the default dashboard account
 */
export function getDefaultAccount() {
  return db.prepare('SELECT * FROM accounts WHERE is_default = 1').get();
}

// ============================================
// LEAD OPERATIONS
// ============================================

/**
 * Insert or update a lead
 * 
 * @param {Object} lead - Lead data
 * @returns {Object} Inserted/updated lead with id
 */
export function saveLeads(leadsData) {
  // Prepare bulk insert statement
  const insert = db.prepare(`
    INSERT INTO leads (
      username, profile_url, lead_source, lead_type, account_id, conversation_step, updated_at
    ) VALUES (
      @username, @profile_url, @lead_source, @lead_type, @account_id, @conversation_step, datetime('now')
    )
    ON CONFLICT(username, account_id) DO UPDATE SET
      updated_at = datetime('now')
  `); // Minimal update now since we don't have scraped profile data columns

  const insertComment = db.prepare(`
    INSERT INTO comments (
      lead_id, post_url, comment_text, posted_at, is_owner, is_spam
    ) VALUES (
      @lead_id, @post_url, @comment_text, @posted_at, @is_owner, @is_spam
    )
  `);

  const updateLeadStats = db.prepare(`
    UPDATE leads SET 
      total_comments = (SELECT COUNT(*) FROM comments WHERE lead_id = leads.id AND is_spam = 0),
      warmth = CASE 
        WHEN (SELECT COUNT(*) FROM comments WHERE lead_id = leads.id AND is_spam = 0) >= 3 THEN 'hot'
        WHEN (SELECT COUNT(*) FROM comments WHERE lead_id = leads.id AND is_spam = 0) >= 1 THEN 'warm'
        ELSE 'cold'
      END,
      updated_at = datetime('now')
    WHERE id = ?
  `);

  const insertTransaction = db.transaction((leads) => {
    let newLeads = 0;
    
    for (const lead of leads) {
      if (!lead.username) continue; // Skip invalid

      try {
        // Insert/Update Lead
        insert.run({
          username: lead.username,
          profile_url: lead.profileUrl || `https://instagram.com/${lead.username}`,
          lead_source: lead.source || null, // Allow passing source
          lead_type: lead.type || 'cold',    // Default to cold
          account_id: lead.account_id || null,
          conversation_step: lead.conversation_step || 0
        });
        
        // Get lead ID
        const leadId = db.prepare('SELECT id FROM leads WHERE username = ? AND account_id = ?').get(lead.username, lead.account_id || null).id;
        
        // Insert Comment
        if (lead.comment) {
             insertComment.run({
                lead_id: leadId,
                post_url: lead.postUrl,
                comment_text: lead.comment,
                posted_at: lead.postedAt || new Date().toISOString(),
                is_owner: 0, 
                is_spam: 0   
             });
        }

        // Update Stats
        updateLeadStats.run(leadId);

        newLeads++;
      } catch (err) {
        console.error(`Error saving lead ${lead.username}: ${err.message}`);
      }
    }
    return newLeads;
  });

  return insertTransaction(leadsData);
}

/**
 * Get a lead by username
 */
export function getLeadByUsername(username, account_id = null) {
  let query = 'SELECT * FROM leads WHERE username = ?';
  const params = [username];
  
  if (account_id) {
    query += ' AND account_id = ?';
    params.push(account_id);
  }
  
  return db.prepare(query).get(...params);
}

/**
 * Get a lead by ID
 */
export function getLeadById(id) {
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
}

/**
 * Get all leads with optional filters
 */
export function getLeads(filters = {}) {
  let query = 'SELECT * FROM leads WHERE 1=1';
  const params = {};
  
  // Account filter (REQUIRED for multi-account)
  if (filters.account_id) {
    query += ' AND account_id = @account_id';
    params.account_id = filters.account_id;
  }
  
  if (filters.status) {
    query += ' AND status = @status';
    params.status = filters.status;
  }
  
  if (filters.warmth) {
    query += ' AND warmth = @warmth';
    params.warmth = filters.warmth;
  }
  
  if (filters.min_engagement_score) {
    query += ' AND engagement_score >= @min_engagement_score';
    params.min_engagement_score = filters.min_engagement_score;
  }
  
  // Exclude ignored by default (unless explicitly requested)
  if (filters.include_ignored !== true) {
    query += ' AND is_ignored = 0';
  }
  
  query += ' ORDER BY engagement_score DESC, updated_at DESC';
  
  if (filters.limit) {
    query += ' LIMIT @limit';
    params.limit = filters.limit;
  }
  
  return db.prepare(query).all(params);
}

/**
 * Update lead engagement metrics
 */
export function updateLeadEngagement(username, metrics) {
  const stmt = db.prepare(`
    UPDATE leads SET
      total_comments = @total_comments,
      engagement_score = @engagement_score,
      updated_at = datetime('now')
    WHERE username = @username
  `);
  
  return stmt.run({
    username,
    total_comments: metrics.total_comments,
    engagement_score: metrics.engagement_score
  });
}

/**
 * Update lead status
 */
export function updateLeadStatus(username, status) {
  const stmt = db.prepare(`
    UPDATE leads SET
      status = @status,
      updated_at = datetime('now')
    WHERE username = @username
  `);
  
  return stmt.run({ username, status });
}

/**
 * Update lead profile data
 */
export function updateLeadProfile(username, profileData) {
  const stmt = db.prepare(`
    UPDATE leads SET
      full_name = COALESCE(@full_name, full_name),
      bio = COALESCE(@bio, bio),
      updated_at = datetime('now')
    WHERE username = @username
  `);
  
  return stmt.run({
    username,
    full_name: profileData.full_name || null,
    bio: profileData.bio || null
  });
}

/**
 * Mark a lead as generally uncontactable (e.g. no button)
 * Uses new simplified 'failed' status
 */
export function markLeadUncontactable(username) {
  return db.prepare(`
    UPDATE leads SET
      status = 'failed',
      notes = COALESCE(notes || ' | ', '') || 'Not contactable (no DM button)',
      updated_at = datetime('now')
    WHERE username = ?
  `).run(username);
}

/**
 * Mark a lead as failed (technical error)
 * Uses new simplified 'failed' status
 */
export function markLeadFailed(username, reason) {
  return db.prepare(`
    UPDATE leads SET
      status = 'failed',
      notes = ?,
      updated_at = datetime('now')
    WHERE username = ?
  `).run(reason || 'unknown_error', username);
}

// ============================================
// COMMENT OPERATIONS
// ============================================

/**
 * Internal helper to upsert a singleton lead
 */
function upsertLead(lead) {
  const stmt = db.prepare(`
    INSERT INTO leads (username, profile_url, lead_source, lead_type, account_id, conversation_step, updated_at)
    VALUES (@username, @profile_url, @lead_source, @lead_type, @account_id, @conversation_step, datetime('now'))
    ON CONFLICT(username, account_id) DO UPDATE SET 
      updated_at = datetime('now'),
      lead_source = COALESCE(NULLIF(NULLIF(lead_source, ''), 'unknown'), @lead_source),
      conversation_step = COALESCE(NULLIF(@conversation_step, 0), conversation_step)
    RETURNING *
  `);
  
  return stmt.get({
    username: lead.username,
    profile_url: lead.profile_url || `https://instagram.com/${lead.username}`,
    lead_source: lead.lead_source || null,
    lead_type: lead.lead_type || 'cold',
    account_id: lead.account_id || null,
    conversation_step: lead.conversation_step || 0
  });
}

/**
 * Insert a comment (check for duplicates)
 * 
 * @param {Object} comment - Comment data
 * @returns {Object|null} Inserted comment or null if duplicate
 */
export function insertComment(comment, forcedAccountId = null) {
  // Upsert lead (handles creation or update of last_seen/source)
  const leadSource = comment.source || 'unknown';
  const leadType = 'cold'; 

  const lead = upsertLead({
    username: comment.username,
    profile_url: comment.profile_url,
    lead_source: leadSource,
    lead_type: leadType,
    account_id: forcedAccountId || comment.account_id || null  // Propagate account
  });
  
  // Check for duplicate (same user, same post, similar text)
  const existing = db.prepare(`
    SELECT id FROM comments 
    WHERE lead_id = ? AND post_url = ? AND substr(comment_text, 1, 50) = ?
  `).get(lead.id, comment.post_url, (comment.comment_text || '').substring(0, 50));
  
  if (existing) {
    return null; // Duplicate
  }
  
  // Normalize is_spam (can be boolean, string "true"/"false", or 1/0)
  const isSpam = comment.is_spam === true || comment.is_spam === 'true' || comment.is_spam === 1;
  
  const stmt = db.prepare(`
    INSERT INTO comments (
      lead_id, username, comment_text, comment_date,
      post_url, source, quality_score, is_spam, spam_reason
    ) VALUES (
      @lead_id, @username, @comment_text, @comment_date,
      @post_url, @source, @quality_score, @is_spam, @spam_reason
    )
    RETURNING *
  `);
  
  return stmt.get({
    lead_id: lead.id,
    username: comment.username,
    comment_text: comment.comment_text,
    comment_date: comment.comment_date || null,
    post_url: comment.post_url || null,
    source: comment.source || null,
    quality_score: parseInt(comment.quality_score, 10) || 0,
    is_spam: isSpam ? 1 : 0,
    spam_reason: comment.spam_reason || null
  });
}

/**
 * Get comments for a lead
 */
export function getCommentsForLead(leadId) {
  return db.prepare(`
    SELECT * FROM comments 
    WHERE lead_id = ? 
    ORDER BY comment_date DESC
  `).all(leadId);
}

/**
 * Get all comments with optional filters
 */
export function getComments(filters = {}) {
  let query = 'SELECT c.*, l.full_name FROM comments c JOIN leads l ON c.lead_id = l.id WHERE 1=1';
  const params = {};
  
  if (filters.is_spam !== undefined) {
    query += ' AND c.is_spam = @is_spam';
    params.is_spam = filters.is_spam ? 1 : 0;
  }
  
  if (filters.source) {
    query += ' AND c.source = @source';
    params.source = filters.source;
  }
  
  query += ' ORDER BY c.comment_date DESC';
  
  if (filters.limit) {
    query += ' LIMIT @limit';
    params.limit = filters.limit;
  }
  
  return db.prepare(query).all(params);
}

/**
 * Batch insert comments (with transaction for performance)
 */
export function insertCommentsBatch(comments, accountId = null) {
  const inserted = [];
  const skipped = [];
  
  const insertMany = db.transaction((comments) => {
    for (const comment of comments) {
      const result = insertComment(comment, accountId);
      if (result) {
        inserted.push(result);
      } else {
        skipped.push(comment);
      }
    }
  });
  
  insertMany(comments);
  
  return { inserted, skipped };
}

// ============================================
// POST OPERATIONS
// ============================================

/**
 * Insert or update a post
 */
export function upsertPost(post) {
  const stmt = db.prepare(`
    INSERT INTO posts (
      post_url, source_type, source_name, post_date,
      likes, comments_count, caption_excerpt
    ) VALUES (
      @post_url, @source_type, @source_name, @post_date,
      @likes, @comments_count, @caption_excerpt
    )
    ON CONFLICT(post_url) DO UPDATE SET
      likes = COALESCE(@likes, likes),
      comments_count = COALESCE(@comments_count, comments_count)
    RETURNING *
  `);
  
  return stmt.get({
    post_url: post.post_url,
    source_type: post.source_type || null,
    source_name: post.source_name || null,
    post_date: post.post_date || null,
    likes: post.likes || null,
    comments_count: post.comments_count || null,
    caption_excerpt: post.caption_excerpt || null
  });
}

/**
 * Mark a post as scraped
 */
export function markPostScraped(postUrl) {
  return db.prepare(`
    UPDATE posts SET 
      scraped_at = datetime('now'),
      comments_scraped = 1
    WHERE post_url = ?
  `).run(postUrl);
}

/**
 * Get posts that haven't been scraped
 */
export function getUnscrapedPosts(limit = 50) {
  return db.prepare(`
    SELECT * FROM posts 
    WHERE comments_scraped = 0 
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Check if a post has been scraped
 */
export function isPostScraped(postUrl) {
  const result = db.prepare('SELECT comments_scraped FROM posts WHERE post_url = ?').get(postUrl);
  return result && result.comments_scraped === 1;
}

/**
 * Get posts scraped within the last X hours
 */
export function getRecentlyScrapedPosts(hours = 24) {
  return db.prepare(`
    SELECT post_url FROM posts 
    WHERE scraped_at >= datetime('now', ?)
  `).all(`-${hours} hours`).map(p => p.post_url);
}

// ============================================
// CONVERSATION OPERATIONS
// ============================================

/**
 * Add a message to conversation
 */
export function addConversationMessage(leadId, role, messageText, messageType = null) {
  const stmt = db.prepare(`
    INSERT INTO conversations (lead_id, role, message_text, message_type)
    VALUES (?, ?, ?, ?)
    RETURNING *
  `);
  
  const result = stmt.get(leadId, role, messageText, messageType);
  
  // Update lead message counts
  if (role === 'assistant') {
    db.prepare(`
      UPDATE leads SET 
        total_messages_sent = total_messages_sent + 1,
        conversation_step = CASE WHEN conversation_step = 0 THEN 1 ELSE conversation_step END,
        last_contact_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(leadId);
  } else {
    db.prepare(`
      UPDATE leads SET 
        total_messages_received = total_messages_received + 1,
        conversation_step = CASE 
          WHEN (total_messages_received + 1) = 1 AND conversation_step < 2 THEN 2
          WHEN (total_messages_received + 1) > 1 AND conversation_step < 3 THEN 3
          ELSE conversation_step
        END,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(leadId);
  }
  
  return result;
}

/**
 * Get conversation history for a lead
 */
export function getConversation(leadId) {
  return db.prepare(`
    SELECT * FROM conversations 
    WHERE lead_id = ? 
    ORDER BY sent_at ASC
  `).all(leadId);
}

// ============================================
// LEAD STATUS & DM URL OPERATIONS
// ============================================

/**
 * Update lead status with optional dm_url for Outreach
 */
export function updateLeadDmStatus(username, status, dmUrl = null) {
  if (!username) {
    throw new Error('Username is required');
  }
  const stmt = db.prepare(`
    UPDATE leads SET
      status = COALESCE(@status, status),
      dm_url = COALESCE(@dm_url, dm_url),
      last_contact_at = datetime('now'),
      updated_at = datetime('now')
    WHERE username = @username
  `);
  return stmt.run({
    username,
    status: status || null,
    dm_url: dmUrl
  });
}

/**
 * Higher-level update for DM Responder
 * Supports status, notes, and metadata
 */
export function updateDmThreadStatus(username, status, updates = {}) {
  const notes = updates.last_error || updates.notes || null;
  const conversationStep = updates.conversation_step;
  
  const stmt = db.prepare(`
    UPDATE leads SET
      status = @status,
      notes = COALESCE(@notes, notes),
      conversation_step = COALESCE(@conversation_step, conversation_step),
      updated_at = datetime('now')
    WHERE username = @username
  `);
  
  return stmt.run({
    username,
    status,
    notes,
    conversation_step: conversationStep !== undefined ? conversationStep : null
  });
}

/**
 * Full UPSERT for a lead with metadata
 */
export function fullUpsertLead(username, account_id, data = {}) {
  const stmt = db.prepare(`
    INSERT INTO leads (
      username, account_id, profile_url, status, 
      full_name, bio, dm_url, lead_source, conversation_step, notes, updated_at
    ) VALUES (
      @username, @account_id, @profile_url, @status,
      @full_name, @bio, @dm_url, @lead_source, @conversation_step, @notes, datetime('now')
    )
    ON CONFLICT(username, account_id) DO UPDATE SET
      status = COALESCE(@status, status),
      full_name = COALESCE(@full_name, full_name),
      bio = COALESCE(@bio, bio),
      dm_url = COALESCE(@dm_url, dm_url),
      lead_source = COALESCE(lead_source, @lead_source),
      conversation_step = COALESCE(NULLIF(@conversation_step, 0), conversation_step),
      notes = COALESCE(@notes, notes),
      updated_at = datetime('now')
    RETURNING *
  `);

  return stmt.get({
    username,
    account_id,
    profile_url: data.profile_url || `https://www.instagram.com/${username}/`,
    status: data.status || 'new',
    full_name: data.full_name || null,
    bio: data.bio || null,
    dm_url: data.dm_url || null,
    lead_source: data.lead_source || null,
    conversation_step: data.conversation_step || 0,
    notes: data.notes || null
  });
}

/**
 * Get leads for DM Responder (replaces getDmThreads)
 * Filters by status and requires dm_url
 */
export function getLeadsForResponder(filters = {}) {
  let query = `
    SELECT *
    FROM leads
    WHERE is_ignored = 0
  `;
  const params = [];

  // Account filter (REQUIRED for multi-account)
  const accountId = filters.account_id || filters.accountId;
  if (accountId) {
    query += ' AND account_id = ?';
    params.push(accountId);
  }
  
  if (filters.statuses && filters.statuses.length > 0) {
    const placeholders = filters.statuses.map(() => '?').join(',');
    query += ` AND status IN (${placeholders})`;
    params.push(...filters.statuses);
  }
  
  if (filters.onlyWithUrl) {
    query += " AND dm_url IS NOT NULL AND dm_url <> ''";
  }
  
  if (filters.username) {
    query += ' AND username = ?';
    params.push(filters.username);
  }
  
  query += ' ORDER BY updated_at DESC';
  
  if (filters.limit) {
    query += ' LIMIT ?';
    params.push(filters.limit);
  }
  
  return db.prepare(query).all(...params);
}

// Deprecated functions removed


// ============================================
// STATISTICS
// ============================================

/**
 * Get database statistics
 */
export function getStats(accountId = null) {
  const stats = {};
  const accountFilter = accountId ? ' WHERE account_id = ?' : '';
  const accountParam = accountId ? [accountId] : [];
  
  stats.total_leads = db.prepare('SELECT COUNT(*) as count FROM leads' + accountFilter).get(...accountParam).count;
  stats.total_comments = db.prepare(`
    SELECT COUNT(*) as count FROM comments c
    JOIN leads l ON c.lead_id = l.id
    ${accountId ? 'WHERE l.account_id = ?' : ''}
  `).get(...accountParam).count;
  stats.total_posts = db.prepare('SELECT COUNT(*) as count FROM posts' + accountFilter).get(...accountParam).count;
  stats.spam_comments = db.prepare(`
    SELECT COUNT(*) as count FROM comments c
    JOIN leads l ON c.lead_id = l.id
    WHERE c.is_spam = 1 ${accountId ? 'AND l.account_id = ?' : ''}
  `).get(...accountParam).count;
  
  stats.leads_by_status = db.prepare(`
    SELECT status, COUNT(*) as count 
    FROM leads 
    ${accountId ? 'WHERE account_id = ?' : ''}
    GROUP BY status
  `).all(...accountParam);
  
  stats.leads_by_engagement = db.prepare(`
    SELECT warmth as level, COUNT(*) as count 
    FROM leads 
    ${accountId ? 'WHERE account_id = ?' : ''}
    GROUP BY warmth
  `).all(...accountParam);
  
  stats.comments_by_source = db.prepare(`
    SELECT c.source, COUNT(*) as count 
    FROM comments c
    JOIN leads l ON c.lead_id = l.id
    ${accountId ? 'WHERE l.account_id = ?' : ''}
    GROUP BY c.source
  `).all(...accountParam);
  
  return stats;
}

/**
 * Recalculate engagement scores for all leads
 */
export function recalculateAllEngagement() {
  const leads = db.prepare('SELECT id, username FROM leads').all();
  
  for (const lead of leads) {
    // Filter out spam comments (is_spam is stored as 1 or 0 in SQLite)
    const allComments = getCommentsForLead(lead.id);
    const nonSpamComments = allComments.filter(c => c.is_spam !== 1 && c.is_spam !== '1');
    const metrics = calculateEngagementMetrics(nonSpamComments);
    updateLeadEngagement(lead.username, metrics);
  }
  
  return leads.length;
}

/**
 * Calculate engagement metrics from comments
 */
function calculateEngagementMetrics(comments) {
  if (!comments || comments.length === 0) {
    return {
      total_comments: 0,
      engagement_score: 0,
      avg_comment_quality: 0
    };
  }
  
  const now = new Date();
  let score = 0;
  let totalQuality = 0;
  
  // Frequency score (0-10)
  score += Math.min(comments.length * 2, 10);
  
  // Recency score (0-15)
  let recentScore = 0;
  for (const comment of comments) {
    const commentDate = new Date(comment.comment_date || 0);
    const daysAgo = (now - commentDate) / (1000 * 60 * 60 * 24);
    
    if (daysAgo < 7) recentScore += 5;
    else if (daysAgo < 30) recentScore += 3;
    else if (daysAgo < 90) recentScore += 1;
    
    totalQuality += comment.quality_score || 0;
  }
  score += Math.min(recentScore, 15);
  
  // Quality score (0-10)
  let qualityScore = 0;
  for (const comment of comments) {
    const text = comment.comment_text || '';
    if (text.length > 100) qualityScore += 3;
    else if (text.length > 50) qualityScore += 2;
    else if (text.length > 20) qualityScore += 1;
  }
  score += Math.min(qualityScore, 10);
  
  // Pattern score (0-10)
  let patternScore = 0;
  for (const comment of comments) {
    const text = comment.comment_text || '';
    if (text.includes('?')) patternScore += 2;
    if (/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/u.test(text)) patternScore += 1;
    if (text.includes('!')) patternScore += 1;
  }
  score += Math.min(patternScore, 10);
  
  // Classification
  let level;
  if (score >= 25) level = 'HIGH';
  else if (score >= 12) level = 'MEDIUM';
  else level = 'LOW';
  
  return {
    total_comments: comments.length,
    engagement_score: score,
    engagement_level: level,
    avg_comment_quality: comments.length > 0 ? totalQuality / comments.length : 0
  };
}

export { calculateEngagementMetrics };

// ============================================
// FOLLOW-UP SYSTEM OPERATIONS
// ============================================

/**
 * Get the next follow-up template for a lead
 * @param {number|null} lastTemplateId - The ID of the last sent template (null if none)
 * @returns {Object|null} The next template or null if end of sequence
 */
export function getNextFollowupTemplate(lastTemplateId) {
  if (!lastTemplateId) {
    // No previous follow-up, get the first one
    return db.prepare('SELECT * FROM followup_templates WHERE is_active = 1 ORDER BY step_order ASC LIMIT 1').get();
  }

  // Get the order of the last template
  const lastTemplate = db.prepare('SELECT step_order FROM followup_templates WHERE id = ?').get(lastTemplateId);
  
  if (!lastTemplate) {
    // If ID not found (e.g. deleted), start from beginning to be safe
    return db.prepare('SELECT * FROM followup_templates WHERE is_active = 1 ORDER BY step_order ASC LIMIT 1').get();
  }

  // Get the next one in sequence
  return db.prepare(`
    SELECT * FROM followup_templates 
    WHERE is_active = 1 AND step_order > ? 
    ORDER BY step_order ASC 
    LIMIT 1
  `).get(lastTemplate.step_order);
}

/**
 * Update the last used follow-up template for a lead
 */
export function updateLeadLastFollowup(username, templateId) {
  return db.prepare(`
    UPDATE leads SET 
      last_followup_template_id = ?,
      updated_at = datetime('now')
    WHERE username = ?
  `).run(templateId, username);
}

/**
 * Get count of follow-ups sent for a specific conversation step
 * 
 * @param {string} username - Instagram username
 * @param {number} step - Step number (2, 3, 4...)
 * @returns {number} Count of follow-ups sent at this step
 */
export function getFollowupCountForStep(username, step) {
  // Get lead ID
  const lead = getLeadByUsername(username);
  if (!lead) return 0;
  
  const result = db.prepare(`
    SELECT COUNT(*) as count 
    FROM conversations 
    WHERE lead_id = ? 
      AND role = 'assistant'
      AND message_type LIKE ?
  `).get(lead.id, `followup_step${step}%`);
  
  return result ? result.count : 0;
}

// ============================================
// TEST SCENARIOS OPERATIONS
// ============================================

/**
 * Create a new test scenario
 * @param {string} name - Scenario name
 * @param {Array} messages - Array of {role, text}
 * @returns {Object} Created scenario
 */
export function createScenario(name, messages) {
  const stmt = db.prepare(`
    INSERT INTO test_scenarios (name, messages)
    VALUES (?, ?)
    RETURNING *
  `);
  return stmt.get(name, JSON.stringify(messages));
}

/**
 * Get all test scenarios
 * @returns {Array} All scenarios
 */
export function getScenarios() {
  const scenarios = db.prepare(`
    SELECT * FROM test_scenarios
    ORDER BY created_at DESC
  `).all();
  
  return scenarios.map(s => ({
    ...s,
    messages: JSON.parse(s.messages)
  }));
}

/**
 * Get a scenario by ID
 * @param {number} id - Scenario ID
 * @returns {Object|null} Scenario
 */
export function getScenarioById(id) {
  const scenario = db.prepare(`
    SELECT * FROM test_scenarios WHERE id = ?
  `).get(id);
  
  if (!scenario) return null;
  
  return {
    ...scenario,
    messages: JSON.parse(scenario.messages)
  };
}

/**
 * Delete a scenario
 * @param {number} id - Scenario ID
 */
export function deleteScenario(id) {
  return db.prepare('DELETE FROM test_scenarios WHERE id = ?').run(id);
}

/**
 * Update a scenario's messages
 * @param {number} id - Scenario ID
 * @param {Array} messages - New message list
 */
export function updateScenario(id, messages) {
  return db.prepare(`
    UPDATE test_scenarios 
    SET messages = ?, created_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(JSON.stringify(messages), id);
}

/**
 * Save scenario test result
 * @param {number} scenarioId - Scenario ID
 * @param {Array} messages - Complete conversation with AI responses
 */
export function saveScenarioResult(scenarioId, messages) {
  const stmt = db.prepare(`
    INSERT INTO test_scenario_results (scenario_id, messages)
    VALUES (?, ?)
    RETURNING *
  `);
  return stmt.get(scenarioId, JSON.stringify(messages));
}

/**
 * Get latest results for a scenario
 * @param {number} scenarioId - Scenario ID
 * @param {number} limit - Number of results to return
 * @returns {Array} Results
 */
export function getScenarioResults(scenarioId, limit = 5) {
  const results = db.prepare(`
    SELECT * FROM test_scenario_results
    WHERE scenario_id = ?
    ORDER BY tested_at DESC
    LIMIT ?
  `).all(scenarioId, limit);
  
  return results.map(r => ({
    ...r,
    messages: JSON.parse(r.messages)
  }));
}
