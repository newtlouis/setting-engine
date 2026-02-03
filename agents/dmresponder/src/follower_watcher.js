/**
 * @file Follower Watcher for DM Responder
 * 
 * Scans Instagram notifications for "started following you".
 * Qualifies the new follower and sends the first outreach message.
 */

import { 
  initBrowser, 
  goToNotifications,
  scrapeProfileMetadata,
  typeInOpenTab,
  registerOpenTab,
  waitForUserToFinish,
  closeBrowser,
  getOpenMessageTabs,
  openDMAndScrape
} from './scraper.js';
import {
  initDB,
  getLeadWithContext,
  addMessage,
  setDmThreadStatus,
  getOrCreateAccount,
  fullUpsertLead
} from './db_integration.js';
import { getContainer } from '../../../shared/container.js';
import { qualifyLead } from '../../outreach/src/qualify_lead.js';
import { extractNameWithAI } from '../../outreach/src/name_extractor.js';
import { loadProfileConfig } from '../../../shared/utils/configLoader.js';
import path from 'path';

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  NOTIFICATION_SELECTORS: {
    ITEMS: 'div[role="listitem"]',
    FOLLOW_TEXT: [
      'commencé à vous suivre',
      'started following you',
      'a commencé à vous suivre'
    ]
  },
  MAX_FOLLOWERS_PER_SESSION: 10
};

/**
 * Scan notifications for new followers in specific sections
 */
async function scanForNewFollowers(page, options = {}) {
    console.log('   Scanning notifications...');
    
    return await page.evaluate((args) => {
        const { selectors, trackWeek } = args;
        const results = [];
        
        // Handle both straight and curly apostrophes
        const sectionsToTrack = ['nouveau', 'aujourd\'hui', 'aujourd’hui', 'hier', 'today', 'yesterday', 'new'];
        if (trackWeek) {
            sectionsToTrack.push('cette semaine', 'this week');
        }
        
        // Find all notification containers
        const allItems = Array.from(document.querySelectorAll('div[data-pressable-container="true"]'));
        console.log(`Debug Context: Found ${allItems.length} total notification items.`);
        
        for (const item of allItems) {
            const text = item.innerText || '';
            const isFollow = selectors.FOLLOW_TEXT.some(t => text.toLowerCase().includes(t));
            
            if (isFollow) {
                // Find section name by searching for the "nearest" preceding heading
                let sectionName = "";
                let current = item;
                
                // Helper to check for heading text
                const findHeadingBefore = (element) => {
                    let prev = element;
                    while (prev) {
                        let sib = prev.previousElementSibling;
                        while (sib) {
                            const heading = sib.matches('[role="heading"]') ? sib : sib.querySelector('[role="heading"]');
                            if (heading) return heading.innerText?.trim().toLowerCase();
                            sib = sib.previousElementSibling;
                        }
                        prev = prev.parentElement;
                        if (prev?.matches('main') || prev?.id === 'mount_0_0') break;
                    }
                    return "";
                };

                sectionName = findHeadingBefore(item);
                const isTargetSection = sectionName && sectionsToTrack.some(t => sectionName.includes(t));
                
                if (isTargetSection) {
                    const link = item.querySelector('a[href^="/"]');
                    if (link) {
                        const href = link.getAttribute('href');
                        const username = href.replace(/\//g, '').split('?')[0];
                        if (username && !['explore', 'direct', 'reels', 'p', 'stories'].includes(username)) {
                            results.push({
                                username,
                                text: text.substring(0, 50) + '...'
                            });
                        }
                    }
                }
            }
        }
        
        return results;
    }, { selectors: CONFIG.NOTIFICATION_SELECTORS, trackWeek: options.trackWeek });
}

export async function runFollowerWatcher(options = {}) {
    await initDB();
    const container = await getContainer();

    const profile = options.profile || process.env.IG_PROFILE;
    if (!profile) {
        throw new Error('Profile name is required. Use --profile <name>.');
    }
    
    console.log(`\n========================================`);
    console.log(`   DM RESPONDER - NEW FOLLOWER WATCHER`);
    console.log(`========================================`);
    console.log(`   Profile: ${profile}`);
    console.log(`   Track Week: ${!!options.trackWeek}`);
    console.log(`   Prepare Only: ${!!options.prepareOnly}`);
    
    let browser = null;
    let page = null;
    let processedCount = 0;
    
    try {
        const userDataDir = path.join(process.cwd(), `browser-data-${profile}`);
        const browserResult = await initBrowser({ 
            profile,
            headless: options.headless !== undefined ? options.headless : false 
        });
        page = browserResult.page;
        
        const profileConfig = await loadProfileConfig(profile);
        const account = await getOrCreateAccount(profile);
        
        // Step 2: Go to Notifications
        await goToNotifications(page);
        
        // Optional: Scroll to load more (e.g. "This Week")
        if (options.trackWeek) {
            console.log('   Scrolling to load "This Week" section...');
            await page.evaluate(async () => {
                for (let i = 0; i < 3; i++) {
                    window.scrollTo(0, document.body.scrollHeight);
                    await new Promise(r => setTimeout(r, 1000));
                }
            });
            await new Promise(r => setTimeout(r, 2000));
        }
        
        // Step 3: Scan for followers
        const newFollowers = await scanForNewFollowers(page, { trackWeek: options.trackWeek });
        console.log(`   Found ${newFollowers.length} potential new follower(s).`);
        
        if (newFollowers.length === 0) {
            console.log('   ✅ No new followers found in recent notifications.');
            return;
        }
        
        // Deduplicate
        const uniqueFollowers = Array.from(new Set(newFollowers.map(f => f.username)))
            .map(username => newFollowers.find(f => f.username === username));
            
        console.log(`   💎 Analysis of ${uniqueFollowers.length} unique profiles found...`);
        
        const leadsToProceed = [];
        let alreadyKnownCount = 0;

        for (const follower of uniqueFollowers) {
            const existingLead = await getLeadWithContext(follower.username);
            const skipStatuses = ['contacted', 'outreach', 'conversation', 'already_known', 'disqualified', 'not_interested'];
            
            if (existingLead && skipStatuses.includes(existingLead.status)) {
                alreadyKnownCount++;
            } else {
                leadsToProceed.push(follower);
            }
        }

        console.log(`      - Already known in DB: ${alreadyKnownCount}`);
        console.log(`      - New followers discovered: ${leadsToProceed.length}`);
        
        const TARGET_MESSAGE_COUNT = options.targetMessageCount || 10;
        console.log(`   🎯 Target: Prepare ${TARGET_MESSAGE_COUNT} outreach messages.`);

        if (leadsToProceed.length === 0) {
             console.log(`      - Action: No new followers to process.`);
             return; // Or continue if there was a loop, here it's main body
        }

        console.log(`      - Action: Processing followers until target (${TARGET_MESSAGE_COUNT}) is reached (Current: ${processedCount})`);

        for (const follower of leadsToProceed) {
            // Check Global Limit
            if (processedCount >= TARGET_MESSAGE_COUNT) {
                console.log(`   🛑 Target reached (${processedCount}/${TARGET_MESSAGE_COUNT}). Stopping.`);
                break;
            }

            const username = follower.username;
            console.log(`\n--- Checking: @${username} ---`);
            
            // 5. Navigate to Profile
            await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
            await new Promise(r => setTimeout(r, 2000));
            
            // 6. Scrape Metadata
            const metadata = await scrapeProfileMetadata(page, username);
            if (!metadata.success) {
                console.log(`   ⚠️ Failed to scrape metadata for @${username}. Skipping.`);
                continue;
            }
            
            // 7. Qualify Lead
            console.log(`   🔍 Qualifying @${username}...`);
            const qualification = await qualifyLead(metadata.bio, profileConfig.outreach?.qualification_prompt, username);
            
            if (!qualification.qualified) {
                console.log(`   ❌ Not qualified: ${qualification.reason}`);
                // Disqualify in DB
                await fullUpsertLead(username, account.id, {
                    status: 'disqualified',
                    full_name: metadata.fullName,
                    bio: metadata.bio,
                    lead_source: 'new_follower',
                    notes: `Disqualified: ${qualification.reason}`
                });
                continue;
            }
            
            // 8. Prepare Message
             let aiFirstName = null;
            try {
                aiFirstName = await extractNameWithAI(username, metadata.fullName);
            } catch (e) {}
            
            let messageTemplate = profileConfig.outreach?.follower_template;
            
            let finalMessage = "";
            if (aiFirstName) {
                // NEW PATTERN: Just "[Name] ?"
                finalMessage = `${aiFirstName} ?`;
            } else {
                if (!messageTemplate || messageTemplate.length < 5) {
                    messageTemplate = "Hello ! Merci pour ton follow, bienvenue ici 🌸";
                }
                finalMessage = messageTemplate.replace(/{{firstName}}/g, '').replace(/\s+/g, ' ').trim();
                if (finalMessage.startsWith('!')) finalMessage = "Hello " + finalMessage;
            }
             finalMessage = finalMessage.replace(/\s+/g, ' ').trim();
            
            if (options.dryRun) {
                console.log(`   🚧 DRY RUN: Would DM @${username}: "${finalMessage}"`);
                continue;
            }
            
            // 9. Send MD
             const dmResult = await openDMAndScrape({
                username,
                profile_url: `https://www.instagram.com/${username}/`
            });
            
             if (!dmResult.success) {
                console.log(`   ❌ Failed to open DM: ${dmResult.error}`);
                
                // Handle blocked/deleted profiles
                if (dmResult.error?.includes('Profile unavailable') || dmResult.error?.includes('page introuvable')) {
                    console.log(`📡 Lead @${username} seems to have blocked Melanie or deleted their profile. Marking as not_interested.`);
                    await fullUpsertLead(username, account.id, {
                        status: 'not_interested',
                        notes: "Profile unavailable (likely blocked/deleted)."
                    });
                }
                continue;
            }
            
            if (dmResult.scrapedMessages.length === 0) {
                console.log(`\n   💬 PREPARING OUTREACH: "${finalMessage}"`);
                
                // --prepare-only mode: Store in queue, don't open tab
                if (options.prepareOnly) {
                    const queueResult = await container.repositories.outreachQueue.add({
                        username,
                        profileUrl: `https://www.instagram.com/${username}/`,
                        dmUrl: dmResult.dmUrl,
                        preparedMessage: finalMessage,
                        firstName: aiFirstName,
                        source: 'follower'
                     });
                     
                     if (queueResult) {
                         console.log(`   📦 Queued @${username} for later sending.`);
                         await fullUpsertLead(username, account.id, {
                             status: 'queued',
                             full_name: metadata.fullName,
                             bio: metadata.bio,
                             first_name: aiFirstName,
                             lead_source: 'new_follower',
                             dm_url: dmResult.dmUrl
                         });
                         processedCount++;
                         console.log(`   ✅ Queued. Progress: ${processedCount}/${TARGET_MESSAGE_COUNT}`);
                     } else {
                         console.log(`   ⚠️ Already in queue: @${username}`);
                     }
                     if (dmResult.tab) await dmResult.tab.close().catch(() => {});
                } else {
                    // Normal mode: Open tab for review
                    await typeInOpenTab(dmResult.tab, finalMessage);
                    registerOpenTab(username, dmResult.tab, finalMessage);
                    
                    await fullUpsertLead(username, account.id, {
                        status: 'outreach',
                        full_name: metadata.fullName,
                        bio: metadata.bio,
                        lead_source: 'new_follower',
                        dm_url: dmResult.dmUrl,
                        conversation_step: 2
                    });
                    await addMessage(username, 'assistant', finalMessage, 'new_follower', account.id);
                    processedCount++;
                    console.log(`   ✅ Message prepared. Progress: ${processedCount}/${TARGET_MESSAGE_COUNT}`);
                }

            } else {
                console.log(`   ⚠️ Conversation history found. Marking as already_known.`);
                 await fullUpsertLead(username, account.id, {
                    status: 'already_known',
                    full_name: metadata.fullName,
                    bio: metadata.bio,
                    lead_source: 'follower_outreach',
                    dm_url: dmResult.dmUrl,
                    notes: `Discussion existante détectée (${dmResult.scrapedMessages.length} messages).`
                });
                
                if (dmResult.tab) await dmResult.tab.close().catch(() => {});
            }
            
            // Small break between profiles
            await new Promise(r => setTimeout(r, 3000));
        }
        
        if (processedCount > 0) {
            if (options.prepareOnly) {
                console.log(`\n✨ Queued ${processedCount} leads for later sending.`);
                const queueStats = await container.repositories.outreachQueue.getStats();
                console.log(`   Total pending in queue: ${queueStats.pending}`);
            } else {
                console.log(`\n✨ Prepared ${processedCount} outreach messages for review.`);
                await waitForUserToFinish();
            }
        } else {
            console.log('\nNo new outreach messages prepared.');
        }
        
    } catch (err) {
        console.error(`\n❌ Fatal error: ${err.message}`);
    } finally {
        await closeBrowser();
    }
}
