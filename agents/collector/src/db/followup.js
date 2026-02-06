/**
 * Follow-up Database Module
 *
 * Handles follow-up template and tracking operations.
 */

import { getDb } from './core.js';
import { getLeadByUsername } from './leads.js';

/**
 * Get the next follow-up template for a lead
 * @param {number|null} lastTemplateId - The ID of the last sent template (null if none)
 * @returns {Object|null} The next template or null if end of sequence
 */
export function getNextFollowupTemplate(lastTemplateId) {
  const db = getDb();
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
  const db = getDb();
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
  const db = getDb();
  // Get lead ID
  const lead = getLeadByUsername(username);
  if (!lead) return 0;

  // Count follow-ups matching various historical formats:
  // - followup_stepX_Y (old format)
  // - followup_funnelX_Y (newer format)
  // - followup_X (legacy simple format, count all as step-agnostic)
  const result = db.prepare(`
    SELECT COUNT(*) as count
    FROM conversations
    WHERE lead_id = ?
      AND role = 'assistant'
      AND (
        message_type LIKE ?
        OR message_type LIKE ?
      )
  `).get(lead.id, `followup_step${step}%`, `followup_funnel${step}%`);

  return result ? result.count : 0;
}
