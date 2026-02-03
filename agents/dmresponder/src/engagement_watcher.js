/**
 * @file Engagement Watcher for DM Responder
 * 
 * Scans Instagram notifications for Likes and Comments on your own posts.
 * Visits the posts, scrapes likers and commenters, and initiates outreach.
 */

import { 
  initBrowser, 
  goToNotifications,
  scrapeProfileMetadata,
  typeInOpenTab,
  registerOpenTab,
  waitForUserToFinish,
  closeBrowser,
  scrapePostLikers,
  scrapePostComments,
  openDMAndScrape,
  uploadFileInDM
} from './scraper.js';
import {
  initDB,
  getLeadWithContext,
  addMessage,
  getOrCreateAccount,
  fullUpsertLead
} from './db_integration.js';
import { getContainer } from '../../../shared/container.js';
import { qualifyLead } from '../../outreach/src/qualify_lead.js';
import { extractNameWithAI } from '../../outreach/src/name_extractor.js';
import { loadProfileConfig } from '../../../shared/utils/configLoader.js';
import path from 'path';

// ============================================
const CONFIG = {
  NOTIFICATION_SELECTORS: {
    LIKE_TEXT: ['liked your', 'aimé votre', 'aimé votre reel', 'aimé votre publication', 'aimé votre photo', 'liked your reel', 'liked your photo'],
    COMMENT_TEXT: ['commented on', 'commenté sur', 'a commenté', 'commenté :', 'commented:'],
    IGNORE_TEXT: [
        'à répondu à votre commentaire', 
        'replied to your comment',
        'à aimé votre commentaire',
        'liked your comment'
    ]
  },
  MAX_POSTS_PER_SESSION: 8,
  MAX_LEADS_PER_POST: 25
};

/**
 * Scan notifications for likes/comments and extract post URLs
 */
async function scanForEngagement(page, options = {}) {
    console.log('   Scanning notifications for engagement...');
    
    return await page.evaluate((args) => {
        const { selectors, trackWeek } = args;
        const postMap = new Map(); // URL -> { type: 'like'|'comment', users: [] }
        
        // Sections to track
        const sectionsToTrack = ['nouveau', 'aujourd\'hui', 'aujourd’hui', 'hier', 'today', 'yesterday', 'new'];
        if (trackWeek) {
            sectionsToTrack.push('cette semaine', 'this week');
        }

        const allItems = Array.from(document.querySelectorAll('div[data-pressable-container="true"]'));
        
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

        for (const item of allItems) {
            const text = item.innerText || '';
            const lowerText = text.toLowerCase();
            
            // Check ignore list first
            if (selectors.IGNORE_TEXT && selectors.IGNORE_TEXT.some(t => lowerText.includes(t))) {
                continue;
            }

            const isLike = selectors.LIKE_TEXT.some(t => lowerText.includes(t));
            const isComment = selectors.COMMENT_TEXT.some(t => lowerText.includes(t));
            
            if (isLike || isComment) {
                // Section filtering
                const sectionName = findHeadingBefore(item);
                const isTargetSection = sectionName && sectionsToTrack.some(t => sectionName.includes(t));
                
                if (!isTargetSection) continue;

                // Find the post link in the notification
                const links = Array.from(item.querySelectorAll('a[href^="/p/"], a[href^="/reels/"]'));
                if (links.length > 0) {
                    // Filter to find the cleaner URL (not ending in /liked_by/ or /comments/)
                    let bestLink = links.find(a => {
                        const h = a.getAttribute('href');
                        return !h.includes('/liked_by/') && !h.includes('/comments/');
                    });
                    
                    // Fallback to first link found
                    const postHref = (bestLink || links[0]).getAttribute('href').split('?')[0];
                    const postUrl = 'https://www.instagram.com' + postHref.replace(/\/liked_by\/?$/, '/').replace(/\/comments\/?$/, '/');
                    
                    const existing = postMap.get(postUrl) || { 
                        url: postUrl,
                        types: new Set(),
                        notifTexts: []
                    };
                    
                    if (isLike) existing.types.add('like');
                    if (isComment) existing.types.add('comment');
                    existing.notifTexts.push(text.substring(0, 50).replace(/\n/g, ' '));
                    
                    postMap.set(postUrl, existing);
                }
            }
        }
        
        return Array.from(postMap.values()).map(p => ({
            ...p,
            types: Array.from(p.types)
        }));
    }, { selectors: CONFIG.NOTIFICATION_SELECTORS, trackWeek: options.trackWeek });
}

export async function runEngagementWatcher(options = {}) {
    await initDB();
    const container = await getContainer();

    const profile = options.profile || process.env.IG_PROFILE;
    if (!profile) {
        throw new Error('Profile name is required. Use --profile <name>.');
    }
    
    console.log(`\n========================================`);
    console.log(`   DM RESPONDER - ENGAGEMENT WATCHER`);
    console.log(`========================================`);
    console.log(`   Profile: ${profile}`);
    console.log(`   Prepare Only: ${!!options.prepareOnly}`);
    
    let browser = null;
    let page = null;
    let preparedCount = 0;
    
    try {
        const browserResult = await initBrowser({ 
            profile,
            headless: options.headless !== undefined ? options.headless : false 
        });
        page = browserResult.page;
        
        const profileConfig = await loadProfileConfig(profile);
        const account = await getOrCreateAccount(profile);
        
        // 1. Go to Notifications
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

        // 2. Scan for engaged posts
        const engagedPosts = await scanForEngagement(page, { trackWeek: options.trackWeek });
        
        if (engagedPosts.length === 0) {
            console.log('   ✅ No new engagement notifications found.');
            return;
        }

        console.log(`\n📋 Found ${engagedPosts.length} post(s) to analyze:`);
        engagedPosts.forEach((p, i) => {
            const typeStr = p.types.map(t => t.toUpperCase()).join(' & ');
            console.log(`   ${i+1}. [${typeStr}] ${p.url}`);
            console.log(`      (${p.notifTexts[0]}${p.notifTexts.length > 1 ? ` + ${p.notifTexts.length-1} more` : ''})`);
        });

        // 3. Process each post
        const TARGET_MESSAGE_COUNT = options.targetMessageCount || 10;
        console.log(`   🎯 Target: Prepare ${TARGET_MESSAGE_COUNT} outreach messages.`);
        
        for (const post of engagedPosts.slice(0, CONFIG.MAX_POSTS_PER_SESSION)) {
            if (preparedCount >= TARGET_MESSAGE_COUNT) {
                console.log(`   🛑 Target reached (${preparedCount}/${TARGET_MESSAGE_COUNT}). Stopping post analysis.`);
                break;
            }

            console.log(`\n🚀 Analyzing Post: ${post.url}`);
            const typeStr = post.types.map(t => t.toUpperCase()).join(' & ');
            console.log(`   Intent: Scrape ${typeStr}`);
            
            await page.goto(post.url, { waitUntil: 'domcontentloaded' });
            await new Promise(r => setTimeout(r, 3000));
            
            // Collect usernames from both likes and comments
            // REVISED ORDER: Scrape comments first (by scrolling the page) before opening the likes popup
            const commenters = await scrapePostComments(page);
            const likers = await scrapePostLikers(page);
            
            console.log(`   📊 Scraping results:`);
            console.log(`      - Likes: ${likers.length} leads ${likers.length > 0 ? `(@${likers.slice(0, 10).join(', @')}${likers.length > 10 ? '...' : ''})` : ''}`);
            console.log(`      - Comments: ${commenters.length} leads ${commenters.length > 0 ? `(@${commenters.slice(0, 10).map(c => c.username).join(', @')}${commenters.length > 10 ? '...' : ''})` : ''}`);

            // Unified list of potential leads
            const potentialLeads = [
                ...likers.map(u => ({ username: u, source: 'post_like' })),
                ...commenters.map(c => ({ username: c.username, source: 'post_comment', text: c.text }))
            ];
            
            // Deduplicate
            const uniqueLeads = Array.from(new Set(potentialLeads.map(l => l.username)))
                .map(username => potentialLeads.find(l => l.username === username));
            
            console.log(`   💎 Analysis of ${uniqueLeads.length} unique profiles found...`);
            
            const leadsToProceed = [];
            let alreadyKnownCount = 0;

            for (const lead of uniqueLeads) {
                const existingLead = await getLeadWithContext(lead.username);
                const skipStatuses = ['contacted', 'outreach', 'conversation', 'already_known', 'disqualified', 'not_interested'];
                
                if (existingLead && skipStatuses.includes(existingLead.status)) {
                    alreadyKnownCount++;
                } else {
                    leadsToProceed.push(lead);
                }
            }

            console.log(`      - Already known in DB: ${alreadyKnownCount}`);
            console.log(`      - New leads discovered: ${leadsToProceed.length}`);
            
            if (leadsToProceed.length === 0) {
                 console.log(`      - Action: No new leads to process for this post.`);
                 continue;
            }
            
            console.log(`      - Action: Processing leads until target (${TARGET_MESSAGE_COUNT}) is reached (Current: ${preparedCount})`);

            // No slicing here - we process until we hit the global target
            for (const lead of leadsToProceed) {
                // Check Global Target
                 if (preparedCount >= TARGET_MESSAGE_COUNT) {
                    console.log(`   🛑 Target reached (${preparedCount}/${TARGET_MESSAGE_COUNT}) during filtering. Stopping.`);
                    break;
                }

                const username = lead.username;
                console.log(`\n   --- Checking: @${username} (${lead.source}) ---`);
                
                // 5. Profile Check
                await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
                await new Promise(r => setTimeout(r, 2000));
                
                const metadata = await scrapeProfileMetadata(page, username);
                if (!metadata.success) continue;
                
                // 6. Contact Check (Optimization: Check before qualifying bio with AI)
                if (!metadata.canContact) {
                    console.log(`   🚫 @${username} not contactable (No Message button). Skipping AI qualification.`);
                    // Save as uncontactable to avoid re-checking in future
                    await fullUpsertLead(username, account.id, {
                        status: 'uncontactable',
                        full_name: metadata.fullName,
                        bio: metadata.bio,
                        lead_source: lead.source,
                        notes: `No message button found on profile.`
                    });
                    continue;
                }
                
                // 7. Qualification
                const qualification = await qualifyLead(metadata.bio, profileConfig.outreach?.qualification_prompt, username);
                if (!qualification.qualified) {
                    console.log(`   ❌ Not qualified: ${qualification.reason}`);
                    // Save as disqualified to avoid re-checking in future
                    await fullUpsertLead(username, account.id, {
                        status: 'disqualified',
                        full_name: metadata.fullName,
                        bio: metadata.bio,
                        lead_source: lead.source,
                        notes: `Disqualified by AI: ${qualification.reason}`
                    });
                    continue;
                }
                
                // 7. Prepare Outreach Message
                let aiFirstName = null;
                try {
                    aiFirstName = await extractNameWithAI(username, metadata.fullName);
                } catch (e) {}

                // --- CTA Keyword Detection ---
                let ctaMatch = null;
                let resourceToUpload = null;
                
                if (lead.source === 'post_comment' && lead.text && profileConfig.outreach?.cta_resources) {
                    const commentText = lead.text.toLowerCase().trim();
                    const ctaKeywords = Object.keys(profileConfig.outreach.cta_resources);
                    
                    for (const keyword of ctaKeywords) {
                        // Match if comment IS the keyword (with some tolerance for emojis/spaces)
                        const cleanedComment = commentText.replace(/[^\w\sàâäéèêëïîôùûüÿçœæ]/gi, '').trim();
                        if (cleanedComment === keyword.toLowerCase() || commentText === keyword.toLowerCase()) {
                            ctaMatch = profileConfig.outreach.cta_resources[keyword];
                            console.log(`   🎁 CTA Keyword detected: "${keyword}" -> Will deliver resource.`);
                            break;
                        }
                    }
                    
                    if (ctaMatch && ctaMatch.file) {
                        // Build absolute path to resource file
                        const resourcesDir = path.join(process.cwd(), 'config', 'profiles', profile, 'resources');
                        resourceToUpload = path.join(resourcesDir, ctaMatch.file);
                    }
                }
                
                // --- Select Message Template ---
                let messageTemplate;
                
                if (ctaMatch && ctaMatch.outreach_template) {
                    // Use CTA-specific template
                    messageTemplate = ctaMatch.outreach_template;
                } else if (lead.source === 'post_comment') {
                    messageTemplate = profileConfig.outreach?.comment_outreach_template;
                } else {
                    messageTemplate = profileConfig.outreach?.like_outreach_template;
                }
                
                let finalMessage = "";
                
                if (aiFirstName) {
                    // NEW PATTERN: Just "[Name] ?"
                    finalMessage = `${aiFirstName} ?`;
                } else {
                    // Handle {{firstName}} placeholder
                    if (!messageTemplate || messageTemplate.length < 10) {
                        messageTemplate = "Hello ! Merci pour ton interaction sur mon dernier post 🌸";
                    }
                    // Remove {{firstName}} and clean up formatting
                    finalMessage = messageTemplate.replace(/{{firstName}}/g, '').replace(/\s+/g, ' ').trim();
                    // If it started with "Hello !" (now that name is gone), make sure it's capitalized correctly
                    if (finalMessage.startsWith('!')) finalMessage = "Hello " + finalMessage;
                }
                
                // Final cleanup: remove double spaces and trim
                finalMessage = finalMessage.replace(/\s+/g, ' ').trim();
                
                // --- CTA Delivery (URL & Message Addon) ---
                if (ctaMatch) {
                    let addon = "";
                    if (ctaMatch.message_addon) addon += `\n\n${ctaMatch.message_addon}`;
                    if (ctaMatch.url) addon += ctaMatch.message_addon ? `\n${ctaMatch.url}` : `\n\n${ctaMatch.url}`;
                    finalMessage += addon;
                }

                if (options.dryRun) {
                    console.log(`   🚧 DRY RUN: Would contact @${username} with: "${finalMessage}"`);
                    if (resourceToUpload) console.log(`   🚧 DRY RUN: Would upload resource: ${resourceToUpload}`);
                    continue; // In dry run we don't increment preparedCount for real, or we could if we wanted to simulate the limit
                }

                // 8. Outreach
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
                    if (dmResult.tab) await dmResult.tab.close().catch(() => {});
                    continue;
                }

                if (dmResult.success && dmResult.scrapedMessages.length === 0) {
                    console.log(`\n   💬 PREPARING ENGAGEMENT OUTREACH:`);
                    console.log(`   Profile: https://www.instagram.com/${username}/`);
                    console.log(`   Message: "${finalMessage}"\n`);

                    // --prepare-only mode: Store in queue, don't open tab
                    if (options.prepareOnly) {
                        const queueResult = await container.repositories.outreachQueue.add({
                            username,
                            profileUrl: `https://www.instagram.com/${username}/`,
                            dmUrl: dmResult.dmUrl,
                            preparedMessage: finalMessage,
                            firstName: aiFirstName,
                            source: 'engagement',
                            resourceFile: resourceToUpload || null,
                            resourceUrl: ctaMatch?.url || null
                        });
                        
                        if (queueResult) {
                            console.log(`   📦 Queued @${username} for later sending.`);
                            await fullUpsertLead(username, account.id, {
                                status: 'queued',
                                full_name: metadata.fullName,
                                bio: metadata.bio,
                                first_name: aiFirstName,
                                lead_source: lead.source,
                                dm_url: dmResult.dmUrl,
                                notes: ctaMatch ? `CTA resource queued: ${ctaMatch.file}` : null
                            });
                            preparedCount++;
                            console.log(`   ✅ Queued. Progress: ${preparedCount}/${TARGET_MESSAGE_COUNT}`);
                        } else {
                            console.log(`   ⚠️ Already in queue: @${username}`);
                        }
                        if (dmResult.tab) await dmResult.tab.close().catch(() => {});
                    } else {
                        // Normal mode: Open tab for review
                        await typeInOpenTab(dmResult.tab, finalMessage);
                        
                        // --- CTA Resource Upload ---
                        if (resourceToUpload) {
                            console.log(`   📎 Uploading CTA resource...`);
                            const uploadResult = await uploadFileInDM(dmResult.tab, resourceToUpload);
                            if (uploadResult.success) {
                                console.log(`   ✅ Resource uploaded successfully.`);
                            } else {
                                console.log(`   ⚠️ Resource upload failed: ${uploadResult.error}`);
                            }
                        }
                        
                        registerOpenTab(username, dmResult.tab, finalMessage);
                        
                        // 9. Sync DB
                        await fullUpsertLead(username, account.id, {
                            status: 'outreach',
                            full_name: metadata.fullName,
                            bio: metadata.bio,
                            lead_source: lead.source,
                            dm_url: dmResult.dmUrl,
                            conversation_step: 2,
                            notes: ctaMatch ? `CTA resource delivered: ${ctaMatch.file}` : null
                        });
                        await addMessage(username, 'assistant', finalMessage, lead.source, account.id);
                        preparedCount++;
                        console.log(`   ✅ Message prepared. Progress: ${preparedCount}/${TARGET_MESSAGE_COUNT}`);
                    }

                } else if (dmResult.success && dmResult.scrapedMessages.length > 0) {
                    console.log(`   ⚠️ Existing conversation history found for @${username}. Marking as known_contact.`);
                    
                    // Register as known contact with context
                    await fullUpsertLead(username, account.id, {
                        status: 'already_known',
                        full_name: metadata.fullName,
                        bio: metadata.bio,
                        lead_source: lead.source,
                        dm_url: dmResult.dmUrl,
                        notes: `Discussion existante détectée (${dmResult.scrapedMessages.length} messages).`
                    });
                    
                    if (dmResult.tab) await dmResult.tab.close().catch(() => {});
                } else if (dmResult.tab) {
                    await dmResult.tab.close().catch(() => {});
                }
                
                await new Promise(r => setTimeout(r, 3000));
            }
        }
        
        if (preparedCount > 0) {
            if (options.prepareOnly) {
                console.log(`\n✨ Queued ${preparedCount} leads for later sending.`);
                const queueStats = await container.repositories.outreachQueue.getStats();
                console.log(`   Total pending in queue: ${queueStats.pending}`);
            } else {
                console.log(`\n✨ Prepared ${preparedCount} engagement outreach messages for review.`);
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
