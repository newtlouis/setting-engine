import path from 'path';
import { fileURLToPath } from 'url';
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
 * Finds threads that are candidates for follow-up.
 * Returns all threads where the last message is from 'assistant' and at least 1h old.
 * The per-stage followup_delay_hours is applied later in the filtering loop.
 */
async function getStaleThreads(db, accountId) {
    // Minimal 1h cutoff to exclude very recent messages (format matches SQLite datetime)
    const minCutoff = new Date(Date.now() - (1 * 60 * 60 * 1000))
        .toISOString().replace('T', ' ').slice(0, 19);

    const sql = `
        WITH LastMessages AS (
            SELECT lead_id, role, sent_at,
                   ROW_NUMBER() OVER(PARTITION BY lead_id ORDER BY sent_at DESC) as rn
            FROM conversations
        )
        SELECT l.*,
               lm.sent_at as last_msg_at,
               lm.role as last_role,
               l.funnel_step as effective_step
        FROM leads l
        JOIN LastMessages lm ON l.id = lm.lead_id AND lm.rn = 1
        WHERE l.account_id = ?
          AND l.status IN ('contacted', 'replied', 'qualified', 'conversation', 'outreach')
          AND l.funnel_step >= 2
          AND (l.booking_status IS NULL OR l.booking_status NOT IN ('completed', 'confirmed'))
          AND l.is_ignored = 0
          AND lm.role = 'assistant'
          AND lm.sent_at < ?
        ORDER BY lm.sent_at ASC
        LIMIT 500
    `;

    return db.prepare(sql).all(accountId, minCutoff);
}

export async function runFollowupWatcher(options = {}) {
    const { limit = 10, profile, dryRun = false, fast = true } = options;

    if (!profile) throw new Error('Profile is required');

    console.log(`🚀 Starting Follow-up Watcher for profile: ${profile}`);
    console.log(`   Delay: per-stage followup_delay_hours from dashboard config.`);
    console.log(`   Typing mode: ${fast ? 'FAST (paste)' : 'slow (human-like)'}`);

    // Initialize via container
    const container = await getContainer();
    const db = container.getDb();
    const funnelRepo = container.repositories.funnel;
    const dbFunctions = await initDB(); // Still needed for getFollowupCountForStep
    const account = await getOrCreateAccount(profile);
    const accountId = account.id;

    // Load funnel stages from database
    const stages = await funnelRepo.getStagesForAccount(accountId);
    if (stages.length === 0) {
        console.log('⚠️  No funnel stages configured for this account. Run migrate-init-funnel-stages.js first.');
        return;
    }

    // Create a map of stageOrder -> stage for quick lookup
    const stagesByOrder = {};
    for (const stage of stages) {
        stagesByOrder[stage.stageOrder] = stage;
    }

    // 1. Find candidate threads (minimal 1h filter, per-stage delay applied below)
    const threads = await getStaleThreads(db, accountId);

    if (threads.length === 0) {
        console.log('✅ No stale threads found needing follow-up.');
        return;
    }

    console.log(`📋 Found ${threads.length} stale threads. Filtering by funnel step rules...`);

    // 2. Filter threads based on Funnel Stage Rules (from database)
    const threadsToProcess = [];

    for (const t of threads) {
        // Use funnel_step (effective_step) as the single source of truth
        const funnelStep = t.effective_step || t.funnel_step || 0;
        if (funnelStep < 2) {
            console.log(`   Skipping @${t.username}: Step ${funnelStep} < 2 (no follow-ups for first contact).`);
            continue;
        }

        // Get the stage configuration from database
        const stage = stagesByOrder[funnelStep];
        if (!stage) {
            console.log(`   Skipping @${t.username} (Funnel step ${funnelStep}): No stage configured.`);
            continue;
        }

        // Check per-stage followup delay (from dashboard config)
        const delayHours = stage.followupDelayHours || 24;
        const delayCutoff = new Date(Date.now() - (delayHours * 60 * 60 * 1000))
            .toISOString().replace('T', ' ').slice(0, 19);
        if (t.last_msg_at > delayCutoff) {
            const hoursAgo = ((Date.now() - new Date(t.last_msg_at + 'Z').getTime()) / (1000 * 60 * 60)).toFixed(1);
            console.log(`   Skipping @${t.username} (Funnel step ${funnelStep}): Last msg ${hoursAgo}h ago, stage requires ${delayHours}h.`);
            continue;
        }

        // Get templates for this stage from database
        const templates = await funnelRepo.getTemplatesForStage(stage.id);
        const maxFollowups = stage.maxFollowups;

        if (maxFollowups === 0 || templates.length === 0) {
            console.log(`   Skipping @${t.username} (Funnel step ${funnelStep}): No follow-ups configured for stage "${stage.stageName}".`);
            continue;
        }

        // Check max follow-ups for this funnel step
        const existingCount = await dbFunctions.getFollowupCountForStep(t.username, funnelStep);

        if (existingCount >= maxFollowups) {
            console.log(`   Skipping @${t.username} (Funnel step ${funnelStep}): Max follow-ups reached (${existingCount}/${maxFollowups}).`);
            // If max reached and auto_ignore is enabled, mark as ignored
            if (stage.autoIgnoreAfterMax) {
                console.log(`   ⚠️  @${t.username}: Marking as ignored (auto_ignore_after_max for stage "${stage.stageName}").`);
                db.prepare(`UPDATE leads SET status = 'ignored', is_ignored = 1, updated_at = datetime('now') WHERE username = ?`).run(t.username);
            }
            continue;
        }

        // Determine next template (sequential)
        let templateIndex = existingCount;
        if (templateIndex >= templates.length) {
            templateIndex = templates.length - 1; // Fallback to last template
        }

        const template = templates[templateIndex];
        t.nextMessage = template.templateText;
        t.templateId = template.id;
        t.followupIndex = existingCount + 1;
        t.maxFollowups = maxFollowups;
        t.funnelStep = funnelStep;
        t.stageName = stage.stageName;
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
            console.log(`   - @${t.username} (Funnel step ${t.funnelStep}, stage: ${t.stageName}) -> Relance #${t.followupIndex}/${t.maxFollowups}`);
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
            console.log(`\n--- Follow-up for @${thread.username} (Funnel step ${thread.funnelStep}) ---`);

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
            const rawName = thread.full_name ? thread.full_name.split(' ')[0] : thread.username;
            const firstName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase() : '';
            message = message.replace(/{{firstName}}/g, firstName);

            console.log(`\n💬 SENDING FOLLOW-UP:`);
            console.log(`   Funnel Step: ${thread.funnelStep} | Relance #${thread.followupIndex}`);
            console.log(`   Message: "${message}"\n`);

            // 7. Type & Register
            await typeInOpenTab(openTab, message, { fast });
            registerOpenTab(thread.username, openTab, message);

            // 8. Update DB
            // Store followup type with step: e.g. 'followup_step4_1'
            await addMessage(thread.username, 'assistant', message, `followup_step${thread.funnelStep}_${thread.followupIndex}`);

            // 9. Track template usage for A/B testing
            if (thread.templateId) {
                await funnelRepo.recordTemplateUsage(thread.templateId, false); // false = not yet replied
            }

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
