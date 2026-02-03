/**
 * Warmth Value Object Tests
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  Warmth,
  isValidWarmth,
  calculateWarmth,
  compareWarmth,
  isHot,
  needsWarming,
  parseWarmth,
  getWarmthEmoji
} from '../value-objects/Warmth.js';

describe('Warmth enum', () => {
  test('should have all expected values', () => {
    assert.strictEqual(Warmth.COLD, 'cold');
    assert.strictEqual(Warmth.WARM, 'warm');
    assert.strictEqual(Warmth.HOT, 'hot');
  });

  test('should be frozen (immutable)', () => {
    assert.ok(Object.isFrozen(Warmth));
  });
});

describe('isValidWarmth', () => {
  test('should return true for valid warmth values', () => {
    assert.strictEqual(isValidWarmth('cold'), true);
    assert.strictEqual(isValidWarmth('warm'), true);
    assert.strictEqual(isValidWarmth('hot'), true);
  });

  test('should return false for invalid warmth values', () => {
    assert.strictEqual(isValidWarmth('lukewarm'), false);
    assert.strictEqual(isValidWarmth(''), false);
    assert.strictEqual(isValidWarmth(null), false);
  });
});

describe('calculateWarmth', () => {
  test('should return hot for engagement >= 80', () => {
    assert.strictEqual(calculateWarmth(80), Warmth.HOT);
    assert.strictEqual(calculateWarmth(100), Warmth.HOT);
  });

  test('should return warm for engagement >= 40 and < 80', () => {
    assert.strictEqual(calculateWarmth(40), Warmth.WARM);
    assert.strictEqual(calculateWarmth(79), Warmth.WARM);
  });

  test('should return cold for engagement < 40', () => {
    assert.strictEqual(calculateWarmth(0), Warmth.COLD);
    assert.strictEqual(calculateWarmth(39), Warmth.COLD);
  });
});

describe('compareWarmth', () => {
  test('should return negative when a < b', () => {
    assert.ok(compareWarmth(Warmth.COLD, Warmth.HOT) < 0);
    assert.ok(compareWarmth(Warmth.WARM, Warmth.HOT) < 0);
  });

  test('should return positive when a > b', () => {
    assert.ok(compareWarmth(Warmth.HOT, Warmth.COLD) > 0);
    assert.ok(compareWarmth(Warmth.WARM, Warmth.COLD) > 0);
  });

  test('should return zero when equal', () => {
    assert.strictEqual(compareWarmth(Warmth.WARM, Warmth.WARM), 0);
  });
});

describe('isHot', () => {
  test('should return true for hot', () => {
    assert.strictEqual(isHot(Warmth.HOT), true);
  });

  test('should return false for non-hot', () => {
    assert.strictEqual(isHot(Warmth.WARM), false);
    assert.strictEqual(isHot(Warmth.COLD), false);
  });
});

describe('needsWarming', () => {
  test('should return true for cold', () => {
    assert.strictEqual(needsWarming(Warmth.COLD), true);
  });

  test('should return false for warm and hot', () => {
    assert.strictEqual(needsWarming(Warmth.WARM), false);
    assert.strictEqual(needsWarming(Warmth.HOT), false);
  });
});

describe('parseWarmth', () => {
  test('should return valid warmth', () => {
    assert.strictEqual(parseWarmth('warm'), 'warm');
  });

  test('should return fallback for invalid', () => {
    assert.strictEqual(parseWarmth('invalid'), Warmth.COLD);
  });

  test('should use custom fallback', () => {
    assert.strictEqual(parseWarmth('invalid', Warmth.HOT), Warmth.HOT);
  });
});

describe('getWarmthEmoji', () => {
  test('should return correct emojis', () => {
    assert.strictEqual(getWarmthEmoji(Warmth.HOT), '🔥');
    assert.strictEqual(getWarmthEmoji(Warmth.WARM), '🌡️');
    assert.strictEqual(getWarmthEmoji(Warmth.COLD), '❄️');
  });

  test('should return question mark for unknown', () => {
    assert.strictEqual(getWarmthEmoji('unknown'), '❓');
  });
});
