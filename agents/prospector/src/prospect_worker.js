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
import { extractNameWithAI } from '../../outreach/src/name_extractor.js';
import { generateFirstMessage, validateMessage } from '../../outreach/src/templates.js';

// Shared utilities
import { loadProfileConfig } from '../../../shared/utils/configLoader.js';
import { loadOutreachConfig } from '../../../shared/utils/outreachConfigLoader.js';
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

// ============================================
// FOREIGN LANGUAGE BIO DETECTION
// ============================================

const UNIVERSAL_BIO_WORDS = new Set([
  'hello', 'hi', 'hey', 'ok', 'love', 'life', 'happy', 'free',
  'cool', 'style', 'design', 'art', 'music', 'photo', 'video',
  'coach', 'coaching', 'yoga', 'fitness', 'beauty', 'fashion',
  'diy', 'travel', 'food', 'blog', 'vlog', 'dm', 'link', 'bio',
  'ceo', 'founder', 'creator', 'artist', 'model', 'digital',
  'mindset', 'lifestyle', 'wellness', 'flow', 'zen', 'energy',
  'shop', 'store', 'online', 'new', 'best', 'top', 'pro',
]);

const FRENCH_BIO_WORDS = new Set([
  'je', 'tu', 'il', 'elle', 'nous', 'vous', 'ils', 'elles', 'on',
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'au', 'aux',
  'est', 'suis', 'sont', 'ai', 'ont', 'été',
  'et', 'ou', 'mais', 'que', 'qui', 'quoi', 'dont',
  'ne', 'pas', 'plus',
  'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses',
  'ce', 'cette', 'ces', 'ça',
  'dans', 'sur', 'avec', 'pour', 'par', 'chez', 'entre',
  'très', 'bien', 'aussi', 'encore', 'toujours', 'trop',
  'moi', 'toi', 'lui', 'eux', 'leur', 'leurs',
  'tout', 'toute', 'tous', 'toutes', 'même', 'autre',
  'peut', 'veux', 'fais', 'fait', 'va', 'vais',
  'comme', 'quand', 'si', 'alors', 'donc', 'parce',
  'accompagnement', 'accompagne', 'thérapeute', 'formatrice', 'formateur',
  'praticienne', 'praticien', 'spécialisée', 'spécialisé',
  'développement', 'personnel', 'holistique', 'bien-être', 'bienveillance',
  'naturopathe', 'sophrologue', 'hypnothérapeute', 'réflexologue',
]);

// Words shared between French and other Romance languages (Spanish, Portuguese, Italian)
// These are AMBIGUOUS and should NOT count as French indicators
const ROMANCE_AMBIGUOUS_WORDS = new Set([
  'tu', 'la', 'le', 'les', 'un', 'une', 'de', 'du', 'que', 'qui',
  'ou', 'ne', 'pas', 'plus', 'mon', 'ma', 'son', 'sa', 'si', 'on',
  'est', 'au', 'par', 'bien',
]);

// Words that are distinctly Spanish/Portuguese/Italian — NOT French
const OTHER_ROMANCE_WORDS = new Set([
  // Spanish
  'el', 'los', 'las', 'del', 'al', 'con', 'para', 'por', 'como', 'pero',
  'este', 'esta', 'esto', 'ese', 'esa', 'aqui', 'donde', 'cuando',
  'muy', 'más', 'ser', 'estar', 'tiene', 'tiene', 'puede', 'hace',
  'hay', 'soy', 'eres', 'somos', 'fue', 'sido', 'hoy', 'dia',
  'vida', 'mundo', 'tiempo', 'mujer', 'mujeres', 'hombre', 'amor',
  'tambien', 'también', 'siempre', 'nunca', 'algo', 'todo', 'nada',
  'aquí', 'ahora', 'después', 'antes', 'sobre', 'entre', 'hasta',
  'desde', 'hacia', 'sin', 'según', 'durante', 'contra', 'cada',
  'otro', 'otra', 'otros', 'otras', 'mismo', 'misma',
  'yo', 'él', 'ella', 'nosotros', 'ellos', 'ellas', 'usted', 'ustedes',
  'te', 'nos', 'lo', 'se', 'mi', 'su', 'sus', 'tus', 'mis',
  'quiero', 'quieres', 'puedo', 'puedes', 'necesito', 'necesitas',
  'trabajo', 'trabajar', 'ayudo', 'ayudar', 'creo', 'crear',
  'conecta', 'conectar', 'construi', 'construir', 'potencial', 'conciencia',
  'experta', 'experto', 'mucho', 'mucha', 'poco', 'bueno', 'buena',
  'nuevo', 'nueva', 'mejor', 'grande', 'pequeño',
  // Portuguese
  'não', 'sim', 'você', 'vocês', 'isso', 'esse', 'essa', 'aquele',
  'são', 'tem', 'foi', 'ter', 'fazer', 'pode', 'deve', 'quero',
  'muito', 'pouco', 'bem', 'mal', 'bom', 'meu', 'minha', 'seu', 'sua',
  'nos', 'das', 'dos', 'nas', 'nos', 'aos', 'pela', 'pelo',
  'mais', 'menos', 'ainda', 'já', 'aqui', 'ali', 'onde', 'como',
  'porque', 'quando', 'quem', 'qual', 'tudo', 'nada', 'cada',
  'ajudo', 'ajudar', 'trabalho', 'trabalhar', 'vida', 'mundo',
  'mulher', 'mulheres', 'homem', 'pessoas', 'negócio', 'negocio',
  // Italian
  'il', 'gli', 'dei', 'del', 'della', 'delle', 'nel', 'nella',
  'che', 'chi', 'cosa', 'come', 'dove', 'quando', 'perché',
  'sono', 'sei', 'siamo', 'hanno', 'fatto', 'fare', 'dire',
  'questo', 'questa', 'quello', 'quella', 'qui', 'qui',
  'molto', 'poco', 'bene', 'male', 'grande', 'piccolo',
  'mio', 'mia', 'tuo', 'tua', 'suo', 'sua', 'nostro', 'nostra',
  'anche', 'ancora', 'sempre', 'mai', 'già', 'poi', 'dopo',
  'aiuto', 'aiutare', 'lavoro', 'lavorare', 'vita', 'mondo',
  'donna', 'donne', 'uomo', 'persone',
]);

/**
 * Detect if a bio is entirely in a foreign (non-French) language.
 * Short bios (< 5 words) are always accepted.
 * Uses a two-pass approach:
 *  1. If other Romance language words are detected, ambiguous shared words don't count as French
 *  2. Only distinctly-French words are counted to determine the language
 */
function isForeignLanguageBio(bio) {
  if (!bio) return false;

  // Strip emojis and special characters for word count
  const cleaned = bio.replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[|•·—–→←↓↑▪️✨🌿💫🔥✅❤️🙏🎯📩💬📲🌸🌺🌻🌼💐🌈⭐️🏆💪🧘‍♀️🧘‍♂️]/gu, ' ');
  const words = cleaned.trim().split(/\s+/).filter(w => w.length > 0);

  if (words.length < 5) return false;

  const cleanWords = words.map(w => w.toLowerCase().replace(/[^a-zàâçéèêëîïôùûüñ'-]/g, ''));
  const substantiveWords = cleanWords.filter(w => w.length > 1 && !UNIVERSAL_BIO_WORDS.has(w));

  if (substantiveWords.length < 3) return false;

  // Pass 1: detect other Romance languages
  const otherRomanceCount = substantiveWords.filter(w => OTHER_ROMANCE_WORDS.has(w)).length;
  const hasOtherRomance = otherRomanceCount >= 2;

  // Pass 2: count French words — if other Romance detected, exclude ambiguous shared words
  const frenchCount = substantiveWords.filter(w => {
    if (!FRENCH_BIO_WORDS.has(w)) return false;
    if (hasOtherRomance && ROMANCE_AMBIGUOUS_WORDS.has(w)) return false;
    return true;
  }).length;

  const frenchRatio = frenchCount / substantiveWords.length;

  // Also check for French-specific accents (ç, œ, æ, ù, û are uniquely French)
  const hasFrenchSpecificAccents = /[çœæùû]/i.test(bio);
  if (hasFrenchSpecificAccents) return false;

  // If other Romance language is detected and no distinctly French words → reject
  if (hasOtherRomance && frenchCount === 0) return true;

  return frenchRatio < 0.1;
}

/**
 * Main prospecting pipeline
 */
export async function runProspector(options = {}) {
  const {
    profile,
    source,
    maxPosts = 3,
    totalLimit = 20,
    skipQualification = false,
    mode = 'comments',
    variantMode = 'A'
  } = options;

  if (!profile) throw new Error('Profile is required');

  await loadDatabase();
  const account = dbFunctions.getOrCreateAccount(profile);
  const accountId = account.id;

  // Load profile config for qualification and messaging
  const profileConfig = await loadProfileConfig(profile);
  const outreachConfig = loadOutreachConfig(accountId, profileConfig);
  console.log(`🧠 Niche: ${outreachConfig.niche || 'default'}`);
  console.log(`🔍 Mode: ${mode === 'authors' ? 'AUTHORS (post publishers)' : 'COMMENTS (commenters)'}`);

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

  // Initialize browser with dedicated prospector account
  // Uses INSTAGRAM_USERNAME_PROSPECTOR / INSTAGRAM_PASSWORD_PROSPECTOR from .env
  // Profile is still used for DB/account association, not for browser session
  const userDataDir = getBrowserDataDir('prospector');
  console.log('\n🌐 Initializing browser (prospector account)...');
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

        try {
          // Build list of candidate leads depending on mode
          let candidates = []; // Array of { username, comment }

          if (mode === 'authors') {
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
            // COMMENTS MODE (default): scrape comments, leads = commenters
            console.log('   Scraping comments...');
            const comments = await scrapePostComments(workingPage, postUrl, 500);

            if (!comments || comments.length === 0) {
              console.log('   No comments found on this post.');
              dbFunctions.upsertPost(post);
              dbFunctions.markPostScraped(postUrl);
              continue;
            }

            console.log(`   Found ${comments.length} comments`);
            stats.commentsFound += comments.length;

            const uniqueUsernames = new Set();
            for (const comment of comments) {
              const username = comment.username;
              if (!username) continue;
              if (username.toLowerCase() === 'reels') continue;
              if (uniqueUsernames.has(username)) continue;
              uniqueUsernames.add(username);
              candidates.push({ username, comment });
            }
          }

          // STEP 3: Process each candidate lead
          for (const { username, comment } of candidates) {
             if (stats.leadsContacted >= totalLimit) break;

             // Skip if already in database in active or completed stage
             const existingLead = dbFunctions.getLeadByUsername(username, accountId);
             const skipStatuses = ['contacted', 'queued', 'outreach', 'conversation', 'already_known', 'disqualified', 'not_interested', 'uncontactable'];

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
             console.log(`   📋 Bio: ${profileData.bio ? profileData.bio.substring(0, 50) + '...' : '(none)'}`);

             // STEP 3c-bis: Reject profiles with bio entirely in a foreign language
             if (profileData.bio && isForeignLanguageBio(profileData.bio)) {
               console.log(`   🌍 @${username}: REJECTED (bio in foreign language)`);
               stats.leadsSkipped++;
               saveLeadToDb(username, comment, accountId, 'failed', 'foreign_language', null, null, null, currentSourceRaw);
               await delay(1000, 2000);
               continue;
             }

             // STEP 3d: Qualify lead (if not skipped)
             let accompanimentType = null;
             if (!skipQualification) {
               const qualificationPrompt = outreachConfig.qualificationPrompt;
               // Extract accompaniment type when niche is set (profile-level opt-in)
               const extractAccompaniment = !qualificationPrompt && !!outreachConfig.niche;
               const qualResult = await qualifyLead(profileData.bio, qualificationPrompt, username, { extractAccompaniment });

               if (!qualResult.qualified) {
                 console.log(`   🚫 @${username}: REJECTED (${qualResult.reason})`);
                 stats.leadsSkipped++;
                 saveLeadToDb(username, comment, accountId, 'failed', 'competitor', null, null, null, currentSourceRaw);
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

              // Determine A/B variant for this lead
              let leadVariant;
              if (variantMode === 'random') {
                leadVariant = Math.random() < 0.5 ? 'A' : 'B';
              } else {
                leadVariant = variantMode === 'B' ? 'B' : 'A';
              }

              // Final Message preparation
              let finalMessage = "";
              if (leadVariant === 'B') {
                // Variant B: "Hello Prénom, est-ce que tu proposes toujours un accompagnement en {type} ?"
                const name = aiFirstName || profileData.fullName?.split(' ')[0] || '';
                const accompSuffix = accompanimentType ? ` en ${accompanimentType}` : '';
                finalMessage = name
                  ? `Hello ${name}, est-ce que tu proposes toujours un accompagnement${accompSuffix} ?`
                  : `Hello, est-ce que tu proposes toujours un accompagnement${accompSuffix} ?`;
              } else if (aiFirstName) {
                // Variant A: Just "[Name] ?"
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
                  niche: outreachConfig.niche || 'personal development',
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
                  console.log(`   ✅ Queued. Progress: ${stats.leadsContacted}/${totalLimit}`);
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

  // FINAL: Print stats and close
  console.log(`\n🎯 PROSPECTING COMPLETE`);
  console.log('========================');
  console.log(`   Posts scraped: ${stats.postsScraped}`);
  console.log(`   Comments found: ${stats.commentsFound}`);
  console.log(`   Leads processed: ${stats.leadsProcessed}`);
  console.log(`   Leads qualified: ${stats.leadsQualified}`);
  console.log(`   Queued: ${stats.leadsContacted}`);
  console.log(`   Skipped: ${stats.leadsSkipped}`);
  console.log(`   Failed: ${stats.leadsFailed}`);
  console.log('');
  console.log(`✨ Queued ${stats.leadsContacted} leads for later sending.`);
  console.log(`   Total pending in queue: ${dbFunctions.getQueueCount()}`);
  await closeBrowser().catch(() => {});
  dbFunctions.closeDatabase();

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
