/**
 * Accounts Database Module
 *
 * Handles all account-related database operations.
 */

import { getDb } from './core.js';

/**
 * Get or create an account by name
 * @param {string} name - Account/profile name
 * @returns {Object} Account with id
 */
export function getOrCreateAccount(name) {
  const db = getDb();
  if (!name) {
    throw new Error('Account name (profile) is required. Please specify it using the --profile flag.');
  }

  const existing = db.prepare('SELECT * FROM accounts WHERE name = ?').get(name);
  if (existing) return existing;

  const result = db.prepare(`
    INSERT INTO accounts (name) VALUES (?)
    RETURNING *
  `).get(name);

  console.log(`📁 Created new account: ${name} (id: ${result.id})`);
  return result;
}

/**
 * Get all accounts
 * @returns {Array} List of accounts
 */
export function getAllAccounts() {
  const db = getDb();
  return db.prepare('SELECT * FROM accounts ORDER BY name').all();
}

/**
 * Get account by ID
 */
export function getAccountById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

/**
 * Set an account as the default dashboard account
 * @param {number} accountId
 */
export function setDefaultAccount(accountId) {
  const db = getDb();
  const transaction = db.transaction(() => {
    // Reset all
    db.prepare('UPDATE accounts SET is_default = 0').run();
    // Set new default
    if (accountId) {
      db.prepare('UPDATE accounts SET is_default = 1 WHERE id = ?').run(accountId);
    }
  });
  transaction();
  return { success: true };
}

/**
 * Get the default dashboard account
 */
export function getDefaultAccount() {
  const db = getDb();
  return db.prepare('SELECT * FROM accounts WHERE is_default = 1').get();
}
