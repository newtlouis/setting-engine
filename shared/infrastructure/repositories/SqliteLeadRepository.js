/**
 * SQLite Lead Repository
 *
 * Implements ILeadRepository using the existing SQLite database.
 * Wraps db/leads.js functions and returns domain entities.
 */

import { Lead } from '../../domain/entities/Lead.js';
import { LeadStatus } from '../../domain/value-objects/LeadStatus.js';
import { createLeadRepository } from '../../application/ports/ILeadRepository.js';

/**
 * Create SQLite Lead Repository
 *
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getDb - Function to get database instance
 * @returns {Object} Repository implementation
 */
export function createSqliteLeadRepository({ getDb }) {
  const implementation = {
    async findById(id) {
      const db = getDb();
      const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
      return row ? Lead.fromDbRow(row) : null;
    },

    async findByUsername(username, accountId = null) {
      const db = getDb();
      let query = 'SELECT * FROM leads WHERE username = ?';
      const params = [username];

      if (accountId) {
        query += ' AND account_id = ?';
        params.push(accountId);
      }

      const row = db.prepare(query).get(...params);
      return row ? Lead.fromDbRow(row) : null;
    },

    async findAll(filters = {}) {
      const db = getDb();
      let query = 'SELECT * FROM leads WHERE 1=1';
      const params = {};

      if (filters.accountId) {
        query += ' AND account_id = @accountId';
        params.accountId = filters.accountId;
      }

      if (filters.status) {
        query += ' AND status = @status';
        params.status = filters.status;
      }

      if (filters.warmth) {
        query += ' AND warmth = @warmth';
        params.warmth = filters.warmth;
      }

      if (filters.minEngagementScore) {
        query += ' AND engagement_score >= @minEngagementScore';
        params.minEngagementScore = filters.minEngagementScore;
      }

      if (filters.includeIgnored !== true) {
        query += ' AND is_ignored = 0';
      }

      query += ' ORDER BY engagement_score DESC, updated_at DESC';

      if (filters.limit) {
        query += ' LIMIT @limit';
        params.limit = filters.limit;
      }

      const rows = db.prepare(query).all(params);
      return rows.map(row => Lead.fromDbRow(row));
    },

    async findForOutreach(accountId, limit = 50) {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM leads
        WHERE account_id = ?
          AND status = 'new'
          AND is_ignored = 0
        ORDER BY engagement_score DESC, updated_at DESC
        LIMIT ?
      `).all(accountId, limit);

      return rows.map(row => Lead.fromDbRow(row));
    },

    async findNeedingFollowUp(accountId, limit = 20) {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM leads
        WHERE account_id = ?
          AND status = 'contacted'
          AND is_ignored = 0
          AND total_messages_received = 0
          AND funnel_step = 1
        ORDER BY last_contact_at ASC
        LIMIT ?
      `).all(accountId, limit);

      return rows.map(row => Lead.fromDbRow(row));
    },

    async save(lead) {
      const db = getDb();
      const data = lead.toDbRow();

      if (lead.id) {
        // Update existing
        const stmt = db.prepare(`
          UPDATE leads SET
            username = @username,
            account_id = @account_id,
            full_name = @full_name,
            first_name = @first_name,
            bio = @bio,
            email = @email,
            profile_url = @profile_url,
            dm_url = @dm_url,
            status = @status,
            warmth = @warmth,
            is_ignored = @is_ignored,
            engagement_score = @engagement_score,
            total_comments = @total_comments,
            total_messages_sent = @total_messages_sent,
            total_messages_received = @total_messages_received,
            conversation_step = @conversation_step,
            funnel_step = @funnel_step,
            last_followup_template_id = @last_followup_template_id,
            last_contact_at = @last_contact_at,
            lead_source = @lead_source,
            lead_type = @lead_type,
            booking_status = @booking_status,
            pain_points = @pain_points,
            notes = @notes,
            updated_at = datetime('now')
          WHERE id = @id
        `);
        stmt.run(data);
        return lead;
      } else {
        // Insert new
        const stmt = db.prepare(`
          INSERT INTO leads (
            username, account_id, full_name, first_name, bio, email,
            profile_url, dm_url, status, warmth, is_ignored,
            engagement_score, total_comments, total_messages_sent,
            total_messages_received, conversation_step, funnel_step,
            last_followup_template_id, last_contact_at, lead_source,
            lead_type, booking_status, pain_points, notes
          ) VALUES (
            @username, @account_id, @full_name, @first_name, @bio, @email,
            @profile_url, @dm_url, @status, @warmth, @is_ignored,
            @engagement_score, @total_comments, @total_messages_sent,
            @total_messages_received, @conversation_step, @funnel_step,
            @last_followup_template_id, @last_contact_at, @lead_source,
            @lead_type, @booking_status, @pain_points, @notes
          )
          ON CONFLICT(username, account_id) DO UPDATE SET
            full_name = COALESCE(excluded.full_name, full_name),
            first_name = COALESCE(excluded.first_name, first_name),
            bio = COALESCE(excluded.bio, bio),
            status = excluded.status,
            warmth = excluded.warmth,
            engagement_score = excluded.engagement_score,
            total_comments = excluded.total_comments,
            total_messages_sent = excluded.total_messages_sent,
            total_messages_received = excluded.total_messages_received,
            conversation_step = excluded.conversation_step,
            funnel_step = MAX(funnel_step, excluded.funnel_step),
            updated_at = datetime('now')
          RETURNING *
        `);

        const row = stmt.get(data);
        return Lead.fromDbRow(row);
      }
    },

    async saveMany(leads) {
      const db = getDb();
      let count = 0;

      const transaction = db.transaction(() => {
        for (const lead of leads) {
          this.save(lead);
          count++;
        }
      });

      transaction();
      return count;
    },

    async updateStatus(username, status) {
      const db = getDb();
      const result = db.prepare(`
        UPDATE leads SET
          status = ?,
          updated_at = datetime('now')
        WHERE username = ?
      `).run(status, username);

      return result.changes > 0;
    },

    async updateEngagement(username, metrics) {
      const db = getDb();
      const result = db.prepare(`
        UPDATE leads SET
          total_comments = ?,
          engagement_score = ?,
          updated_at = datetime('now')
        WHERE username = ?
      `).run(metrics.totalComments, metrics.engagementScore, username);

      return result.changes > 0;
    },

    async markContacted(username, dmUrl = null) {
      const db = getDb();
      const result = db.prepare(`
        UPDATE leads SET
          status = 'contacted',
          dm_url = COALESCE(?, dm_url),
          last_contact_at = datetime('now'),
          updated_at = datetime('now')
        WHERE username = ?
      `).run(dmUrl, username);

      return result.changes > 0;
    },

    async markFailed(username, reason) {
      const db = getDb();
      const result = db.prepare(`
        UPDATE leads SET
          status = 'failed',
          notes = ?,
          updated_at = datetime('now')
        WHERE username = ?
      `).run(reason, username);

      return result.changes > 0;
    },

    async ignore(username) {
      const db = getDb();
      const result = db.prepare(`
        UPDATE leads SET
          status = 'ignored',
          is_ignored = 1,
          updated_at = datetime('now')
        WHERE username = ?
      `).run(username);

      return result.changes > 0;
    },

    async countByStatus(accountId) {
      const db = getDb();
      const rows = db.prepare(`
        SELECT status, COUNT(*) as count
        FROM leads
        WHERE account_id = ? AND is_ignored = 0
        GROUP BY status
      `).all(accountId);

      const counts = {};
      for (const row of rows) {
        counts[row.status] = row.count;
      }
      return counts;
    }
  };

  return createLeadRepository(implementation);
}

export default createSqliteLeadRepository;
