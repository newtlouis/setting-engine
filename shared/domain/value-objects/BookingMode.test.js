/**
 * Tests for BookingMode Value Object
 * Run: node shared/domain/value-objects/BookingMode.test.js
 */

import {
  BookingMode,
  isValidBookingMode,
  parseBookingMode
} from './BookingMode.js';

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

console.log('\n🧪 BookingMode Tests\n');

// Enum values
console.log('--- BookingMode enum ---');
test('CALENDLY equals "calendly"', () => assert(BookingMode.CALENDLY === 'calendly'));
test('GOOGLE_CALENDAR equals "google_calendar"', () => assert(BookingMode.GOOGLE_CALENDAR === 'google_calendar'));
test('is frozen', () => {
  assert(Object.isFrozen(BookingMode));
});

// Validation
console.log('\n--- isValidBookingMode ---');
test('calendly is valid', () => assert(isValidBookingMode('calendly')));
test('google_calendar is valid', () => assert(isValidBookingMode('google_calendar')));
test('random string is invalid', () => assert(!isValidBookingMode('zoom')));
test('null is invalid', () => assert(!isValidBookingMode(null)));
test('undefined is invalid', () => assert(!isValidBookingMode(undefined)));
test('empty string is invalid', () => assert(!isValidBookingMode('')));

// Parsing
console.log('\n--- parseBookingMode ---');
test('parse calendly returns calendly', () => assert(parseBookingMode('calendly') === 'calendly'));
test('parse google_calendar returns google_calendar', () => assert(parseBookingMode('google_calendar') === 'google_calendar'));
test('parse null falls back to calendly', () => assert(parseBookingMode(null) === 'calendly'));
test('parse invalid falls back to calendly', () => assert(parseBookingMode('zoom') === 'calendly'));
test('parse with custom fallback', () => assert(parseBookingMode('invalid', 'google_calendar') === 'google_calendar'));

// Summary
console.log('\n' + '='.repeat(40));
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log('='.repeat(40) + '\n');

process.exit(failed > 0 ? 1 : 0);
