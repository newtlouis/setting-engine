import path from 'path';
import { fileURLToPath } from 'url';
import { loadProfileConfig } from '../../../shared/utils/configLoader.js';
import { getContainer } from '../../../shared/container.js';
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
import { generateResponse, generateRevivalMessage } from './engine.js';

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

    const profileConfig = await loadProfileConfig(profile);

    console.log(`🚀 Starting Follow-up Watcher for profile: ${profile}`);
    console.log(`   Criteria: Last msg from Assistant > ${hours}h ago.`);

    // Initialize via container
    const container = await getContainer();
    const db = container.getDb();
    const dbFunctions = await initDB(); // Still needed for getFollowupCountForStep
    const account = await getOrCreateAccount(profile);
    const accountId = account.id;

    // 1. Find Stale Threads
    const threads = await getStaleThreads(db, accountId, hours);
    
    if (threads.length === 0) {
        console.log('✅ No stale threads found needing follow-up.');
        return;
    }

    console.log(`📋 Found ${threads.length} stale threads. Filtering by step rules...`);
    
    // 2. Filter threads based on Step Rules
    const threadsToProcess = [];
    
    for (const t of threads) {
        // Only process steps 2, 3, 4, 5. Step 1 gets 0 follow-ups.
        if (!t.conversation_step || t.conversation_step < 2) continue;
        
        const stepKey = `step${t.conversation_step}`;
        const stepConfig = profileConfig.outreach?.followups?.[stepKey];
        
        if (!stepConfig) {
            console.log(`   Skipping @${t.username} (Step ${t.conversation_step}): No config found.`);
            continue;
        }

        // Check max follow-ups for this step
        const existingCount = await dbFunctions.getFollowupCountForStep(t.username, t.conversation_step);
        
        if (existingCount >= stepConfig.max) {
            console.log(`   Skipping @${t.username} (Step ${t.conversation_step}): Max follow-ups reached (${existingCount}/${stepConfig.max}).`);
            continue;
        }

        // Determine next template index (sequential)
        // If existingCount is 0, we use template[0]. If 1, use template[1].
        // If we want random, we could do that too, but sequential makes sense for "relance 1", "relance 2".
        // The user said "generic relances", implying we can just cycle or pick one. 
        // Let's use sequential for now to avoid repeating the exact same message if max > 1.
        let templateIndex = existingCount; 
        if (templateIndex >= stepConfig.templates.length) {
            templateIndex = stepConfig.templates.length - 1; // Fallback to last one if we have more allowance than templates
        }

        t.nextMessage = stepConfig.templates[templateIndex];
        t.followupIndex = existingCount + 1; // 1-based index for logging/tracking
        threadsToProcess.push(t);
    }
    
    if (threadsToProcess.length === 0) {
        console.log('✅ No threads eligible for follow-up after filtering.');
        return;
    }

    // Filter by limit
    const targetThreads = threadsToProcess.slice(0, limit);

    if (dryRun) {
        console.log(`🚧 DRY RUN MODE. Would process ${targetThreads.length} threads:`);
        for (const t of targetThreads) {
            console.log(`   - @${t.username} (Step ${t.conversation_step}) -> Relance #${t.followupIndex}/${profileConfig.outreach.followups[`step${t.conversation_step}`].max}`);
            console.log(`     Message: "${t.nextMessage.substring(0, 50)}..."`);
        }
        return;
    }

    // 3. Init Browser
    const userDataDir = path.join(process.cwd(), `browser-data-${profile}`);
    let browser = await initBrowser({ 
        userDataDir,
        profile,
        headless: false 
    });

    let processedCount = 0;

    try {
        for (const thread of targetThreads) {
            console.log(`\n--- Follow-up for @${thread.username} (Step ${thread.conversation_step}) ---`);

            // 4. Open DM
            const result = await openDMAndScrape({
                username: thread.username,
                profile_url: thread.profile_url,
                dm_url: thread.dm_url
            });

            if (!result.success) {
                console.log(`❌ Failed to open: ${result.error}`);
                if (result.error?.includes('Profile unavailable') || result.error?.includes('page introuvable')) {
                     await setDmThreadStatus(thread.username, 'not_interested', { 
                        notes: "Profile unavailable (likely blocked/deleted)." 
                    });
                }
                continue;
            }

            const openTab = result.tab;
            
            // 5. Verify Context (Double check scraping)
            const scrapedMessages = result.scrapedMessages || [];
            
            // Logic: Ensure last message is indeed from us (assistant) - safety check vs partial DB state
            if (scrapedMessages.length > 0) {
                const lastScraped = scrapedMessages[scrapedMessages.length - 1];
                if (lastScraped.role === 'user') {
                    console.log('⚠️  User has replied recently! Syncing and aborting follow-up.');
                    await addMessage(thread.username, 'user', lastScraped.text); 
                    await openTab.close();
                    continue;
                }
            }

            // 6. Prepare Message
            let message = thread.nextMessage;
            
            // Placeholder replacement
            const firstName = thread.full_name ? thread.full_name.split(' ')[0] : thread.username;
            message = message.replace(/{{firstName}}/g, firstName);

            console.log(`\n💬 SENDING FOLLOW-UP:`);
            console.log(`   Step: ${thread.conversation_step} | Relance #${thread.followupIndex}`);
            console.log(`   Message: "${message}"\n`);
            
            // 7. Type & Register
            await typeInOpenTab(openTab, message);
            registerOpenTab(thread.username, openTab, message);
            
            // 8. Update DB 
            // We store specific type to count later: e.g. 'followup_step3_1'
            await addMessage(thread.username, 'assistant', message, `followup_step${thread.conversation_step}_${thread.followupIndex}`);
            
            processedCount++;
            
            // Close tab to save memory/resources if we are processing many? 
            // The scraping function usually keeps it open for 'waitForUserToFinish' batch sending.
            // But here we are just adding to tabs.
        }

        if (processedCount > 0) {
            console.log(`\n✨ Prepared ${processedCount} follow-ups for review.`);
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
