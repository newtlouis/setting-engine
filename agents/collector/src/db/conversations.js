/**
 * Conversations Database Module
 *
 * Handles all conversation/DM history operations.
 */

import { getDb } from './core.js';

/**
 * Add a message to conversation
 */
export function addConversationMessage(leadId, role, messageText, messageType = null) {
  const db = getDb();
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
  const db = getDb();
  return db.prepare(`
    SELECT * FROM conversations
    WHERE lead_id = ?
    ORDER BY sent_at ASC
  `).all(leadId);
}
