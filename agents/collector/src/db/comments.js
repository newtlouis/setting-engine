/**
 * Comments Database Module
 *
 * Handles all comment-related database operations.
 */

import { getDb } from './core.js';
import { upsertLead } from './leads.js';

/**
 * Insert a comment (check for duplicates)
 *
 * @param {Object} comment - Comment data
 * @returns {Object|null} Inserted comment or null if duplicate
 */
export function insertComment(comment, forcedAccountId = null) {
  const db = getDb();
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
  const db = getDb();
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
  const db = getDb();
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
  const db = getDb();
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
