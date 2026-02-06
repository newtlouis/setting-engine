/**
 * LeadStatus Value Object
 *
 * Represents the lifecycle status of a lead in the sales funnel.
 * Immutable enum with validation and transition rules.
 */

export const LeadStatus = Object.freeze({
  NEW: 'new',
  QUEUED: 'queued',           // In outreach queue, waiting to be sent
  OUTREACH: 'outreach',       // First message sent, waiting for reply
  CONTACTED: 'contacted',
  REPLIED: 'replied',
  CONVERSATION: 'conversation', // Active conversation in progress
  QUALIFIED: 'qualified',
  SCHEDULING: 'scheduling',   // Booking/scheduling in progress
  CONVERTED: 'converted',
  IGNORED: 'ignored',
  FAILED: 'failed',           // DM failed (account not found, blocked, etc.)
  MANUAL: 'manual',           // Needs manual intervention
  NOT_INTERESTED: 'not_interested',
  DISQUALIFIED: 'disqualified',
  UNCONTACTABLE: 'uncontactable', // No message button on profile
  ALREADY_KNOWN: 'already_known', // Existing conversation detected
  KNOWN_CONTACT: 'known_contact'  // Known contact outside funnel
});

/**
 * Valid status transitions (state machine)
 */
const VALID_TRANSITIONS = {
  [LeadStatus.NEW]: [LeadStatus.QUEUED, LeadStatus.CONTACTED, LeadStatus.OUTREACH, LeadStatus.IGNORED, LeadStatus.FAILED, LeadStatus.DISQUALIFIED, LeadStatus.UNCONTACTABLE, LeadStatus.ALREADY_KNOWN],
  [LeadStatus.QUEUED]: [LeadStatus.OUTREACH, LeadStatus.CONTACTED, LeadStatus.FAILED, LeadStatus.IGNORED],
  [LeadStatus.OUTREACH]: [LeadStatus.CONVERSATION, LeadStatus.REPLIED, LeadStatus.NOT_INTERESTED, LeadStatus.IGNORED, LeadStatus.FAILED, LeadStatus.MANUAL],
  [LeadStatus.CONTACTED]: [LeadStatus.CONVERSATION, LeadStatus.REPLIED, LeadStatus.NOT_INTERESTED, LeadStatus.IGNORED, LeadStatus.FAILED, LeadStatus.MANUAL],
  [LeadStatus.REPLIED]: [LeadStatus.CONVERSATION, LeadStatus.QUALIFIED, LeadStatus.IGNORED, LeadStatus.MANUAL],
  [LeadStatus.CONVERSATION]: [LeadStatus.QUALIFIED, LeadStatus.SCHEDULING, LeadStatus.NOT_INTERESTED, LeadStatus.IGNORED, LeadStatus.MANUAL],
  [LeadStatus.QUALIFIED]: [LeadStatus.SCHEDULING, LeadStatus.CONVERTED, LeadStatus.IGNORED, LeadStatus.MANUAL],
  [LeadStatus.SCHEDULING]: [LeadStatus.CONVERTED, LeadStatus.CONVERSATION, LeadStatus.IGNORED, LeadStatus.MANUAL],
  [LeadStatus.CONVERTED]: [],
  [LeadStatus.IGNORED]: [],
  [LeadStatus.FAILED]: [LeadStatus.NEW],
  [LeadStatus.MANUAL]: [LeadStatus.CONTACTED, LeadStatus.CONVERSATION, LeadStatus.REPLIED, LeadStatus.QUALIFIED, LeadStatus.IGNORED],
  [LeadStatus.NOT_INTERESTED]: [LeadStatus.CONVERSATION], // Can re-engage if they ask a question
  [LeadStatus.DISQUALIFIED]: [],
  [LeadStatus.UNCONTACTABLE]: [],
  [LeadStatus.ALREADY_KNOWN]: [LeadStatus.CONVERSATION, LeadStatus.NOT_INTERESTED],
  [LeadStatus.KNOWN_CONTACT]: [LeadStatus.CONVERSATION]
};

/**
 * Check if a status value is valid
 * @param {string} status
 * @returns {boolean}
 */
export function isValidStatus(status) {
  return Object.values(LeadStatus).includes(status);
}

/**
 * Check if a status transition is valid
 * @param {string} fromStatus
 * @param {string} toStatus
 * @returns {boolean}
 */
export function canTransitionTo(fromStatus, toStatus) {
  if (!isValidStatus(fromStatus) || !isValidStatus(toStatus)) {
    return false;
  }
  return VALID_TRANSITIONS[fromStatus]?.includes(toStatus) ?? false;
}

/**
 * Get the next valid statuses from current status
 * @param {string} currentStatus
 * @returns {string[]}
 */
export function getNextStatuses(currentStatus) {
  if (!isValidStatus(currentStatus)) {
    return [];
  }
  return VALID_TRANSITIONS[currentStatus] || [];
}

/**
 * Parse status from string (with fallback)
 * @param {string} value
 * @param {string} fallback
 * @returns {string}
 */
export function parseStatus(value, fallback = LeadStatus.NEW) {
  if (isValidStatus(value)) {
    return value;
  }
  return fallback;
}
