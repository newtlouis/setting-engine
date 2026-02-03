/**
 * LeadStatus Value Object Tests
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  LeadStatus,
  isValidStatus,
  canTransitionTo,
  getNextStatuses,
  parseStatus
} from '../value-objects/LeadStatus.js';

describe('LeadStatus enum', () => {
  test('should have all expected statuses', () => {
    assert.strictEqual(LeadStatus.NEW, 'new');
    assert.strictEqual(LeadStatus.CONTACTED, 'contacted');
    assert.strictEqual(LeadStatus.REPLIED, 'replied');
    assert.strictEqual(LeadStatus.QUALIFIED, 'qualified');
    assert.strictEqual(LeadStatus.CONVERTED, 'converted');
    assert.strictEqual(LeadStatus.IGNORED, 'ignored');
  });

  test('should be frozen (immutable)', () => {
    assert.ok(Object.isFrozen(LeadStatus));
  });
});

describe('isValidStatus', () => {
  test('should return true for valid statuses', () => {
    assert.strictEqual(isValidStatus('new'), true);
    assert.strictEqual(isValidStatus('contacted'), true);
    assert.strictEqual(isValidStatus('replied'), true);
    assert.strictEqual(isValidStatus('qualified'), true);
    assert.strictEqual(isValidStatus('converted'), true);
    assert.strictEqual(isValidStatus('ignored'), true);
  });

  test('should return false for invalid statuses', () => {
    assert.strictEqual(isValidStatus('unknown'), false);
    assert.strictEqual(isValidStatus(''), false);
    assert.strictEqual(isValidStatus(null), false);
    assert.strictEqual(isValidStatus(undefined), false);
  });
});

describe('canTransitionTo', () => {
  test('should allow NEW to CONTACTED', () => {
    assert.strictEqual(canTransitionTo(LeadStatus.NEW, LeadStatus.CONTACTED), true);
  });

  test('should allow NEW to IGNORED', () => {
    assert.strictEqual(canTransitionTo(LeadStatus.NEW, LeadStatus.IGNORED), true);
  });

  test('should not allow NEW to REPLIED', () => {
    assert.strictEqual(canTransitionTo(LeadStatus.NEW, LeadStatus.REPLIED), false);
  });

  test('should allow CONTACTED to REPLIED', () => {
    assert.strictEqual(canTransitionTo(LeadStatus.CONTACTED, LeadStatus.REPLIED), true);
  });

  test('should not allow CONVERTED to any status', () => {
    assert.strictEqual(canTransitionTo(LeadStatus.CONVERTED, LeadStatus.NEW), false);
    assert.strictEqual(canTransitionTo(LeadStatus.CONVERTED, LeadStatus.IGNORED), false);
  });

  test('should not allow IGNORED to any status', () => {
    assert.strictEqual(canTransitionTo(LeadStatus.IGNORED, LeadStatus.NEW), false);
  });

  test('should return false for invalid statuses', () => {
    assert.strictEqual(canTransitionTo('invalid', LeadStatus.NEW), false);
    assert.strictEqual(canTransitionTo(LeadStatus.NEW, 'invalid'), false);
  });
});

describe('getNextStatuses', () => {
  test('should return valid next statuses for NEW', () => {
    const next = getNextStatuses(LeadStatus.NEW);
    assert.deepStrictEqual(next, [LeadStatus.CONTACTED, LeadStatus.IGNORED]);
  });

  test('should return empty array for CONVERTED', () => {
    const next = getNextStatuses(LeadStatus.CONVERTED);
    assert.deepStrictEqual(next, []);
  });

  test('should return empty array for invalid status', () => {
    const next = getNextStatuses('invalid');
    assert.deepStrictEqual(next, []);
  });
});

describe('parseStatus', () => {
  test('should return valid status', () => {
    assert.strictEqual(parseStatus('contacted'), 'contacted');
  });

  test('should return fallback for invalid status', () => {
    assert.strictEqual(parseStatus('invalid'), LeadStatus.NEW);
  });

  test('should use custom fallback', () => {
    assert.strictEqual(parseStatus('invalid', LeadStatus.IGNORED), LeadStatus.IGNORED);
  });
});
