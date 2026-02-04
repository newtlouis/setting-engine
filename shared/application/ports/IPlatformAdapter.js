/**
 * IPlatformAdapter Interface
 *
 * Contract for platform-specific implementations (Instagram, TikTok, LinkedIn).
 * Each platform must implement these methods to integrate with the lead engine.
 */

/**
 * @typedef {Object} PlatformSession
 * @property {Object} browser - Browser instance
 * @property {Object} page - Active page
 * @property {string} platform - Platform name
 * @property {string} profile - Profile/account name
 */

/**
 * @typedef {Object} ScrapedProfile
 * @property {boolean} success
 * @property {string} username
 * @property {string} fullName
 * @property {string} bio
 * @property {string} profileUrl
 * @property {number} followersCount
 * @property {boolean} isVerified
 * @property {boolean} isPrivate
 * @property {string} [error]
 */

/**
 * @typedef {Object} ScrapedMessage
 * @property {string} role - 'user' or 'assistant'
 * @property {string} text
 * @property {string} [timestamp]
 */

/**
 * @typedef {Object} DMResult
 * @property {boolean} success
 * @property {Object} [tab] - Browser tab with open DM
 * @property {string} [dmUrl]
 * @property {ScrapedMessage[]} scrapedMessages
 * @property {string} [error]
 */

/**
 * @typedef {Object} SendResult
 * @property {boolean} success
 * @property {string} [error]
 */

/**
 * Platform Adapter Interface
 *
 * @typedef {Object} IPlatformAdapter
 * @property {string} platform - Platform identifier ('instagram', 'tiktok', 'linkedin')
 * @property {Function} initSession - Initialize browser session
 * @property {Function} login - Handle platform login
 * @property {Function} scrapeProfile - Scrape user profile metadata
 * @property {Function} openDM - Open direct message with user
 * @property {Function} scrapeConversation - Scrape messages from open DM
 * @property {Function} sendMessage - Send a message in open DM
 * @property {Function} typeMessage - Type message without sending (for review)
 * @property {Function} closeSession - Close browser session
 */

/**
 * Create a platform adapter with validation
 *
 * @param {Object} implementation - Platform-specific implementation
 * @returns {IPlatformAdapter}
 */
export function createPlatformAdapter(implementation) {
  const required = [
    'platform',
    'initSession',
    'login',
    'scrapeProfile',
    'openDM',
    'scrapeConversation',
    'sendMessage',
    'typeMessage',
    'closeSession'
  ];

  for (const method of required) {
    if (!(method in implementation)) {
      throw new Error(`PlatformAdapter missing required method: ${method}`);
    }
  }

  return Object.freeze({
    platform: implementation.platform,

    /**
     * Initialize browser session for this platform
     * @param {Object} options
     * @param {string} options.profile - Account/profile name
     * @param {boolean} [options.headless=false]
     * @returns {Promise<PlatformSession>}
     */
    initSession: implementation.initSession,

    /**
     * Handle platform-specific login
     * @param {PlatformSession} session
     * @returns {Promise<boolean>}
     */
    login: implementation.login,

    /**
     * Scrape user profile metadata
     * @param {PlatformSession} session
     * @param {string} username
     * @returns {Promise<ScrapedProfile>}
     */
    scrapeProfile: implementation.scrapeProfile,

    /**
     * Open DM conversation with user
     * @param {PlatformSession} session
     * @param {string} username
     * @param {string} [profileUrl]
     * @returns {Promise<DMResult>}
     */
    openDM: implementation.openDM,

    /**
     * Scrape messages from currently open DM
     * @param {Object} tab - Browser tab with open DM
     * @returns {Promise<ScrapedMessage[]>}
     */
    scrapeConversation: implementation.scrapeConversation,

    /**
     * Send a message in the open DM
     * @param {Object} tab - Browser tab with open DM
     * @param {string} message
     * @returns {Promise<SendResult>}
     */
    sendMessage: implementation.sendMessage,

    /**
     * Type message without sending (for human review)
     * @param {Object} tab - Browser tab with open DM
     * @param {string} message
     * @returns {Promise<void>}
     */
    typeMessage: implementation.typeMessage,

    /**
     * Close browser session
     * @param {PlatformSession} session
     * @returns {Promise<void>}
     */
    closeSession: implementation.closeSession
  });
}

/**
 * Platform identifiers
 */
export const Platform = Object.freeze({
  INSTAGRAM: 'instagram',
  TIKTOK: 'tiktok',
  LINKEDIN: 'linkedin'
});

export default { createPlatformAdapter, Platform };
