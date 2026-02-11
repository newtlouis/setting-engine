/**
 * normalizePhone Unit Tests
 *
 * Tests phone number normalization to E.164 format
 * for French, Belgian, and Canadian numbers.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { normalizePhone } from '../../../shared/utils/calendly.js';

describe('normalizePhone', () => {
  test('French standard 10-digit number', () => {
    assert.strictEqual(normalizePhone('0612345678'), '+33612345678');
  });

  test('French number with spaces', () => {
    assert.strictEqual(normalizePhone('06 12 34 56 78'), '+33612345678');
  });

  test('Belgian number detected by hint', () => {
    assert.strictEqual(normalizePhone('0475123456', 'je suis belge'), '+32475123456');
  });

  test('Belgian number detected by prefix (04[5-9])', () => {
    assert.strictEqual(normalizePhone('0475123456'), '+32475123456');
  });

  test('Canadian 10-digit with hint "canada"', () => {
    assert.strictEqual(normalizePhone('5145551234', 'je vis au canada'), '+15145551234');
  });

  test('Canadian with hint "quebec"', () => {
    assert.strictEqual(normalizePhone('5145551234', 'je suis de quebec'), '+15145551234');
  });

  test('Canadian with hint "montreal"', () => {
    assert.strictEqual(normalizePhone('5819841318', 'je suis a montreal'), '+15819841318');
  });

  test('Canadian with country code but no +', () => {
    assert.strictEqual(normalizePhone('15145551234', 'canada'), '+15145551234');
  });

  test('Already international format preserved', () => {
    assert.strictEqual(normalizePhone('+33612345678'), '+33612345678');
  });

  test('Null input returns null', () => {
    assert.strictEqual(normalizePhone(null), null);
  });

  test('Empty string returns null', () => {
    assert.strictEqual(normalizePhone(''), null);
  });

  test('Number with dots and dashes cleaned', () => {
    assert.strictEqual(normalizePhone('06.12.34.56.78'), '+33612345678');
  });
});
