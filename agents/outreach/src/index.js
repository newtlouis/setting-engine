/**
 * Outreach Agent - Main Module
 * 
 * Orchestrates the outreach process:
 * 1. Select leads from database based on criteria
 * 2. Generate personalized first messages
 * 3. Send DMs (with preview mode by default)
 * 4. Track sent messages in database
 */

import path from 'path';
import { mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { CONFIG, OUTREACH_CRITERIA } from './config.js';
import { generateFirstMessage, validateMessage } from './templates.js';
import { initBrowser, batchSendDMs, closeBrowser, waitForUserToFinish, getOpenMessageTabs } from './dm_sender.js';
import { ExcelCRM } from '../../collector/src/excel_writer.js';

// Import database from collector (shared)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamic import for database (ESM compatibility)
let db = null;
let dbFunctions = null;
let excelTrackerInstance = null;

async function getExcelTracker() {
  if (!CONFIG.CRM_TRACKING_ENABLED) {
    return null;
  }
  if (excelTrackerInstance) {
    return excelTrackerInstance;
  }
  await mkdir(CONFIG.CRM_OUTPUT_DIR, { recursive: true });
  const tracker = new ExcelCRM(CONFIG.CRM_OUTPUT_DIR);
  await tracker.load();
  excelTrackerInstance = tracker;
  return excelTrackerInstance;
}

async function loadDatabase() {
  if (dbFunctions) return dbFunctions;
  
  const dbModule = await import(path.join(__dirname, '..', '..', 'collector', 'src', 'database.js'));
  await dbModule.initDatabase(CONFIG.DB_PATH);
  db = await dbModule.getDatabase();
  dbFunctions = dbModule;
  return dbFunctions;
}

/**
 * Get leads eligible for outreach
 * 
 * @param {Object} options
 * @returns {Promise<Array>} Array of lead objects
 */
export async function getOutreachCandidates(options = {}) {
  const {
    limit = 10,
    minEngagementScore = OUTREACH_CRITERIA.MIN_ENGAGEMENT_SCORE,
    minFollowers = OUTREACH_CRITERIA.MIN_FOLLOWERS,
    maxFollowers = OUTREACH_CRITERIA.MAX_FOLLOWERS,
    excludePrivate = OUTREACH_CRITERIA.EXCLUDE_PRIVATE,
    excludeContacted = true
  } = options;
  
  await loadDatabase();
  
  /* DEFENSIVE CODING: Cast params to expected types to avoid SQLite datatype mismatch */
  const cleanMinScore = Number(minEngagementScore) || 0;
  const cleanMinFollowers = Number(minFollowers) || 0;
  const cleanMaxFollowers = Number(maxFollowers) || 1000000;
  const cleanLimit = Number(limit) || 10;
  
  if (process.env.DEBUG) {
    console.log('DEBUG: Outreach Params:', { 
        cleanMinScore, cleanMinFollowers, cleanMaxFollowers, cleanLimit, 
        originalLimit: limit 
    });
  }

  // Build query with filters
  let query = `
    SELECT l.*, 
           (SELECT COUNT(*) FROM comments c WHERE c.lead_id = l.id AND c.is_spam = 0) as comment_count
    FROM leads l
    WHERE 1=1
      AND l.engagement_score >= ?
      AND (l.followers_count IS NULL OR l.followers_count >= ?)
      AND (l.followers_count IS NULL OR l.followers_count <= ?)
  `;
  
  const params = [cleanMinScore, cleanMinFollowers, cleanMaxFollowers];
  
  if (excludePrivate) {
    query += ' AND (l.is_private IS NULL OR l.is_private = 0)';
  }
  
  if (excludeContacted) {
    query += " AND l.status = 'new'";
  }
  
  // Order by engagement and warmth
  query += `
    ORDER BY 
      CASE l.warmth 
        WHEN 'hot' THEN 1 
        WHEN 'warm' THEN 2 
        ELSE 3 
      END,
      l.engagement_score DESC,
      l.total_comments DESC
    LIMIT ?
  `;
  
  params.push(cleanLimit);
  
  const leads = db.prepare(query).all(...params);
  
  // Get comments for each lead
  for (const lead of leads) {
    lead.comments = dbFunctions.getCommentsForLead(lead.id);
  }
  
  return leads;
}

/**
 * Generate outreach messages for leads
 * 
 * @param {Array} leads - Array of lead objects
 * @param {Object} options
 * @returns {Array} Array of { lead, message, validation } objects
 */
export function generateOutreachMessages(leads, options = {}) {
  const {
    niche = 'fitness',
    topic = 'their goals',
    customTemplate = null
  } = options;
  
  const messages = [];
  
  for (const lead of leads) {
    const generated = generateFirstMessage(lead, lead.comments || [], {
      niche,
      topic,
      customTemplate
    });
    
    const validation = validateMessage(generated.message);
    
    messages.push({
      lead,
      ...generated,
      validation
    });
  }
  
  return messages;
}

/**
 * Preview outreach without sending
 * 
 * @param {Object} options
 */
export async function previewOutreach(options = {}) {
  const {
    limit = 5,
    niche = 'fitness',
    topic = 'their goals'
  } = options;
  
  console.log('\n=== Outreach Preview ===\n');
  
  const leads = await getOutreachCandidates({ limit, ...options });
  
  if (leads.length === 0) {
    console.log('No eligible leads found. Check your criteria.');
    return [];
  }
  
  console.log(`Found ${leads.length} eligible leads:\n`);
  
  const messages = generateOutreachMessages(leads, { niche, topic });
  
  for (let i = 0; i < messages.length; i++) {
    const { lead, message, template_category, reasoning, validation } = messages[i];
    
    console.log(`--- Lead ${i + 1}: @${lead.username} ---`);
    console.log(`   Followers: ${lead.followers_count || 'unknown'}`);
    console.log(`   Engagement: ${lead.engagement_level} (score: ${lead.engagement_score})`);
    console.log(`   Comments: ${lead.total_comments || 0}`);
    console.log(`   Template: ${template_category}`);
    console.log(`   Reasoning: ${reasoning}`);
    console.log(`\n   MESSAGE:`);
    console.log(`   "${message}"`);
    
    if (!validation.valid) {
      console.log(`\n   ISSUES:`);
      validation.issues.forEach(issue => console.log(`   - ${issue}`));
    }
    console.log('\n');
  }
  
  return messages;
}

/**
 * Run outreach campaign
 * 
 * NEW WORKFLOW:
 * 1. Check each profile for "Contacter" button
 * 2. If contactable: open new tab, type message, keep tab open
 * 3. Skip non-contactable profiles
 * 4. At end: browser stays open for manual review and sending
 * 
 * @param {Object} options
 */
export async function runOutreach(options = {}) {
  const {
    limit = CONFIG.MAX_DMS_PER_SESSION,
    niche = 'fitness',
    topic = 'their goals',
    dryRun = true,  // In new flow, this is always "type but don't auto-send"
    userDataDir = './browser-data'
  } = options;
  
  console.log('\n========================================');
  console.log('   OUTREACH (Multi-Tab Mode)');
  console.log('========================================\n');
  console.log('   Messages will be typed but NOT sent automatically.');
  console.log('   Each contactable profile opens in a new tab.');
  console.log('   Review and send manually, then close browser.\n');
  
  // Get candidates
  const leads = await getOutreachCandidates({ limit, ...options });
  
  if (leads.length === 0) {
    console.log('No eligible leads found.');
    return { success: false, reason: 'no_leads' };
  }
  
  // Generate messages
  const messages = generateOutreachMessages(leads, { niche, topic });
  
  // Filter out invalid messages
  const validMessages = messages.filter(m => m.validation.valid);
  const invalidMessages = messages.filter(m => !m.validation.valid);
  
  if (invalidMessages.length > 0) {
    console.log(`Skipping ${invalidMessages.length} leads with invalid messages:`);
    invalidMessages.forEach(m => {
      console.log(`   @${m.lead.username}: ${m.validation.issues.join(', ')}`);
    });
    console.log('');
  }
  
  if (validMessages.length === 0) {
    console.log('No valid messages to send.');
    return { success: false, reason: 'no_valid_messages' };
  }
  
  // Initialize browser
  const { browser, page } = await initBrowser({ userDataDir });
  
  // Prepare targets
  const targets = validMessages.map(m => ({
    username: m.lead.username,
    message: m.message,
    leadId: m.lead.id
  }));

  const recordConversationMetadata = async ({ username, dmUrl, message, typedAt }) => {
    try {
      await loadDatabase();
      const preview = (message || '').trim();
      const messagePreview = preview.length > 280 ? `${preview.slice(0, 277)}...` : preview;
      if (dbFunctions?.upsertDmThread) {
        dbFunctions.upsertDmThread({
          username,
          dm_url: dmUrl,
          last_message_preview: messagePreview,
          last_status: 'message_ready',
          typed_at: typedAt || new Date().toISOString()
        });
      }
      const tracker = await getExcelTracker();
      if (tracker) {
        await tracker.recordConversationEntry({
          username,
          dmUrl,
          messagePreview,
          status: 'message_ready',
          typedAt: typedAt || new Date().toISOString()
        });
        await tracker.save();
      }
    } catch (error) {
      console.error(`Failed to record conversation metadata for @${username}:`, error.message);
    }
  };
  
  // Process leads with multi-tab workflow
  const results = await batchSendDMs(page, targets, {
    dryRun: true,  // Always type, never auto-send in new flow
    onConversationReady: recordConversationMetadata,
    onComplete: async (result) => {
      // Track in database (mark as pending, not sent yet)
      if (result.success && result.tabKeptOpen) {
        await loadDatabase();
        
        const target = targets.find(t => t.username === result.username);
        if (target) {
          // Mark lead as having message ready (but not sent)
          db.prepare(`
            UPDATE leads SET 
              status = 'message_ready',
              conversation_stage = 'pending_send'
            WHERE username = ?
          `).run(result.username);
        }
      }
    }
  });
  
  // If we have tabs open, wait for user to finish
  const openTabs = getOpenMessageTabs();
  if (openTabs.length > 0) {
    await waitForUserToFinish();
  } else {
    // No tabs open, close browser
    await closeBrowser();
  }
  
  return results;
}

/**
 * Get outreach statistics
 */
export async function getOutreachStats() {
  await loadDatabase();
  
  const stats = {
    total_leads: db.prepare('SELECT COUNT(*) as count FROM leads').get().count,
    new_leads: db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'new'").get().count,
    contacted_leads: db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'contacted'").get().count,
    replied_leads: db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'replied'").get().count,
    
    messages_sent: db.prepare("SELECT COUNT(*) as count FROM conversations WHERE role = 'assistant'").get().count,
    messages_received: db.prepare("SELECT COUNT(*) as count FROM conversations WHERE role = 'user'").get().count,
    
    min_engagement_threshold: OUTREACH_CRITERIA.MIN_ENGAGEMENT_SCORE,
    
    eligible_for_outreach: db.prepare(`
      SELECT COUNT(*) as count FROM leads 
      WHERE status = 'new' 
        AND engagement_score >= ?
        AND (is_private IS NULL OR is_private = 0)
    `).get(OUTREACH_CRITERIA.MIN_ENGAGEMENT_SCORE).count,
    
    by_engagement: db.prepare(`
      SELECT engagement_level, COUNT(*) as count 
      FROM leads 
      WHERE status = 'new'
      GROUP BY engagement_level
    `).all()
  };
  
  return stats;
}

export default {
  getOutreachCandidates,
  generateOutreachMessages,
  previewOutreach,
  runOutreach,
  getOutreachStats
};
