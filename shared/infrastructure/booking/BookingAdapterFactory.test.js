/**
 * Tests for BookingAdapterFactory
 * Run: node shared/infrastructure/booking/BookingAdapterFactory.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createBookingAdapterForMode } from './BookingAdapterFactory.js';

describe('createBookingAdapterForMode', () => {
  test('returns adapter for calendly mode', () => {
    const adapter = createBookingAdapterForMode('calendly');
    assert.ok(adapter);
    assert.strictEqual(typeof adapter.fetchAvailability, 'function');
    assert.strictEqual(typeof adapter.createBooking, 'function');
    assert.strictEqual(typeof adapter.cancelBooking, 'function');
    assert.strictEqual(typeof adapter.rescheduleBooking, 'function');
  });

  test('returns adapter for google_calendar mode', () => {
    const adapter = createBookingAdapterForMode('google_calendar');
    assert.ok(adapter);
    assert.strictEqual(typeof adapter.fetchAvailability, 'function');
    assert.strictEqual(typeof adapter.createBooking, 'function');
    assert.strictEqual(typeof adapter.cancelBooking, 'function');
    assert.strictEqual(typeof adapter.rescheduleBooking, 'function');
  });

  test('falls back to calendly for unknown mode', () => {
    const adapter = createBookingAdapterForMode('zoom');
    assert.ok(adapter);
    assert.strictEqual(typeof adapter.fetchAvailability, 'function');
  });

  test('falls back to calendly for null mode', () => {
    const adapter = createBookingAdapterForMode(null);
    assert.ok(adapter);
    assert.strictEqual(typeof adapter.fetchAvailability, 'function');
  });

  test('passes bookingConfig to google_calendar adapter', () => {
    const config = { calendarId: 'test@group.calendar.google.com', minHour: 9, maxHour: 18 };
    const adapter = createBookingAdapterForMode('google_calendar', config);
    assert.ok(adapter);
  });
});
