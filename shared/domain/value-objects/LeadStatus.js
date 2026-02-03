/**
 * LeadStatus Value Object
 *
 * Represents the lifecycle status of a lead in the sales funnel.
 * Immutable enum with validation and transition rules.
 */

export const LeadStatus = Object.freeze({
  NEW: 'new',
  CONTACTED: 'contacted',
  REPLIED: 'replied',
  QUALIFIED: 'qualified',
  CONVERTED: 'converted',
  IGNORED: 'ignored'
});

/**
 * Valid status transitions (state machine)
 */
const VALID_TRANSITIONS = {
  [LeadStatus.NEW]: [LeadStatus.CONTACTED, LeadStatus.IGNORED],
  [LeadStatus.CONTACTED]: [LeadStatus.REPLIED, LeadStatus.IGNORED],
  [LeadStatus.REPLIED]: [LeadStatus.QUALIFIED, LeadStatus.IGNORED],
  [LeadStatus.QUALIFIED]: [LeadStatus.CONVERTED, LeadStatus.IGNORED],
  [LeadStatus.CONVERTED]: [],
  [LeadStatus.IGNORED]: []
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
