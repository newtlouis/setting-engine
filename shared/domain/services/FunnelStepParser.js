/**
 * FunnelStepParser Service
 *
 * Parses [STEP_X] labels from LLM-generated messages to track
 * the sales funnel progression.
 *
 * Labels format: [STEP_1], [STEP_2], [STEP_3.1], [STEP_3.2], etc.
 */

/**
 * Funnel step mapping
 * Maps sub-steps to main step numbers for config lookup
 */
export const FunnelStepMapping = Object.freeze({
  '1': 1,      // Premier contact
  '2': 2,      // Connexion
  '3': 3,      // Exploration (3.1, 3.2)
  '3.1': 3,
  '3.2': 3,
  '4': 4,      // Projection (4.1, 4.2)
  '4.1': 4,
  '4.2': 4,
  '5': 5,      // Proposition d'appel
  '6': 6,      // Créneaux proposés
  '7': 7,      // Récupération infos
  '8': 8,      // Confirmation RDV
  '9': 9       // Clôture
});

/**
 * Parse [STEP_X] label from message text
 *
 * @param {string} text - Message text
 * @returns {number|null} - Parsed step number (1-9) or null if not found
 */
export function parseFunnelStep(text) {
  if (!text || typeof text !== 'string') return null;

  // Match patterns like [STEP_1], [STEP_3.1], [STEP_5]
  const match = text.match(/\[STEP_(\d+(?:\.\d+)?)\]/i);

  if (!match) return null;

  const stepLabel = match[1];

  // Map to main step number
  const mainStep = FunnelStepMapping[stepLabel];

  if (mainStep !== undefined) {
    return mainStep;
  }

  // Fallback: parse the integer part
  const intPart = parseInt(stepLabel, 10);
  return isNaN(intPart) ? null : Math.min(intPart, 9);
}

/**
 * Check if message contains a NOT_INTERESTED tag
 *
 * @param {string} text - Message text
 * @returns {boolean}
 */
export function isNotInterested(text) {
  if (!text || typeof text !== 'string') return false;
  return text.includes('[NOT_INTERESTED]');
}

/**
 * Check if message contains an ALERT_BOOKING tag
 *
 * @param {string} text - Message text
 * @returns {boolean}
 */
export function isBookingAlert(text) {
  if (!text || typeof text !== 'string') return false;
  return text.includes('[ALERT_BOOKING]');
}

/**
 * Check if message contains a MANUAL tag
 *
 * @param {string} text - Message text
 * @returns {boolean}
 */
export function needsManualIntervention(text) {
  if (!text || typeof text !== 'string') return false;
  return text.includes('[MANUAL]');
}

/**
 * Strip all control tags from message text
 *
 * @param {string} text - Message text with tags
 * @returns {string} - Clean message without tags
 */
export function stripControlTags(text) {
  if (!text || typeof text !== 'string') return text;

  return text
    .replace(/\[STEP_\d+(?:\.\d+)?\]\s*/gi, '')
    .replace(/\[NOT_INTERESTED\]\s*/gi, '')
    .replace(/\[ALERT_BOOKING\]\s*/gi, '')
    .replace(/\[MANUAL\]\s*/gi, '')
    .trim();
}

export default {
  parseFunnelStep,
  isNotInterested,
  isBookingAlert,
  needsManualIntervention,
  stripControlTags,
  FunnelStepMapping
};
