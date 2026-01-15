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
 * - Status is 'conversation' or 'outreach'
 * - Last message was from 'assistant'
 * - Last message was sent > X days ago
 */
async function getStaleThreads(db, accountId, days) {
    const daysMs = days * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(Date.now() - daysMs).toISOString();

    // We can use a complex query or just get all conversations and filter in JS.
    // Given we need to check the *last message*, a SQL query is better.
    
    // This query finds leads where the most recent message in 'conversations' table is from 'assistant'
    const sql = `
        SELECT l.*, 
               MAX(c.sent_at) as last_msg_at,
               (SELECT role FROM conversations WHERE lead_id = l.id ORDER BY sent_at DESC LIMIT 1) as last_role,
               (SELECT message_text FROM conversations WHERE lead_id = l.id ORDER BY sent_at DESC LIMIT 1) as last_text
        FROM leads l
        JOIN conversations c ON l.id = c.lead_id
        WHERE l.account_id = ?
          AND l.status IN ('conversation', 'outreach')
          AND l.booking_status IS NOT 'completed'
          AND l.is_ignored = 0
        GROUP BY l.id
        HAVING last_role = 'assistant' AND last_msg_at < ?
        ORDER BY last_msg_at ASC
        LIMIT ?
    `;

    return db.prepare(sql).all(accountId, cutoffDate, 50); // limit 50 at a time
}

export async function runFollowupWatcher(options = {}) {
    const { days = 2, limit = 10, profile, dryRun = false } = options;

    if (!profile) throw new Error('Profile is required');

    console.log(`🚀 Starting Follow-up Watcher for profile: ${profile}`);
    console.log(`   Criteria: Last msg from Assistant > ${days} days ago.`);

    const dbFunctions = await initDB();
    const db = await dbFunctions.getDatabase(); // Access raw db
    const account = await getOrCreateAccount(profile);
    const accountId = account.id;

    // 1. Find Stale Threads
    const threads = await getStaleThreads(db, accountId, days);
    
    if (threads.length === 0) {
        console.log('✅ No stale threads found needing follow-up.');
        return;
    }

    console.log(`📋 Found ${threads.length} stale threads.`);
    
    // Filter by limit
    const targetThreads = threads.slice(0, limit);

    if (dryRun) {
        console.log('🚧 DRY RUN MODE. Would process:');
        targetThreads.forEach(t => {
            console.log(`   - @${t.username} (Last msg: ${t.last_msg_at})`);
        });
        return;
    }

    // 2. Load Config
    // We construct a SPECIAL prompt for follow-ups that OVERRIDES the standard system prompt logic slightly
    // or we just inject a strong instruction.
    const profileConfig = await loadProfileConfig(profile);

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
            console.log(`\n--- Follow-up for @${thread.username} ---`);

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
            // If the user HAS replied since our DB record, `scrapedMessages` will show it.
            // We must NOT send a follow-up if they replied.
            const scrapedMessages = result.scrapedMessages || [];
            if (scrapedMessages.length > 0) {
                const lastScraped = scrapedMessages[scrapedMessages.length - 1];
                if (lastScraped.role === 'user') {
                    console.log('⚠️  User has replied recently! Aborting follow-up.');
                    // Sync DB
                    await addMessage(thread.username, 'user', lastScraped.text); 
                    await openTab.close();
                    continue;
                }
            }

            // 6. Generate Follow-up
            // We use the Engine but we inject a "Force Follow Up" instruction
            const history = await getConversationHistory(thread.username);
            const leadContext = await getLeadWithContext(thread.username);

            // SPECIAL FOLLOW-UP PROMPT INJECTION
            // We wrap the profile config to override the system prompt or add context
            const followupContext = `
            🚨 **MODE RELANCE ACTIVÉ** 🚨
            
            CONTEXTE : Cela fait plus de ${days} jours que tu as envoyé ton dernier message et le prospect n'a pas répondu.
            TA MISSION : Écrire un message de RELANCE (Follow-up) court et naturel pour réengager la conversation.
            
            RÈGLES :
            - Ne répète pas ton dernier message.
            - Utilise les "Etapes 6 (Relances)" de ton script.
            - Si c'est la première relance : "Je me permets de te relancer doucement..."
            - Si c'est la deuxième : "Je repensais à notre échange..."
            - Ton : Doux, pas harcelant, bienveillant.
            - PAS DE TAG [ALERT_BOOKING] ICI.
            `;

            console.log('🤖 Generating follow-up...');
            const response = await generateResponse({
                conversationHistory: history,
                leadContext: leadContext,
                profileConfig: profileConfig,
                additionalContext: followupContext // We need to ensure Engine supports this or append to system prompt
            });

            const message = response.next_message || response.message || response.suggested_message;

            if (!message) {
                console.log('❌ No message generated');
                await openTab.close();
                continue;
            }

            console.log(`💬 Suggestion: "${message}"`);
            
            // 7. Type
            await typeInOpenTab(openTab, message);
            
            // Register for Review
            registerOpenTab(thread.username, openTab, message);
            
            // Save as 'assistant' to update timestamp so we don't spam
            // But mark it as a 'followup' type if possible, or just standard text.
            await addMessage(thread.username, 'assistant', message);
            
            processedCount++;
        }

        if (processedCount > 0) {
            console.log(`\n✨ Prepared ${processedCount} follow-ups.`);
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
