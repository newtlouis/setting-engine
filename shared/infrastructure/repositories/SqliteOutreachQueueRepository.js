/**
 * SQLite OutreachQueue Repository
 *
 * Implements IOutreachQueueRepository using the existing SQLite database.
 * Wraps db/outreachQueue.js functions.
 */

import { createOutreachQueueRepository } from '../../application/ports/IOutreachQueueRepository.js';

/**
 * Create SQLite OutreachQueue Repository
 *
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getDb - Function to get database instance
 * @returns {Object} Repository implementation
 */
export function createSqliteOutreachQueueRepository({ getDb }) {
  const implementation = {
    async add(entry) {
      const db = getDb();
      try {
        const stmt = db.prepare(`
          INSERT INTO outreach_queue (
            username, profile_url, dm_url, prepared_message,
            first_name, source, resource_file, resource_url, status
          ) VALUES (
            @username, @profileUrl, @dmUrl, @preparedMessage,
            @firstName, @source, @resourceFile, @resourceUrl, 'pending'
          )
          ON CONFLICT(username) DO UPDATE SET
            status = 'pending',
            prepared_message = @preparedMessage,
            first_name = COALESCE(@firstName, first_name),
            source = @source,
            resource_file = COALESCE(@resourceFile, resource_file),
            resource_url = COALESCE(@resourceUrl, resource_url),
            error = NULL,
            sent_at = NULL,
            created_at = datetime('now')
          WHERE status = 'failed'
          RETURNING *
        `);

        const row = stmt.get({
          username: entry.username,
          profileUrl: entry.profileUrl || null,
          dmUrl: entry.dmUrl || null,
          preparedMessage: entry.preparedMessage,
          firstName: entry.firstName || null,
          source: entry.source || null,
          resourceFile: entry.resourceFile || null,
          resourceUrl: entry.resourceUrl || null
        });

        return row || null;
      } catch (err) {
        console.error('Error adding to outreach queue:', err.message);
        return null;
      }
    },

    async addMany(entries) {
      let count = 0;
      for (const entry of entries) {
        const result = await this.add(entry);
        if (result) count++;
      }
      return count;
    },

    async getPending(limit = 10) {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM outreach_queue
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT ?
      `).all(limit);

      return rows.map(row => ({
        id: row.id,
        username: row.username,
        profileUrl: row.profile_url,
        dmUrl: row.dm_url,
        preparedMessage: row.prepared_message,
        firstName: row.first_name,
        source: row.source,
        status: row.status,
        resourceFile: row.resource_file,
        resourceUrl: row.resource_url,
        createdAt: row.created_at
      }));
    },

    async markSent(username) {
      const db = getDb();
      const result = db.prepare(`
        UPDATE outreach_queue
        SET status = 'sent', sent_at = datetime('now')
        WHERE username = ?
      `).run(username);

      return result.changes > 0;
    },

    async markFailed(username, error) {
      const db = getDb();
      const result = db.prepare(`
        UPDATE outreach_queue
        SET status = 'failed', error = ?
        WHERE username = ?
      `).run(error, username);

      return result.changes > 0;
    },

    async incrementRetry(username, error, maxRetries = 3) {
      const db = getDb();

      // Get current retry count
      const row = db.prepare(`SELECT retry_count FROM outreach_queue WHERE username = ?`).get(username);
      const currentRetries = (row?.retry_count || 0) + 1;

      if (currentRetries >= maxRetries) {
        // Max retries reached — mark as failed
        console.log(`   ⛔ Max retries (${maxRetries}) reached for @${username}`);
        return this.markFailed(username, `${error} (after ${currentRetries} retries)`);
      }

      // Increment retry count, keep status pending
      const result = db.prepare(`
        UPDATE outreach_queue
        SET retry_count = ?, error = ?
        WHERE username = ?
      `).run(currentRetries, error, username);

      console.log(`   🔄 Retry ${currentRetries}/${maxRetries} scheduled for @${username}`);
      return result.changes > 0;
    },

    async exists(username) {
      const db = getDb();
      const row = db.prepare(`
        SELECT 1 FROM outreach_queue
        WHERE username = ? AND status = 'pending'
      `).get(username);

      return !!row;
    },

    async getStats() {
      const db = getDb();

      const pending = db.prepare(`
        SELECT COUNT(*) as count FROM outreach_queue WHERE status = 'pending'
      `).get();

      const sent = db.prepare(`
        SELECT COUNT(*) as count FROM outreach_queue WHERE status = 'sent'
      `).get();

      const failed = db.prepare(`
        SELECT COUNT(*) as count FROM outreach_queue WHERE status = 'failed'
      `).get();

      return {
        pending: pending?.count || 0,
        sent: sent?.count || 0,
        failed: failed?.count || 0
      };
    },

    async clearOld(daysOld = 7) {
      const db = getDb();
      const result = db.prepare(`
        DELETE FROM outreach_queue
        WHERE status IN ('sent', 'failed')
          AND created_at < datetime('now', '-' || ? || ' days')
      `).run(daysOld);

      return result.changes;
    }
  };

  return createOutreachQueueRepository(implementation);
}

export default createSqliteOutreachQueueRepository;
