/**
 * Database Module Index
 *
 * Re-exports all database functions from split modules.
 * This provides an alternative import path: import { ... } from './db/index.js'
 */

// Core (init, singleton, migrations)
export {
  initDatabase,
  getDatabase,
  closeDatabase,
  getDb
} from './core.js';

// Accounts
export {
  getOrCreateAccount,
  getAllAccounts,
  getAccountById,
  setDefaultAccount,
  getDefaultAccount
} from './accounts.js';

// Leads
export {
  saveLeads,
  getLeadByUsername,
  getLeadById,
  getLeads,
  updateLeadEngagement,
  updateLeadStatus,
  updateLeadProfile,
  markLeadUncontactable,
  markLeadFailed,
  upsertLead,
  updateLeadDmStatus,
  updateDmThreadStatus,
  fullUpsertLead,
  getLeadsForResponder
} from './leads.js';

// Comments
export {
  insertComment,
  getCommentsForLead,
  getComments,
  insertCommentsBatch
} from './comments.js';

// Posts
export {
  upsertPost,
  markPostScraped,
  getUnscrapedPosts,
  isPostScraped,
  getRecentlyScrapedPosts
} from './posts.js';

// Conversations
export {
  addConversationMessage,
  getConversation
} from './conversations.js';

// Statistics
export {
  getStats,
  recalculateAllEngagement,
  calculateEngagementMetrics
} from './statistics.js';

// Follow-up
export {
  getNextFollowupTemplate,
  updateLeadLastFollowup,
  getFollowupCountForStep
} from './followup.js';

// Test Scenarios
export {
  createScenario,
  getScenarios,
  getScenarioById,
  deleteScenario,
  updateScenario,
  saveScenarioResult,
  getScenarioResults
} from './testScenarios.js';

// Outreach Queue
export {
  addToOutreachQueue,
  getQueuedLeads,
  markQueuedLeadSent,
  markQueuedLeadFailed,
  getQueueCount,
  cleanupOutreachQueue
} from './outreachQueue.js';
