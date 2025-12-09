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
  
  // Create tables
  db.exec(`
    -- Leads table: one row per unique Instagram user
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      full_name TEXT,
      profile_url TEXT,
      
      -- Profile data (from scraping)
      followers_count INTEGER,
      following_count INTEGER,
      posts_count INTEGER,
      is_verified INTEGER DEFAULT 0,
      is_business INTEGER DEFAULT 0,
      is_private INTEGER DEFAULT 0,
      bio TEXT,
      external_url TEXT,
      profile_scraped_at TEXT,
      
      -- Engagement metrics (calculated)
      total_comments INTEGER DEFAULT 0,
      engagement_score INTEGER DEFAULT 0,
      engagement_level TEXT DEFAULT 'LOW',
      avg_comment_quality REAL DEFAULT 0,
      
      -- Outreach status
      status TEXT DEFAULT 'new',  -- new, contacted, replied, qualified, converted, rejected
      first_message_sent_at TEXT,
      last_contact_at TEXT,
      
      -- Conversation tracking
      conversation_stage TEXT DEFAULT 'none',  -- none, initial, rapport, qualifying, pitching, closing
      total_messages_sent INTEGER DEFAULT 0,
      total_messages_received INTEGER DEFAULT 0,
      
      -- Lead qualification
      warmth TEXT DEFAULT 'cold',  -- cold, warm, hot
      pain_points TEXT,  -- JSON array
      goals TEXT,  -- JSON array
      objections TEXT,  -- JSON array
      notes TEXT,
      
      -- Timestamps
      first_seen_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
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
    
    -- Conversation threads table: stores DM URLs and metadata
    CREATE TABLE IF NOT EXISTS dm_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      dm_url TEXT,
      last_message_preview TEXT,
      last_status TEXT,
      typed_at TEXT,
      last_reply_at TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(lead_id),
      UNIQUE(username)
    );
    
    -- Create indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_leads_username ON leads(username);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_engagement ON leads(engagement_level);
    CREATE INDEX IF NOT EXISTS idx_leads_warmth ON leads(warmth);
    CREATE INDEX IF NOT EXISTS idx_comments_lead_id ON comments(lead_id);
    CREATE INDEX IF NOT EXISTS idx_comments_post_url ON comments(post_url);
    CREATE INDEX IF NOT EXISTS idx_posts_url ON posts(post_url);
    CREATE INDEX IF NOT EXISTS idx_conversations_lead_id ON conversations(lead_id);
    CREATE INDEX IF NOT EXISTS idx_dm_threads_status ON dm_threads(last_status);
    CREATE INDEX IF NOT EXISTS idx_dm_threads_username ON dm_threads(username);
  `);
  
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
// LEAD OPERATIONS
// ============================================

/**
 * Insert or update a lead
 * 
 * @param {Object} lead - Lead data
 * @returns {Object} Inserted/updated lead with id
 */
export function upsertLead(lead) {
  const stmt = db.prepare(`
    INSERT INTO leads (
      username, full_name, profile_url,
      followers_count, following_count, posts_count,
      is_verified, is_business, is_private,
      bio, external_url, profile_scraped_at,
      last_seen_at, updated_at
    ) VALUES (
      @username, @full_name, @profile_url,
      @followers_count, @following_count, @posts_count,
      @is_verified, @is_business, @is_private,
      @bio, @external_url, @profile_scraped_at,
      datetime('now'), datetime('now')
    )
    ON CONFLICT(username) DO UPDATE SET
      full_name = COALESCE(@full_name, full_name),
      profile_url = COALESCE(@profile_url, profile_url),
      followers_count = COALESCE(@followers_count, followers_count),
      following_count = COALESCE(@following_count, following_count),
      posts_count = COALESCE(@posts_count, posts_count),
      is_verified = COALESCE(@is_verified, is_verified),
      is_business = COALESCE(@is_business, is_business),
      is_private = COALESCE(@is_private, is_private),
      bio = COALESCE(@bio, bio),
      external_url = COALESCE(@external_url, external_url),
      profile_scraped_at = COALESCE(@profile_scraped_at, profile_scraped_at),
      last_seen_at = datetime('now'),
      updated_at = datetime('now')
    RETURNING *
  `);
  
  return stmt.get({
    username: lead.username,
    full_name: lead.full_name || null,
    profile_url: lead.profile_url || null,
    followers_count: lead.followers_count || null,
    following_count: lead.following_count || null,
    posts_count: lead.posts_count || null,
    is_verified: lead.is_verified ? 1 : 0,
    is_business: lead.is_business ? 1 : 0,
    is_private: lead.is_private ? 1 : 0,
    bio: lead.bio || null,
    external_url: lead.external_url || null,
    profile_scraped_at: lead.profile_scraped_at || null
  });
}

/**
 * Get a lead by username
 */
export function getLeadByUsername(username) {
  return db.prepare('SELECT * FROM leads WHERE username = ?').get(username);
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
  
  if (filters.status) {
    query += ' AND status = @status';
    params.status = filters.status;
  }
  
  if (filters.engagement_level) {
    query += ' AND engagement_level = @engagement_level';
    params.engagement_level = filters.engagement_level;
  }
  
  if (filters.warmth) {
    query += ' AND warmth = @warmth';
    params.warmth = filters.warmth;
  }
  
  if (filters.min_engagement_score) {
    query += ' AND engagement_score >= @min_engagement_score';
    params.min_engagement_score = filters.min_engagement_score;
  }
  
  query += ' ORDER BY engagement_score DESC, last_seen_at DESC';
  
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
      engagement_level = @engagement_level,
      avg_comment_quality = @avg_comment_quality,
      updated_at = datetime('now')
    WHERE username = @username
  `);
  
  return stmt.run({
    username,
    total_comments: metrics.total_comments,
    engagement_score: metrics.engagement_score,
    engagement_level: metrics.engagement_level,
    avg_comment_quality: metrics.avg_comment_quality
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
      followers_count = @followers_count,
      following_count = @following_count,
      posts_count = @posts_count,
      is_verified = @is_verified,
      is_business = @is_business,
      is_private = @is_private,
      bio = @bio,
      external_url = @external_url,
      full_name = @full_name,
      profile_scraped_at = datetime('now'),
      updated_at = datetime('now')
    WHERE username = @username
  `);
  
  return stmt.run({
    username,
    followers_count: profileData.followers_count,
    following_count: profileData.following_count,
    posts_count: profileData.posts_count,
    is_verified: profileData.is_verified ? 1 : 0,
    is_business: profileData.is_business ? 1 : 0,
    is_private: profileData.is_private ? 1 : 0,
    bio: profileData.bio || null,
    external_url: profileData.external_url || null,
    full_name: profileData.full_name || null
  });
}

// ============================================
// COMMENT OPERATIONS
// ============================================

/**
 * Insert a comment (check for duplicates)
 * 
 * @param {Object} comment - Comment data
 * @returns {Object|null} Inserted comment or null if duplicate
 */
export function insertComment(comment) {
  // Get or create lead
  let lead = getLeadByUsername(comment.username);
  if (!lead) {
    lead = upsertLead({
      username: comment.username,
      full_name: comment.full_name,
      profile_url: comment.profile_url
    });
  }
  
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
  let query = 'SELECT c.*, l.full_name, l.followers_count FROM comments c JOIN leads l ON c.lead_id = l.id WHERE 1=1';
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
export function insertCommentsBatch(comments) {
  const inserted = [];
  const skipped = [];
  
  const insertMany = db.transaction((comments) => {
    for (const comment of comments) {
      const result = insertComment(comment);
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
        last_contact_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(leadId);
  } else {
    db.prepare(`
      UPDATE leads SET 
        total_messages_received = total_messages_received + 1,
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
// DM THREAD OPERATIONS
// ============================================

export function upsertDmThread(thread) {
  if (!thread || !thread.username) {
    throw new Error('Username is required to upsert DM thread');
  }
  let lead = getLeadByUsername(thread.username);
  if (!lead) {
    lead = upsertLead({
      username: thread.username,
      profile_url: thread.profile_url || `https://www.instagram.com/${thread.username}/`
    });
  }
  const stmt = db.prepare(`
    INSERT INTO dm_threads (
      lead_id, username, dm_url, last_message_preview, last_status, typed_at, metadata
    ) VALUES (
      @lead_id, @username, @dm_url, @last_message_preview, @last_status, @typed_at, @metadata
    )
    ON CONFLICT(lead_id) DO UPDATE SET
      dm_url = COALESCE(@dm_url, dm_url),
      last_message_preview = COALESCE(@last_message_preview, last_message_preview),
      last_status = COALESCE(@last_status, last_status),
      typed_at = COALESCE(@typed_at, typed_at),
      metadata = COALESCE(@metadata, metadata),
      updated_at = datetime('now')
    RETURNING *
  `);
  const metadataValue = thread.metadata === undefined
    ? null
    : (typeof thread.metadata === 'string' ? thread.metadata : JSON.stringify(thread.metadata));
  return stmt.get({
    lead_id: lead.id,
    username: thread.username,
    dm_url: thread.dm_url || null,
    last_message_preview: thread.last_message_preview || null,
    last_status: thread.last_status || null,
    typed_at: thread.typed_at || null,
    metadata: metadataValue
  });
}

export function updateDmThreadStatus(username, status, updates = {}) {
  if (!username) {
    throw new Error('Username is required to update DM thread status');
  }
  const stmt = db.prepare(`
    UPDATE dm_threads SET
      last_status = COALESCE(@last_status, last_status),
      last_reply_at = COALESCE(@last_reply_at, last_reply_at),
      metadata = COALESCE(@metadata, metadata),
      updated_at = datetime('now')
    WHERE username = @username
  `);
  const metadataValue = updates.metadata === undefined
    ? null
    : (typeof updates.metadata === 'string' ? updates.metadata : JSON.stringify(updates.metadata));
  return stmt.run({
    username,
    last_status: status || null,
    last_reply_at: updates.last_reply_at || null,
    metadata: metadataValue
  });
}

export function getDmThreadByUsername(username) {
  return db.prepare('SELECT * FROM dm_threads WHERE username = ?').get(username);
}

export function getDmThreads(filters = {}) {
  let query = `
    SELECT dt.*, l.status as lead_status, l.conversation_stage, l.total_messages_sent, l.total_messages_received
    FROM dm_threads dt
    JOIN leads l ON dt.lead_id = l.id
    WHERE 1=1
  `;
  const params = [];
  if (filters.statuses && filters.statuses.length > 0) {
    const placeholders = filters.statuses.map(() => '?').join(',');
    query += ` AND dt.last_status IN (${placeholders})`;
    params.push(...filters.statuses);
  }
  if (filters.onlyWithUrl) {
    query += " AND dt.dm_url IS NOT NULL AND dt.dm_url <> ''";
  }
  if (filters.username) {
    query += ' AND dt.username = ?';
    params.push(filters.username);
  }
  query += ' ORDER BY dt.updated_at DESC';
  if (filters.limit) {
    query += ' LIMIT ?';
    params.push(filters.limit);
  }
  return db.prepare(query).all(...params);
}

// ============================================
// STATISTICS
// ============================================

/**
 * Get database statistics
 */
export function getStats() {
  const stats = {};
  
  stats.total_leads = db.prepare('SELECT COUNT(*) as count FROM leads').get().count;
  stats.total_comments = db.prepare('SELECT COUNT(*) as count FROM comments').get().count;
  stats.total_posts = db.prepare('SELECT COUNT(*) as count FROM posts').get().count;
  stats.spam_comments = db.prepare('SELECT COUNT(*) as count FROM comments WHERE is_spam = 1').get().count;
  
  stats.leads_by_status = db.prepare(`
    SELECT status, COUNT(*) as count 
    FROM leads 
    GROUP BY status
  `).all();
  
  stats.leads_by_engagement = db.prepare(`
    SELECT engagement_level, COUNT(*) as count 
    FROM leads 
    GROUP BY engagement_level
  `).all();
  
  stats.comments_by_source = db.prepare(`
    SELECT source, COUNT(*) as count 
    FROM comments 
    GROUP BY source
  `).all();
  
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
      engagement_level: 'LOW',
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
