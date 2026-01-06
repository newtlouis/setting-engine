/**
 * Page Verification Utility
 * 
 * Verifies that the browser is on the expected page and no CAPTCHA/challenge
 * is present. If verification fails, blocks execution and waits for user input.
 */

import { createInterface } from 'readline';

/**
 * Wait for user to press Enter
 */
async function waitForEnter(message = 'Press [ENTER] to continue...') {
  console.log(`   ⌨️  ${message}`);
  process.stdout.write('\x07'); // Beep
  
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Simple delay utility
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if page shows CAPTCHA or challenge
 * @param {Page} page - Playwright page
 * @returns {Promise<{isChallenge: boolean, reason?: string}>}
 */
async function detectChallenge(page) {
  const url = page.url();
  
  // 1. Robust URL-based detection
  const challengeUrls = [
    '/challenge/',
    '/checkpoint/',
    '/accounts/suspended/',
    '/accounts/login/two_factor',
    'instagram.com/logging_out'
  ];
  
  for (const pattern of challengeUrls) {
    if (url.includes(pattern)) {
      return { isChallenge: true, reason: `URL contains sensitive pattern: ${pattern}` };
    }
  }
  
  // 2. Text-based detection - more restrictive to avoid false positives in content
  const challengePatterns = [
    'suspicious activity',
    'confirm your identity',
    'confirmer votre identité',
    'activité suspecte',
    'try again later',
    'action blocked',
    'we limit how often',
    'verify it\'s you',
    'help us confirm'
  ];
  
  // We exclude common words like "challenge", "verify", "robot" from general text search
  // because they are too common in post captions/comments.
  
  try {
    // Check main headings or body text but ignore content-heavy areas like articles/comments
    const bodyText = await page.evaluate(() => {
      // Create a clone of the body to manipulate it safely
      const bodyClone = document.body.cloneNode(true);
      
      // CRITICAL FIX: Remove script, style, and noscript tags first!
      // innerText on detached nodes can include script content (like JSON blobs), causing false positives.
      const scripts = bodyClone.querySelectorAll('script, style, noscript, iframe, svg');
      scripts.forEach(el => el.remove());

      // Remove articles and comment sections to avoid false positives in captions/comments
      const contentToIgnore = bodyClone.querySelectorAll('article, [role="main"] section:last-child, .x1n2onr6');
      contentToIgnore.forEach(el => el.remove());
      
      return bodyClone.innerText?.toLowerCase() || '';
    });
    
    for (const pattern of challengePatterns) {
      if (bodyText.includes(pattern.toLowerCase())) {
        return { isChallenge: true, reason: `Critical text detected: "${pattern}"` };
      }
    }
    
    // Check for explicit "Help Us Confirm It's You" or similar challenge headers
    const headerChallenge = await page.evaluate(() => {
      const h2s = Array.from(document.querySelectorAll('h2'));
      const challengeTitles = ['help us confirm', 'votre compte', 'suspicious activity', 'verify'];
      return h2s.find(h2 => {
        const text = h2.innerText.toLowerCase();
        // For H2, we can be slightly more liberal but still careful
        return challengeTitles.some(title => text.includes(title)) && text.length < 50;
      });
    });
    
    if (headerChallenge) {
      return { isChallenge: true, reason: 'Challenge header detected' };
    }

  } catch (e) {
    // Ignore evaluation errors
  }
  
  return { isChallenge: false };
}

/**
 * Validate that we're on a profile page with the expected username
 */
async function validateProfilePage(page, expectedUsername) {
  try {
    const url = page.url();
    
    // URL should contain the username
    if (!url.includes(`/${expectedUsername}`)) {
      return { valid: false, reason: `URL doesn't contain username: ${expectedUsername}` };
    }
    
    // Look for username in page content (header h1/h2 or specific elements)
    const usernameVisible = await page.evaluate((username) => {
      const text = document.body?.innerText || '';
      // Username should appear in the page
      return text.toLowerCase().includes(username.toLowerCase());
    }, expectedUsername);
    
    if (!usernameVisible) {
      return { valid: false, reason: `Username "${expectedUsername}" not visible on page` };
    }
    
    // Check for profile-specific elements
    const hasProfileElements = await page.evaluate(() => {
      return !!(
        document.querySelector('header') ||
        document.querySelector('[aria-label*="followers"]') ||
        document.querySelector('button:has-text("Follow")') ||
        document.querySelector('button:has-text("Suivre")') ||
        document.querySelector('button:has-text("Message")') ||
        document.querySelector('button:has-text("Contacter")')
      );
    });
    
    if (!hasProfileElements) {
      return { valid: false, reason: 'No profile elements found (header, follow button, etc.)' };
    }
    
    return { valid: true };
  } catch (e) {
    return { valid: false, reason: `Error validating profile: ${e.message}` };
  }
}

/**
 * Validate that we're on a post page
 */
async function validatePostPage(page, expectedPostUrl) {
  try {
    const url = page.url();
    
    // URL should be a post URL
    if (!url.includes('/p/') && !url.includes('/reel/')) {
      return { valid: false, reason: 'URL is not a post or reel' };
    }
    
    // Check for article element (post container) or post-specific buttons
    const hasArticle = await page.$('article').catch(() => null);
    if (hasArticle) return { valid: true };
    
    // Fallback: Check for action buttons (Like, Comment, Save)
    const postSignals = await page.evaluate(() => {
      return !!(
        document.querySelector('svg[aria-label="Like"]') ||
        document.querySelector('svg[aria-label="J’aime"]') ||
        document.querySelector('svg[aria-label="Comment"]') ||
        document.querySelector('svg[aria-label="Commenter"]') ||
        document.querySelector('svg[aria-label="Save"]') ||
        document.querySelector('svg[aria-label="Enregistrer"]') ||
        document.querySelector('textarea[aria-label*="comment"]')
      );
    });
    
    if (!postSignals) {
      return { valid: false, reason: 'No article or post action buttons found' };
    }
    
    return { valid: true };
  } catch (e) {
    return { valid: false, reason: `Error validating post: ${e.message}` };
  }
}

/**
 * Validate that we're on a DM/messaging page
 */
async function validateDMPage(page) {
  try {
    const url = page.url();
    
    // Should be on direct messages
    if (!url.includes('/direct/')) {
      // Might still be on profile with DM popup open
    }
    
    // Check for message input
    const hasMessageInput = await page.evaluate(() => {
      return !!(
        document.querySelector('[contenteditable="true"][role="textbox"]') ||
        document.querySelector('[aria-label*="message" i][contenteditable="true"]') ||
        document.querySelector('[data-lexical-editor="true"]')
      );
    });
    
    if (!hasMessageInput) {
      return { valid: false, reason: 'No message input found' };
    }
    
    return { valid: true };
  } catch (e) {
    return { valid: false, reason: `Error validating DM: ${e.message}` };
  }
}

/**
 * Validate that we're on the home page
 */
async function validateHomePage(page) {
  try {
    const url = page.url();
    
    // Should be on instagram.com root or /reels/
    if (!url.match(/instagram\.com\/(reels\/)?(\?|$)/)) {
      return { valid: false, reason: 'Not on home page' };
    }
    
    // Check for home icon or feed elements
    const hasHomeElements = await page.evaluate(() => {
      return !!(
        document.querySelector('svg[aria-label="Home"]') ||
        document.querySelector('a[href="/direct/inbox/"]') ||
        document.querySelector('[aria-label="New post"]')
      );
    });
    
    if (!hasHomeElements) {
      return { valid: false, reason: 'No home page elements found' };
    }
    
    return { valid: true };
  } catch (e) {
    return { valid: false, reason: `Error validating home: ${e.message}` };
  }
}

/**
 * Validate that we're on a hashtag page
 */
async function validateHashtagPage(page, expectedHashtag) {
  try {
    const url = page.url();
    
    // URL should contain /explore/tags/ OR /explore/search/keyword/
    const isHashtagUrl = url.includes('/explore/tags/');
    const isSearchUrl = url.includes('/explore/search/keyword/');
    
    if (!isHashtagUrl && !isSearchUrl) {
      return { valid: false, reason: 'Not on a hashtag or search results page' };
    }
    
    // Hashtag or keyword should be in URL
    if (expectedHashtag) {
      const cleanHashtag = expectedHashtag.replace(/^#/, '');
      const searchPattern = encodeURIComponent(expectedHashtag).toLowerCase();
      const cleanPattern = encodeURIComponent(cleanHashtag).toLowerCase();
      
      if (!url.toLowerCase().includes(searchPattern) && !url.toLowerCase().includes(cleanPattern)) {
        return { valid: false, reason: `URL doesn't contain hashtag or keyword: ${expectedHashtag}` };
      }
    }
    
    return { valid: true };
  } catch (e) {
    return { valid: false, reason: `Error validating hashtag: ${e.message}` };
  }
}

/**
 * Main page verification function
 * 
 * @param {Page} page - Playwright page object
 * @param {Object} options
 * @param {string} options.expectedType - 'profile' | 'post' | 'dm' | 'home' | 'hashtag' | 'any'
 * @param {string} [options.expectedValue] - Username for profile, URL for post, hashtag name, etc.
 * @param {number} [options.waitMs=1000] - Wait time before verification
 * @param {boolean} [options.blockOnFailure=true] - Whether to block and wait for Enter on failure
 * @returns {Promise<{success: boolean, blocked: boolean, reason?: string}>}
 */
export async function verifyPage(page, options = {}) {
  const {
    expectedType = 'any',
    expectedValue = null,
    waitMs = 1000,
    blockOnFailure = true
  } = options;
  
  // Wait before verification
  await delay(waitMs);
  
  const result = {
    success: true,
    blocked: false,
    reason: null
  };
  
  // Step 1: Check for CAPTCHA/challenge
  const challengeResult = await detectChallenge(page);
  
  if (challengeResult.isChallenge) {
    console.log('\n🛑 🛑 🛑 CAPTCHA / CHALLENGE DÉTECTÉ 🛑 🛑 🛑');
    console.log(`   Raison: ${challengeResult.reason}`);
    console.log('   👉 Résous le CAPTCHA dans le navigateur');
    console.log('   👉 Reviens ensuite ici');
    
    if (blockOnFailure) {
      await waitForEnter('Appuie sur [ENTRÉE] quand c\'est résolu...');
      result.blocked = true;
      
      // Re-check after user intervention
      const recheckChallenge = await detectChallenge(page);
      if (recheckChallenge.isChallenge) {
        console.log('   ❌ Challenge toujours présent!');
        result.success = false;
        result.reason = 'Challenge not resolved';
        return result;
      }
      console.log('   ✅ Challenge résolu, on continue...');
    } else {
      result.success = false;
      result.reason = challengeResult.reason;
      return result;
    }
  }
  
  // Step 2: Validate expected page type
  if (expectedType !== 'any') {
    let validationResult = { valid: true };
    
    switch (expectedType) {
      case 'profile':
        validationResult = await validateProfilePage(page, expectedValue);
        break;
      case 'post':
        validationResult = await validatePostPage(page, expectedValue);
        break;
      case 'dm':
        validationResult = await validateDMPage(page);
        break;
      case 'home':
        validationResult = await validateHomePage(page);
        break;
      case 'hashtag':
        validationResult = await validateHashtagPage(page, expectedValue);
        break;
    }
    
    if (!validationResult.valid) {
      console.log('\n⚠️  PAGE INATTENDUE DÉTECTÉE');
      console.log(`   Type attendu: ${expectedType}`);
      if (expectedValue) console.log(`   Valeur attendue: ${expectedValue}`);
      console.log(`   Raison: ${validationResult.reason}`);
      console.log(`   URL actuelle: ${page.url()}`);
      
      if (blockOnFailure) {
        await waitForEnter('Appuie sur [ENTRÉE] pour continuer malgré tout...');
        result.blocked = true;
      }
      
      result.success = false;
      result.reason = validationResult.reason;
    }
  }
  
  return result;
}

/**
 * Shorthand for profile verification
 */
export async function verifyProfilePage(page, username) {
  return verifyPage(page, { expectedType: 'profile', expectedValue: username });
}

/**
 * Shorthand for post verification
 */
export async function verifyPostPage(page, postUrl = null) {
  return verifyPage(page, { expectedType: 'post', expectedValue: postUrl });
}

/**
 * Shorthand for DM verification
 */
export async function verifyDMPage(page) {
  return verifyPage(page, { expectedType: 'dm' });
}

/**
 * Shorthand for home page verification
 */
export async function verifyHomePage(page) {
  return verifyPage(page, { expectedType: 'home' });
}

/**
 * Shorthand for hashtag page verification
 */
export async function verifyHashtagPage(page, hashtag) {
  return verifyPage(page, { expectedType: 'hashtag', expectedValue: hashtag });
}

/**
 * Quick challenge-only check (no page type validation)
 * Compatible with existing detectChallenge usage pattern
 */
export async function checkForChallenge(page) {
  const result = await verifyPage(page, { expectedType: 'any', blockOnFailure: true });
  return !result.success;
}
