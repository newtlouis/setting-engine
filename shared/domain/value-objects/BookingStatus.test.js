/**
 * Tests for BookingStatus Value Object
 * Run: node shared/domain/value-objects/BookingStatus.test.js
 */

import {
  BookingStatus,
  isValidBookingStatus,
  canTransitionBookingTo,
  getNextBookingStatuses,
  isBookingTerminal,
  shouldSkipForBooking
} from './BookingStatus.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(condition, msg = 'Assertion failed') {
  if (!condition) throw new Error(msg);
}

console.log('\n🧪 BookingStatus Tests\n');

// Validation tests
console.log('--- isValidBookingStatus ---');
test('null is valid', () => assert(isValidBookingStatus(null)));
test('proposed is valid', () => assert(isValidBookingStatus('proposed')));
test('pending is valid', () => assert(isValidBookingStatus('pending')));
test('confirmed is valid', () => assert(isValidBookingStatus('confirmed')));
test('completed is valid', () => assert(isValidBookingStatus('completed')));
test('cancelled is valid', () => assert(isValidBookingStatus('cancelled')));
test('failed is valid', () => assert(isValidBookingStatus('failed')));
test('random string is invalid', () => assert(!isValidBookingStatus('random')));

// Transition tests
console.log('\n--- canTransitionBookingTo ---');
test('null → proposed', () => assert(canTransitionBookingTo(null, 'proposed')));
test('null → pending', () => assert(canTransitionBookingTo(null, 'pending')));
test('proposed → pending', () => assert(canTransitionBookingTo('proposed', 'pending')));
test('proposed → cancelled', () => assert(canTransitionBookingTo('proposed', 'cancelled')));
test('pending → confirmed', () => assert(canTransitionBookingTo('pending', 'confirmed')));
test('pending → failed', () => assert(canTransitionBookingTo('pending', 'failed')));
test('confirmed → completed', () => assert(canTransitionBookingTo('confirmed', 'completed')));
test('failed → pending (retry)', () => assert(canTransitionBookingTo('failed', 'pending')));
test('cancelled → proposed (restart)', () => assert(canTransitionBookingTo('cancelled', 'proposed')));

// Invalid transitions
test('completed → X (terminal)', () => assert(!canTransitionBookingTo('completed', 'proposed')));
test('null → confirmed (skip steps)', () => assert(!canTransitionBookingTo(null, 'confirmed')));
test('proposed → completed (skip steps)', () => assert(!canTransitionBookingTo('proposed', 'completed')));

// Terminal state tests
console.log('\n--- isBookingTerminal ---');
test('completed is terminal', () => assert(isBookingTerminal('completed')));
test('cancelled is terminal', () => assert(isBookingTerminal('cancelled')));
test('pending is not terminal', () => assert(!isBookingTerminal('pending')));
test('confirmed is not terminal', () => assert(!isBookingTerminal('confirmed')));

// Skip tests
console.log('\n--- shouldSkipForBooking ---');
test('skip if confirmed', () => assert(shouldSkipForBooking('confirmed')));
test('skip if completed', () => assert(shouldSkipForBooking('completed')));
test('dont skip if pending', () => assert(!shouldSkipForBooking('pending')));
test('dont skip if null', () => assert(!shouldSkipForBooking(null)));

// Next statuses
console.log('\n--- getNextBookingStatuses ---');
test('from null can go to proposed/pending', () => {
  const next = getNextBookingStatuses(null);
  assert(next.includes('proposed') && next.includes('pending'));
});
test('from failed can retry or cancel', () => {
  const next = getNextBookingStatuses('failed');
  assert(next.includes('pending') && next.includes('cancelled'));
});

// Summary
console.log('\n' + '='.repeat(40));
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log('='.repeat(40) + '\n');

process.exit(failed > 0 ? 1 : 0);
