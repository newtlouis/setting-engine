/**
 * BookingStatus Value Object
 *
 * Represents the booking state machine for scheduling calls with leads.
 * Ensures valid transitions and provides clear booking lifecycle tracking.
 *
 * State Machine:
 *
 *   null (no booking)
 *     │
 *     ▼
 *   proposed ──────────────────┐
 *     │ (lead accepts slot)    │ (lead declines/ghosts)
 *     ▼                        ▼
 *   pending ─────────────┬─► cancelled
 *     │ (Calendly OK)    │ (Calendly fails)
 *     ▼                  ▼
 *   confirmed         failed ──► pending (retry)
 *     │ (call done)
 *     ▼
 *   completed
 */

export const BookingStatus = Object.freeze({
  // No booking initiated
  NONE: null,

  // Slot proposed to lead, waiting for response
  PROPOSED: 'proposed',

  // Lead accepted slot, waiting for Calendly booking
  PENDING: 'pending',

  // Calendly booking created successfully
  CONFIRMED: 'confirmed',

  // Call completed
  COMPLETED: 'completed',

  // Lead declined or cancelled
  CANCELLED: 'cancelled',

  // Calendly API failed (can retry)
  FAILED: 'failed'
});

/**
 * Valid state transitions
 */
const VALID_TRANSITIONS = {
  [BookingStatus.NONE]: [BookingStatus.PROPOSED, BookingStatus.PENDING],
  [BookingStatus.PROPOSED]: [BookingStatus.PENDING, BookingStatus.CANCELLED, BookingStatus.NONE],
  [BookingStatus.PENDING]: [BookingStatus.CONFIRMED, BookingStatus.FAILED, BookingStatus.CANCELLED],
  [BookingStatus.CONFIRMED]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
  [BookingStatus.COMPLETED]: [],
  [BookingStatus.CANCELLED]: [BookingStatus.PROPOSED, BookingStatus.PENDING], // Can restart
  [BookingStatus.FAILED]: [BookingStatus.PENDING, BookingStatus.CANCELLED] // Can retry
};

/**
 * Check if a booking status value is valid
 * @param {string|null} status
 * @returns {boolean}
 */
export function isValidBookingStatus(status) {
  if (status === null) return true;
  return Object.values(BookingStatus).includes(status);
}

/**
 * Check if a status transition is valid
 * @param {string|null} fromStatus
 * @param {string} toStatus
 * @returns {boolean}
 */
export function canTransitionBookingTo(fromStatus, toStatus) {
  const from = fromStatus || BookingStatus.NONE;
  if (!isValidBookingStatus(from) || !isValidBookingStatus(toStatus)) {
    return false;
  }
  return VALID_TRANSITIONS[from]?.includes(toStatus) ?? false;
}

/**
 * Get possible next statuses from current status
 * @param {string|null} currentStatus
 * @returns {string[]}
 */
export function getNextBookingStatuses(currentStatus) {
  const current = currentStatus || BookingStatus.NONE;
  return VALID_TRANSITIONS[current] || [];
}

/**
 * Check if booking is in a terminal state (no further action needed)
 * @param {string|null} status
 * @returns {boolean}
 */
export function isBookingTerminal(status) {
  return status === BookingStatus.COMPLETED || status === BookingStatus.CANCELLED;
}

/**
 * Check if booking needs attention (action required)
 * @param {string|null} status
 * @returns {boolean}
 */
export function bookingNeedsAttention(status) {
  return status === BookingStatus.FAILED || status === BookingStatus.PENDING;
}

/**
 * Check if lead should be skipped in inbox processing
 * @param {string|null} status
 * @returns {boolean}
 */
export function shouldSkipForBooking(status) {
  return status === BookingStatus.CONFIRMED ||
         status === BookingStatus.COMPLETED;
}

/**
 * Parse booking status from string (with fallback)
 * @param {string|null} value
 * @param {string|null} fallback
 * @returns {string|null}
 */
export function parseBookingStatus(value, fallback = BookingStatus.NONE) {
  if (isValidBookingStatus(value)) {
    return value;
  }
  return fallback;
}

export default BookingStatus;
