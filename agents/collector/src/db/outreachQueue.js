/**
 * Outreach Queue Database Module
 *
 * Handles outreach queue operations for the harvest/send system.
 */

import { getDb } from './core.js';

/**
 * Add a lead to the outreach queue
 * @param {Object} lead - Lead data with username, profile_url, dm_url, prepared_message, source, resource_file, resource_url
 * @returns {Object} Inserted row or null if duplicate
 */
export function addToOutreachQueue(lead) {
  const db = getDb();
  try {
    const stmt = db.prepare(`
      INSERT INTO outreach_queue (
        username, profile_url, dm_url, prepared_message,
        first_name, source, resource_file, resource_url, account_id
      ) VALUES (
        @username, @profile_url, @dm_url, @prepared_message,
        @first_name, @source, @resource_file, @resource_url, @account_id
      )
      ON CONFLICT(username) DO UPDATE SET
        status = 'pending',
        prepared_message = @prepared_message,
        first_name = COALESCE(@first_name, first_name),
        source = @source,
        resource_file = COALESCE(@resource_file, resource_file),
        resource_url = COALESCE(@resource_url, resource_url),
        account_id = COALESCE(@account_id, account_id),
        error = NULL,
        sent_at = NULL,
        created_at = datetime('now')
      WHERE status = 'failed'
    `);
    const info = stmt.run({
      username: lead.username,
      profile_url: lead.profile_url || null,
      dm_url: lead.dm_url || null,
      prepared_message: lead.prepared_message,
      first_name: lead.first_name || null,
      source: lead.source || null,
      resource_file: lead.resource_file || null,
      resource_url: lead.resource_url || null,
      account_id: lead.account_id || null
    });
    return info.changes > 0 ? { id: info.lastInsertRowid, ...lead } : null;
  } catch (err) {
    console.error('❌ Error adding to outreach queue:', err.message);
    return null;
  }
}

/**
 * Get queued leads (pending status, oldest first)
 * @param {number} limit - Max number to fetch
 * @returns {Array} List of queued leads
 */
export function getQueuedLeads(limit = 5, accountId = null) {
  const db = getDb();
  if (accountId) {
    return db.prepare(`
      SELECT * FROM outreach_queue
      WHERE status = 'pending' AND account_id = ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(accountId, limit);
  }
  return db.prepare(`
    SELECT * FROM outreach_queue
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit);
}

/**
 * Mark a queued lead as sent
 * @param {string} username
 */
export function markQueuedLeadSent(username) {
  const db = getDb();
  return db.prepare(`
    UPDATE outreach_queue
    SET status = 'sent', sent_at = datetime('now')
    WHERE username = ?
  `).run(username);
}

/**
 * Mark a queued lead as failed
 * @param {string} username
 * @param {string} error - Error message
 */
export function markQueuedLeadFailed(username, error) {
  const db = getDb();
  return db.prepare(`
    UPDATE outreach_queue
    SET status = 'failed', error = ?
    WHERE username = ?
  `).run(error, username);
}

/**
 * Get count of pending leads in queue
 * @returns {number}
 */
export function getQueueCount(accountId = null) {
  const db = getDb();
  if (accountId) {
    const result = db.prepare(`SELECT COUNT(*) as count FROM outreach_queue WHERE status = 'pending' AND account_id = ?`).get(accountId);
    return result ? result.count : 0;
  }
  const result = db.prepare(`SELECT COUNT(*) as count FROM outreach_queue WHERE status = 'pending'`).get();
  return result ? result.count : 0;
}

/**
 * Clear old entries from queue (e.g., sent/failed older than X days)
 * @param {number} days - Age threshold
 */
export function cleanupOutreachQueue(days = 7) {
  const db = getDb();
  return db.prepare(`
    DELETE FROM outreach_queue
    WHERE status IN ('sent', 'failed') AND created_at < datetime('now', '-' || ? || ' days')
  `).run(days);
}
