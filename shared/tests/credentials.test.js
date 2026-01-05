import test from 'node:test';
import assert from 'node:assert';
import { normalizeProfileName, getCredentialsForProfile } from '../credentials.js';

test('normalizeProfileName', (t) => {
  assert.strictEqual(normalizeProfileName('default'), '');
  assert.strictEqual(normalizeProfileName(''), '');
  assert.strictEqual(normalizeProfileName('lifestyle'), 'LIFESTYLE');
  assert.strictEqual(normalizeProfileName('my-profile'), 'MY_PROFILE');
  assert.strictEqual(normalizeProfileName('Test_123'), 'TEST_123');
});

test('getCredentialsForProfile - global fallback', (t) => {
  // Mock env
  process.env.INSTAGRAM_USERNAME = 'global_user';
  process.env.INSTAGRAM_PASSWORD = 'global_password';
  
  const creds = getCredentialsForProfile('any');
  assert.strictEqual(creds.username, 'global_user');
  assert.strictEqual(creds.password, 'global_password');
});

test('getCredentialsForProfile - profile specific', (t) => {
  // Mock env
  process.env.INSTAGRAM_USERNAME_BUSINESS = 'business_user';
  process.env.INSTAGRAM_PASSWORD_BUSINESS = 'business_password';
  
  const creds = getCredentialsForProfile('business');
  assert.strictEqual(creds.username, 'business_user');
  assert.strictEqual(creds.password, 'business_password');
});

test('getCredentialsForProfile - profile specific with hyphen', (t) => {
  // Mock env
  process.env.INSTAGRAM_USERNAME_MY_ACCOUNT = 'hyphen_user';
  process.env.INSTAGRAM_PASSWORD_MY_ACCOUNT = 'hyphen_password';
  
  const creds = getCredentialsForProfile('my-account');
  assert.strictEqual(creds.username, 'hyphen_user');
  assert.strictEqual(creds.password, 'hyphen_password');
});
