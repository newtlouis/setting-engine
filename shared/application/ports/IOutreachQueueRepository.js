/**
 * IOutreachQueueRepository - Outreach Queue Repository Interface (Port)
 *
 * Defines the contract for outreach queue data access.
 * Infrastructure layer implements this interface.
 */

/**
 * @typedef {Object} QueuedLead
 * @property {number} id
 * @property {string} username
 * @property {string} profileUrl
 * @property {string} dmUrl
 * @property {string} preparedMessage
 * @property {string} [firstName]
 * @property {string} source
 * @property {string} status - 'pending' | 'sent' | 'failed'
 * @property {string} [error]
 * @property {string} createdAt
 * @property {string} [sentAt]
 */

/**
 * Outreach Queue Repository Interface
 */
export const IOutreachQueueRepository = {
  /**
   * Add lead to outreach queue
   * @param {Object} queueEntry
   * @returns {Promise<QueuedLead>}
   */
  add: async (queueEntry) => { throw new Error('Not implemented'); },

  /**
   * Add multiple leads to queue
   * @param {Object[]} entries
   * @returns {Promise<number>} Number added
   */
  addMany: async (entries) => { throw new Error('Not implemented'); },

  /**
   * Get pending leads from queue
   * @param {number} [limit]
   * @returns {Promise<QueuedLead[]>}
   */
  getPending: async (limit) => { throw new Error('Not implemented'); },

  /**
   * Mark queue entry as sent
   * @param {string} username
   * @returns {Promise<boolean>}
   */
  markSent: async (username) => { throw new Error('Not implemented'); },

  /**
   * Mark queue entry as failed
   * @param {string} username
   * @param {string} error
   * @returns {Promise<boolean>}
   */
  markFailed: async (username, error) => { throw new Error('Not implemented'); },

  /**
   * Increment retry count for retryable errors (keeps status pending)
   * If max retries reached, marks as failed
   * @param {string} username
   * @param {string} error
   * @param {number} [maxRetries=3]
   * @returns {Promise<boolean>}
   */
  incrementRetry: async (username, error, maxRetries) => { throw new Error('Not implemented'); },

  /**
   * Check if username is already in queue
   * @param {string} username
   * @returns {Promise<boolean>}
   */
  exists: async (username) => { throw new Error('Not implemented'); },

  /**
   * Get queue statistics
   * @returns {Promise<{pending: number, sent: number, failed: number}>}
   */
  getStats: async () => { throw new Error('Not implemented'); },

  /**
   * Clear old entries from queue
   * @param {number} daysOld
   * @returns {Promise<number>} Number removed
   */
  clearOld: async (daysOld) => { throw new Error('Not implemented'); }
};

/**
 * Create a repository instance that validates interface compliance
 * @param {Object} implementation
 * @returns {Object}
 */
export function createOutreachQueueRepository(implementation) {
  const required = Object.keys(IOutreachQueueRepository);
  const missing = required.filter(method => typeof implementation[method] !== 'function');

  if (missing.length > 0) {
    throw new Error(`OutreachQueueRepository missing methods: ${missing.join(', ')}`);
  }

  return implementation;
}

export default IOutreachQueueRepository;
