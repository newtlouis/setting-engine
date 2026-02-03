/**
 * IConversationRepository - Conversation Repository Interface (Port)
 *
 * Defines the contract for conversation/message data access.
 * Infrastructure layer implements this interface.
 */

/**
 * Conversation Repository Interface
 */
export const IConversationRepository = {
  /**
   * Get conversation history for a lead
   * @param {number} leadId
   * @returns {Promise<Conversation>}
   */
  getByLeadId: async (leadId) => { throw new Error('Not implemented'); },

  /**
   * Get conversation by username
   * @param {string} username
   * @param {number} [accountId]
   * @returns {Promise<Conversation|null>}
   */
  getByUsername: async (username, accountId) => { throw new Error('Not implemented'); },

  /**
   * Add a message to conversation
   * @param {number} leadId
   * @param {Message} message
   * @returns {Promise<Message>}
   */
  addMessage: async (leadId, message) => { throw new Error('Not implemented'); },

  /**
   * Get last N messages for a lead
   * @param {number} leadId
   * @param {number} [limit=10]
   * @returns {Promise<Message[]>}
   */
  getLastMessages: async (leadId, limit) => { throw new Error('Not implemented'); },

  /**
   * Get messages for AI context (formatted for prompts)
   * @param {number} leadId
   * @param {number} [limit=10]
   * @returns {Promise<Array<{role: string, content: string}>>}
   */
  getMessagesForAI: async (leadId, limit) => { throw new Error('Not implemented'); },

  /**
   * Count messages for a lead
   * @param {number} leadId
   * @returns {Promise<{sent: number, received: number}>}
   */
  countMessages: async (leadId) => { throw new Error('Not implemented'); },

  /**
   * Check if lead has unanswered message
   * @param {number} leadId
   * @returns {Promise<boolean>}
   */
  hasUnansweredMessage: async (leadId) => { throw new Error('Not implemented'); },

  /**
   * Get leads with unanswered messages
   * @param {number} accountId
   * @returns {Promise<Array<{leadId: number, username: string, lastMessage: Message}>>}
   */
  getUnansweredConversations: async (accountId) => { throw new Error('Not implemented'); }
};

/**
 * Create a repository instance that validates interface compliance
 * @param {Object} implementation
 * @returns {Object}
 */
export function createConversationRepository(implementation) {
  const required = Object.keys(IConversationRepository);
  const missing = required.filter(method => typeof implementation[method] !== 'function');

  if (missing.length > 0) {
    throw new Error(`ConversationRepository missing methods: ${missing.join(', ')}`);
  }

  return implementation;
}

export default IConversationRepository;
