/**
 * ILeadRepository - Lead Repository Interface (Port)
 *
 * Defines the contract for lead data access.
 * Infrastructure layer implements this interface.
 *
 * This is a "port" in hexagonal architecture terms.
 */

/**
 * @typedef {Object} LeadFilters
 * @property {number} [accountId] - Filter by account
 * @property {string} [status] - Filter by status
 * @property {string} [warmth] - Filter by warmth
 * @property {number} [minEngagementScore] - Minimum engagement score
 * @property {boolean} [includeIgnored] - Include ignored leads
 * @property {number} [limit] - Maximum results
 */

/**
 * Lead Repository Interface
 *
 * All methods should be implemented by the infrastructure layer.
 * Methods return domain entities (Lead), not raw database rows.
 */
export const ILeadRepository = {
  /**
   * Find a lead by ID
   * @param {number} id
   * @returns {Promise<Lead|null>}
   */
  findById: async (id) => { throw new Error('Not implemented'); },

  /**
   * Find a lead by username
   * @param {string} username
   * @param {number} [accountId]
   * @returns {Promise<Lead|null>}
   */
  findByUsername: async (username, accountId) => { throw new Error('Not implemented'); },

  /**
   * Find leads matching filters
   * @param {LeadFilters} filters
   * @returns {Promise<Lead[]>}
   */
  findAll: async (filters) => { throw new Error('Not implemented'); },

  /**
   * Find leads ready for outreach (new, qualified, not ignored)
   * @param {number} accountId
   * @param {number} [limit]
   * @returns {Promise<Lead[]>}
   */
  findForOutreach: async (accountId, limit) => { throw new Error('Not implemented'); },

  /**
   * Find leads that need follow-up
   * @param {number} accountId
   * @param {number} [limit]
   * @returns {Promise<Lead[]>}
   */
  findNeedingFollowUp: async (accountId, limit) => { throw new Error('Not implemented'); },

  /**
   * Save a lead (insert or update)
   * @param {Lead} lead
   * @returns {Promise<Lead>}
   */
  save: async (lead) => { throw new Error('Not implemented'); },

  /**
   * Save multiple leads in a transaction
   * @param {Lead[]} leads
   * @returns {Promise<number>} Number of leads saved
   */
  saveMany: async (leads) => { throw new Error('Not implemented'); },

  /**
   * Update lead status
   * @param {string} username
   * @param {string} status
   * @returns {Promise<boolean>}
   */
  updateStatus: async (username, status) => { throw new Error('Not implemented'); },

  /**
   * Update lead engagement metrics
   * @param {string} username
   * @param {{ totalComments: number, engagementScore: number }} metrics
   * @returns {Promise<boolean>}
   */
  updateEngagement: async (username, metrics) => { throw new Error('Not implemented'); },

  /**
   * Mark lead as contacted
   * @param {string} username
   * @param {string} [dmUrl]
   * @returns {Promise<boolean>}
   */
  markContacted: async (username, dmUrl) => { throw new Error('Not implemented'); },

  /**
   * Mark lead as failed/uncontactable
   * @param {string} username
   * @param {string} reason
   * @returns {Promise<boolean>}
   */
  markFailed: async (username, reason) => { throw new Error('Not implemented'); },

  /**
   * Ignore a lead
   * @param {string} username
   * @returns {Promise<boolean>}
   */
  ignore: async (username) => { throw new Error('Not implemented'); },

  /**
   * Count leads by status
   * @param {number} accountId
   * @returns {Promise<Record<string, number>>}
   */
  countByStatus: async (accountId) => { throw new Error('Not implemented'); }
};

/**
 * Create a repository instance that validates interface compliance
 * @param {Object} implementation
 * @returns {Object}
 */
export function createLeadRepository(implementation) {
  const required = Object.keys(ILeadRepository);
  const missing = required.filter(method => typeof implementation[method] !== 'function');

  if (missing.length > 0) {
    throw new Error(`LeadRepository missing methods: ${missing.join(', ')}`);
  }

  return implementation;
}

export default ILeadRepository;
