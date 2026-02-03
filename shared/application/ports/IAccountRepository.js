/**
 * IAccountRepository - Account Repository Interface (Port)
 *
 * Defines the contract for account data access.
 * Infrastructure layer implements this interface.
 */

/**
 * Account Repository Interface
 */
export const IAccountRepository = {
  /**
   * Find account by ID
   * @param {number} id
   * @returns {Promise<Account|null>}
   */
  findById: async (id) => { throw new Error('Not implemented'); },

  /**
   * Find account by name
   * @param {string} name
   * @returns {Promise<Account|null>}
   */
  findByName: async (name) => { throw new Error('Not implemented'); },

  /**
   * Get or create account by name
   * @param {string} name
   * @returns {Promise<Account>}
   */
  getOrCreate: async (name) => { throw new Error('Not implemented'); },

  /**
   * Get all accounts
   * @returns {Promise<Account[]>}
   */
  findAll: async () => { throw new Error('Not implemented'); },

  /**
   * Get the default account
   * @returns {Promise<Account|null>}
   */
  getDefault: async () => { throw new Error('Not implemented'); },

  /**
   * Set account as default
   * @param {number} id
   * @returns {Promise<boolean>}
   */
  setDefault: async (id) => { throw new Error('Not implemented'); },

  /**
   * Save account
   * @param {Account} account
   * @returns {Promise<Account>}
   */
  save: async (account) => { throw new Error('Not implemented'); },

  /**
   * Delete account
   * @param {number} id
   * @returns {Promise<boolean>}
   */
  delete: async (id) => { throw new Error('Not implemented'); }
};

/**
 * Create a repository instance that validates interface compliance
 * @param {Object} implementation
 * @returns {Object}
 */
export function createAccountRepository(implementation) {
  const required = Object.keys(IAccountRepository);
  const missing = required.filter(method => typeof implementation[method] !== 'function');

  if (missing.length > 0) {
    throw new Error(`AccountRepository missing methods: ${missing.join(', ')}`);
  }

  return implementation;
}

export default IAccountRepository;
