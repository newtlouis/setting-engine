import path from 'path';
import { fileURLToPath } from 'url';
import { loadProfileConfig } from '../../../shared/utils/configLoader.js'; // Verify path
import { 
  initBrowser, 
  openDMAndScrape,
  typeInOpenTab,
  registerOpenTab,
  waitForUserToFinish, 
  closeBrowser,
  getOpenMessageTabs 
} from './scraper.js';
import {
  initDB,
  addMessage,
  setDmThreadStatus,
  getOrCreateAccount,
  getConversationHistory,
  getLeadWithContext
} from './db_integration.js';
import { generateResponse } from './engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Finds threads that need a follow-up.
 * Criteria: 
 * - Status is 'conversation'
 * - Last message was from 'assistant'
 * - Last message was sent > X hours ago
 */
async function getStaleThreads(db, accountId, hours = 24) {
    const cutoffDate = new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();

    // Query finding leads where the most recent message is from 'assistant' and older than cutoff
    const sql = `
        WITH LastMessages AS (
            SELECT lead_id, role, sent_at, 
                   ROW_NUMBER() OVER(PARTITION BY lead_id ORDER BY sent_at DESC) as rn
            FROM conversations
        )
        SELECT l.*, 
               lm.sent_at as last_msg_at,
               lm.role as last_role
        FROM leads l
        JOIN LastMessages lm ON l.id = lm.lead_id AND lm.rn = 1
        WHERE l.account_id = ?
          AND l.status = 'conversation'
          AND l.booking_status IS NOT 'completed'
          AND l.is_ignored = 0
          AND lm.role = 'assistant'
          AND lm.sent_at < ?
        ORDER BY lm.sent_at ASC
        LIMIT 50
    `;

    return db.prepare(sql).all(accountId, cutoffDate);
}

export async function runFollowupWatcher(options = {}) {
    const { hours = 24, limit = 10, profile, dryRun = false } = options;

    if (!profile) throw new Error('Profile is required');

    console.log(`🚀 Starting Follow-up Watcher for profile: ${profile}`);
    console.log(`   Criteria: Last msg from Assistant > ${hours}h ago.`);

    const dbFunctions = await initDB();
    const db = await dbFunctions.getDatabase();
    const account = await getOrCreateAccount(profile);
    const accountId = account.id;

    // 1. Find Stale Threads
    const threads = await getStaleThreads(db, accountId, hours);
    
    if (threads.length === 0) {
        console.log('✅ No stale threads found needing follow-up.');
        return;
    }

    console.log(`📋 Found ${threads.length} stale threads.`);
    
    // Filter by limit
    const targetThreads = threads.slice(0, limit);

    if (dryRun) {
        console.log('🚧 DRY RUN MODE. Would process:');
        for (const t of targetThreads) {
            const nextTpl = await dbFunctions.getNextFollowupTemplate(t.last_followup_template_id);
            console.log(`   - @${t.username} (Last: ${t.last_msg_at}) -> Next: ${nextTpl ? nextTpl.step_order : 'NONE (End of sequence)'}`);
        }
        return;
    }

    // 2. Init Browser
    const userDataDir = path.join(process.cwd(), `browser-data-${profile}`);
    let browser = await initBrowser({ 
        userDataDir,
        profile,
        headless: false 
    });

    let processedCount = 0;

    try {
        for (const thread of targetThreads) {
            console.log(`\n--- Follow-up for @${thread.username} ---`);

            // 3. Get Next Template
            const nextTemplate = await dbFunctions.getNextFollowupTemplate(thread.last_followup_template_id);
            
            if (!nextTemplate) {
                console.log(`ℹ️  No more follow-up templates for @${thread.username}. Skipping.`);
                continue;
            }

            // 4. Open DM
            const result = await openDMAndScrape({
                username: thread.username,
                profile_url: thread.profile_url,
                dm_url: thread.dm_url
            });

            if (!result.success) {
                console.log(`❌ Failed to open: ${result.error}`);
                continue;
            }

            const openTab = result.tab;
            
            // 5. Verify Context (Double check scraping)
            const scrapedMessages = result.scrapedMessages || [];
            if (scrapedMessages.length > 0) {
                const lastScraped = scrapedMessages[scrapedMessages.length - 1];
                if (lastScraped.role === 'user') {
                    console.log('⚠️  User has replied! Syncing and aborting follow-up.');
                    await addMessage(thread.username, 'user', lastScraped.text); 
                    await openTab.close();
                    continue;
                }
            }

            // 6. Format Template
            // Simple placeholder replacement. We can add more context if needed.
            let message = nextTemplate.template_text;
            const firstName = thread.full_name ? thread.full_name.split(' ')[0] : thread.username;
            message = message.replace(/\{\{firstName\}\}/g, firstName);

            console.log(`💬 Follow-up #${nextTemplate.step_order}: "${message}"`);
            
            // 7. Type & Register
            await typeInOpenTab(openTab, message);
            registerOpenTab(thread.username, openTab, message);
            
            // 8. Update DB (Stage and Template Tracking)
            await addMessage(thread.username, 'assistant', message, `followup_${nextTemplate.step_order}`);
            await dbFunctions.updateLeadLastFollowup(thread.username, nextTemplate.id);
            
            processedCount++;
        }

        if (processedCount > 0) {
            console.log(`\n✨ Prepared ${processedCount} follow-ups review.`);
            await waitForUserToFinish();
        } else {
            console.log('No follow-ups prepared.');
        }

    } catch (err) {
        console.error('Fatal error:', err);
    } finally {
        await closeBrowser();
    }
}
