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
                    
                    if (!postMap.has(postUrl)) {
                        postMap.set(postUrl, { 
                            url: postUrl,
                            type: isLike ? 'like' : 'comment',
                            notifText: text.substring(0, 50).replace(/\n/g, ' ')
                        });
                    }
                }
            }
        }
        
        return Array.from(postMap.values());
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
            console.log(`   ${i+1}. [${p.type.toUpperCase()}] ${p.url} (${p.notifText})`);
        });

        // 3. Process each post
        for (const post of engagedPosts.slice(0, CONFIG.MAX_POSTS_PER_SESSION)) {
            console.log(`\n🚀 Analyzing Post: ${post.url}`);
            console.log(`   Context: ${post.notifText}`);
            
            await page.goto(post.url, { waitUntil: 'domcontentloaded' });
            await new Promise(r => setTimeout(r, 3000));
            
            // Collect usernames from both likes and comments
            const likers = await scrapePostLikers(page);
            // const commenters = await scrapePostComments(page);
            
            // Unified list of potential leads
            const potentialLeads = [
                ...likers.map(u => ({ username: u, source: 'post_like' })),
                // ...commenters.map(c => ({ username: c.username, source: 'post_comment', text: c.text }))
            ];
            
            // Deduplicate
            const uniqueLeads = Array.from(new Set(potentialLeads.map(l => l.username)))
                .map(username => potentialLeads.find(l => l.username === username));
                
            console.log(`   Processing ${Math.min(uniqueLeads.length, CONFIG.MAX_LEADS_PER_POST)} unique users from this post...`);

            for (const lead of uniqueLeads.slice(0, CONFIG.MAX_LEADS_PER_POST)) {
                const username = lead.username;
                
                // 4. Check if already in DB
                const existingLead = await getLeadWithContext(username);
                if (existingLead && ['conversation', 'contacted', 'outreach'].includes(existingLead.status)) {
                    continue;
                }
                
                console.log(`\n   --- Checking: @${username} (${lead.source}) ---`);
                
                // 5. Profile Check
                await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
                await new Promise(r => setTimeout(r, 2000));
                
                const metadata = await scrapeProfileMetadata(page, username);
                if (!metadata.success) continue;
                
                // 6. Qualification
                const qualification = await qualifyLead(metadata.bio, profileConfig.outreach?.qualification_prompt, username);
                if (!qualification.qualified) {
                    console.log(`   ❌ Not qualified: ${qualification.reason}`);
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
                if (!messageTemplate) messageTemplate = "Hello {{firstName}} ! Merci pour ton interaction sur mon dernier post 🌸";

                let finalMessage = messageTemplate.replace('{{firstName}}', aiFirstName || '').replace(/\s+/g, ' ').trim();
                if (!aiFirstName) finalMessage = finalMessage.replace(/Hello\s+/, 'Hello ').trim();

                if (options.dryRun) {
                    console.log(`   🚧 DRY RUN: Would contact @${username} with: "${finalMessage}"`);
                    continue;
                }

                // 8. Outreach
                const dmResult = await openDMAndScrape({
                    username,
                    profile_url: `https://www.instagram.com/${username}/`
                });
                
                if (dmResult.success && dmResult.scrapedMessages.length === 0) {
                    await typeInOpenTab(dmResult.tab, finalMessage);
                    registerOpenTab(username, dmResult.tab, finalMessage);
                    
                    // 9. Sync DB
                    await fullUpsertLead(username, account.id, {
                        status: 'outreach',
                        full_name: metadata.fullName,
                        bio: metadata.bio,
                        lead_source: lead.source,
                        dm_url: dmResult.dmUrl,
                        conversation_step: 1
                    });
                    await addMessage(username, 'assistant', finalMessage, lead.source, account.id);
                    preparedCount++;
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
