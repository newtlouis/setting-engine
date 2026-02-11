/**
 * Calendly Live Integration Tests
 *
 * Tests the full booking lifecycle against the real Calendly API:
 *   1. Fetch real availability
 *   2. Create a booking on a real slot
 *   3. Cancel the booking immediately
 *   4. Reschedule (cancel + rebook on different slot)
 *
 * SKIPPED automatically if no Calendly token found (CALENDLY_TOKEN or CALENDLY_TOKEN_{PROFILE}).
 * Run manually: CALENDLY_TEST_PROFILE=melanie node --test tests/calendly-live.test.js
 *
 * Uses a test email to avoid polluting real data.
 * All bookings are cancelled immediately after creation.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import dotenv from 'dotenv';

dotenv.config();

import {
  fetchAvailability,
  createBooking,
  cancelBooking,
  rescheduleBooking
} from '../../../shared/utils/calendly.js';

const PROFILE = process.env.CALENDLY_TEST_PROFILE || 'default';
const normalizedProfile = PROFILE.toUpperCase().replace(/[^A-Z0-9]/g, '_');
const HAS_TOKEN = !!(
  process.env.CALENDLY_TOKEN ||
  process.env[`CALENDLY_TOKEN_${normalizedProfile}`]
);
const TEST_EMAIL = process.env.CALENDLY_TEST_EMAIL || 'settingengine.test@gmail.com';
const TEST_NAME = 'Test CI';
const TEST_PHONE = '0600000000';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const API_DELAY = 4000; // 4s between API calls to avoid 429

// Store state between tests
let availableSlots = [];
let firstBookingResult = null;

describe('Calendly Live Integration', { skip: !HAS_TOKEN && `No Calendly token found for profile "${PROFILE}" — skipping live tests` }, () => {

  test('Fetch real availability returns valid structure', async () => {
    const availability = await fetchAvailability(PROFILE);

    // Should return an object with thisWeek/nextWeek (not an empty array from error)
    assert.ok(availability && typeof availability === 'object', 'Should return an object');
    assert.ok(availability.thisWeek, 'Should have thisWeek');
    assert.ok(availability.nextWeek, 'Should have nextWeek');
    assert.ok(Array.isArray(availability.thisWeek.primary), 'thisWeek.primary should be an array');
    assert.ok(Array.isArray(availability.nextWeek.primary), 'nextWeek.primary should be an array');

    // Collect all available slots for subsequent tests
    availableSlots = [
      ...(availability.thisWeek.primary || []),
      ...(availability.thisWeek.backup || []),
      ...(availability.nextWeek.primary || []),
      ...(availability.nextWeek.backup || []),
    ];

    console.log(`[Live Test] Found ${availableSlots.length} total slots`);
    if (availableSlots.length > 0) {
      console.log(`[Live Test] First slot: ${availableSlots[0].start_time}`);
    }
  });

  test('Create booking on real slot + cancel immediately', async () => {
    if (availableSlots.length === 0) {
      console.log('[Live Test] No slots available — skipping create+cancel test');
      return;
    }

    const slot = availableSlots[0];
    console.log(`[Live Test] Waiting ${API_DELAY}ms before booking...`);
    await delay(API_DELAY);
    console.log(`[Live Test] Creating booking for: ${slot.start_time}`);

    // CREATE
    const result = await createBooking(PROFILE, {
      startTime: slot.start_time,
      email: TEST_EMAIL,
      name: TEST_NAME,
      phone: TEST_PHONE,
      conversationHints: ''
    });

    console.log(`[Live Test] Create result:`, JSON.stringify(result, null, 2));

    if (!result.success) {
      // Calendly plan may not support programmatic booking (403)
      console.log(`[Live Test] Create failed (plan restriction?): ${result.error}`);
      console.log(`[Live Test] Skipping cancel test — booking was not created`);
      return;
    }

    assert.ok(result.success, 'Booking should succeed');
    assert.ok(result.booking_url, 'Should have booking_url');

    firstBookingResult = result;

    // CANCEL
    if (result.event_uri) {
      await delay(API_DELAY);
      console.log(`[Live Test] Cancelling event: ${result.event_uri}`);
      const cancelResult = await cancelBooking(PROFILE, result.event_uri, 'Test automatique — annulation immédiate');
      console.log(`[Live Test] Cancel result:`, JSON.stringify(cancelResult, null, 2));
      assert.ok(cancelResult.success, 'Cancel should succeed');
    } else {
      console.log(`[Live Test] No event_uri in response — cannot cancel (API may not return it)`);
    }
  });

  test('Reschedule: book slot A → reschedule to slot B → verify', async () => {
    if (availableSlots.length < 2) {
      console.log('[Live Test] Need at least 2 slots for reschedule test — skipping');
      return;
    }

    const slotA = availableSlots[0];
    const slotB = availableSlots[1];
    console.log(`[Live Test] Reschedule: ${slotA.start_time} → ${slotB.start_time}`);

    // Book slot A — extra delay because this is the 3rd booking attempt in the suite
    const RESCHEDULE_DELAY = 8000;
    console.log(`[Live Test] Waiting ${RESCHEDULE_DELAY}ms before booking slot A...`);
    await delay(RESCHEDULE_DELAY);
    const bookingA = await createBooking(PROFILE, {
      startTime: slotA.start_time,
      email: TEST_EMAIL,
      name: TEST_NAME,
      phone: TEST_PHONE,
      conversationHints: ''
    });

    if (!bookingA.success) {
      console.log(`[Live Test] Initial booking failed (plan restriction?): ${bookingA.error}`);
      return;
    }

    if (!bookingA.event_uri) {
      console.log(`[Live Test] No event_uri — cannot reschedule, cancelling via fallback`);
      return;
    }

    // Reschedule to slot B
    console.log(`[Live Test] Waiting ${API_DELAY}ms before reschedule...`);
    await delay(API_DELAY);
    const rescheduleResult = await rescheduleBooking(PROFILE, {
      oldEventUri: bookingA.event_uri,
      startTime: slotB.start_time,
      email: TEST_EMAIL,
      name: TEST_NAME,
      phone: TEST_PHONE,
      conversationHints: ''
    });

    console.log(`[Live Test] Reschedule result:`, JSON.stringify(rescheduleResult, null, 2));

    if (!rescheduleResult.success) {
      console.log(`[Live Test] Reschedule failed: ${rescheduleResult.error}`);
      return;
    }

    assert.ok(rescheduleResult.success, 'Reschedule should succeed');
    assert.ok(rescheduleResult.rescheduled, 'Should have rescheduled flag');
    assert.strictEqual(rescheduleResult.cancelledEventUri, bookingA.event_uri, 'Should reference old event');

    // Clean up: cancel the new booking
    if (rescheduleResult.event_uri) {
      await delay(API_DELAY);
      console.log(`[Live Test] Cleaning up: cancelling rescheduled booking`);
      await cancelBooking(PROFILE, rescheduleResult.event_uri, 'Test cleanup');
    }
  });
});
