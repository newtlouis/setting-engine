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
import { discoverFromHashtags, discoverFromProfiles, extractPostAuthor } from '../../collector/src/discover.js';
import { scrapePostComments } from '../../collector/src/scrape_post.js';
import { scrapePostLikers } from '../../dmresponder/src/scraper.js';

// Import from Outreach agent
import {
  initBrowser,
  goToProfile,
  checkCanContact,
  scrapeProfileData,
  closeBrowser,
  getWorkingPage
} from '../../outreach/src/dm_sender.js';
import { qualifyLead } from '../../outreach/src/qualify_lead.js';
import { extractNameWithAI, getNameGender } from '../../outreach/src/name_extractor.js';
import { generateFirstMessage, validateMessage } from '../../outreach/src/templates.js';

// Shared utilities
import { loadProfileConfig } from '../../../shared/utils/configLoader.js';
import { loadOutreachConfig } from '../../../shared/utils/outreachConfigLoader.js';
import { checkForChallenge } from '../../../shared/pageVerification.js';
import { delay } from '../../../shared/browser/index.js';

// Follower scraping (from dmresponder — reused for "followers" mode)
import { scrapeFollowers as scrapeFollowersList } from '../../dmresponder/src/follower_scraper.js';

// ============================================================================
// HARD INVARIANT: the prospector NEVER uses a target account's browser/session.
// All scraping + outreach runs through scout accounts (loulou, hercule, etc.)
// to avoid burning the reach of katessence/melanie/etc.
// ============================================================================
const DEFAULT_SCOUT_PROFILES = ['loulou', 'hercule'];
const DEFAULT_SCOUT_HOURS = 2;

// Active scout state — managed by the rotation logic
let activeScout = null;

/**
 * Check if an error indicates the browser/page has been closed.
 */
function isBrowserDead(err) {
  const msg = err?.message || '';
  return msg.includes('Target page, context or browser has been closed')
    || msg.includes('browser has been closed')
    || msg.includes('Target closed')
    || msg.includes('Protocol error');
}

/**
 * Check if an error is an HTTP response failure (Instagram rate limit / soft ban)
 */
function isHttpError(err) {
  const msg = err?.message || '';
  return msg.includes('ERR_HTTP_RESPONSE_CODE_FAILURE');
}

/**
 * Attempt to recover from a dead browser by relaunching it.
 * Returns the new working page, or throws if recovery fails.
 */
async function recoverBrowser() {
  console.log('   🔄 Browser died — attempting recovery...');
  try { await closeBrowser().catch(() => {}); } catch {}
  await delay(3000, 5000);
  await initBrowser({ profile: activeScout, purpose: 'prospector' });
  const page = getWorkingPage();
  console.log('   ✅ Browser recovered');
  return page;
}

/**
 * Switch to the next scout account. Closes current browser, opens new one.
 * @param {string} nextScout - Profile name of the next scout
 * @returns {Promise<Page>} The new working page
 */
async function switchScout(nextScout) {
  console.log(`\n🔄 SWITCHING SCOUT: ${activeScout} → ${nextScout}`);
  try { await closeBrowser().catch(() => {}); } catch {}
  await delay(3000, 5000);
  activeScout = nextScout;
  await initBrowser({ profile: activeScout, purpose: 'prospector' });
  const page = getWorkingPage();
  console.log(`   ✅ Now using scout: ${activeScout}`);
  return page;
}

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

// ============================================

/**
 * Main prospecting pipeline
 */
export async function runProspector(options = {}) {
  const {
    profile,
    source,
    mode = null,
    maxPosts = 3,
    totalLimit = 60,
    skipQualification = false,
    variantMode = 'A',
    scoutProfiles = DEFAULT_SCOUT_PROFILES,
    scoutHours = DEFAULT_SCOUT_HOURS
  } = options;

  if (!profile) throw new Error('Profile is required');

  await loadDatabase();
  const account = dbFunctions.getOrCreateAccount(profile);
  const accountId = account.id;

  // Load profile config for qualification and messaging
  const profileConfig = await loadProfileConfig(profile);
  const outreachConfig = loadOutreachConfig(accountId, profileConfig);
  console.log(`🧠 Niche: ${outreachConfig.niche || 'default'}`);
  console.log(`🔍 Mode par source: hashtag=${outreachConfig.prospectModeHashtag}, profil=${outreachConfig.prospectModeProfile}`);
  console.log(`🚫 Reject filter: ${REJECT_WORDS.join(', ')}`);
  if (outreachConfig.maxFollowers) console.log(`👥 Max followers filter: ${outreachConfig.maxFollowers}`);

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

  // Prospector uses scout accounts — never the target profile's account
  if (scoutProfiles.includes(profile)) {
    throw new Error(`Prospector target profile cannot be a scout account ("${profile}"). Pass --profile katessence / melanie / etc.`);
  }

  const SCOUT_ROUND_MS = scoutHours * 60 * 60 * 1000;
  const MAX_RUNTIME_MS = SCOUT_ROUND_MS * scoutProfiles.length; // Total = rounds × scout count
  const runStartTime = Date.now();

  console.log(`🕵️ Scout accounts: ${scoutProfiles.join(', ')} (${scoutHours}h per scout, ${scoutProfiles.length * scoutHours}h max total)`);

  // Start with first scout
  let scoutIndex = 0;
  activeScout = scoutProfiles[scoutIndex];
  let scoutStartTime = Date.now();
  let scoutHttpErrors = 0;
  const MAX_SCOUT_HTTP_ERRORS = 2;

  console.log(`\n🌐 Initializing browser (prospector via ${activeScout} → leads for ${profile})...`);
  await initBrowser({ profile: activeScout, purpose: 'prospector' });
  let workingPage = getWorkingPage();
  let effectiveLimit = totalLimit;

  try {
    // ====================================
    // FOLLOWERS MODE — scrape followers of competitor profiles
    // ====================================
    if (mode === 'followers') {
      const followersStats = await runFollowersMode({
        workingPage, accountId, profile, totalLimit, skipQualification, variantMode, outreachConfig, stats, runStartTime, MAX_RUNTIME_MS
      });

      // Fallback to comments mode if followers didn't reach the target
      if (followersStats.leadsContacted < totalLimit) {
        const remaining = totalLimit - followersStats.leadsContacted;
        console.log(`\n🔄 Followers mode got ${followersStats.leadsContacted}/${totalLimit} — falling back to comments mode for ${remaining} more leads`);
        // Update stats for the comments phase — reset leadsContacted so
        // the while-loop condition (leadsContacted < effectiveLimit) works
        const followersContacted = followersStats.leadsContacted;
        Object.assign(stats, followersStats);
        stats.leadsContacted = 0;
        stats._followersContacted = followersContacted;
        effectiveLimit = remaining;
        // Re-init browser if closed by followers mode
        if (!workingPage || workingPage.isClosed()) {
          await initBrowser({ profile: activeScout, purpose: 'prospector' });
          workingPage = getWorkingPage();
        }
        // Fall through to comments mode below
      } else {
        // Goal reached in followers mode — close and return
        await closeBrowser().catch(() => {});
        dbFunctions.closeDatabase();
        return followersStats;
      }
    }

    // ====================================
    // DEFAULT MODE — comments / authors from posts
    // ====================================

    // STEP 1: Main Loop - Continue until goal reached
  console.log(`\n🎯 GOAL: Contact ${effectiveLimit} new leads (timeout: 4h)`);
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
  let sourceList = outreachConfig.prospectorSources;
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
  let browserRecoveryCount = 0;
  const MAX_BROWSER_RECOVERIES = 3;
  const MAX_SOURCE_FAILURES = 2;
  let sourceFailures = {}; // { sourceRaw: count }

  while (stats.leadsContacted < effectiveLimit && exhaustionCount < sourceList.length) {
    // Global timeout check
    if (Date.now() - runStartTime > MAX_RUNTIME_MS) {
      console.log(`\n⏰ TIMEOUT: ${scoutProfiles.length * scoutHours}h total runtime exceeded. Stopping gracefully.`);
      break;
    }

    // Scout rotation: switch when time limit reached
    if (Date.now() - scoutStartTime > SCOUT_ROUND_MS) {
      const nextIdx = scoutIndex + 1;
      if (nextIdx < scoutProfiles.length) {
        console.log(`\n⏰ Scout ${activeScout}: ${scoutHours}h round complete.`);
        scoutIndex = nextIdx;
        scoutHttpErrors = 0;
        browserRecoveryCount = 0;
        sourceFailures = {};
        exhaustionCount = 0;
        scoutStartTime = Date.now();
        try {
          workingPage = await switchScout(scoutProfiles[scoutIndex]);
        } catch (err) {
          console.error(`   ❌ Failed to switch to ${scoutProfiles[scoutIndex]}: ${err.message}`);
          break;
        }
      } else {
        console.log(`\n⏰ All scouts have completed their rounds. Stopping.`);
        break;
      }
    }

    const currentSourceRaw = sourceList[sourceIndex % sourceList.length];
    const currentSource = parseSource(currentSourceRaw);

    console.log(`\n🔄 [Source ${sourceIndex % sourceList.length + 1}/${sourceList.length}] Checking ${currentSourceRaw}...`);
    console.log(`   Current Progress: ${stats.leadsContacted}/${effectiveLimit}`);

    let posts = [];

    // Discover a batch of posts from current source
    try {
        if (currentSource.type === 'hashtag') {
          posts = await discoverFromHashtags(workingPage, [currentSource.value], DISCOVERY_BATCH_SIZE, alreadyScraped);
        } else {
          posts = await discoverFromProfiles(workingPage, [currentSource.value], DISCOVERY_BATCH_SIZE, alreadyScraped);
        }
    } catch (discoveryErr) {
        // HTTP error = Instagram rate limit → count toward scout switch
        if (isHttpError(discoveryErr)) {
          scoutHttpErrors++;
          console.log(`   ⚠️ HTTP error on ${activeScout} (${scoutHttpErrors}/${MAX_SCOUT_HTTP_ERRORS})`);
          if (scoutHttpErrors >= MAX_SCOUT_HTTP_ERRORS) {
            const nextIdx = scoutIndex + 1;
            if (nextIdx < scoutProfiles.length) {
              console.log(`   🔄 Scout ${activeScout} rate-limited. Switching...`);
              scoutIndex = nextIdx;
              scoutHttpErrors = 0;
              browserRecoveryCount = 0;
              sourceFailures = {};
              exhaustionCount = 0;
              scoutStartTime = Date.now();
              try { workingPage = await switchScout(scoutProfiles[scoutIndex]); } catch (e) { break; }
              continue;
            } else {
              console.error(`   ❌ All scouts rate-limited. Stopping.`);
              break;
            }
          }
        }
        if (isBrowserDead(discoveryErr)) {
          if (browserRecoveryCount >= MAX_BROWSER_RECOVERIES) {
            // Try next scout instead of stopping
            const nextIdx = scoutIndex + 1;
            if (nextIdx < scoutProfiles.length) {
              console.log(`   🔄 Scout ${activeScout}: max crashes. Switching...`);
              scoutIndex = nextIdx;
              scoutHttpErrors = 0;
              browserRecoveryCount = 0;
              sourceFailures = {};
              exhaustionCount = 0;
              scoutStartTime = Date.now();
              try { workingPage = await switchScout(scoutProfiles[scoutIndex]); } catch (e) { break; }
              continue;
            }
            console.error(`   ❌ Max browser crashes reached and no more scouts. Stopping.`);
            break;
          }
          browserRecoveryCount++;
          try {
            workingPage = await recoverBrowser();
          } catch (recErr) {
            console.error(`   ❌ Browser recovery failed: ${recErr.message}`);
            break;
          }
        }
        // Count as a source failure regardless of cause
        sourceFailures[currentSourceRaw] = (sourceFailures[currentSourceRaw] || 0) + 1;
        if (sourceFailures[currentSourceRaw] >= MAX_SOURCE_FAILURES) {
          console.log(`   ⏭️ ${currentSourceRaw}: ${MAX_SOURCE_FAILURES} failures — skipping to next source.`);
          sourceIndex++;
          exhaustionCount++;
          continue;
        }
        console.error(`   ⚠️ Discovery error on ${currentSourceRaw} (${sourceFailures[currentSourceRaw]}/${MAX_SOURCE_FAILURES}): ${discoveryErr.message}`);
        posts = [];
    }

    if (posts.length === 0) {
      // Check if the browser is dead (discovery may have swallowed the error)
      const pageOk = await workingPage.evaluate(() => true).catch(() => false);
      if (!pageOk) {
        sourceFailures[currentSourceRaw] = (sourceFailures[currentSourceRaw] || 0) + 1;
        if (browserRecoveryCount >= MAX_BROWSER_RECOVERIES) {
          console.error(`   ❌ Max browser crashes reached (${MAX_BROWSER_RECOVERIES}). Stopping.`);
          break;
        }
        browserRecoveryCount++;
        try {
          workingPage = await recoverBrowser();
        } catch (recErr) {
          console.error(`   ❌ Browser recovery failed: ${recErr.message}`);
          break;
        }
        if (sourceFailures[currentSourceRaw] >= MAX_SOURCE_FAILURES) {
          console.log(`   ⏭️ ${currentSourceRaw}: ${MAX_SOURCE_FAILURES} failures — skipping to next source.`);
          sourceIndex++;
          exhaustionCount++;
          continue;
        }
        continue; // Retry same source once more
      }
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
      if (stats.leadsContacted >= effectiveLimit) break;
      if (Date.now() - runStartTime > MAX_RUNTIME_MS) { console.log(`\n⏰ TIMEOUT: 4h runtime exceeded.`); break; }
        const post = posts[postIdx];
        const postUrl = post.url || post.post_url;

        // Skip if already in memory (could happen if discovery returned a duplicate)
        if (alreadyScraped.has(postUrl)) continue;
        alreadyScraped.add(postUrl);
        console.log(`\n📝 Processing Post ${postIdx + 1}/${posts.length} in batch: ${postUrl}`);

        try {
          // Determine mode based on source type and DB config
          const effectiveMode = currentSource.type === 'hashtag'
            ? outreachConfig.prospectModeHashtag
            : outreachConfig.prospectModeProfile;

          // Build list of candidate leads depending on mode
          let candidates = []; // Array of { username, comment }

          if (effectiveMode === 'authors') {
            // AUTHORS MODE: extract the post author as the lead
            console.log('   Extracting post author...');
            const authorUsername = await extractPostAuthor(workingPage, postUrl);
            if (authorUsername) {
              console.log(`   👤 Post author: @${authorUsername}`);
              candidates.push({
                username: authorUsername,
                comment: { username: authorUsername, comment_text: null, post_url: postUrl }
              });
            } else {
              console.log('   ⚠️ Could not extract post author.');
            }
          } else {
            // COMMENTS + LIKERS MODE: scrape both likers and commenters
            const uniqueUsernames = new Set();

            // 1. Scrape likers first
            console.log('   Scraping likers...');
            try {
              const likers = await scrapePostLikers(workingPage);
              if (likers && likers.length > 0) {
                console.log(`   ❤️ Found ${likers.length} likers`);
                for (const likerUsername of likers) {
                  if (!likerUsername) continue;
                  if (likerUsername.toLowerCase() === 'reels') continue;
                  if (uniqueUsernames.has(likerUsername)) continue;
                  uniqueUsernames.add(likerUsername);
                  candidates.push({
                    username: likerUsername,
                    comment: { username: likerUsername, comment_text: null, post_url: postUrl }
                  });
                }
              } else {
                console.log('   No likers found (or could not open likers popup).');
              }
            } catch (e) {
              console.log(`   ⚠️ Likers scraping failed: ${e.message}`);
            }

            // 2. Then scrape commenters
            console.log('   Scraping comments...');
            const comments = await scrapePostComments(workingPage, postUrl, 500);

            if (comments && comments.length > 0) {
              console.log(`   💬 Found ${comments.length} comments`);
              stats.commentsFound += comments.length;

              for (const comment of comments) {
                const username = comment.username;
                if (!username) continue;
                if (username.toLowerCase() === 'reels') continue;
                if (uniqueUsernames.has(username)) continue;
                uniqueUsernames.add(username);
                candidates.push({ username, comment });
              }
            } else {
              console.log('   No comments found on this post.');
            }

            if (candidates.length === 0) {
              console.log('   No candidates (likers or commenters) found on this post.');
              dbFunctions.upsertPost(post);
              dbFunctions.markPostScraped(postUrl);
              continue;
            }

            console.log(`   📊 Total unique candidates: ${candidates.length} (likers + commenters)`);
          }

          // STEP 3: Process each candidate lead
          for (const { username, comment } of candidates) {
             if (stats.leadsContacted >= effectiveLimit) break;

             // Skip if already in database in active or completed stage
             const existingLead = dbFunctions.getLeadByUsername(username, accountId);
             const skipStatuses = ['contacted', 'queued', 'outreach', 'conversation', 'already_known', 'disqualified', 'not_interested', 'uncontactable'];

             if (existingLead && skipStatuses.includes(existingLead.status)) {
               console.log(`   ⏭️  @${username}: Already in DB (status: ${existingLead.status})`);
               stats.leadsSkipped++;
               continue;
             }

             // Skip if already in outreach_queue (pending or sent) — avoids re-processing silently deduped leads
             const queuedRow = db.prepare(
               "SELECT status FROM outreach_queue WHERE username = ? AND status IN ('pending','sent')"
             ).get(username);
             if (queuedRow) {
               console.log(`   ⏭️  @${username}: Already in outreach_queue (${queuedRow.status})`);
               stats.leadsSkipped++;
               continue;
             }

             console.log(`\n   --- Processing @${username} (${stats.leadsContacted + 1}/${effectiveLimit}) ---`);
             stats.leadsProcessed++;

             // STEP 3a: Open profile and check contactability
             const profileResult = await goToProfile(workingPage, username);

             if (!profileResult.success) {
               console.log(`   ❌ Could not open profile: ${profileResult.error}`);
               stats.leadsFailed++;
               if (!existingLead) saveLeadToDb(username, comment, accountId, 'failed', profileResult.error, null, null, null, currentSourceRaw);
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
               if (!existingLead) saveLeadToDb(username, comment, accountId, 'failed', 'private_account_no_contact', null, null, null, currentSourceRaw);
               continue;
             }

             // STEP 3c: Scrape profile data
             const profileData = await scrapeProfileData(workingPage);
             console.log(`   📋 Bio: ${profileData.bio || '(none)'}`);

             // STEP 3c.1: Filter by max followers (if configured)
             if (!withinFollowersLimit(profileData.followersCount, outreachConfig.maxFollowers)) {
               console.log(`   👥 @${username}: Too many followers (${profileData.followersCount} > ${outreachConfig.maxFollowers})`);
               stats.leadsSkipped++;
               if (!existingLead) saveLeadToDb(username, comment, accountId, 'failed', 'too_many_followers', profileData, null, null, currentSourceRaw);
               continue;
             }

             // STEP 3c.2: Filter — reject présentiel businesses (massage, etc.)
             if (bioContainsRejectWord(profileData.bio, profileData.fullName)) {
               console.log(`   🚫 @${username}: Rejected (présentiel business)`);
               stats.leadsSkipped++;
               if (!existingLead) saveLeadToDb(username, comment, accountId, 'failed', 'presentiel_business', profileData, null, null, currentSourceRaw);
               continue;
             }

             // STEP 3d: Qualify lead — language + competitor check via LLM (if not skipped)
             let accompanimentType = null;
             if (!skipQualification) {
               const qualificationPrompt = outreachConfig.qualificationPrompt;
               // Extract accompaniment type when niche is set (profile-level opt-in)
               const extractAccompaniment = !qualificationPrompt && !!outreachConfig.niche;
               const qualResult = await qualifyLead(profileData.bio, qualificationPrompt, username, { extractAccompaniment, fullName: profileData.fullName });

               if (!qualResult.qualified) {
                 const failReason = qualResult.reason === 'foreign_language' ? 'foreign_language' : 'competitor';
                 const icon = failReason === 'foreign_language' ? '🌍' : '🚫';
                 console.log(`   ${icon} @${username}: REJECTED (${qualResult.reason})`);
                 stats.leadsSkipped++;
                 saveLeadToDb(username, comment, accountId, 'failed', failReason, null, null, null, currentSourceRaw);
                 await delay(1000, 2000);
                 continue;
               }
               accompanimentType = qualResult.accompanimentType || null;
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

             // Female-only filter (comments mode) — only block confirmed males
             if (outreachConfig.femaleOnly && aiFirstName) {
               const genderInfo = await getNameGender(aiFirstName);
               if (genderInfo.gender === 'male' && genderInfo.probability >= 0.7) {
                 console.log(`   🚫 @${username}: "${aiFirstName}" is male (${Math.round(genderInfo.probability * 100)}%) → skipping`);
                 saveLeadToDb(username, comment, accountId, 'failed', 'not_female', null, null, aiFirstName, currentSourceRaw);
                 stats.leadsSkipped++;
                 await delay(500, 1000);
                 continue;
               }
               if (!genderInfo.gender || genderInfo.fallback) {
                 console.log(`   ℹ️  @${username}: "${aiFirstName}" gender unknown — accepting`);
               } else {
                 console.log(`   ♀️ @${username}: "${aiFirstName}" confirmed ${genderInfo.gender} (${Math.round(genderInfo.probability * 100)}%)`);
               }
             }

              // Determine A/B variant for this lead
              let leadVariant;
              if (variantMode === 'random') {
                leadVariant = Math.random() < 0.5 ? 'A' : 'B';
              } else {
                leadVariant = variantMode === 'B' ? 'B' : 'A';
              }

              // Final Message preparation
              let finalMessage = "";
              const prospectMessageA = outreachConfig.prospectMessageA;
              const prospectMessageB = outreachConfig.prospectMessageB;

              if (leadVariant === 'B' && prospectMessageB) {
                const accompSuffix = accompanimentType ? ` en ${accompanimentType}` : '';
                finalMessage = prospectMessageB
                  .replace('{name}', aiFirstName || '')
                  .replace('{accomp}', accompSuffix);
              } else if (leadVariant === 'A' && prospectMessageA) {
                finalMessage = prospectMessageA
                  .replace('{name}', aiFirstName || '');
              } else if (aiFirstName) {
                finalMessage = `${aiFirstName} ?`;
              } else {
                finalMessage = 'Hello !';
              }
              // Clean up spacing when name is missing
              finalMessage = finalMessage.replace(/\s+,/g, ',').replace(/\s+!/g, ' !').trim();

              const validation = validateMessage(finalMessage);
              if (!validation.valid) {
                console.log(`   ⚠️  Invalid message: ${validation.issues.join(', ')}`);
                stats.leadsFailed++;
                continue;
              }

              console.log(`   💬 [${leadVariant}] Message: "${finalMessage.substring(0, 60)}..."`);

              // STEP 3f: Queue lead + message for later sending
              const queueResult = dbFunctions.addToOutreachQueue({
                  username,
                  profile_url: `https://www.instagram.com/${username}/`,
                  dm_url: null,
                  prepared_message: finalMessage,
                  first_name: aiFirstName,
                  source: 'prospect',
                  account_id: accountId,
                  variant: leadVariant
              });

              if (queueResult) {
                  console.log(`   📦 Queued @${username} for later sending.`);
                  saveLeadToDb(username, comment, accountId, 'queued', null, profileData, null, aiFirstName, currentSourceRaw, leadVariant, accompanimentType);
                  stats.leadsContacted++;
                  console.log(`   ✅ Queued. Progress: ${stats.leadsContacted}/${effectiveLimit}`);
              } else {
                  console.log(`   ⚠️ Already in queue: @${username}`);
              }

             // Small delay between leads
             await delay(2000, 4000);
           } // End candidates loop

           // Ensure post is in DB and mark as fully scraped to avoid re-processing
           dbFunctions.upsertPost(post);
           dbFunctions.markPostScraped(postUrl);

        } catch (err) {
            console.error(`   ⚠️ Error processing post ${postUrl}: ${err.message}`);
            // HTTP error = Instagram rate limit → count toward scout switch
            if (isHttpError(err)) {
              scoutHttpErrors++;
              console.log(`   ⚠️ HTTP error on ${activeScout} (${scoutHttpErrors}/${MAX_SCOUT_HTTP_ERRORS})`);
              if (scoutHttpErrors >= MAX_SCOUT_HTTP_ERRORS) {
                const nextIdx = scoutIndex + 1;
                if (nextIdx < scoutProfiles.length) {
                  console.log(`   🔄 Scout ${activeScout} rate-limited. Switching...`);
                  scoutIndex = nextIdx;
                  scoutHttpErrors = 0;
                  browserRecoveryCount = 0;
                  sourceFailures = {};
                  exhaustionCount = 0;
                  scoutStartTime = Date.now();
                  try { workingPage = await switchScout(scoutProfiles[scoutIndex]); } catch (e) { break; }
                  break; // Break post loop, retry sources with new scout
                } else {
                  console.error(`   ❌ All scouts rate-limited. Stopping.`);
                  break;
                }
              }
            }
            if (isBrowserDead(err)) {
              sourceFailures[currentSourceRaw] = (sourceFailures[currentSourceRaw] || 0) + 1;
              if (browserRecoveryCount >= MAX_BROWSER_RECOVERIES) {
                const nextIdx = scoutIndex + 1;
                if (nextIdx < scoutProfiles.length) {
                  console.log(`   🔄 Scout ${activeScout}: max crashes. Switching...`);
                  scoutIndex = nextIdx;
                  scoutHttpErrors = 0;
                  browserRecoveryCount = 0;
                  sourceFailures = {};
                  exhaustionCount = 0;
                  scoutStartTime = Date.now();
                  try { workingPage = await switchScout(scoutProfiles[scoutIndex]); } catch (e) { break; }
                  break;
                }
                console.error(`   ❌ Max browser crashes and no more scouts. Stopping.`);
                break;
              }
              browserRecoveryCount++;
              try {
                workingPage = await recoverBrowser();
              } catch (recErr) {
                console.error(`   ❌ Browser recovery failed: ${recErr.message}`);
                break;
              }
              if (sourceFailures[currentSourceRaw] >= MAX_SOURCE_FAILURES) {
                console.log(`   ⏭️ ${currentSourceRaw}: ${MAX_SOURCE_FAILURES} failures — skipping to next source.`);
                break;
              }
            }
        }
      } // End post loop
      
      // Delay between batches
      if (stats.leadsContacted < effectiveLimit) {
          console.log('   ⏳ Waiting before finding next batch...');
          await delay(5000, 10000);
      }

    } // End main while loop

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    if (process.env.DEBUG) console.error(error.stack);
  }

  // FINAL: Print stats and close
  const totalQueued = stats.leadsContacted + (stats._followersContacted || 0);
  console.log(`\n🎯 PROSPECTING COMPLETE`);
  console.log('========================');
  console.log(`   Posts scraped: ${stats.postsScraped}`);
  console.log(`   Comments found: ${stats.commentsFound}`);
  console.log(`   Leads processed: ${stats.leadsProcessed}`);
  console.log(`   Leads qualified: ${stats.leadsQualified}`);
  console.log(`   Queued: ${totalQueued}${stats._followersContacted ? ` (${stats._followersContacted} followers + ${stats.leadsContacted} comments)` : ''}`);
  console.log(`   Skipped: ${stats.leadsSkipped}`);
  console.log(`   Failed: ${stats.leadsFailed}`);
  console.log('');
  console.log(`✨ Queued ${totalQueued} leads for later sending.`);
  console.log(`   Total pending in queue: ${dbFunctions.getQueueCount()}`);
  await closeBrowser().catch(() => {});
  dbFunctions.closeDatabase();

  return stats;
}

/**
 * Check if a bio matches at least one keyword from the filter list
 * @param {string|null} bio
 * @param {string[]|null} keywords - Lowercase keywords array, null = no filter
 * @returns {boolean} true if bio passes (matches or no filter)
 */
function matchesBioKeywords(bio, keywords) {
  if (!keywords) return true;
  if (!bio) return false;
  const lowerBio = bio.toLowerCase();
  return keywords.some(kw => lowerBio.includes(kw));
}

// Reject words — if bio or name contains any of these, skip the lead
const REJECT_WORDS = ['massage', 'massages', 'masseuse', 'masseur', 'esthétique', 'esthéticienne', 'onglerie', 'manucure', 'pédicure', 'tatouage', 'coiffure', 'coiffeuse', 'setter', 'setting', 'closer', 'closing', 'école', 'ecole', 'center', 'centre de', 'agence', 'institut', 'organisme', 'academy', 'language', 'immobilier', 'restaurant', 'boutique', 'salon de'];

/**
 * Check if bio/name contains words indicating a local/présentiel business to reject
 */
function bioContainsRejectWord(bio, fullName) {
  const text = [(bio || ''), (fullName || '')].join(' ').toLowerCase();
  return REJECT_WORDS.some(w => text.includes(w));
}

/**
 * Check if follower count is within the max limit
 * @param {number|null} followersCount
 * @param {number|null} maxFollowers - null = no filter
 * @returns {boolean} true if within limit or no filter
 */
function withinFollowersLimit(followersCount, maxFollowers) {
  if (!maxFollowers) return true;
  if (followersCount == null) return true; // can't determine, let it pass
  return followersCount <= maxFollowers;
}

/**
 * Followers mode — scrape followers of competitor profiles and prospect them
 */
async function runFollowersMode({ workingPage, accountId, profile, totalLimit, skipQualification, variantMode, outreachConfig, stats, runStartTime, MAX_RUNTIME_MS }) {
  const { getDb } = await import('../../../agents/collector/src/db/core.js');
  const pdb = getDb();

  let browserRecoveryCount = 0;
  const MAX_BROWSER_RECOVERIES = 3;
  const BATCH_SIZE = 200; // Scrape 200 followers at a time per competitor

  console.log(`\n🎯 FOLLOWERS MODE — Contact ${totalLimit} new leads from competitor followers`);
  const apiKey = process.env.OPENAI_API_KEY;
  console.log(`🔑 OpenAI API: ${apiKey ? `Présente (...${apiKey.substring(apiKey.length - 8)})` : 'MANQUANTE'}`);

  // Get profile sources (only @profiles, not #hashtags)
  const sourceList = outreachConfig.prospectorSources
    .filter(s => s.startsWith('@'))
    .map(s => s.slice(1));

  if (sourceList.length === 0) {
    throw new Error('No profile sources defined for followers mode. Add @competitor sources in prospector_sources.');
  }

  console.log(`📡 Competitor profiles to scrape: ${sourceList.map(s => '@' + s).join(', ')}`);

  const insertStmt = pdb.prepare(
    "INSERT OR IGNORE INTO prospect_followers (account_id, source_profile, username, status) VALUES (?, ?, ?, 'pending')"
  );

  for (const sourceProfile of sourceList) {
    if (stats.leadsContacted >= totalLimit) break;

    console.log(`\n🔄 Processing competitor @${sourceProfile}...`);

    // Loop: scrape batches of 200, analyze pending, repeat until all followers exhausted or goal reached
    let batchRound = 0;
    let allFollowersExhausted = false;

    while (stats.leadsContacted < totalLimit && !allFollowersExhausted) {
      if (Date.now() - runStartTime > MAX_RUNTIME_MS) {
        console.log(`\n⏰ TIMEOUT: 4h runtime exceeded. Stopping followers mode.`);
        return stats;
      }
      batchRound++;

      // Check how many pending followers we have for this source before scraping more
      const pendingCount = pdb.prepare(
        "SELECT COUNT(*) as cnt FROM prospect_followers WHERE account_id = ? AND source_profile = ? AND status = 'pending'"
      ).get(accountId, sourceProfile).cnt;

      // If no pending left, scrape a new batch
      if (pendingCount === 0) {
        // How many do we already know from this source? That's our scroll offset
        const knownCount = pdb.prepare(
          "SELECT COUNT(*) as cnt FROM prospect_followers WHERE account_id = ? AND source_profile = ?"
        ).get(accountId, sourceProfile).cnt;

        const targetTotal = knownCount + BATCH_SIZE;
        console.log(`\n   📥 Batch #${batchRound}: Scraping up to ${targetTotal} followers (already known: ${knownCount})...`);

        let followerUsernames;
        try {
          followerUsernames = await scrapeFollowersList(workingPage, sourceProfile, accountId, { saveToDb: false, maxToScrape: targetTotal });
        } catch (err) {
          console.error(`   ❌ Failed to scrape followers of @${sourceProfile}: ${err.message}`);
          break;
        }

        // Save new ones as pending
        const insertMany = pdb.transaction((usernames) => {
          let inserted = 0;
          for (const u of usernames) {
            const result = insertStmt.run(accountId, sourceProfile, u);
            if (result.changes > 0) inserted++;
          }
          return inserted;
        });
        const newCount = insertMany(followerUsernames);
        console.log(`   💾 ${newCount} new followers saved (${followerUsernames.length} total scraped)`);

        // If we got fewer than targetTotal, we've reached the end of this competitor's followers
        if (followerUsernames.length < targetTotal) {
          allFollowersExhausted = true;
          console.log(`   📭 All followers of @${sourceProfile} have been scraped`);
        }

        if (newCount === 0) {
          console.log(`   ⚠️ No new followers found, moving to next competitor`);
          break;
        }
      }

      // Get pending followers for this source
      const pendingFollowers = pdb.prepare(
        "SELECT username, source_profile FROM prospect_followers WHERE account_id = ? AND source_profile = ? AND status = 'pending' ORDER BY id"
      ).all(accountId, sourceProfile);

      console.log(`   📋 ${pendingFollowers.length} pending followers to analyze`);

      for (const follower of pendingFollowers) {
        if (stats.leadsContacted >= totalLimit) {
          console.log(`\n🎯 Goal reached (${stats.leadsContacted}/${totalLimit}). Stopping.`);
          break;
        }

        const username = follower.username;

        // Skip if already a lead in the system
        const existingLead = dbFunctions.getLeadByUsername(username, accountId);
        const skipStatuses = ['contacted', 'queued', 'outreach', 'conversation', 'already_known', 'disqualified', 'not_interested', 'uncontactable'];
        if (existingLead && skipStatuses.includes(existingLead.status)) {
          pdb.prepare("UPDATE prospect_followers SET status = 'rejected', reject_reason = ? WHERE account_id = ? AND username = ?").run('already_in_db:' + existingLead.status, accountId, username);
          continue;
        }

        // Skip if already in outreach_queue (pending or sent) — avoids silent dedup by ON CONFLICT
        const queuedRow = pdb.prepare(
          "SELECT status FROM outreach_queue WHERE username = ? AND status IN ('pending','sent')"
        ).get(username);
        if (queuedRow) {
          pdb.prepare("UPDATE prospect_followers SET status = 'rejected', reject_reason = ? WHERE account_id = ? AND username = ?").run('already_in_queue:' + queuedRow.status, accountId, username);
          continue;
        }

        console.log(`\n   --- Processing @${username} (${stats.leadsContacted + 1}/${totalLimit}) ---`);
        stats.leadsProcessed++;

        // Visit profile
        let profileResult;
        try {
          profileResult = await goToProfile(workingPage, username);
        } catch (navErr) {
          if (isBrowserDead(navErr) && browserRecoveryCount < MAX_BROWSER_RECOVERIES) {
            browserRecoveryCount++;
            try {
              workingPage = await recoverBrowser();
              profileResult = await goToProfile(workingPage, username);
            } catch (recErr) {
              console.error(`   ❌ Browser recovery failed: ${recErr.message}`);
              pdb.prepare("UPDATE prospect_followers SET status = 'rejected', reject_reason = ? WHERE account_id = ? AND username = ?").run('profile_error:browser_dead', accountId, username);
              stats.leadsFailed++;
              break;
            }
          } else {
            throw navErr;
          }
        }
        if (!profileResult.success) {
          console.log(`   ❌ Could not open profile: ${profileResult.error}`);
          pdb.prepare("UPDATE prospect_followers SET status = 'rejected', reject_reason = ? WHERE account_id = ? AND username = ?").run('profile_error:' + profileResult.error, accountId, username);
          stats.leadsFailed++;
          continue;
        }

        if (await checkForChallenge(workingPage)) {
          console.log('   ⚠️  Challenge detected during prospecting');
        }

        // Check contactability
        const contactCheck = await checkCanContact(workingPage);
        if (!contactCheck.canContact) {
          console.log(`   🔒 @${username}: No Contact button`);
          pdb.prepare("UPDATE prospect_followers SET status = 'rejected', reject_reason = 'no_contact_button' WHERE account_id = ? AND username = ?").run(accountId, username);
          stats.leadsSkipped++;
          continue;
        }

        // Scrape profile data (bio, fullName, followersCount)
        const profileData = await scrapeProfileData(workingPage);
        console.log(`   📋 Bio: ${profileData.bio || '(none)'}`);

        // Filter: max followers
        if (!withinFollowersLimit(profileData.followersCount, outreachConfig.maxFollowers)) {
          console.log(`   👥 @${username}: Too many followers (${profileData.followersCount} > ${outreachConfig.maxFollowers})`);
          pdb.prepare("UPDATE prospect_followers SET status = 'rejected', reject_reason = ? WHERE account_id = ? AND username = ?").run('too_many_followers:' + profileData.followersCount, accountId, username);
          stats.leadsSkipped++;
          continue;
        }

        // Filter: reject présentiel businesses (massage, etc.)
        if (bioContainsRejectWord(profileData.bio, profileData.fullName)) {
          console.log(`   🚫 @${username}: Rejected (présentiel business)`);
          pdb.prepare("UPDATE prospect_followers SET status = 'rejected', reject_reason = 'reject_word' WHERE account_id = ? AND username = ?").run(accountId, username);
          stats.leadsSkipped++;
          continue;
        }

        // LLM qualification
        let accompanimentType = null;
        if (!skipQualification) {
          const qualificationPrompt = outreachConfig.qualificationPrompt;
          const extractAccompaniment = !qualificationPrompt && !!outreachConfig.niche;
          const qualResult = await qualifyLead(profileData.bio, qualificationPrompt, username, { extractAccompaniment, fullName: profileData.fullName });

        if (!qualResult.qualified) {
          const failReason = qualResult.reason === 'foreign_language' ? 'foreign_language' : 'competitor';
          const icon = failReason === 'foreign_language' ? '🌍' : '🚫';
          console.log(`   ${icon} @${username}: REJECTED (${qualResult.reason})`);
          pdb.prepare("UPDATE prospect_followers SET status = 'rejected', reject_reason = ? WHERE account_id = ? AND username = ?").run('llm:' + qualResult.reason, accountId, username);
          stats.leadsSkipped++;
          await delay(1000, 2000);
          continue;
        }
        accompanimentType = qualResult.accompanimentType || null;
      }

      stats.leadsQualified++;

      // Generate message
      let aiFirstName = null;
      try {
        aiFirstName = await extractNameWithAI(username, profileData.fullName);
      } catch (e) {
        console.error(`   ⚠️ Name extraction failed: ${e.message}`);
      }

      // Filter: female names only (if configured) — only block confirmed males
      if (outreachConfig.femaleOnly && aiFirstName) {
        const genderInfo = await getNameGender(aiFirstName);
        if (genderInfo.gender === 'male' && genderInfo.probability >= 0.7) {
          console.log(`   🚫 @${username}: "${aiFirstName}" is male (${Math.round(genderInfo.probability * 100)}%) → skipping`);
          pdb.prepare("UPDATE prospect_followers SET status = 'rejected', reject_reason = ? WHERE account_id = ? AND username = ?").run('male:' + aiFirstName, accountId, username);
          stats.leadsSkipped++;
          continue;
        }
        if (!genderInfo.gender || genderInfo.fallback) {
          console.log(`   ℹ️  @${username}: "${aiFirstName}" gender unknown — accepting`);
        } else {
          console.log(`   ♀️ @${username}: "${aiFirstName}" confirmed ${genderInfo.gender} (${Math.round(genderInfo.probability * 100)}%)`);
        }
      }

      let leadVariant;
      if (variantMode === 'random') {
        leadVariant = Math.random() < 0.5 ? 'A' : 'B';
      } else {
        leadVariant = variantMode === 'B' ? 'B' : 'A';
      }

      let finalMessage = '';
      const prospectMessageA = outreachConfig.prospectMessageA;
      const prospectMessageB = outreachConfig.prospectMessageB;

      if (leadVariant === 'B' && prospectMessageB) {
        const accompSuffix = accompanimentType ? ` en ${accompanimentType}` : '';
        finalMessage = prospectMessageB
          .replace('{name}', aiFirstName || '')
          .replace('{accomp}', accompSuffix);
      } else if (leadVariant === 'A' && prospectMessageA) {
        finalMessage = prospectMessageA
          .replace('{name}', aiFirstName || '');
      } else if (aiFirstName) {
        finalMessage = `${aiFirstName} ?`;
      } else {
        finalMessage = 'Hello !';
      }
      // Clean up spacing when name is missing: "Coucou , " → "Coucou, "
      finalMessage = finalMessage.replace(/\s+,/g, ',').replace(/\s+!/g, ' !').trim();

      const validation = validateMessage(finalMessage);
      if (!validation.valid) {
        console.log(`   ⚠️  Invalid message: ${validation.issues.join(', ')}`);
        stats.leadsFailed++;
        continue;
      }

      console.log(`   💬 [${leadVariant}] Message: "${finalMessage.substring(0, 60)}..."`);

      // Queue the lead
      const sourceTag = `@${follower.source_profile}`;
      const queueResult = dbFunctions.addToOutreachQueue({
        username,
        profile_url: `https://www.instagram.com/${username}/`,
        dm_url: null,
        prepared_message: finalMessage,
        first_name: aiFirstName,
        source: 'prospect',
        account_id: accountId,
        variant: leadVariant
      });

      if (queueResult) {
        console.log(`   📦 Queued @${username} for later sending.`);
        const dummyComment = { username, comment_text: null, post_url: null };
        saveLeadToDb(username, dummyComment, accountId, 'queued', null, profileData, null, aiFirstName, sourceTag, leadVariant, accompanimentType);
        pdb.prepare("UPDATE prospect_followers SET status = 'qualified' WHERE account_id = ? AND username = ?").run(accountId, username);
        stats.leadsContacted++;
        console.log(`   ✅ Queued. Progress: ${stats.leadsContacted}/${totalLimit}`);
      } else {
        console.log(`   ⚠️ Already in queue: @${username}`);
        pdb.prepare("UPDATE prospect_followers SET status = 'rejected', reject_reason = 'already_in_queue' WHERE account_id = ? AND username = ?").run(accountId, username);
      }

      await delay(2000, 4000);
      } // end for (follower of pendingFollowers)
    } // end while (batch loop per competitor)
  } // end for (sourceProfile of sourceList)

  // Print stats and close
  console.log(`\n🎯 PROSPECTING COMPLETE (followers mode)`);
  console.log('========================');
  console.log(`   Leads processed: ${stats.leadsProcessed}`);
  console.log(`   Leads qualified: ${stats.leadsQualified}`);
  console.log(`   Queued: ${stats.leadsContacted}`);
  console.log(`   Skipped: ${stats.leadsSkipped}`);
  console.log(`   Failed: ${stats.leadsFailed}`);
  console.log('');
  console.log(`✨ Queued ${stats.leadsContacted} leads for later sending.`);
  console.log(`   Total pending in queue: ${dbFunctions.getQueueCount()}`);

  // Don't close browser/db here — caller handles it (may fallback to comments mode)
  return stats;
}

/**
 * Helper to save lead to database
 */
function saveLeadToDb(username, comment, accountId, status, failReason = null, profileData = null, dmUrl = null, firstName = null, sourceTag = null, variant = 'A', accompanimentType = null) {
  try {
    // Insert or update lead
    const lead = dbFunctions.getLeadByUsername(username, accountId);

    if (!lead) {
      // Create new lead
      db.prepare(`
        INSERT INTO leads (username, account_id, profile_url, status, full_name, bio, dm_url, lead_source, first_name, notes, variant, accompaniment_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        username,
        accountId,
        `https://www.instagram.com/${username}/`,
        status,
        profileData?.fullName || null,
        profileData?.bio || null,
        dmUrl || null,
        sourceTag || 'prospect',
        firstName || null,
        failReason ? `Failed: ${failReason}` : null,
        variant,
        accompanimentType
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
          accompaniment_type = COALESCE(?, accompaniment_type),
          updated_at = datetime('now')
        WHERE username = ? AND account_id = ?
      `).run(
        status,
        profileData?.fullName || null,
        profileData?.bio || null,
        dmUrl || null,
        failReason || null,
        accompanimentType,
        username,
        accountId
      );
    }
  } catch (err) {
    console.error(`   DB Error for @${username}: ${err.message}`);
  }
}

export default { runProspector };
