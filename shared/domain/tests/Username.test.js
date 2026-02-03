/**
 * Username Value Object Tests
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  validateUsername,
  isValidUsername,
  normalizeUsername,
  extractUsernameFromUrl,
  buildProfileUrl,
  buildDmUrl
} from '../value-objects/Username.js';

describe('validateUsername', () => {
  test('should accept valid usernames', () => {
    assert.deepStrictEqual(validateUsername('john_doe'), { valid: true });
    assert.deepStrictEqual(validateUsername('user123'), { valid: true });
    assert.deepStrictEqual(validateUsername('a.b.c'), { valid: true });
    assert.deepStrictEqual(validateUsername('x'), { valid: true });
  });

  test('should reject empty or null usernames', () => {
    assert.strictEqual(validateUsername('').valid, false);
    assert.strictEqual(validateUsername(null).valid, false);
    assert.strictEqual(validateUsername(undefined).valid, false);
    assert.ok(validateUsername('').error.includes('required') || validateUsername('').error.includes('empty'));
  });

  test('should reject usernames over 30 characters', () => {
    const longUsername = 'a'.repeat(31);
    const result = validateUsername(longUsername);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('30'));
  });

  test('should reject invalid characters', () => {
    const result = validateUsername('user@name');
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('letters'));
  });

  test('should reject consecutive periods', () => {
    const result = validateUsername('user..name');
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('consecutive'));
  });

  test('should reject usernames starting with period', () => {
    const result = validateUsername('.username');
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('start'));
  });

  test('should reject usernames ending with period', () => {
    const result = validateUsername('username.');
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('end'));
  });
});

describe('isValidUsername', () => {
  test('should return true for valid username', () => {
    assert.strictEqual(isValidUsername('john_doe'), true);
  });

  test('should return false for invalid username', () => {
    assert.strictEqual(isValidUsername(''), false);
    assert.strictEqual(isValidUsername('user@name'), false);
  });
});

describe('normalizeUsername', () => {
  test('should trim whitespace', () => {
    assert.strictEqual(normalizeUsername('  username  '), 'username');
  });

  test('should remove @ prefix', () => {
    assert.strictEqual(normalizeUsername('@username'), 'username');
  });

  test('should lowercase', () => {
    assert.strictEqual(normalizeUsername('UserName'), 'username');
  });

  test('should handle combined normalization', () => {
    assert.strictEqual(normalizeUsername('  @UserName  '), 'username');
  });

  test('should return empty string for invalid input', () => {
    assert.strictEqual(normalizeUsername(null), '');
    assert.strictEqual(normalizeUsername(undefined), '');
  });
});

describe('extractUsernameFromUrl', () => {
  test('should extract username from profile URL', () => {
    assert.strictEqual(extractUsernameFromUrl('https://www.instagram.com/john_doe/'), 'john_doe');
    assert.strictEqual(extractUsernameFromUrl('https://instagram.com/john_doe'), 'john_doe');
  });

  test('should extract username from URL with query params', () => {
    assert.strictEqual(extractUsernameFromUrl('https://instagram.com/john_doe/?hl=en'), 'john_doe');
  });

  test('should return null for reserved paths', () => {
    assert.strictEqual(extractUsernameFromUrl('https://instagram.com/p/abc123/'), null);
    assert.strictEqual(extractUsernameFromUrl('https://instagram.com/reel/xyz/'), null);
    assert.strictEqual(extractUsernameFromUrl('https://instagram.com/stories/user/'), null);
    assert.strictEqual(extractUsernameFromUrl('https://instagram.com/explore/'), null);
  });

  test('should return null for invalid input', () => {
    assert.strictEqual(extractUsernameFromUrl(null), null);
    assert.strictEqual(extractUsernameFromUrl('not a url'), null);
  });

  test('should lowercase extracted username', () => {
    assert.strictEqual(extractUsernameFromUrl('https://instagram.com/JohnDoe/'), 'johndoe');
  });
});

describe('buildProfileUrl', () => {
  test('should build correct profile URL', () => {
    assert.strictEqual(buildProfileUrl('john_doe'), 'https://www.instagram.com/john_doe/');
  });

  test('should normalize username before building', () => {
    assert.strictEqual(buildProfileUrl('@JohnDoe'), 'https://www.instagram.com/johndoe/');
  });
});

describe('buildDmUrl', () => {
  test('should build correct DM URL', () => {
    assert.strictEqual(buildDmUrl('john_doe'), 'https://www.instagram.com/direct/t/john_doe/');
  });

  test('should normalize username before building', () => {
    assert.strictEqual(buildDmUrl('@JohnDoe'), 'https://www.instagram.com/direct/t/johndoe/');
  });
});
