/**
 * Unified Prospecting Worker
 * 
 * Combines scraping and outreach in a single browser session:
 * 1. Discover posts from hashtag or competitor profile
 * 2. Scrape comments from each post
 * 3. For each commenter: open profile, qualify, send message
 */

import path from 'path';
import { fileURLToPath } from 'url';

// Import from Collector agent
import { discoverFromHashtags, discoverFromProfiles } from '../../collector/src/discover.js';
import { scrapePostComments } from '../../collector/src/scrape_post.js';

// Import from Outreach agent
import { 
  initBrowser, 
  goToProfile,
  checkCanContact,
  scrapeProfileData,
  sendDMToUserInNewTab,
  closeBrowser, 
  waitForUserToFinish, 
  getOpenMessageTabs,
  getWorkingPage
} from '../../outreach/src/dm_sender.js';
import { qualifyLead } from '../../outreach/src/qualify_lead.js';
import { extractNameWithAI } from '../../outreach/src/name_extractor.js';
import { generateFirstMessage, validateMessage } from '../../outreach/src/templates.js';

// Shared utilities
import { loadProfileConfig } from '../../../shared/utils/configLoader.js';
import { getBrowserDataDir } from '../../../shared/paths.js';
import { checkForChallenge } from '../../../shared/pageVerification.js';
import { delay } from '../../../shared/browser/index.js';

// Database
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db = null;
let dbFunctions = null;

async function loadDatabase() {
  if (dbFunctions) return dbFunctions;
  
  const dbModule = await import(path.join(__dirname, '..', '..', 'collector', 'src', 'database.js'));
  const dbPath = path.join(__dirname, '..', '..', 'collector', 'permanent-data', 'leads.db');
  await dbModule.initDatabase(dbPath);
  db = await dbModule.getDatabase();
  dbFunctions = dbModule;
  return dbFunctions;
}

/**
 * Parse source string to determine type
 * @param {string} source - "#hashtag" or "@username"
 * @returns {{ type: 'hashtag' | 'profile', value: string }}
 */
function parseSource(source) {
  if (!source || typeof source !== 'string') {
    return { type: 'unknown', value: 'none' };
  }
  
  if (source.startsWith('#')) {
    return { type: 'hashtag', value: source.slice(1) };
  } else if (source.startsWith('@')) {
    return { type: 'profile', value: source.slice(1) };
  } else {
    // Assume hashtag if no prefix
    return { type: 'hashtag', value: source };
  }
}

/**
 * Main prospecting pipeline
 */
export async function runProspector(options = {}) {
  const {
    profile,
    source,
    maxPosts = 3,
    maxLeadsPerPost = 10,
    totalLimit = 20,
    dryRun = false,
    skipQualification = false,
    prepareOnly = false
  } = options;

  if (!profile) throw new Error('Profile is required');

  await loadDatabase();
  const account = dbFunctions.getOrCreateAccount(profile);
  const accountId = account.id;

  // Load profile config for qualification and messaging
  const profileConfig = await loadProfileConfig(profile);
  console.log(`🧠 Loaded profile config: ${profileConfig?.niche || 'default'}`);
  console.log(`📦 Prepare Only: ${prepareOnly}`);

  if (source) {
    const sourceInfo = parseSource(source);
    console.log(`📍 Source (CLI): ${sourceInfo.type} "${sourceInfo.value}"`);
  }

  // Stats
  let stats = {
    postsScraped: 0,
    commentsFound: 0,
    leadsProcessed: 0,
    leadsQualified: 0,
    leadsContacted: 0,
    leadsSkipped: 0,
    leadsFailed: 0
  };

  // DRY RUN MODE
  if (dryRun) {
    console.log('\n🚧 DRY RUN MODE - No browser will be opened');
    console.log('This will simulate the discovery phase only.\n');
    
    // We can't actually scrape without a browser, so just show what would happen
    console.log(`Would loop until ${totalLimit} successful contacts are made:`);
    console.log(`   1. Find batch of ${maxPosts} posts from rotated sources`);
    console.log(`   2. Process comment leads (max ${maxLeadsPerPost} per post)`);
    console.log(`   3. If limit not reached, move to NEXT source and find batch of ${maxPosts} posts`);
    console.log(`   4. Repeat...`);
    return stats;
  }

  // Initialize browser
  const userDataDir = getBrowserDataDir(profile);
  console.log('\n🌐 Initializing browser...');
  const browserObj = await initBrowser({ userDataDir });
  const workingPage = getWorkingPage();

  try {
    // STEP 1: Main Loop - Continue until goal reached
  console.log(`\n🎯 GOAL: Contact ${totalLimit} new leads`);
  const apiKey = process.env.OPENAI_API_KEY;
  console.log(`🔑 OpenAI API: ${apiKey ? `Présente (...${apiKey.substring(apiKey.length - 8)})` : 'MANQUANTE'}`);
  
  // Track scraped post URLs across batches to avoid duplicates
  const recentScrapedUrls = dbFunctions.getRecentlyScrapedPosts ? dbFunctions.getRecentlyScrapedPosts(168) : [];
  const alreadyScraped = new Set(recentScrapedUrls); 
  
  if (recentScrapedUrls.length > 0) {
    console.log(`   📚 Loaded ${recentScrapedUrls.length} recently scraped posts from database history.`);
  }

  // --- SOURCE LIST PREPARATION ---
  // If the user provided a source via CLI, we start with it. 
  // Otherwise, we use the list from config.
  let sourceList = profileConfig?.prospector?.sources || [];
  if (source && !sourceList.includes(source)) {
      sourceList = [source, ...sourceList];
  } else if (source && sourceList.includes(source)) {
      // Move the CLI source to the front
      sourceList = [source, ...sourceList.filter(s => s !== source)];
  }

  if (sourceList.length === 0) {
      throw new Error("No sources defined via CLI or in profile config.");
  }

  console.log(`📡 Sources to rotate: ${sourceList.join(', ')}`);
  
  const DISCOVERY_BATCH_SIZE = maxPosts;
  let sourceIndex = 0;
  let exhaustionCount = 0; // Track how many sources in a row were exhausted

  while (stats.leadsContacted < totalLimit && exhaustionCount < sourceList.length) {
    const currentSourceRaw = sourceList[sourceIndex % sourceList.length];
    const currentSource = parseSource(currentSourceRaw);
    
    console.log(`\n🔄 [Source ${sourceIndex % sourceList.length + 1}/${sourceList.length}] Checking ${currentSourceRaw}...`);
    console.log(`   Current Progress: ${stats.leadsContacted}/${totalLimit}`);
    
    let posts = [];
    
    // Discover a batch of posts from current source
    try {
        if (currentSource.type === 'hashtag') {
          posts = await discoverFromHashtags(workingPage, [currentSource.value], DISCOVERY_BATCH_SIZE, alreadyScraped);
        } else {
          posts = await discoverFromProfiles(workingPage, [currentSource.value], DISCOVERY_BATCH_SIZE, alreadyScraped);
        }
    } catch (discoveryErr) {
        console.error(`   ⚠️ Discovery error on ${currentSourceRaw}: ${discoveryErr.message}`);
        posts = [];
    }

    if (posts.length === 0) {
      console.log(`   ⏭️ No new posts found for ${currentSourceRaw}. Moving to next source.`);
      sourceIndex++;
      exhaustionCount++;
      continue; 
    }

    // Reset exhaustion count if we found posts
    exhaustionCount = 0;
    console.log(`   ✅ Found ${posts.length} new posts to process`);
    stats.postsScraped += posts.length;

    // STEP 2: Process each post in the batch
    for (let postIdx = 0; postIdx < posts.length; postIdx++) {
      if (stats.leadsContacted >= totalLimit) break;
        const post = posts[postIdx];
        const postUrl = post.url || post.post_url;
        
        // Skip if already in memory (could happen if discovery returned a duplicate)
        if (alreadyScraped.has(postUrl)) continue;
        alreadyScraped.add(postUrl);
        console.log(`\n📝 Processing Post ${postIdx + 1}/${posts.length} in batch: ${postUrl}`);

        // Navigate to post and scrape comments
        console.log('   Scraping comments...');
        try {
            // Scraping more comments to be exhaustive (up to 500)
            const comments = await scrapePostComments(workingPage, postUrl, 500); 
            
            if (!comments || comments.length === 0) {
              console.log('   No comments found on this post.');
              dbFunctions.upsertPost(post);
              dbFunctions.markPostScraped(postUrl);
              continue;
            }

            console.log(`   Found ${comments.length} comments`);
            stats.commentsFound += comments.length;

            // STEP 3: Process each commenter
            const uniqueUsernames = new Set();
            
            for (const comment of comments) {
              const username = comment.username;
              if (!username) continue;
             
             // Skip duplicates in this session
             if (uniqueUsernames.has(username)) continue;
             uniqueUsernames.add(username);

             // Skip if already in database in active or completed stage
             const existingLead = dbFunctions.getLeadByUsername(username, accountId);
             const skipStatuses = ['contacted', 'outreach', 'conversation', 'already_known', 'disqualified', 'not_interested'];
             
             if (existingLead && skipStatuses.includes(existingLead.status)) {
               console.log(`   ⏭️  @${username}: Already in DB (status: ${existingLead.status})`);
               stats.leadsSkipped++;
               continue;
             }

             console.log(`\n   --- Processing @${username} (${stats.leadsContacted + 1}/${totalLimit}) ---`);
             stats.leadsProcessed++;

             // STEP 3a: Open profile and check contactability
             const profileResult = await goToProfile(workingPage, username);
             
             if (!profileResult.success) {
               console.log(`   ❌ Could not open profile: ${profileResult.error}`);
               stats.leadsFailed++;
               if (!existingLead) saveLeadToDb(username, comment, accountId, 'failed', profileResult.error);
               continue;
             }

             // Check for challenge/CAPTCHA
             if (await checkForChallenge(workingPage)) {
               console.log('   ⚠️  Challenge detected during prospecting');
             }

             // STEP 3b: Check "Contact" button
             const contactCheck = await checkCanContact(workingPage);
             
             if (!contactCheck.canContact) {
               console.log(`   🔒 @${username}: No Contact button`);
               stats.leadsSkipped++;
               if (!existingLead) saveLeadToDb(username, comment, accountId, 'failed', 'private_account_no_contact');
               continue;
             }

             // STEP 3c: Scrape profile data
             const profileData = await scrapeProfileData(workingPage);
             console.log(`   📋 Bio: ${profileData.bio ? profileData.bio.substring(0, 50) + '...' : '(none)'}`);

             // STEP 3d: Qualify lead (if not skipped)
             if (!skipQualification) {
               const qualificationPrompt = profileConfig?.outreach?.qualification_prompt || null;
               const qualResult = await qualifyLead(profileData.bio, qualificationPrompt, username);
               
               if (!qualResult.qualified) {
                 console.log(`   🚫 @${username}: REJECTED (${qualResult.reason})`);
                 stats.leadsSkipped++;
                 saveLeadToDb(username, comment, accountId, 'failed', 'competitor');
                 await delay(1000, 2000);
                 continue;
               }
             }

             stats.leadsQualified++;

             // STEP 3e: Generate message
             
             // 🤖 Smart Name Extraction (AI)
             let aiFirstName = null;
             try {
                  aiFirstName = await extractNameWithAI(username, profileData.fullName);
             } catch (e) {
                  console.error(`   ⚠️ Name extraction failed: ${e.message}`);
             }
                          // Final Message preparation
              let finalMessage = "";
              if (aiFirstName) {
                // NEW PATTERN: Just "[Name] ?"
                finalMessage = `${aiFirstName} ?`;
              } else {
                const nameToUse = 'there';
                const leadForTemplate = {
                  username,
                  full_name: profileData.fullName,
                  bio: profileData.bio,
                  warmth: 'cold',
                  comments: [comment]
                };
                
                const messageResult = generateFirstMessage(leadForTemplate, [comment], {
                  niche: profileConfig?.niche || 'personal development',
                  isSimple: true,
                  profileConfig,
                  forceFirstName: nameToUse
                });
                finalMessage = messageResult.message;
              }

              const validation = validateMessage(finalMessage);
              if (!validation.valid) {
                console.log(`   ⚠️  Invalid message: ${validation.issues.join(', ')}`);
                stats.leadsFailed++;
                continue;
              }

              console.log(`   💬 Message: "${finalMessage.substring(0, 60)}..."`);

              // STEP 3f: Send message (opens new tab, types, keeps open)
              if (prepareOnly) {
                  // Queue mode: store lead + message for later
                   const queueResult = dbFunctions.addToOutreachQueue({
                       username,
                       profile_url: `https://www.instagram.com/${username}/`,
                       dm_url: null,
                       prepared_message: finalMessage,
                       first_name: aiFirstName,
                       source: 'prospect'
                   });
                  
                  if (queueResult) {
                      console.log(`   📦 Queued @${username} for later sending.`);
                      saveLeadToDb(username, comment, accountId, 'queued', null, profileData, null, aiFirstName);
                      stats.leadsContacted++;
                      console.log(`   ✅ Queued. Progress: ${stats.leadsContacted}/${totalLimit}`);
                  } else {
                      console.log(`   ⚠️ Already in queue: @${username}`);
                  }
              } else {
                   // Normal mode: Open tab for review
                   const sendResult = await sendDMToUserInNewTab(username, finalMessage, {
                     targetUrl: `https://www.instagram.com/${username}/`,
                     profileData
                   });

                  // Keep focusing the working page (scraper) so the user can see progress
                  if (workingPage) {
                    await workingPage.bringToFront().catch(() => {});
                  }

                   if (sendResult.success && sendResult.tabKeptOpen) {
                     console.log(`   ✅ Message typed! Tab kept open for review.`);
                     stats.leadsContacted++;

                     // Save to database
                     saveLeadToDb(username, comment, accountId, 'outreach', null, profileData, sendResult.dmUrl, aiFirstName);
                                          // Record conversation
                      const lead = dbFunctions.getLeadByUsername(username, accountId);
                      if (lead) {
                        dbFunctions.addConversationMessage(lead.id, 'assistant', finalMessage, 'outreach');
                      }

                   } else if (sendResult.skipped) {
                     if (sendResult.existingConversation) {
                       console.log(`   ⏭️  @${username}: Conversation existante détectée - Marqué comme 'already_known'.`);
                       saveLeadToDb(username, comment, accountId, 'already_known', 'existing_messages', profileData, sendResult.dmUrl, aiFirstName);
                     } else if (sendResult.isCompetitor) {
                        // This should have been caught by qualifyLead, but safety check
                       console.log(`   🚫 @${username}: Qualifié comme concurrent pendant l'envoi.`);
                       saveLeadToDb(username, comment, accountId, 'failed', 'competitor', profileData, null, aiFirstName);
                     } else {
                       console.log(`   ⏭️  @${username}: Lead ignoré (${sendResult.error || 'raison inconnue'})`);
                       saveLeadToDb(username, comment, accountId, 'failed', sendResult.error, profileData, null, aiFirstName);
                     }
                     stats.leadsSkipped++;
                   } else {
                     console.log(`   ❌ Failed to send: ${sendResult.error}`);
                     stats.leadsFailed++;
                     saveLeadToDb(username, comment, accountId, 'failed', sendResult.error, null, null, aiFirstName);
                   }
              }

             // Small delay between leads
             await delay(2000, 4000);
           } // End comment loop
           
           // Ensure post is in DB and mark as fully scraped to avoid re-processing
           dbFunctions.upsertPost(post);
           dbFunctions.markPostScraped(postUrl);
           
        } catch (err) {
            console.error(`   ⚠️ Error processing post ${postUrl}: ${err.message}`);
        }
      } // End post loop
      
      // Delay between batches
      if (stats.leadsContacted < totalLimit) {
          console.log('   ⏳ Waiting before finding next batch...');
          await delay(5000, 10000);
      }

    } // End main while loop

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    if (process.env.DEBUG) console.error(error.stack);
  }

  // FINAL: Wait for user to review tabs
  const openTabs = getOpenMessageTabs();
  if (openTabs.length > 0) {
    console.log(`\n🎯 PROSPECTING COMPLETE`);
    console.log('========================');
    console.log(`   Posts scraped: ${stats.postsScraped}`);
    console.log(`   Comments found: ${stats.commentsFound}`);
    console.log(`   Leads processed: ${stats.leadsProcessed}`);
    console.log(`   Leads qualified: ${stats.leadsQualified}`);
    console.log(`   Messages ready: ${stats.leadsContacted}`);
    console.log(`   Skipped: ${stats.leadsSkipped}`);
    console.log(`   Failed: ${stats.leadsFailed}`);
    console.log('');
    
    if (prepareOnly) {
        console.log(`✨ Queued ${stats.leadsContacted} leads for later sending.`);
        console.log(`   Total pending in queue: ${dbFunctions.getQueueCount()}`);
        await closeBrowser().catch(() => {});
        dbFunctions.closeDatabase();
    } else {
        await waitForUserToFinish();
        await closeBrowser().catch(() => {});
        dbFunctions.closeDatabase();
    }
  } else {
    console.log('\n📭 No messages to review.');
    await closeBrowser().catch(() => {});
    dbFunctions.closeDatabase();
  }

  return stats;
}

/**
 * Helper to save lead to database
 */
function saveLeadToDb(username, comment, accountId, status, failReason = null, profileData = null, dmUrl = null, firstName = null) {
  try {
    // Insert or update lead
    const lead = dbFunctions.getLeadByUsername(username, accountId);
    
    if (!lead) {
      // Create new lead
      db.prepare(`
        INSERT INTO leads (username, account_id, profile_url, status, full_name, bio, dm_url, lead_source, first_name, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        username,
        accountId,
        `https://www.instagram.com/${username}/`,
        status,
        profileData?.fullName || null,
        profileData?.bio || null,
        dmUrl || null,
        comment.post_url || 'prospect',
        firstName || null,
        failReason ? `Failed: ${failReason}` : null
      );
      
      // Also save the comment
      const newLead = dbFunctions.getLeadByUsername(username, accountId);
      if (newLead && comment.comment_text) {
        dbFunctions.insertComment({
          username,
          comment_text: comment.comment_text,
          post_url: comment.post_url,
          source: 'prospect',
          account_id: accountId
        }, accountId);
      }
    } else {
      // Update existing lead
      db.prepare(`
        UPDATE leads SET 
          status = ?,
          full_name = COALESCE(?, full_name),
          bio = COALESCE(?, bio),
          dm_url = COALESCE(?, dm_url),
          notes = COALESCE(?, notes),
          updated_at = datetime('now')
        WHERE username = ? AND account_id = ?
      `).run(
        status,
        profileData?.fullName || null,
        profileData?.bio || null,
        dmUrl || null,
        failReason || null,
        username,
        accountId
      );
    }
  } catch (err) {
    console.error(`   DB Error for @${username}: ${err.message}`);
  }
}

export default { runProspector };
