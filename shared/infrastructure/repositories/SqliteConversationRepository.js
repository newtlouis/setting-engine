/**
 * SQLite Conversation Repository
 *
 * Implements IConversationRepository using the existing SQLite database.
 * Wraps db/conversations.js functions and returns domain entities.
 */

import { Conversation } from '../../domain/entities/Conversation.js';
import { Message, MessageRole } from '../../domain/entities/Message.js';
import { createConversationRepository } from '../../application/ports/IConversationRepository.js';

/**
 * Create SQLite Conversation Repository
 *
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getDb - Function to get database instance
 * @returns {Object} Repository implementation
 */
export function createSqliteConversationRepository({ getDb }) {
  const implementation = {
    async getByLeadId(leadId) {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM conversations
        WHERE lead_id = ?
        ORDER BY sent_at ASC
      `).all(leadId);

      const messages = rows.map(row => Message.fromDbRow(row));
      return new Conversation(leadId, messages);
    },

    async getByUsername(username, accountId = null) {
      const db = getDb();

      // First get lead ID
      let leadQuery = 'SELECT id FROM leads WHERE username = ?';
      const params = [username];

      if (accountId) {
        leadQuery += ' AND account_id = ?';
        params.push(accountId);
      }

      const lead = db.prepare(leadQuery).get(...params);
      if (!lead) return null;

      return this.getByLeadId(lead.id);
    },

    async addMessage(leadId, message) {
      const db = getDb();
      const data = message.toDbRow();

      const stmt = db.prepare(`
        INSERT INTO conversations (lead_id, role, message_text, message_type)
        VALUES (?, ?, ?, ?)
        RETURNING *
      `);

      const row = stmt.get(leadId, data.role, data.message_text, data.message_type);

      // Update lead message counts and funnel_step
      if (message.role === MessageRole.ASSISTANT) {
        db.prepare(`
          UPDATE leads SET
            total_messages_sent = total_messages_sent + 1,
            funnel_step = CASE WHEN funnel_step = 0 THEN 1 ELSE funnel_step END,
            last_contact_at = datetime('now'),
            updated_at = datetime('now')
          WHERE id = ?
        `).run(leadId);
      } else {
        db.prepare(`
          UPDATE leads SET
            total_messages_received = total_messages_received + 1,
            funnel_step = CASE
              WHEN (total_messages_received + 1) = 1 AND funnel_step < 2 THEN 2
              WHEN (total_messages_received + 1) > 1 AND funnel_step < 3 THEN 3
              ELSE funnel_step
            END,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(leadId);
      }

      return Message.fromDbRow(row);
    },

    async getLastMessages(leadId, limit = 10) {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM conversations
        WHERE lead_id = ?
        ORDER BY sent_at DESC
        LIMIT ?
      `).all(leadId, limit);

      // Reverse to get chronological order
      return rows.reverse().map(row => Message.fromDbRow(row));
    },

    async getMessagesForAI(leadId, limit = 10) {
      const messages = await this.getLastMessages(leadId, limit);

      return messages.map(m => ({
        role: m.role,
        content: m.text
      }));
    },

    async countMessages(leadId) {
      const db = getDb();

      const sent = db.prepare(`
        SELECT COUNT(*) as count FROM conversations
        WHERE lead_id = ? AND role = 'assistant'
      `).get(leadId);

      const received = db.prepare(`
        SELECT COUNT(*) as count FROM conversations
        WHERE lead_id = ? AND role = 'user'
      `).get(leadId);

      return {
        sent: sent?.count || 0,
        received: received?.count || 0
      };
    },

    async hasUnansweredMessage(leadId) {
      const db = getDb();
      const lastMessage = db.prepare(`
        SELECT role FROM conversations
        WHERE lead_id = ?
        ORDER BY sent_at DESC
        LIMIT 1
      `).get(leadId);

      // Unanswered if last message is from lead (user)
      return lastMessage?.role === 'user';
    },

    async getUnansweredConversations(accountId) {
      const db = getDb();

      // Get leads where last message is from user
      const rows = db.prepare(`
        SELECT l.id as lead_id, l.username, c.*
        FROM leads l
        INNER JOIN conversations c ON c.lead_id = l.id
        WHERE l.account_id = ?
          AND l.is_ignored = 0
          AND c.id = (
            SELECT c2.id FROM conversations c2
            WHERE c2.lead_id = l.id
            ORDER BY c2.sent_at DESC
            LIMIT 1
          )
          AND c.role = 'user'
        ORDER BY c.sent_at DESC
      `).all(accountId);

      return rows.map(row => ({
        leadId: row.lead_id,
        username: row.username,
        lastMessage: Message.fromDbRow(row)
      }));
    }
  };

  return createConversationRepository(implementation);
}

export default createSqliteConversationRepository;
