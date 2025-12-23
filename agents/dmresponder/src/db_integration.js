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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to collector's database module
const DB_PATH = path.join(__dirname, '..', '..', 'collector', 'permanent-data', 'leads.db');
const DB_MODULE_PATH = path.join(__dirname, '..', '..', 'collector', 'src', 'database.js');

let db = null;
let dbFunctions = null;

/**
 * Initialize database connection
 */
export async function initDB() {
  if (dbFunctions) return dbFunctions;
  
  try {
    const dbModule = await import(DB_MODULE_PATH);
    await dbModule.initDatabase(DB_PATH);
    db = await dbModule.getDatabase();
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
export async function getLeadWithContext(username) {
  await initDB();
  if (!db) return null;
  
  const lead = dbFunctions.getLeadByUsername(username);
  if (!lead) return null;
  
  // Get comments for context
  const comments = dbFunctions.getCommentsForLead(lead.id);
  
  // Build lead context object (compatible with existing leadContext format)
  // Build lead context object (compatible with existing leadContext format)
  const context = {
    username: lead.username,
    profile_url: lead.profile_url,
    // full_name removed
    
    // Profile data
    followers_count: 0, // removed from DB
    bio: '[Bio not scraped]', // removed from DB
    is_verified: false,
    is_business: false,
    is_private: false,
    
    // Engagement
    engagement_level: lead.warmth, // Mapping warmth to engagement_level for compatibility
    engagement_score: lead.engagement_score,
    total_comments: lead.total_comments,
    
    // Qualification
    warmth: lead.warmth || 'cold',
    pain_points: lead.pain_points ? JSON.parse(lead.pain_points) : [],
    goals: lead.goals ? JSON.parse(lead.goals) : [],
    objections_likely: lead.objections ? JSON.parse(lead.objections) : [],
    
    // Conversation state
    conversation_stage: lead.conversation_stage,
    status: lead.status,
    total_messages_sent: lead.total_messages_sent,
    total_messages_received: lead.total_messages_received,
    
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
 * @returns {Promise<Array>} Conversation history
 */
export async function getConversationHistory(username) {
  await initDB();
  if (!db) return [];
  
  const lead = dbFunctions.getLeadByUsername(username);
  if (!lead) return [];
  
  const messages = dbFunctions.getConversation(lead.id);
  
  // Convert to format expected by engine
  return messages.map(msg => ({
    role: msg.role,
    text: msg.message_text,
    type: msg.message_type,
    timestamp: msg.sent_at
  }));
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
export async function addMessage(username, role, message, messageType = null) {
  await initDB();
  if (!db) return false;
  
  const lead = dbFunctions.getLeadByUsername(username);
  if (!lead) {
    console.error(`Lead not found: ${username}`);
    return false;
  }
  
  try {
    dbFunctions.addConversationMessage(lead.id, role, message, messageType);
    
    // Update lead status if this is a user reply
    if (role === 'user' && lead.status === 'contacted') {
      dbFunctions.updateLeadStatus(username, 'replied');
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
  await initDB();
  if (!db) return;
  
  db.prepare(`
    UPDATE leads SET 
      conversation_stage = ?,
      updated_at = datetime('now')
    WHERE username = ?
  `).run(stage, username);
}

/**
 * Get all leads with active conversations (replied but not closed)
 * 
 * @returns {Promise<Array>} List of leads with active conversations
 */
export async function getActiveConversations() {
  await initDB();
  if (!db) return [];
  
  const leads = db.prepare(`
    SELECT l.*, 
           (SELECT COUNT(*) FROM conversations c WHERE c.lead_id = l.id) as message_count,
           (SELECT MAX(sent_at) FROM conversations c WHERE c.lead_id = l.id) as last_message_at
    FROM leads l
    WHERE l.status IN ('contacted', 'replied', 'qualified')
      AND l.conversation_stage NOT IN ('closed_won', 'closed_lost')
      AND l.total_messages_sent > 0
      AND l.is_ignored = 0
    ORDER BY last_message_at DESC
  `).all();
  
  return leads;
}

/**
 * Get conversation summary for display
 * 
 * @param {string} username - Instagram username
 * @returns {Promise<Object>} Conversation summary
 */
export async function getConversationSummary(username) {
  await initDB();
  if (!db) return null;
  
  const lead = dbFunctions.getLeadByUsername(username);
  if (!lead) return null;
  
  const messages = await getConversationHistory(username);
  const context = await getLeadWithContext(username);
  
  return {
    username: lead.username,
    // full_name removed
    status: lead.status,
    stage: lead.conversation_stage,
    message_count: messages.length,
    last_message: messages.length > 0 ? messages[messages.length - 1] : null,
    engagement_level: lead.warmth, // mapped
    warmth: lead.warmth,
    pain_points: context?.pain_points || [],
    bio_excerpt: null // bio removed
  };
}

export async function getTrackedDmThreads(filters = {}) {
  await initDB();
  if (!dbFunctions?.getDmThreads) return [];
  return dbFunctions.getDmThreads(filters);
}

export async function setDmThreadStatus(username, status, updates = {}) {
  await initDB();
  if (!dbFunctions?.updateDmThreadStatus) return;
  return dbFunctions.updateDmThreadStatus(username, status, updates);
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
   parseThreadMetadata
 };

