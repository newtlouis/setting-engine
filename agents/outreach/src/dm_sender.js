/**
 * Instagram DM Sender Module
 * 
 * Handles sending DMs via Playwright with proper rate limiting and safety features.
 * 
 * WORKFLOW:
 * - Opens one "working" tab to check profiles
 * - For each contactable profile: opens a NEW tab, types message, keeps tab open
 * - Skipped profiles: just changes URL in working tab
 * - At the end: browser stays open so user can review and send messages manually
 * 
 * CRITICAL SAFETY NOTES:
 * - This module requires manual login (no automated login)
 * - Rate limits are enforced to avoid account restrictions
 * - All messages should be reviewed before enabling send mode
 * - Default mode is PREVIEW (no actual sending)
 */

import { chromium } from 'playwright';
import { CONFIG } from './config.js';
import { qualifyLead } from './qualify_lead.js';
import { extractFirstName } from './templates.js';
import { getCredentialsForProfile } from '../../../shared/credentials.js';
import { createInterface } from 'readline';
import { USER_AGENT, STEALTH_ARGS, applyStealthToPage, getRandomViewport, humanDelay, TIMING } from '../../../shared/stealth.js';

// Store reference to browser context for tab management
let browserContext = null;
let workingPage = null;  // Reusable tab for checking profiles
let messageTabs = [];    // Tabs with typed messages (kept open)

/**
 * Wait for a random delay between min and max
 */
/**
 * Wait for a random delay between min and max
 */
function delay(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Type text with human-like variations
 * - Variable speeds
 * - Pauses on punctuation/spaces
 * - Occasional micro-pauses
 */
async function typeHumanLike(page, text) {
  // Use for...of to correctly iterate over Unicode code points (preserving emojis)
  for (const char of text) {
    
    // Base delay: faster for common letters, slower for symbols
    let charDelay = 30 + Math.random() * 50;
    
    // Longer pauses for punctuation
    if (['.', '!', '?', '\n'].includes(char)) {
      charDelay += Math.random() * 400 + 200; 
    } else if ([',', ';', ':'].includes(char)) {
      charDelay += Math.random() * 200 + 100;
    } else if (char === ' ') {
      charDelay += Math.random() * 50 + 20;
    }
    
    // Occasional "thinking" pause (1% chance)
    if (Math.random() < 0.01) {
      charDelay += Math.random() * 1000 + 500;
    }
    
    await page.keyboard.type(char);
    await delay(charDelay * 0.8, charDelay * 1.2);
  }
}

/**
 * Check if page shows any challenge or rate limit
 */
/**
 * Detect Instagram challenge or rate limit page
 * AND pause for manual resolution if detected.
 * 
 * @param {Page} page - Playwright page object
 * @returns {Promise<{blocked: boolean, reason?: string}>}
 */
async function detectChallenge(page) {
  const url = page.url();
  
  // Check URL patterns
  let isChallenge = url.includes('/challenge/') || url.includes('/accounts/suspended/');

  // Check for challenge text content
  if (!isChallenge) {
      const challengeText = await page.$('text=/suspicious activity|verify|challenge|confirm|robot|identité/i').catch(() => null);
      if (challengeText) isChallenge = true;
  }
  
  // Check for specific rate limit dialogs
  if (!isChallenge) {
      const rateLimitIndicators = [
        'text="Try Again Later"',
        'text="Action Blocked"', 
        'text="We limit how often"',
        'text="You\'re Temporarily Blocked"',
        '[role="dialog"]:has-text("try again")'
      ];
      for (const selector of rateLimitIndicators) {
         if (await page.$(selector).catch(() => null)) {
             isChallenge = true; 
             break;
         }
      }
  }

  if (isChallenge) {
      console.log('\n🛑 🛑 🛑 CHALLENGE / BLOCK DETECTED 🛑 🛑 🛑');
      console.log('   Instagram has flagged this activity.');
      console.log('   👉 Please go to the browser window NOW.');
      console.log('   👉 Solve the CAPTCHA, enter SMS code, or click "Tell us" if blocked.');
      console.log('   👉 Navigate back to the profile or home page.');
      console.log('   ⌨️  Press [ENTER] in this terminal when you are done to continue...');
      
      process.stdout.write('\x07'); // Beep

      // Wait for manual resolution
      const { createInterface } = await import('readline');
      await new Promise((resolve) => {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout
        });
        rl.question('', () => {
          rl.close();
          resolve();
        });
      });

      console.log('   🔄 Verifying if challenge is cleared...');
      await delay(3000, 4000);
      
      // Re-check
      const newUrl = page.url();
      const stillChallenge = newUrl.includes('/challenge/') || 
                             newUrl.includes('/accounts/suspended/') ||
                             (await page.$('text=/suspicious activity|verify|challenge|confirm|try again/i').catch(() => null));
                             
      if (stillChallenge) {
          console.log('   ❌ Challenge still detected. Stopping script.');
          return { blocked: true, reason: 'unresolved_challenge' };
      } else {
          console.log('   ✅ Challenge cleared! Resuming...');
          return { blocked: false };
      }
  }
  
  return { blocked: false };
}

/**
 * Verify that the profile page is actually loaded
 * Confirms we are seeing the specific user's page, not a generic page or error
 * 
 * @param {Page} page 
 * @param {string} username 
 */
async function verifyProfileLoaded(page, username) {
    try {
        // Check 1: URL should contain username
        if (!page.url().includes(username)) {
            // It might be acceptable if redirected (e.g. login), but suspicious
        }

        // Check 2: Look for username in header (h2, h1, or specific spans)
        // Instagram usually puts the username in an h2 at the top
        const usernameSelectors = [
            `h2:has-text("${username}")`,
            `h1:has-text("${username}")`,
            `header h2`, 
            `span[role="link"]:has-text("${username}")` // sometimes in nav
        ];

        for (const selector of usernameSelectors) {
            const el = await page.$(selector).catch(() => null);
            if (el) {
                const text = await el.textContent();
                if (text.includes(username)) return true;
            }
        }
        
        // Fallback: Check for "Follow" or "Message" which implies a profile
        const actionButton = await page.$('button:has-text("Follow"), button:has-text("Suivre"), button:has-text("Message"), button:has-text("Contacter")');
        if (actionButton) return true;

        return false;
    } catch (e) {
        return false;
    }
}

/**
 * Initialize browser with existing session
 * Requires manual login on first run
 * 
 * @param {Object} options
 * @returns {Promise<{browser, context, page}>}
 */
export async function initBrowser(options = {}) {
  const {
    userDataDir = './browser-data',
    headless = CONFIG.HEADLESS
  } = options;
  
  // Extract profile name from userDataDir if possible
  const profileMatch = userDataDir.match(/browser-data-(.+)$/);
  const profile = profileMatch ? profileMatch[1] : 'default';
  
  console.log('\n=== Initializing Browser ===');
  console.log(`   User data: ${userDataDir}`);
  console.log(`   Headless: ${headless}`);
  
  const timeout = CONFIG.PAGE_TIMEOUT || 90000;
  const viewport = getRandomViewport();
  
  browserContext = await chromium.launchPersistentContext(userDataDir, {
    headless,
    slowMo: CONFIG.SLOW_MO,
    viewport,
    userAgent: USER_AGENT,
    locale: 'en-US',
    timezoneId: 'Europe/Paris',
    args: STEALTH_ARGS,
    ignoreDefaultArgs: ['--enable-automation'],
    timeout: timeout
  });
  
  // Reset tab tracking
  messageTabs = [];
  
  // Create working page (for checking profiles)
  workingPage = await browserContext.newPage();
  workingPage.setDefaultTimeout(timeout);
  
  // Apply stealth init script
  await applyStealthToPage(workingPage);
  
  // Navigate to Instagram to check login status
  console.log(`   Loading Instagram (timeout: ${timeout/1000}s)...`);
  try {
    await workingPage.goto('https://www.instagram.com/', { 
      waitUntil: 'domcontentloaded',
      timeout: timeout
    });
  } catch (error) {
    console.log('   Slow connection, retrying with extended timeout...');
    await delay(3000, 5000);
    await workingPage.goto('https://www.instagram.com/', { 
      waitUntil: 'domcontentloaded',
      timeout: timeout * 2  // Double timeout on retry
    });
  }
  await delay(2000, 3000);
  
  // Check if logged in
  const isLoggedIn = await workingPage.evaluate(() => {
    // Check for elements that only appear when logged in
    return !!(
      document.querySelector('svg[aria-label="Home"]') ||
      document.querySelector('a[href="/direct/inbox/"]') ||
      document.querySelector('[aria-label="New post"]')
    );
  });
  
  if (!isLoggedIn) {
    const { username, password } = getCredentialsForProfile(profile);
    
    if (!username || !password) {
      console.log('\n   ⚠️  MANUAL LOGIN REQUIRED');
      console.log('   (Set INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD in .env for auto-login)');
      console.log('   Please log in to Instagram in the browser window.');
      console.log('   Press Enter in this terminal when done...');
      
      await new Promise(resolve => {
        process.stdin.once('data', resolve);
      });
    } else {
      console.log('   Logging in automatically...');
      
      // --- COOKIE POPUP HANDLING ---
      try {
        console.log('   Checking for cookie consent popup...');
        const cookieSelectors = [
          'button:has-text("Allow all cookies")',
          'button:has-text("Autoriser tous les cookies")',
          'button:has-text("Allow essential and optional cookies")',
          'button:has-text("Uniquement les cookies essentiels")',
          'button._a9--._ap36._asz1', 
          'button._a9--._a9_0',
          'div[role="dialog"] button:has-text("Allow")',
          'div[role="dialog"] button:has-text("Autoriser")'
        ];

        let cookieHandled = false;
        for (const selector of cookieSelectors) {
          try {
            const button = await workingPage.$(selector);
            if (button && await button.isVisible()) {
              console.log(`   Found cookie button: ${selector}`);
              await button.click();
              cookieHandled = true;
              await delay(1000, 1500);
              break;
            }
          } catch (e) {
            // Ignore
          }
        }

        if (!cookieHandled) {
          // Fallback: JavaScript click
          await workingPage.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const target = buttons.find(b => 
              b.innerText.includes('Allow all cookies') || 
              b.innerText.includes('Autoriser tous les cookies') ||
              b.innerText.includes('Decline optional cookies') ||
              b.innerText.includes('Refuser')
            );
            if (target) target.click();
          });
          await delay(1000, 1500);
        }
      } catch (error) {
        console.log('   Cookie popup check failed (or none present)');
      }
      // ----------------------------
      
      // Wait for login form
      try {
        await workingPage.waitForSelector('input[name="username"]', { timeout: 10000 });
      } catch (e) {
        console.log('   Login form not found, waiting longer...');
        await delay(2000, 3000);
      }
      
      // Type credentials
      await workingPage.type('input[name="username"]', username, { delay: 50 + Math.random() * 100 });
      await delay(500, 1000);
      await workingPage.type('input[name="password"]', password, { delay: 50 + Math.random() * 100 });
      await workingPage.click('button[type="submit"]');
      
      // Wait for login to complete
      try {
        await workingPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (e) {
        console.log('   Login navigation slow, continuing...');
      }
      await delay(2000, 3000);
      
      // Handle "Save Login Info?" popup
      try {
        const notNowBtn = workingPage.locator('text=Not Now').or(workingPage.locator('button:has-text("Not Now")'));
        await notNowBtn.click({ timeout: 5000 });
        console.log('   Dismissed "Save Login" popup.');
      } catch (e) {
        // No popup
      }
      
      console.log('   ✅ Login successful!');
    }
    
    await workingPage.reload({ waitUntil: 'domcontentloaded' });
    await delay(2000, 3000);
  }
  
  console.log('   Browser ready\n');
  
  return { browser: browserContext, page: workingPage };
}

/**
 * Create a new tab for a contactable profile
 * @returns {Promise<Page>}
 */
async function createNewTab() {
  if (!browserContext) {
    throw new Error('Browser not initialized');
  }
  const timeout = CONFIG.PAGE_TIMEOUT || 90000;
  const newPage = await browserContext.newPage();
  newPage.setDefaultTimeout(timeout);
  
  // Apply stealth to new tab
  await applyStealthToPage(newPage);
  
  return newPage;
}

/**
 * Get the working page (reusable tab for checking profiles)
 * @returns {Page}
 */
function getWorkingPage() {
  return workingPage;
}

/**
 * Navigate to a user's profile and check if we can contact them
 * 
 * @param {Page} page - Playwright page
 * @param {string} username - Instagram username
 * @returns {Promise<{success: boolean, canContact: boolean, error?: string}>}
 */
export async function goToProfile(page, username, targetUrl = null) {
  const profileUrl = targetUrl || `https://www.instagram.com/${username}/`;
  
  try {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.PAGE_TIMEOUT });
    await delay(2000, 3000);
    
    // Check for blocks / challenges interactively
    const blockStatus = await detectChallenge(page);
    if (blockStatus.blocked) {
      return { success: false, canContact: false, error: blockStatus.reason };
    }

    // Verify profile loaded correctly (CRITICAL User Fix)
    const isLoaded = await verifyProfileLoaded(page, username);
    if (!isLoaded) {
        // If not loaded, it might be a subtle challenge (CAPTCHA page)
        // Check challenge one more time explicitly
        const retryBlock = await detectChallenge(page);
        if (retryBlock.blocked) {
             return { success: false, canContact: false, error: retryBlock.reason };
        }
        
        console.log(`      ⚠️  Profile @${username} does not verify (username not found in header).`);
        // We could return error, or assume it's a 404/unavailable
    }
    
    // Check if profile exists (multiple languages)
    const notFoundSelectors = [
      'text=/sorry, this page/i',
      'text=/cette page n\'est pas disponible/i',
      'text=/page not available/i'
    ];
    
    for (const selector of notFoundSelectors) {
      const notFound = await page.$(selector).catch(() => null);
      if (notFound) {
        return { success: false, canContact: false, error: 'profile_not_found' };
      }
    }
    
    // Check if Private Account (CRITICAL User Fix)
    // We check this BEFORE looking for buttons, to avoid false positives
    const isPrivate = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('this account is private') || 
               text.includes('ce compte est privé') ||
               text.includes('compte privé');
    });

    if (isPrivate) {
        // Double check if we are already following (meaning we CAN contact)
        const isFollowing = await page.$('button:has-text("Following"), button:has-text("Abonné(e)")').catch(() => null);
        
        if (!isFollowing) {
             // It's private and we don't follow -> NO CONTACT
             return { 
                success: true, 
                canContact: false, 
                error: 'private_account_no_contact'
             };
        }
    }

    // Check if the "Contacter" / "Message" button exists
    const { canContact } = await checkCanContact(page);
    
    if (!canContact) {
      if (isPrivate) {
         return { success: true, canContact: false, error: 'private_account_no_contact' };
      }

      // If Public but no contact button
      // Check if we see "Follow" to confirm page structure is valid (and we are not just seeing a blank page)
      const hasFollowButton = await page.$('button:has-text("Follow"), button:has-text("Suivre"), button:has-text("S’abonner")').catch(() => null);
      
      if (hasFollowButton) {
          console.log(`      ℹ️  Profile is Public but likely settings prevent generic messaging (No Contact button).`);
          return { success: true, canContact: false, error: 'public_no_contact_button' };
      }

      return { 
        success: true, 
        canContact: false, 
        error: 'no_contact_button'
      };
    }
    
    return { success: true, canContact: true };
    
  } catch (error) {
    return { success: false, canContact: false, error: error.message };
  }
}

/**
 * Check if the profile has a "Contacter" / "Message" button
 * This indicates we can DM this user (public account or we follow them)
 * 
 * @param {Page} page - Playwright page
 * @returns {Promise<{canContact: boolean, button?: ElementHandle}>}
 */
export async function checkCanContact(page) {
  // Try all possible selectors for the contact button
  const selectors = CONFIG.SELECTORS.CONTACT_BUTTON;
  
  for (const selector of selectors) {
    const button = await page.$(selector).catch(() => null);
    if (button) {
      // Verify it's visible
      const isVisible = await button.isVisible().catch(() => false);
      if (isVisible) {
        return { canContact: true, button };
      }
    }
  }
  
  return { canContact: false };
}

/**
 * Scrape profile data (bio, full name) from Instagram profile page
 * Uses the same robust logic as the Collector agent
 * 
 * @param {Page} page - Playwright page on a profile
 * @returns {Promise<{bio: string|null, fullName: string|null}>} Profile data
 */
export async function scrapeProfileData(page) {
  try {
    const data = await page.evaluate(() => {
      let foundBio = null;
      let foundFullName = null;
      
      // Helper to validate if a string looks like a real name
      function isValidName(text) {
        if (!text || text.length < 2 || text.length > 40) return false; // Allowed slightly longer names
        // Should not have numbers (unless it's like "3rd") but Instagram names usually don't have digits if they are real names
        // Relaxed rule: allow some digits if complex, but generally avoid stats
        if (/^\d+$/.test(text) || text.includes('followers')) return false;
        // Should not contain @
        if (text.includes('@')) return false;
        // Should not be a common UI button text
        if (/^(follow|suivre|message|contacter|edit|modifier|friends|amis|s’abonner)$/i.test(text)) return false;
        return true;
      }

      // STRATEGY 1: Targeted Name Element (User Request)
      // The user indicated the name is often in a specific span with dir="auto"
      // We look for spans that are likely the "Name" field:
      // - Inside header
      // - Separate from the bio
      // - Often bold or distinct
      
      const header = document.querySelector('main header') || document.querySelector('header');
      
      if (header) {
          // 1. Look for the span that is explicitly the name (often h1's child or sibling)
          // Try H1 first - technically Instagram puts username in H2 and Real Name in span usually, but varies.
          
          // Capture all standard text spans in header
          const allSpans = Array.from(header.querySelectorAll('span[dir="auto"]'));
          
          // Filter candidate spans
          const candidates = allSpans
              .map(s => s.textContent.trim())
              .filter(text => isValidName(text));
              
          // HEURISTIC: The "Real Name" is usually the FIRST valid text span in the header content
          // (Username is often in an H2 or distinct element)
          if (candidates.length > 0) {
              // The bio is usually longer. The name is usually short (2-3 words).
              // We pick the first candidate that isn't clearly a bio (long paragraph)
              
              for (const c of candidates) {
                  // If it's short and looks like a name
                  if (c.length < 50 && !c.includes('\n')) {
                      foundFullName = c;
                      break; // Found it
                  }
              }
          }
          
          // If we found a name, try to distinguish Bio (appearing after name)
          if (foundFullName) {
               const bioCandidates = candidates.filter(c => c !== foundFullName && c.length > 5);
               // Pick the longest remaining one as Bio
               if (bioCandidates.length > 0) {
                   foundBio = bioCandidates.reduce((a, b) => a.length > b.length ? a : b);
               }
          }
      }
      
      // Fallback: Generic Meta tags
      if (!foundFullName) {
         // Sometimes meta tags have it: "Name (@username) • Instagram photos"
         const metaTitle = document.querySelector('meta[property="og:title"]')?.content;
         if (metaTitle) {
             const match = metaTitle.match(/^(.+?)\s+\(@/);
             if (match && isValidName(match[1])) {
                 foundFullName = match[1];
             }
         }
      }

      return { bio: foundBio, fullName: foundFullName };
    });
    
    if (data.fullName) console.log(`   👤 Nom trouvé : "${data.fullName}"`);
    else console.log(`   👤 Nom non trouvé (sera fallback sur username)`);
    
    if (data.bio) console.log(`   📋 Bio trouvée (${data.bio.length} chars)`);
    
    return data;
    
  } catch (error) {
    console.error('   ⚠️  Erreur scraping profile data:', error.message);
    return { bio: null, fullName: null };
  }
}

/**
 * Click the Contact/Message button on a profile page
 * 
 * @param {Page} page - Playwright page
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function clickMessageButton(page) {
  try {
    // First check if the contact button exists
    const { canContact, button } = await checkCanContact(page);
    
    if (!canContact || !button) {
      return { success: false, error: 'no_contact_button_private_account' };
    }
    
    // Click the contact button
    await button.click();
    
    // Wait briefly for transition to start
    await delay(2000, 3000);
    
    // Verify the message input appeared (DM popup opened)
    const inputSelectors = CONFIG.SELECTORS.MESSAGE_INPUT;
    let dmInput = null;
    
    // Try to wait for one of the selectors to appear (dynamic wait)
    // Total wait will be 2s delay + up to 3s wait = max 5s (but usually faster)
    for (const selector of inputSelectors) {
      try {
        dmInput = await page.waitForSelector(selector, { state: 'visible', timeout: 3000 }).catch(() => null);
        if (dmInput) break;
      } catch (e) {
        // Ignore timeout
      }
    }
    
    if (!dmInput) {
      // Last ditch effort: check immediate presence
      for (const selector of inputSelectors) {
        dmInput = await page.$(selector).catch(() => null);
        if (dmInput) {
          const isVisible = await dmInput.isVisible().catch(() => false);
          if (isVisible) break;
          dmInput = null;
        }
      }
    }

    if (!dmInput) {
      return { success: false, error: 'dm_popup_not_opened' };
    }
    
    return { success: true };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Check if the DM conversation already has messages
 * Prevents sending duplicate outreach messages
 * 
 * @param {Page} page - Playwright page with DM popup open
 * @returns {Promise<{hasMessages: boolean, messageCount: number}>}
 */
export async function hasExistingMessages(page) {
  try {
    // Wait a moment for messages to load
    await delay(500, 800);
    
    const result = await page.evaluate(() => {
      // Look for message bubbles with dir="auto" containing text
      const messageElements = document.querySelectorAll('div[dir="auto"]');
      
      let messageCount = 0;
      
      for (const el of messageElements) {
        const text = el.innerText?.trim();
        
        // Skip empty, very short, or placeholder texts
        if (!text || text.length < 3) continue;
        if (text === 'Message...' || text === 'Votre message...') continue;
        if (text === 'Seen' || text === 'Vu' || text === 'Active now') continue;
        
        // Check if it looks like a message (has parent with role="button" for double-tap)
        const parentButton = el.closest('[role="button"][aria-label*="Double tap"]');
        if (parentButton) {
          messageCount++;
        }
      }
      
      return { hasMessages: messageCount > 0, messageCount };
    });
    
    if (result.hasMessages) {
      console.log(`      ⚠️  Conversation already has ${result.messageCount} message(s)!`);
    }
    
    return result;
    
  } catch (error) {
    console.error('      Error checking existing messages:', error.message);
    return { hasMessages: false, messageCount: 0 };
  }
}

/**
 * Type and send a DM message in the popup
 * 
 * @param {Page} page - Playwright page
 * @param {string} message - Message to send
 * @param {boolean} dryRun - If true, types but doesn't send
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendMessage(page, message, dryRun = true) {
  try {
    // Find message input using configured selectors
    const inputSelectors = CONFIG.SELECTORS.MESSAGE_INPUT;
    
    let input = null;
    for (const selector of inputSelectors) {
      input = await page.$(selector).catch(() => null);
      if (input) {
        const isVisible = await input.isVisible().catch(() => false);
        if (isVisible) break;
        input = null;
      }
    }
    
    if (!input) {
      return { success: false, error: 'message_input_not_found' };
    }
    
    // Click to focus the contenteditable div
    await input.click();
    await delay(300, 500);
    
    // Type message with human-like delays
    await typeHumanLike(page, message);
    
    await delay(500, 1000);
    
    if (dryRun) {
      console.log('      [DRY RUN] Message typed but not sent');
      // Clear the message using Cmd+A then Backspace
      await page.keyboard.down('Meta');
      await page.keyboard.press('a');
      await page.keyboard.up('Meta');
      await page.keyboard.press('Backspace');
      await delay(500, 800);
      return { success: true, dryRun: true };
    }
    
    // Send the message by pressing Enter
    await page.keyboard.press('Enter');
    
    await delay(1500, 2000);
    
    // Verify message was sent (input should be empty or have placeholder)
    const inputText = await input.textContent().catch(() => '');
    if (inputText.length > 10 && inputText !== message.substring(0, 10)) {
      // Message might not have sent
      return { success: false, error: 'message_may_not_have_sent' };
    }
    
    return { success: true, sent: true };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Check if a profile can be contacted (using working tab)
 * Does NOT type any message - just checks if "Contacter" button exists
 * 
 * @param {string} username - Instagram username
 * @returns {Promise<Object>} Result with canContact boolean
 */
export async function checkProfileContactable(username, targetUrl = null) {
  const page = getWorkingPage();
  
  const result = {
    username,
    canContact: false,
    error: null
  };
  
  try {
    const navResult = await goToProfile(page, username, targetUrl);
    
    if (!navResult.success) {
      result.error = navResult.error;
      return result;
    }
    
    result.canContact = navResult.canContact;
    if (!navResult.canContact) {
      result.error = navResult.error || 'cannot_contact';
    }
    
    return result;
    
  } catch (error) {
    result.error = error.message;
    return result;
  }
}

/**
 * Send a DM to a user in a NEW tab (keeps tab open with message)
 * 
 * Flow:
 * 1. Open new tab and navigate to profile
 * 2. Click "Contacter" to open DM popup
 * 3. Type message in the contenteditable field
 * 4. Keep tab open (don't send, don't close)
 * 
 * @param {string} username - Instagram username
 * @param {string} message - Message to send
 * @param {Object} options
 * @returns {Promise<Object>} Result object
 */
export async function sendDMToUserInNewTab(username, message, options = {}) {
  const {
    dryRun = true,  // In new flow, dryRun means "type but don't send"
    onProgress = null,
    onConversationReady = null,
    profileUrl = null
  } = options;
  
  const result = {
    username,
    success: false,
    skipped: false,
    steps: [],
    error: null,
    tabKeptOpen: false,
    timestamp: new Date().toISOString()
  };
  
  let newTab = null;
  
  try {
    // Step 1: Create new tab and navigate to profile
    if (onProgress) onProgress('opening_tab', username);
    newTab = await createNewTab();
    
    const navResult = await goToProfile(newTab, username, profileUrl);
    result.steps.push({ step: 'navigate', ...navResult });
    
    if (!navResult.success) {
      result.error = navResult.error;
      // Close failed tab
      await newTab.close().catch(() => {});
      return result;
    }
    
    // Step 2: Check if we can contact (should be true since we pre-checked)
    if (!navResult.canContact) {
      result.skipped = true;
      result.error = navResult.error || 'cannot_contact';
      // Close tab for non-contactable
      await newTab.close().catch(() => {});
      return result;
    }
    
    // Step 2.5: Get Profile Data BEFORE clicking contact (while still on profile)
    if (onProgress) onProgress('scraping_profile', username);
    const profileData = await scrapeProfileData(newTab);
    result.fullName = profileData.fullName; // Return for DB update
    
    // Step 3: Click "Contacter" button to open DM popup
    if (onProgress) onProgress('clicking_contact', username);
    const clickResult = await clickMessageButton(newTab);
    result.steps.push({ step: 'click_contact', ...clickResult });
    
    if (!clickResult.success) {
      result.error = clickResult.error;
      await newTab.close().catch(() => {});
      return result;
    }
    
    // Step 3.5: Check if conversation already has messages (prevent duplicate outreach)
    const existingCheck = await hasExistingMessages(newTab);
    result.steps.push({ step: 'check_existing', ...existingCheck });
    
    if (existingCheck.hasMessages) {
      result.skipped = true;
      result.existingConversation = true; // Flag for caller to update status
      result.messageCount = existingCheck.messageCount;
      console.log(`      💬 @${username} already has ${existingCheck.messageCount} message(s) - marking as conversation`);
      await newTab.close().catch(() => {});
      return result;
    }

    // Step 3.7: NOW qualify lead (after confirmation that we can actually message them)
    // This ensures we only call OpenAI for leads we can actually contact
    if (CONFIG.QUALIFICATION_ENABLED && CONFIG.OPENAI_API_KEY) {
      if (onProgress) onProgress('qualifying', username);
      
      const qualification = await qualifyLead(profileData.bio);
      result.steps.push({ step: 'qualify', ...qualification });
      
      if (!qualification.qualified) {
        result.skipped = true;
        result.isCompetitor = true;
        result.error = qualification.reason || 'competitor_detected';
        console.log(`      🚫 @${username} est un concurrent - outreach annulé`);
        await newTab.close().catch(() => {});
        return result;
      }
      
      console.log(`      ✅ @${username} qualifié pour outreach`);
    }

    // Step 3.9: Personalize message with actual name if found
    if (profileData.fullName) {
      const actualFirstName = extractFirstName(profileData.fullName, username);
      const oldFirstName = extractFirstName(null, username); // What we likely used
      
      if (actualFirstName !== oldFirstName && actualFirstName !== 'there') {
        const greetingPattern = /^(Salut|Hello|Hey|Coucou)\s+[^\s,!?]+/;
        if (greetingPattern.test(message)) {
          const newMessage = message.replace(greetingPattern, `$1 ${actualFirstName}`);
          if (newMessage !== message) {
            console.log(`      ✨ Message personnalisé : "Salut ${actualFirstName}" (au lieu de "${oldFirstName}")`);
            message = newMessage;
            result.personalizedName = actualFirstName;
          }
        }
      }
    }
    
    // Step 4: Type message (but DON'T send, DON'T clear - keep it ready)
    if (onProgress) onProgress('typing', username);
    const typeResult = await typeMessageOnly(newTab, message);
    result.steps.push({ step: 'type', ...typeResult });
    
    if (!typeResult.success) {
      result.error = typeResult.error;
      await newTab.close().catch(() => {});
      return result;
    }
    
    // Success! Keep tab open with message ready to send
    result.success = true;
    result.tabKeptOpen = true;
    result.dryRun = dryRun;
    const dmUrl = newTab.url();
    result.dmUrl = dmUrl;

    if (onConversationReady) {
      try {
        await onConversationReady({ username, dmUrl, message, typedAt: result.timestamp });
      } catch (callbackError) {
        console.error(`onConversationReady failed for @${username}:`, callbackError.message);
      }
    }
    
    // Track this tab
    messageTabs.push({
      username,
      page: newTab,
      message,
      dmUrl,
      timestamp: result.timestamp
    });
    
    return result;
    
  } catch (error) {
    result.error = error.message;
    if (newTab) {
      await newTab.close().catch(() => {});
    }
    return result;
  }
}

/**
 * Type message only (don't send, don't clear)
 * Message stays in the input field ready for manual send
 * 
 * @param {Page} page - Playwright page
 * @param {string} message - Message to type
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function typeMessageOnly(page, message) {
  try {
    // Find message input using configured selectors
    const inputSelectors = CONFIG.SELECTORS.MESSAGE_INPUT;
    
    let input = null;
    for (const selector of inputSelectors) {
      input = await page.$(selector).catch(() => null);
      if (input) {
        const isVisible = await input.isVisible().catch(() => false);
        if (isVisible) break;
        input = null;
      }
    }
    
    if (!input) {
      return { success: false, error: 'message_input_not_found' };
    }
    
    // Click to focus the contenteditable div
    await input.click();
    await delay(300, 500);
    
    // Type message with human-like delays
    await typeHumanLike(page, message);
    
    await delay(300, 500);
    
    // DON'T send, DON'T clear - leave message in input
    return { success: true, typed: true };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Legacy: Send a DM to a user (full flow) - single page mode
 * Kept for backwards compatibility
 * 
 * @param {Page} page - Playwright page
 * @param {string} username - Instagram username
 * @param {string} message - Message to send
 * @param {Object} options
 * @returns {Promise<Object>} Result object
 */
export async function sendDMToUser(page, username, message, options = {}) {
  const {
    dryRun = true,
    onProgress = null
  } = options;
  
  const result = {
    username,
    success: false,
    skipped: false,
    steps: [],
    error: null,
    timestamp: new Date().toISOString()
  };
  
  try {
    // Step 1: Go to profile and check if we can contact
    if (onProgress) onProgress('navigating', username);
    const navResult = await goToProfile(page, username);
    result.steps.push({ step: 'navigate', ...navResult });
    
    if (!navResult.success) {
      result.error = navResult.error;
      return result;
    }
    
    // Step 2: Check if we can contact this user
    if (!navResult.canContact) {
      result.skipped = true;
      result.error = navResult.error || 'cannot_contact';
      console.log(`      SKIPPED: ${result.error}`);
      return result;
    }
    
    // Step 3: Click "Contacter" button to open DM popup
    if (onProgress) onProgress('clicking_contact', username);
    const clickResult = await clickMessageButton(page);
    result.steps.push({ step: 'click_contact', ...clickResult });
    
    if (!clickResult.success) {
      result.error = clickResult.error;
      return result;
    }
    
    // Step 4: Type and send message
    if (onProgress) onProgress('sending', username);
    const sendResult = await sendMessage(page, message, dryRun);
    result.steps.push({ step: 'send', ...sendResult });
    
    if (!sendResult.success) {
      result.error = sendResult.error;
      return result;
    }
    
    result.success = true;
    result.dryRun = dryRun;
    
    return result;
    
  } catch (error) {
    result.error = error.message;
    return result;
  }
}

/**
 * Batch send DMs with multi-tab workflow
 * 
 * NEW WORKFLOW:
 * 1. Use working tab to check if profile is contactable
 * 2. If contactable: open NEW tab, navigate, type message, keep tab open
 * 3. If not contactable: just move to next (working tab already has it)
 * 4. At end: browser stays open with all message tabs ready to send
 * 
 * @param {Page} page - Playwright page (working page)
 * @param {Array} targets - Array of { username, message } objects
 * @param {Object} options
 * @returns {Promise<Object>} Results summary
 */
export async function batchSendDMs(page, targets, options = {}) {
  const {
    dryRun = true,  // In new flow, always "types but doesn't send"
    maxPerSession = CONFIG.MAX_DMS_PER_SESSION,
    onProgress = null,
    onComplete = null,
    onConversationReady = null
  } = options;
  
  const results = {
    total: targets.length,
    attempted: 0,
    successful: 0,
    failed: 0,
    skipped: 0,  // Private accounts / no contact button
    blocked: false,
    tabsOpen: 0,
    details: []
  };
  
  console.log(`\n=== Starting Batch DM (Multi-Tab Mode) ===`);
  console.log(`   Targets: ${targets.length}`);
  console.log(`   Max per session: ${maxPerSession}`);
  console.log(`   Mode: Type messages, keep tabs open for manual review`);
  console.log(`   Delay range: ${CONFIG.MIN_DELAY_BETWEEN_DMS/1000}s - ${CONFIG.MAX_DELAY_BETWEEN_DMS/1000}s\n`);
  
  let successfulCount = 0;  // Track actual successes for max limit
  
  for (let i = 0; i < targets.length && successfulCount < maxPerSession; i++) {
    const target = targets[i];
    results.attempted++;
    
    console.log(`   [${i + 1}/${targets.length}] @${target.username}`);
    
    // DIRECT TAB OPENING (Optimized Flow)
    // We open a new tab immediately. If it's valid, we keep it. If not, the function closes it.
    console.log(`      Opening new tab for @${target.username}...`);
    
    if (onProgress) onProgress('opening_tab', target.username);
    
    const result = await sendDMToUserInNewTab(target.username, target.message, {
      dryRun: true,  // Always just type, don't send
      onProgress,
      onConversationReady,
      profileUrl: target.profileUrl
    });
    
    // Check if we hit a rate limit/block during the attempt
    if (result.error && (result.error.includes('rate_limit') || result.error.includes('challenge'))) {
       console.log(`   BLOCKED: ${result.error}. Stopping.`);
       results.blocked = true;
       results.blockReason = result.error;
       break;
    }
    
    if (result.skipped) {
       // Private account or no contact button
       results.skipped++;
       results.details.push(result);
       console.log(`      → SKIPPED: ${result.error}`);
       if (onComplete) onComplete(result);
    } else if (result.success && result.tabKeptOpen) {
       // Success!
       results.successful++;
       results.tabsOpen++;
       successfulCount++;
       results.details.push(result);
       console.log(`      ✓ Message typed - tab #${results.tabsOpen} kept open`);
       if (onComplete) onComplete(result);
    } else {
       // General failure
       results.failed++;
       results.details.push(result);
       console.log(`      ✗ FAILED: ${result.error}`);
       if (onComplete) onComplete(result);
    }
    
    // Logic handled above
    
    // Logic handled above
    
    // Rate limiting delay (reduced by half as requested)
    if (i < targets.length - 1 && successfulCount < maxPerSession) {
      const waitTime = (CONFIG.MIN_DELAY_BETWEEN_DMS + 
                       Math.random() * (CONFIG.MAX_DELAY_BETWEEN_DMS - CONFIG.MIN_DELAY_BETWEEN_DMS)) / 4;
      console.log(`      Waiting ${Math.round(waitTime/1000)}s before next...`);
      await delay(waitTime, waitTime + 1000);
    }
  }
  
  // Summary
  console.log('\n=== Batch Complete ===');
  console.log(`   Attempted: ${results.attempted}`);
  console.log(`   Messages typed: ${results.successful}`);
  console.log(`   Tabs open: ${results.tabsOpen}`);
  console.log(`   Skipped (private): ${results.skipped}`);
  console.log(`   Failed: ${results.failed}`);
  if (results.blocked) {
    console.log(`   STOPPED: ${results.blockReason}`);
  }
  
  if (results.tabsOpen > 0) {
    console.log(`\n   ⚠️  BROWSER LEFT OPEN`);
    console.log(`   ${results.tabsOpen} tabs with messages ready to send.`);
    console.log(`   Review each tab and press Enter to send manually.`);
    console.log(`   Close browser when done.`);
  }
  
  return results;
}

/**
 * Get list of open message tabs
 * @returns {Array} Array of {username, page, message, timestamp}
 */
export function getOpenMessageTabs() {
  return messageTabs;
}

/**
 * Wait for user to finish reviewing and close browser manually
 * Browser stays open until user presses Ctrl+C or closes it
 */
export async function waitForUserToFinish() {
  if (messageTabs.length === 0) {
    console.log('\n   No message tabs open. Closing browser...');
    await closeBrowser();
    return;
  }
  
  console.log('\n=== REVIEW YOUR MESSAGES ===');
  console.log(`   ${messageTabs.length} tabs with messages ready:`);
  messageTabs.forEach((tab, i) => {
    console.log(`   ${i + 1}. @${tab.username}`);
  });
  console.log('\n   For each tab:');
  console.log('   1. Review the message');
  console.log('   2. Press Enter to send (or edit first)');
  console.log('   3. Move to next tab');
  console.log('\n   When done, press Ctrl+C or close the browser manually.');
  console.log('   Waiting...\n');
  
  // Keep process alive until browser is closed or Ctrl+C
  return new Promise((resolve) => {
    // Check if browser is still open every second
    const checkInterval = setInterval(async () => {
      try {
        // Try to get pages - will fail if browser closed
        const pages = browserContext?.pages();
        if (!pages || pages.length === 0) {
          clearInterval(checkInterval);
          resolve();
        }
      } catch (e) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 1000);
    
    // Also handle Ctrl+C
    process.on('SIGINT', () => {
      clearInterval(checkInterval);
      console.log('\n   Received Ctrl+C. Exiting...');
      resolve();
    });
  });
}

/**
 * Close browser (force close all tabs)
 */
export async function closeBrowser() {
  if (browserContext) {
    await browserContext.close().catch(() => {});
    browserContext = null;
    workingPage = null;
    messageTabs = [];
  }
}
