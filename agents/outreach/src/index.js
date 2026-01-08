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
import { getBrowserDataDir } from '../../../shared/paths.js';
import { generateFirstMessage, validateMessage } from './templates.js';
import { initBrowser, batchSendDMs, closeBrowser, waitForUserToFinish, getOpenMessageTabs } from './dm_sender.js';
// ExcelCRM removed


import { loadProfileConfig } from '../../../shared/utils/configLoader.js';

// Import database from collector (shared)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamic import for database (ESM compatibility)
let db = null;
let dbFunctions = null;
// getExcelTracker removed


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
    targetStatus = 'new',
    accountId = null
  } = options;
  
  await loadDatabase();
  
  /* DEFENSIVE CODING: Cast params to expected types to avoid SQLite datatype mismatch */
  const cleanMinScore = Number(minEngagementScore) || 0;
  const cleanLimit = Number(limit) || 10;
  
  if (process.env.DEBUG) {
    console.log('DEBUG: Outreach Params:', { 
        cleanMinScore, cleanLimit, targetStatus,
        originalLimit: limit 
    });
  }

  // Build query with filters
  let query = `
    SELECT l.*, 
           (SELECT COUNT(*) FROM comments c WHERE c.lead_id = l.id AND c.is_spam = 0) as comment_count
    FROM leads l
    WHERE l.is_ignored = 0
      AND l.engagement_score >= ?
  `;
  
  const params = [cleanMinScore];

  // Account Filtering
  if (accountId) {
    query += " AND l.account_id = ?";
    params.push(accountId);
  }
  
  // Status Filtering
  if (targetStatus === 'new') {
      query += " AND l.status = 'new'";
  } else if (targetStatus === 'failed') {
      query += " AND l.status = 'failed'";
  } else if (targetStatus === 'contacted') {
      query += " AND l.status IN ('outreach', 'conversation')";
  } else if (targetStatus !== 'all') {
      query += " AND l.status = ?";
      params.push(targetStatus);
  }
  
  // Note: excludeContacted logic is effectively replaced by targetStatus='new' default
  // but if explicit exclusion is needed for custom queries, it can be added here.
  // For now, targetStatus handles the primary filtering.
  
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
    customTemplate = null,
    isSimple = false
  } = options;
  
  const messages = [];
  
  for (const lead of leads) {
    const generated = generateFirstMessage(lead, lead.comments || [], {
      niche,
      topic,
      customTemplate,
      isSimple,
      profileConfig: options.profileConfig || null
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
    topic = 'their goals',
    isSimple = false
  } = options;
  
  console.log('\n=== Outreach Preview ===\n');
  
  const leads = await getOutreachCandidates({ limit, ...options });
  
  if (leads.length === 0) {
    console.log('No eligible leads found. Check your criteria.');
    return [];
  }
  
  console.log(`Found ${leads.length} eligible leads:\n`);
  
  const messages = generateOutreachMessages(leads, { niche, topic, isSimple: options.isSimple });
  
  for (let i = 0; i < messages.length; i++) {
    const { lead, message, template_category, reasoning, validation } = messages[i];
    
    console.log(`--- Lead ${i + 1}: @${lead.username} ---`);
    console.log(`   Followers: ${lead.followers_count || 'unknown'}`);
    console.log(`   Engagement: ${lead.warmth} (score: ${lead.engagement_score})`);
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
    isSimple = false,
    profile = process.env.IG_PROFILE
  } = options;

  if (!profile) {
    throw new Error('Profile name is required. Use --profile <name> or set IG_PROFILE env var.');
  }

  const userDataDir = getBrowserDataDir(profile);
  
  await loadDatabase();
  const account = dbFunctions.getOrCreateAccount(profile);
  const accountId = account.id;
  
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
  const maxAttempts = Math.max(50, cleanLimit * 20); // Safety break: allow many attempts before giving up
  
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

        /* LOAD PROFILE CONFIG */
        let profileConfig = null;
        if (profile) {
            profileConfig = await loadProfileConfig(profile);
            if (profileConfig && profileConfig.niche) {
                console.log(`🧠 Using Niche strategy: ${profileConfig.niche}`);
            }
        }

        /* STEP 1: Get Candidates */
        const leads = await getOutreachCandidates({
            limit: fetchLimit,
            targetStatus: 'new', // Explicitly target new leads for outreach
            accountId: accountId
        });

        if (leads.length === 0) {
            console.log('   No more eligible leads found in database.');
            break;
        }

        console.log(`   Fetched batch of ${leads.length} candidates.`);

        /* STEP 2: Generate Messages */
        const messages = generateOutreachMessages(leads, {
            niche,
            topic,
            isSimple,
            profileConfig // Pass profileConfig here
        });

        // Handle Invalid Messages: Mark them as failed so we don't infinite loop on them
        const invalidMessages = messages.filter(m => !m.validation.valid);
        if (invalidMessages.length > 0) {
            console.log(`   ⚠️  Marking ${invalidMessages.length} leads as failed due to message validation errors.`);
            for (const inv of invalidMessages) {
                const reason = `Validation Error: ${inv.validation.issues.join(', ')}`;
                try {
                     await loadDatabase();
                     dbFunctions.markLeadFailed(inv.lead.username, reason);
                } catch (err) {
                    console.error(`Failed to mark validation error for ${inv.lead.username}: ${err.message}`);
                }
            }
        }
        
        // Filter valid
        const validMessages = messages.filter(m => m.validation.valid);
        
        if (validMessages.length === 0) {
            console.log('   No valid messages generated for this batch. Continuing...');
            attempts++; 
            
            // If we fetched fewer than requested, we are at the end of the list anyway
            if (leads.length < fetchLimit) {
                 console.log('   ℹ️  End of available leads reached.');
                 break;
            }
            continue; // Go to next loop to fetch more
        }
        
        const targets = validMessages.map(m => ({
            username: m.lead.username,
            profileUrl: m.lead.profile_url, // Use stored URL
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
            profileConfig, // Pass profile config for custom qualification prompt
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
                      last_status: 'outreach',
                      typed_at: typedAt || new Date().toISOString()
                    });
                  }

                  // RECORD MESSAGE IN CONVERSATION HISTORY
                  if (dbFunctions?.addConversationMessage) {
                    const lead = dbFunctions.getLeadByUsername(username, accountId);
                    if (lead) {
                      dbFunctions.addConversationMessage(lead.id, 'assistant', message, 'outreach');
                    }
                  }
                  // Excel tracking removed

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
                    
                    // Mark as pending send and update profile data
                     await loadDatabase();
                     db.prepare(`
                        UPDATE leads SET 
                          status = 'outreach',
                          dm_url = ?,
                          full_name = COALESCE(?, full_name),
                          bio = COALESCE(?, bio),
                          updated_at = datetime('now')
                        WHERE username = ?
                      `).run(
                        result.dmUrl || null, 
                        result.fullName || null,
                        result.steps.find(s => s.step === 'scrape_profile')?.bio || null,
                        result.username
                      );
                } else if (result.skipped) {
                    batchResults.skipped++;
                    // UPDATE DB Status so we don't fetch again!
                     await loadDatabase();
                     
                     // Check if this is an existing conversation (already has messages)
                     if (result.existingConversation) {
                         console.log(`   💬 Marking @${result.username} as CONVERSATION (${result.messageCount} existing messages)`);
                         db.prepare(`
                           UPDATE leads SET 
                             status = 'conversation',
                             updated_at = datetime('now')
                           WHERE username = ?
                         `).run(result.username);
                     } else if (result.isCompetitor) {
                         console.log(`   🚫 Marking @${result.username} as FAILED (Competitor) in DB.`);
                         db.prepare(`
                           UPDATE leads SET 
                             status = 'failed',
                             notes = 'Profil concurrent (coach/accompagnateur)',
                             updated_at = datetime('now')
                           WHERE username = ?
                         `).run(result.username);
                     } else if (result.error && (result.error.includes('private') || result.error === 'private_account_no_contact')) {
                         console.log(`   ✨ Marking @${result.username} as FAILED (Private Account) in DB.`);
                         dbFunctions.markLeadFailed(result.username, 'Private Account');
                     } else {
                         console.log(`   ✨ Marking @${result.username} as NOT CONTACTABLE in DB.`);
                         dbFunctions.markLeadUncontactable(result.username);
                     }
                } else {
                    batchResults.failed++;
                    
                    // CRITICAL FIX: Mark failing leads (e.g. timeout, no popup)
                    // so we don't pick them up again in the next while-loop iteration
                    if (result.error) {
                        console.log(`   ⚠️  Marking @${result.username} as FAILED in DB (Reason: ${result.error})`);
                        try {
                            await loadDatabase();
                            dbFunctions.markLeadFailed(result.username, result.error);
                        } catch (dbErr) {
                            console.error(`      Failed to mark lead as failed: ${dbErr.message}`);
                        }
                    }
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
            // STOP CONDITION: If we fetched fewer items than the limit, we've exhausted the database
            if (leads.length < fetchLimit) {
                console.log('   ℹ️  End of available leads reached. Stopping early.');
                break;
            }
            
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
export async function getOutreachStats(accountId = null) {
  await loadDatabase();
  
  const accountFilter = accountId ? ' AND account_id = ?' : '';
  const accountParam = accountId ? [accountId] : [];
  
  const stats = {
    total_leads: db.prepare('SELECT COUNT(*) as count FROM leads WHERE is_ignored = 0' + accountFilter).get(...accountParam).count,
    new_leads: db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'new' AND is_ignored = 0" + accountFilter).get(...accountParam).count,
    contacted_leads: db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'contacted' AND is_ignored = 0" + accountFilter).get(...accountParam).count,
    replied_leads: db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'replied' AND is_ignored = 0" + accountFilter).get(...accountParam).count,
    
    messages_sent: db.prepare(`
      SELECT COUNT(*) as count FROM conversations c 
      JOIN leads l ON c.lead_id = l.id 
      WHERE c.role = 'assistant' AND l.is_ignored = 0 ${accountFilter ? 'AND l' + accountFilter : ''}
    `).get(...accountParam).count,
    messages_received: db.prepare(`
      SELECT COUNT(*) as count FROM conversations c 
      JOIN leads l ON c.lead_id = l.id 
      WHERE c.role = 'user' AND l.is_ignored = 0 ${accountFilter ? 'AND l' + accountFilter : ''}
    `).get(...accountParam).count,
    
    min_engagement_threshold: OUTREACH_CRITERIA.MIN_ENGAGEMENT_SCORE,
    
    eligible_for_outreach: db.prepare(`
      SELECT COUNT(*) as count FROM leads 
      WHERE status = 'new' 
        AND is_ignored = 0
        AND engagement_score >= ?
        ${accountFilter}
    `).get(OUTREACH_CRITERIA.MIN_ENGAGEMENT_SCORE, ...accountParam).count,
    
    by_engagement: db.prepare(`
      SELECT warmth as level, COUNT(*) as count 
      FROM leads 
      WHERE status = 'new' AND is_ignored = 0
      ${accountFilter}
      GROUP BY warmth
    `).all(...accountParam)
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
