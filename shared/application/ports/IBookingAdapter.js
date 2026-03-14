/**
 * IBookingAdapter - Booking Adapter Interface (Port)
 *
 * Defines the contract for booking providers (Calendly, Google Calendar, etc.).
 * Infrastructure layer implements this interface per provider.
 */

/**
 * @typedef {Object} BookingSlot
 * @property {string} start_time - ISO 8601 timestamp
 * @property {string} status - 'available'
 */

/**
 * @typedef {Object} BookingAvailability
 * @property {{ primary: BookingSlot[], backup: BookingSlot[] }} thisWeek
 * @property {{ primary: BookingSlot[], backup: BookingSlot[] }} nextWeek
 */

/**
 * @typedef {Object} CreateBookingParams
 * @property {string} startTime - ISO 8601 timestamp
 * @property {string} email - Prospect email
 * @property {string} name - Prospect full name
 * @property {string} [phone] - Prospect phone number
 * @property {string} [conversationHints] - Recent conversation text for country detection
 * @property {string} [briefing] - Pre-call briefing text
 * @property {string} [profileUrl] - Instagram profile URL
 */

/**
 * @typedef {Object} BookingResult
 * @property {boolean} success
 * @property {string} [message]
 * @property {string} [booking_url]
 * @property {string} [event_uri]
 * @property {string} [error]
 */

/**
 * Booking Adapter Interface
 */
export const IBookingAdapter = {
  /**
   * Fetch available slots for upcoming weeks
   * @param {string} profileName
   * @returns {Promise<BookingAvailability>}
   */
  fetchAvailability: async (profileName) => { throw new Error('Not implemented'); },

  /**
   * Create a booking for a prospect
   * @param {string} profileName
   * @param {CreateBookingParams} params
   * @returns {Promise<BookingResult>}
   */
  createBooking: async (profileName, params) => { throw new Error('Not implemented'); },

  /**
   * Cancel an existing booking
   * @param {string} profileName
   * @param {string} eventUri - Provider-specific event identifier
   * @param {string} [reason]
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  cancelBooking: async (profileName, eventUri, reason) => { throw new Error('Not implemented'); },

  /**
   * Reschedule a booking (cancel old + create new)
   * @param {string} profileName
   * @param {Object} params
   * @param {string} params.oldEventUri
   * @param {string} params.startTime
   * @param {string} params.email
   * @param {string} params.name
   * @param {string} [params.phone]
   * @param {string} [params.conversationHints]
   * @returns {Promise<BookingResult>}
   */
  rescheduleBooking: async (profileName, params) => { throw new Error('Not implemented'); }
};

/**
 * Create a booking adapter instance that validates interface compliance
 * @param {Object} implementation
 * @returns {Object}
 */
export function createBookingAdapter(implementation) {
  const required = Object.keys(IBookingAdapter);
  const missing = required.filter(method => typeof implementation[method] !== 'function');

  if (missing.length > 0) {
    throw new Error(`BookingAdapter missing methods: ${missing.join(', ')}`);
  }

  return implementation;
}

export default IBookingAdapter;
