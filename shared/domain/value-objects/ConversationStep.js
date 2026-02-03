/**
 * ConversationStep Value Object
 *
 * Represents the stage of conversation with a lead.
 * Based on message counts: Step 0 = no contact, Step 1 = sent, Step 2 = first reply, Step 3+ = ongoing
 */

export const ConversationStep = Object.freeze({
  NO_CONTACT: 0,      // Never contacted
  FIRST_MESSAGE: 1,   // First message sent, no reply yet
  FIRST_REPLY: 2,     // Lead replied once
  ONGOING: 3,         // Multiple exchanges
  FOLLOW_UP_1: 4,     // First follow-up sent
  FOLLOW_UP_2: 5,     // Second follow-up
  FOLLOW_UP_3: 6,     // Third follow-up
  FOLLOW_UP_4: 7,     // Fourth follow-up
  FOLLOW_UP_5: 8      // Final follow-up
});

/**
 * Human-readable labels for each step
 */
export const STEP_LABELS = {
  [ConversationStep.NO_CONTACT]: 'Pas contacté',
  [ConversationStep.FIRST_MESSAGE]: 'Premier message envoyé',
  [ConversationStep.FIRST_REPLY]: 'Première réponse reçue',
  [ConversationStep.ONGOING]: 'Conversation en cours',
  [ConversationStep.FOLLOW_UP_1]: 'Relance 1',
  [ConversationStep.FOLLOW_UP_2]: 'Relance 2',
  [ConversationStep.FOLLOW_UP_3]: 'Relance 3',
  [ConversationStep.FOLLOW_UP_4]: 'Relance 4',
  [ConversationStep.FOLLOW_UP_5]: 'Relance finale'
};

/**
 * Check if a step value is valid
 * @param {number} step
 * @returns {boolean}
 */
export function isValidStep(step) {
  return Number.isInteger(step) && step >= 0 && step <= 8;
}

/**
 * Calculate step from message counts
 *
 * Logic:
 * - If lead replied multiple times → ONGOING (3)
 * - If lead replied once → FIRST_REPLY (2)
 * - If we sent messages but no reply:
 *   - 1 message sent → FIRST_MESSAGE (1)
 *   - 2 messages sent → FOLLOW_UP_1 (4)
 *   - 3 messages sent → FOLLOW_UP_2 (5)
 *   - 4 messages sent → FOLLOW_UP_3 (6)
 *   - 5 messages sent → FOLLOW_UP_4 (7)
 *   - 6+ messages sent → FOLLOW_UP_5 (8)
 * - If no contact → NO_CONTACT (0)
 *
 * @param {number} sentCount
 * @param {number} receivedCount
 * @returns {number}
 */
export function calculateStep(sentCount, receivedCount) {
  // Lead has replied - active conversation
  if (receivedCount > 1) return ConversationStep.ONGOING;
  if (receivedCount === 1) return ConversationStep.FIRST_REPLY;

  // No reply yet - calculate based on messages sent
  if (sentCount >= 6) return ConversationStep.FOLLOW_UP_5;
  if (sentCount === 5) return ConversationStep.FOLLOW_UP_4;
  if (sentCount === 4) return ConversationStep.FOLLOW_UP_3;
  if (sentCount === 3) return ConversationStep.FOLLOW_UP_2;
  if (sentCount === 2) return ConversationStep.FOLLOW_UP_1;
  if (sentCount === 1) return ConversationStep.FIRST_MESSAGE;

  return ConversationStep.NO_CONTACT;
}

/**
 * Check if lead needs follow-up (sent message but no reply)
 * Returns true for steps where we're waiting for a reply and haven't
 * exhausted all follow-ups yet (steps 1, 4, 5, 6, 7)
 * @param {number} step
 * @returns {boolean}
 */
export function needsFollowUp(step) {
  return step === ConversationStep.FIRST_MESSAGE ||
         (step >= ConversationStep.FOLLOW_UP_1 && step < ConversationStep.FOLLOW_UP_5);
}

/**
 * Check if lead is awaiting reply (any step where no reply received)
 * @param {number} step
 * @returns {boolean}
 */
export function isAwaitingReply(step) {
  return step === ConversationStep.FIRST_MESSAGE ||
         (step >= ConversationStep.FOLLOW_UP_1 && step <= ConversationStep.FOLLOW_UP_5);
}

/**
 * Check if all follow-ups have been exhausted
 * @param {number} step
 * @returns {boolean}
 */
export function isFollowUpExhausted(step) {
  return step === ConversationStep.FOLLOW_UP_5;
}

/**
 * Check if conversation is active (has replies)
 * @param {number} step
 * @returns {boolean}
 */
export function isActiveConversation(step) {
  return step >= ConversationStep.FIRST_REPLY;
}

/**
 * Get label for step
 * @param {number} step
 * @returns {string}
 */
export function getStepLabel(step) {
  return STEP_LABELS[step] || `Étape ${step}`;
}

/**
 * Parse step from value (with fallback)
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
export function parseStep(value, fallback = ConversationStep.NO_CONTACT) {
  const num = parseInt(value, 10);
  return isValidStep(num) ? num : fallback;
}
