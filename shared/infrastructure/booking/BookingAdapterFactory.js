/**
 * BookingAdapterFactory - Creates the appropriate booking adapter based on mode
 *
 * Strategy pattern factory: resolves the booking mode for a profile/account
 * and returns the corresponding adapter (Calendly or Google Calendar).
 */

import { BookingMode, isValidBookingMode } from '../../domain/value-objects/BookingMode.js';
import { createCalendlyAdapter } from './CalendlyAdapter.js';
import { createGoogleCalendarAdapter } from './GoogleCalendarAdapter.js';

/**
 * Create a booking adapter for the given mode
 * @param {string} bookingMode - 'calendly' or 'google_calendar'
 * @param {Object} [bookingConfig] - Provider-specific config (parsed from account.booking_config)
 * @returns {Object} IBookingAdapter implementation
 */
export function createBookingAdapterForMode(bookingMode, bookingConfig = {}) {
  if (!isValidBookingMode(bookingMode)) {
    console.warn(`[BookingFactory] Unknown booking mode "${bookingMode}", falling back to Calendly`);
    return createCalendlyAdapter();
  }

  switch (bookingMode) {
    case BookingMode.CALENDLY:
      return createCalendlyAdapter();
    case BookingMode.GOOGLE_CALENDAR:
      return createGoogleCalendarAdapter(bookingConfig);
    default:
      return createCalendlyAdapter();
  }
}

/**
 * Resolve booking adapter for an account by reading its booking_mode from the database
 * @param {Function} getDb - Database accessor
 * @param {number} accountId
 * @returns {{ adapter: Object, profileName: string }}
 */
export function resolveBookingAdapter(getDb, accountId) {
  const db = getDb();
  const row = db.prepare('SELECT name, booking_mode, booking_config FROM accounts WHERE id = ?').get(accountId);

  if (!row) {
    console.warn(`[BookingFactory] Account ${accountId} not found, using Calendly default`);
    return { adapter: createCalendlyAdapter(), profileName: 'default' };
  }

  const bookingMode = row.booking_mode || BookingMode.CALENDLY;
  const bookingConfig = row.booking_config ? JSON.parse(row.booking_config) : {};
  const adapter = createBookingAdapterForMode(bookingMode, bookingConfig);

  return { adapter, profileName: row.name };
}
