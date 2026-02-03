/**
 * Warmth Value Object
 *
 * Represents the engagement level/temperature of a lead.
 * Cold = no interaction, Warm = some engagement, Hot = high intent
 */

export const Warmth = Object.freeze({
  COLD: 'cold',
  WARM: 'warm',
  HOT: 'hot'
});

/**
 * Warmth scoring thresholds
 */
const WARMTH_THRESHOLDS = {
  HOT: 80,   // engagement_score >= 80
  WARM: 40   // engagement_score >= 40
};

/**
 * Check if warmth value is valid
 * @param {string} warmth
 * @returns {boolean}
 */
export function isValidWarmth(warmth) {
  return Object.values(Warmth).includes(warmth);
}

/**
 * Calculate warmth from engagement score
 * @param {number} engagementScore
 * @returns {string}
 */
export function calculateWarmth(engagementScore) {
  if (engagementScore >= WARMTH_THRESHOLDS.HOT) {
    return Warmth.HOT;
  }
  if (engagementScore >= WARMTH_THRESHOLDS.WARM) {
    return Warmth.WARM;
  }
  return Warmth.COLD;
}

/**
 * Compare warmth levels (returns -1, 0, or 1)
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareWarmth(a, b) {
  const order = { [Warmth.COLD]: 0, [Warmth.WARM]: 1, [Warmth.HOT]: 2 };
  return (order[a] ?? 0) - (order[b] ?? 0);
}

/**
 * Check if lead is hot
 * @param {string} warmth
 * @returns {boolean}
 */
export function isHot(warmth) {
  return warmth === Warmth.HOT;
}

/**
 * Check if lead needs warming up
 * @param {string} warmth
 * @returns {boolean}
 */
export function needsWarming(warmth) {
  return warmth === Warmth.COLD;
}

/**
 * Parse warmth from string (with fallback)
 * @param {string} value
 * @param {string} fallback
 * @returns {string}
 */
export function parseWarmth(value, fallback = Warmth.COLD) {
  if (isValidWarmth(value)) {
    return value;
  }
  return fallback;
}

/**
 * Get emoji for warmth level
 * @param {string} warmth
 * @returns {string}
 */
export function getWarmthEmoji(warmth) {
  switch (warmth) {
    case Warmth.HOT: return '🔥';
    case Warmth.WARM: return '🌡️';
    case Warmth.COLD: return '❄️';
    default: return '❓';
  }
}
