/**
 * SQLite Account Repository
 *
 * Implements IAccountRepository using the existing SQLite database.
 * Wraps db/accounts.js functions and returns domain entities.
 */

import { Account } from '../../domain/entities/Account.js';
import { createAccountRepository } from '../../application/ports/IAccountRepository.js';

/**
 * Create SQLite Account Repository
 *
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getDb - Function to get database instance
 * @returns {Object} Repository implementation
 */
export function createSqliteAccountRepository({ getDb }) {
  const implementation = {
    async findById(id) {
      const db = getDb();
      const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
      return row ? Account.fromDbRow(row) : null;
    },

    async findByName(name) {
      const db = getDb();
      const row = db.prepare('SELECT * FROM accounts WHERE name = ?').get(name);
      return row ? Account.fromDbRow(row) : null;
    },

    async getOrCreate(name) {
      if (!name) {
        throw new Error('Account name is required');
      }

      const db = getDb();

      // Check existing
      const existing = db.prepare('SELECT * FROM accounts WHERE name = ?').get(name);
      if (existing) {
        return Account.fromDbRow(existing);
      }

      // Create new
      const row = db.prepare(`
        INSERT INTO accounts (name) VALUES (?)
        RETURNING *
      `).get(name);

      return Account.fromDbRow(row);
    },

    async findAll() {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM accounts ORDER BY name').all();
      return rows.map(row => Account.fromDbRow(row));
    },

    async getDefault() {
      const db = getDb();
      const row = db.prepare('SELECT * FROM accounts WHERE is_default = 1').get();
      return row ? Account.fromDbRow(row) : null;
    },

    async setDefault(id) {
      const db = getDb();

      const transaction = db.transaction(() => {
        // Reset all
        db.prepare('UPDATE accounts SET is_default = 0').run();
        // Set new default
        if (id) {
          db.prepare('UPDATE accounts SET is_default = 1 WHERE id = ?').run(id);
        }
      });

      transaction();
      return true;
    },

    async save(account) {
      const db = getDb();
      const data = account.toDbRow();

      if (account.id) {
        // Update existing
        db.prepare(`
          UPDATE accounts SET
            name = ?,
            ig_username = ?,
            description = ?,
            is_default = ?
          WHERE id = ?
        `).run(data.name, data.ig_username, data.description, data.is_default, data.id);

        return account;
      } else {
        // Insert new
        const row = db.prepare(`
          INSERT INTO accounts (name, ig_username, description, is_default)
          VALUES (?, ?, ?, ?)
          RETURNING *
        `).get(data.name, data.ig_username, data.description, data.is_default);

        return Account.fromDbRow(row);
      }
    },

    async delete(id) {
      const db = getDb();
      const result = db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
      return result.changes > 0;
    }
  };

  return createAccountRepository(implementation);
}

export default createSqliteAccountRepository;
