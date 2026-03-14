/**
 * BookingMode Value Object
 *
 * Represents the booking method used by a profile/account.
 * Determines which adapter handles availability and booking creation.
 */

export const BookingMode = Object.freeze({
  CALENDLY: 'calendly',
  GOOGLE_CALENDAR: 'google_calendar'
});

/**
 * Check if a booking mode value is valid
 * @param {string} mode
 * @returns {boolean}
 */
export function isValidBookingMode(mode) {
  return Object.values(BookingMode).includes(mode);
}

/**
 * Parse booking mode from string with fallback
 * @param {string|null} value
 * @param {string} fallback
 * @returns {string}
 */
export function parseBookingMode(value, fallback = BookingMode.CALENDLY) {
  if (isValidBookingMode(value)) return value;
  return fallback;
}

export default BookingMode;
