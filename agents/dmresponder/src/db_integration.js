/**
 * Database Integration for DM Responder
 * 
 * Connects to the shared SQLite database to:
 * - Load conversation history for a lead
 * - Load lead context (bio, pain points, engagement)
 * - Save generated responses and user messages
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { getContainer } from '../../../shared/container.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to collector's database module
const DB_PATH = path.join(__dirname, '..', '..', 'collector', 'permanent-data', 'leads.db');
const DB_MODULE_PATH = path.join(__dirname, '..', '..', 'collector', 'src', 'database.js');

let db = null;
let dbFunctions = null;
let container = null;

/**
 * Initialize database connection
 */
export async function initDB() {
  if (dbFunctions) return dbFunctions;

  try {
    // Initialize container (handles database + repositories + use cases)
    container = await getContainer(DB_PATH);
    db = container.getDb();

    // Load legacy dbFunctions for backward compatibility
    const dbModule = await import(DB_MODULE_PATH);
    dbFunctions = dbModule;
    return dbFunctions;
  } catch (error) {
    console.error('Warning: Could not connect to database:', error.message);
    return null;
  }
}

/**
 * Get lead by username with full context
 *
 * @param {string} username - Instagram username
 * @returns {Promise<Object|null>} Lead with context
 */
export async function getLeadWithContext(username, accountId = null) {
  await initDB();
  if (!container) return null;

  try {
    // Use repository to get lead
    const lead = await container.repositories.lead.findByUsername(username, accountId);
    if (!lead) return null;

    // Get comments for context (still using legacy for now)
    const comments = dbFunctions?.getCommentsForLead ? dbFunctions.getCommentsForLead(lead.id) : [];

    // Build lead context object (compatible with existing leadContext format)
    const context = {
      username: lead.username,
      profile_url: lead.profileUrl,

      // Profile data
      followers_count: 0,
      bio: lead.bio || '[Bio not scraped]',
      is_verified: false,
      is_business: false,
      is_private: false,

      // Engagement
      engagement_level: lead.warmth,
      engagement_score: lead.engagementScore,
      total_comments: lead.totalComments,

      // Qualification
      warmth: lead.warmth || 'cold',
      pain_points: lead.painPoints || [],

      // Funnel state
      funnel_step: lead.funnelStep || 0,
      booking_status: lead.bookingStatus || null,
      status: lead.status,
      is_ignored: lead.isIgnored,
      total_messages_sent: lead.totalMessagesSent,
      total_messages_received: lead.totalMessagesReceived,

      // Original comments for reference
      original_comments: comments.map(c => ({
        text: c.comment_text,
        date: c.comment_date,
        post_url: c.post_url
      }))
    };

    // Extract pain points from comments if not already set
    if (context.pain_points.length === 0) {
      const extractedPains = extractPainPointsFromComments(comments);
      context.pain_points = extractedPains;
    }

    return context;
  } catch (error) {
    console.error('Error getting lead context:', error.message);
    return null;
  }
}

/**
 * Extract pain points from comments
 */
function extractPainPointsFromComments(comments) {
  const painPoints = [];
  const painPatterns = [
    /struggl\w* with ([^.,!?]+)/i,
    /can't (seem to )?([^.,!?]+)/i,
    /problem with ([^.,!?]+)/i,
    /frustrated (with|about) ([^.,!?]+)/i,
    /need help (with )?([^.,!?]+)/i,
    /stuck (with|on) ([^.,!?]+)/i,
    /don't know how to ([^.,!?]+)/i
  ];
  
  for (const comment of comments) {
    const text = comment.comment_text || '';
    for (const pattern of painPatterns) {
      const match = text.match(pattern);
      if (match) {
        const pain = match[match.length - 1].trim();
        if (pain && !painPoints.includes(pain)) {
          painPoints.push(pain);
        }
      }
    }
  }
  
  return painPoints;
}

/**
 * Get conversation history for a lead
 *
 * @param {string} username - Instagram username
 * @param {number} accountId - Optional account ID
 * @returns {Promise<Array>} Conversation history
 */
export async function getConversationHistory(username, accountId = null) {
  await initDB();
  if (!db || !container) return [];

  try {
    // Use GetConversationHistory use case
    const result = await container.useCases.getConversationHistory.execute(username, accountId);

    if (!result) return [];

    // Convert to format expected by engine
    return result.messages.map(msg => ({
      role: msg.role,
      text: msg.text,
      type: msg.type,
      timestamp: msg.sentAt
    }));
  } catch (error) {
    console.error('Error getting conversation history:', error.message);
    return [];
  }
}

/**
 * Add a message to the conversation (either from user or assistant)
 *
 * @param {string} username - Instagram username
 * @param {string} role - 'user' or 'assistant'
 * @param {string} message - Message text
 * @param {string} messageType - Type of message (empathy, qualification, etc.)
 * @returns {Promise<boolean>} Success
 */
export async function addMessage(username, role, message, messageType = null, accountId = null) {
  await initDB();
  if (!db || !container) return false;

  try {
    // Use RecordMessage use case
    const direction = role === 'user' ? 'incoming' : 'outgoing';
    const result = await container.useCases.recordMessage.execute({
      username,
      text: message,
      direction,
      type: messageType,
      accountId
    });

    if (!result.message) {
      console.error(`Failed to record message for @${username}`);
      return false;
    }

    // Log status change if first reply
    if (result.isFirstReply) {
      console.log(`   🔄 Lead @${username} first reply recorded!`);
    }

    return true;
  } catch (error) {
    console.error('Error adding message:', error.message);
    return false;
  }
}

/**
 * Update conversation stage for a lead
 * 
 * @param {string} username - Instagram username
 * @param {string} stage - New conversation stage
 */
export async function updateConversationStage(username, stage) {
  // DEPRECATED: conversation_stage field removed
  // Use status and booking_status instead
  console.warn('updateConversationStage is deprecated - use status/booking_status instead');
}

/**
 * Get all leads with active conversations (replied but not closed)
 * 
 * @returns {Promise<Array>} List of leads with active conversations
 */
export async function getActiveConversations(accountId = null) {
  await initDB();
  if (!db) return [];
  
  const leads = db.prepare(`
    SELECT l.*,
           (SELECT COUNT(*) FROM conversations c WHERE c.lead_id = l.id) as message_count,
           (SELECT MAX(sent_at) FROM conversations c WHERE c.lead_id = l.id) as last_message_at
    FROM leads l
    WHERE l.status IN ('contacted', 'replied', 'qualified')
      AND (l.booking_status IS NULL OR l.booking_status != 'completed')
      AND l.total_messages_sent > 0
      AND l.is_ignored = 0
      ${accountId ? 'AND l.account_id = ' + accountId : ''}
    ORDER BY last_message_at DESC
  `).all();
  
  return leads;
}

/**
 * Get conversation summary for display
 *
 * @param {string} username - Instagram username
 * @param {number} accountId - Optional account ID for filtering
 * @returns {Promise<Object>} Conversation summary
 */
export async function getConversationSummary(username, accountId = null) {
  await initDB();
  if (!container) return null;

  try {
    const lead = await container.repositories.lead.findByUsername(username, accountId);
    if (!lead) return null;

    const messages = await getConversationHistory(username, accountId);
    const context = await getLeadWithContext(username, accountId);

    return {
      username: lead.username,
      status: lead.status,
      stage: lead.conversationStage,
      message_count: messages.length,
      last_message: messages.length > 0 ? messages[messages.length - 1] : null,
      engagement_level: lead.warmth,
      warmth: lead.warmth,
      pain_points: context?.pain_points || [],
      bio_excerpt: null
    };
  } catch (error) {
    console.error('Error getting conversation summary:', error.message);
    return null;
  }
}

export async function getTrackedDmThreads(filters = {}) {
  await initDB();
  if (!dbFunctions?.getLeadsForResponder) return [];
  return dbFunctions.getLeadsForResponder(filters);
}

export async function setDmThreadStatus(username, status, updates = {}) {
  await initDB();
  if (!dbFunctions?.updateDmThreadStatus) return;
  return dbFunctions.updateDmThreadStatus(username, status, updates);
}

export async function fullUpsertLead(username, accountId, data) {
  await initDB();
  if (!dbFunctions?.fullUpsertLead) return null;
  return dbFunctions.fullUpsertLead(username, accountId, data);
}

export async function getOrCreateAccount(name) {
  await initDB();
  if (!container) return null;

  try {
    // Use repository
    const account = await container.repositories.account.getOrCreate(name);
    return account ? account.toJSON() : null;
  } catch (error) {
    console.error('Error getting/creating account:', error.message);
    return null;
  }
}

export function parseThreadMetadata(rawMetadata) {
  if (!rawMetadata) return {};
  if (typeof rawMetadata === 'object') return rawMetadata;
  try {
    return JSON.parse(rawMetadata);
  } catch (error) {
    return {};
  }
}
 
 export default {
   initDB,
   getLeadWithContext,
   getConversationHistory,
   addMessage,
   updateConversationStage,
   getActiveConversations,
   getConversationSummary,
    getTrackedDmThreads,
    setDmThreadStatus,
    getOrCreateAccount,
    parseThreadMetadata,
    fullUpsertLead: (username, accountId, data) => dbFunctions.fullUpsertLead(username, accountId, data),
    getNextFollowupTemplate: (lastId) => dbFunctions.getNextFollowupTemplate(lastId),
    updateLeadLastFollowup: (username, tplId) => dbFunctions.updateLeadLastFollowup(username, tplId),
    getFollowupCountForStep: (username, step) => dbFunctions.getFollowupCountForStep(username, step)
 };
