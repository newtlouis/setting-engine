/**
 * Tests for IBookingAdapter Port
 * Run: node shared/application/tests/IBookingAdapter.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createBookingAdapter, IBookingAdapter } from '../ports/IBookingAdapter.js';

describe('IBookingAdapter', () => {
  test('IBookingAdapter has all required methods', () => {
    const methods = Object.keys(IBookingAdapter);
    assert.ok(methods.includes('fetchAvailability'));
    assert.ok(methods.includes('createBooking'));
    assert.ok(methods.includes('cancelBooking'));
    assert.ok(methods.includes('rescheduleBooking'));
  });

  test('IBookingAdapter methods throw "Not implemented"', async () => {
    await assert.rejects(() => IBookingAdapter.fetchAvailability('test'), { message: 'Not implemented' });
    await assert.rejects(() => IBookingAdapter.createBooking('test', {}), { message: 'Not implemented' });
    await assert.rejects(() => IBookingAdapter.cancelBooking('test', 'uri'), { message: 'Not implemented' });
    await assert.rejects(() => IBookingAdapter.rescheduleBooking('test', {}), { message: 'Not implemented' });
  });
});

describe('createBookingAdapter', () => {
  test('accepts valid implementation with all methods', () => {
    const adapter = createBookingAdapter({
      fetchAvailability: async () => ({}),
      createBooking: async () => ({}),
      cancelBooking: async () => ({}),
      rescheduleBooking: async () => ({})
    });
    assert.ok(adapter);
    assert.strictEqual(typeof adapter.fetchAvailability, 'function');
  });

  test('throws when missing methods', () => {
    assert.throws(
      () => createBookingAdapter({ fetchAvailability: async () => ({}) }),
      /BookingAdapter missing methods/
    );
  });

  test('throws when method is not a function', () => {
    assert.throws(
      () => createBookingAdapter({
        fetchAvailability: async () => ({}),
        createBooking: 'not a function',
        cancelBooking: async () => ({}),
        rescheduleBooking: async () => ({})
      }),
      /BookingAdapter missing methods.*createBooking/
    );
  });

  test('throws for empty implementation', () => {
    assert.throws(
      () => createBookingAdapter({}),
      /BookingAdapter missing methods/
    );
  });
});
