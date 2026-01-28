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
  openDMAndScrape
} from './scraper.js';
import {
  initDB,
  getLeadWithContext,
  addMessage,
  getOrCreateAccount,
  fullUpsertLead
} from './db_integration.js';
import { qualifyLead } from '../../outreach/src/qualify_lead.js';
import { extractNameWithAI } from '../../outreach/src/name_extractor.js';
import { loadProfileConfig } from '../../../shared/utils/configLoader.js';
import path from 'path';

// ============================================
const CONFIG = {
  NOTIFICATION_SELECTORS: {
    LIKE_TEXT: ['liked your', 'aimé votre', 'aimé votre reel', 'aimé votre publication', 'aimé votre photo', 'liked your reel', 'liked your photo'],
    COMMENT_TEXT: ['commented on', 'commenté sur', 'a commenté', 'commenté :', 'commented:']
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
            const isLike = selectors.LIKE_TEXT.some(t => text.toLowerCase().includes(t));
            const isComment = selectors.COMMENT_TEXT.some(t => text.toLowerCase().includes(t));
            
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
    
    const profile = options.profile || process.env.IG_PROFILE;
    if (!profile) {
        throw new Error('Profile name is required. Use --profile <name>.');
    }
    
    console.log(`\n========================================`);
    console.log(`   DM RESPONDER - ENGAGEMENT WATCHER`);
    console.log(`========================================`);
    console.log(`   Profile: ${profile}`);
    
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
        for (const post of engagedPosts.slice(0, CONFIG.MAX_POSTS_PER_SESSION)) {
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
                
            console.log(`   💎 Total unique users to process: ${Math.min(uniqueLeads.length, CONFIG.MAX_LEADS_PER_POST)}`);

            for (const lead of uniqueLeads.slice(0, CONFIG.MAX_LEADS_PER_POST)) {
                const username = lead.username;
                
                // 4. Check if already in DB (Avoid redundant scraping/evaluation)
                const existingLead = await getLeadWithContext(username);
                if (existingLead) {
                    console.log(`   ⏭️ @${username} already in database (status: ${existingLead.status}). Skipping.`);
                    continue;
                }
                
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

                let messageTemplate = lead.source === 'post_comment' 
                    ? profileConfig.outreach?.comment_outreach_template 
                    : profileConfig.outreach?.like_outreach_template;
                
                // Fallback to follower template if specific ones don't exist
                if (!messageTemplate) messageTemplate = profileConfig.outreach?.follower_template;
                
                // Final safety fallback to avoid empty or ultra-short messages
                if (!messageTemplate || messageTemplate.length < 10) {
                    messageTemplate = "Hello {{firstName}} ! Merci pour ton interaction sur mon dernier post 🌸";
                }

                let finalMessage = messageTemplate;
                
                // Handle {{firstName}} placeholder
                if (aiFirstName) {
                    finalMessage = finalMessage.replace(/{{firstName}}/g, aiFirstName);
                } else {
                    // Remove {{firstName}} and clean up formatting
                    // Handles "Hello {{firstName}}" -> "Hello", "Coucou {{firstName}}" -> "Coucou"
                    finalMessage = finalMessage.replace(/{{firstName}}/g, '').replace(/\s+/g, ' ').trim();
                    // If it started with "Hello !" (now that name is gone), make sure it's capitalized correctly
                    if (finalMessage.startsWith('!')) finalMessage = "Hello " + finalMessage;
                }
                
                // Final cleanup: remove double spaces and trim
                finalMessage = finalMessage.replace(/\s+/g, ' ').trim();

                if (options.dryRun) {
                    console.log(`   🚧 DRY RUN: Would contact @${username} with: "${finalMessage}"`);
                    continue;
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
                    console.log(`\n   💬 SENDING ENGAGEMENT OUTREACH:`);
                    console.log(`   Profile: https://www.instagram.com/${username}/`);
                    console.log(`   Message: "${finalMessage}"\n`);

                    await typeInOpenTab(dmResult.tab, finalMessage);
                    registerOpenTab(username, dmResult.tab, finalMessage);
                    
                    // 9. Sync DB
                    await fullUpsertLead(username, account.id, {
                        status: 'outreach',
                        full_name: metadata.fullName,
                        bio: metadata.bio,
                        lead_source: lead.source,
                        dm_url: dmResult.dmUrl,
                        conversation_step: 2
                    });
                    await addMessage(username, 'assistant', finalMessage, lead.source, account.id);
                    preparedCount++;
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
            console.log(`\n✨ Prepared ${preparedCount} engagement outreach messages for review.`);
            await waitForUserToFinish();
        } else {
            console.log('\nNo new outreach messages prepared.');
        }
        
    } catch (err) {
        console.error(`\n❌ Fatal error: ${err.message}`);
    } finally {
        await closeBrowser();
    }
}
