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
    dryRun = true,
    userDataDir = './browser-data'
  } = options;
  
  /* DEFENSIVE CODING: Cast params */
  const cleanLimit = Number(limit) || 10;
  
  console.log('\n========================================');
  console.log('   OUTREACH (Multi-Tab Mode)');
  console.log('========================================\n');
  console.log(`   Target: ${cleanLimit} succesful messages typed/ready.`);
  console.log('   Messages will be typed but NOT sent automatically.');
  
  // Initialize browser once
  let browserObj = null;
  
  let successfulCount = 0;
  let attempts = 0;
  const maxAttempts = cleanLimit * 3; // Safety break to prevent infinite loops
  
  let batchResults = {
    attempted: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    blocked: false,
    tabsOpen: 0,
    details: []
  };

  try {
    // Loop until we reach the target limit or hit max safety attempts
    while (successfulCount < cleanLimit && attempts < maxAttempts) {
        
        const remaining = cleanLimit - successfulCount;
        console.log(`\n--- Batch Progress: ${successfulCount}/${cleanLimit} ready (Need ${remaining} more) ---`);
        
        // Fetch a bit more than needed to account for likely skips
        // e.g. if need 1, fetch 3. If need 5, fetch 8.
        const fetchLimit = remaining + Math.ceil(remaining * 0.5) + 2;
        
        const leads = await getOutreachCandidates({ 
            ...options, 
            limit: fetchLimit,
            excludeContacted: true // CRITICAL: Ensure we don't fetch the same ones
        });

        if (leads.length === 0) {
            console.log('   No more eligible leads found in database.');
            break;
        }
        
        console.log(`   Fetched batch of ${leads.length} candidates.`);

        // Generate messages for this batch
        const messages = generateOutreachMessages(leads, { niche, topic });
        
        // Filter valid
        const validMessages = messages.filter(m => m.validation.valid);
        
        if (validMessages.length === 0) {
            console.log('   No valid messages generated for this batch. Continuing...');
            attempts++; 
            continue; // Go to next loop to fetch more
        }
        
        const targets = validMessages.map(m => ({
            username: m.lead.username,
            message: m.message,
            leadId: m.lead.id
        }));

        // Initialize browser if not already done
        if (!browserObj) {
             browserObj = await initBrowser({ userDataDir });
        }
        
        // Run batch for this chunk
        // We pass the *remaining* count as maxPerSession for this specific call
        // BUT we need `batchSendDMs` to NOT close the browser
        const results = await batchSendDMs(browserObj.page, targets, {
            dryRun: true,
            maxPerSession: remaining, // Only try to fill the gap
            onConversationReady: async ({ username, dmUrl, message, typedAt }) => {
                // Same metadata recording logic...
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
            },
            onComplete: async (result) => {
                // Update global counters
                batchResults.attempted++;
                attempts++;
                
                if (result.success && result.tabKeptOpen) {
                    successfulCount++;
                    batchResults.successful++;
                    batchResults.tabsOpen++;
                    batchResults.details.push(result);
                    
                    // Mark as pending send
                     await loadDatabase();
                     db.prepare(`
                        UPDATE leads SET 
                          status = 'message_ready',
                          conversation_stage = 'pending_send'
                        WHERE username = ?
                      `).run(result.username);
                } else if (result.skipped) {
                    batchResults.skipped++;
                    // UPDATE DB Status so we don't fetch again!
                     await loadDatabase();
                     if (result.error && (result.error.includes('private') || result.error === 'private_account_no_contact')) {
                         console.log(`   ✨ Marking @${result.username} as PRIVATE in DB.`);
                         dbFunctions.markLeadPrivate(result.username);
                     } else {
                         console.log(`   ✨ Marking @${result.username} as NOT CONTACTABLE in DB.`);
                         dbFunctions.markLeadUncontactable(result.username);
                     }
                } else {
                    batchResults.failed++;
                     // Also mark failed to avoid immediate retry loops? 
                     // Maybe safest to mark as 'skipped' or specific error status
                }
            }
        });

        if (results.blocked) {
            batchResults.blocked = true;
            batchResults.blockReason = results.blockReason;
            console.log('   🛑 Block detected. Halting outreach loop.');
            break;
        }

        // Small break between chunks if we are continuing
        if (successfulCount < cleanLimit) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }
  
  } catch (err) {
      console.error('Fatal error in outreach loop:', err);
  }
  
  // Cleanup
  // If we have tabs open, wait for user to finish
  const openTabs = getOpenMessageTabs();
  if (openTabs.length > 0) {
    await waitForUserToFinish();
  } else {
    // No tabs open, close browser
    await closeBrowser();
  }
  
  return batchResults;
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
