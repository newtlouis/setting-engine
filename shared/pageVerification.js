/**
 * Page Verification Utility
 * 
 * Verifies that the browser is on the expected page and no CAPTCHA/challenge
 * is present. If verification fails, blocks execution and waits for user input.
 * 
 * Multi-layer detection:
 *  1. URL-based (challenge, checkpoint, login redirect, suspended)
 *  2. Text-based (suspicious activity, action blocked, rate limit, captcha text FR+EN)
 *  3. Instagram dialog/modal detection (unknown blocking dialogs)
 *  4. Error page detection (404, blank page, page not found)
 *  5. Auto-dismiss of known popups (cookies, notifications) before blocking
 */

import { createInterface } from 'readline';

/**
 * Wait for user to press Enter
 */
async function waitForEnter(message = 'Press [ENTER] to continue...') {
  // In non-interactive mode (cron), don't block — throw to skip
  if (!process.stdin.isTTY) {
    console.log(`   ⚠️ Non-interactive mode (cron) — cannot wait for input. Skipping.`);
    throw new Error('CAPTCHA_NON_INTERACTIVE');
  }

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
 * Try to auto-dismiss known Instagram popups (cookies, notifications, save login).
 * Returns true if a popup was dismissed (caller may want to re-check the page).
 * 
 * @param {Page} page - Playwright page
 * @returns {Promise<boolean>} True if a popup was auto-dismissed
 */
async function tryDismissKnownPopups(page) {
  let dismissed = false;

  try {
    // 1. Cookie consent popup
    const cookieDismissed = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const cookieBtn = buttons.find(btn => {
        const t = btn.textContent?.toLowerCase() || '';
        return (
          t.includes('allow all cookies') ||
          t.includes('autoriser tous les cookies') ||
          t.includes('decline optional cookies') ||
          t.includes('uniquement les cookies essentiels') ||
          t.includes('tout accepter') ||
          t.includes('accepter') ||
          t.includes('accept all')
        );
      });
      if (cookieBtn) { cookieBtn.click(); return true; }
      return false;
    });
    if (cookieDismissed) {
      console.log('   🍪 Popup cookies auto-fermé');
      dismissed = true;
      await delay(1000);
    }

    // 2. "Turn on Notifications?" / "Save Login Info?" popup — click "Not Now"
    const notifDismissed = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      const notNowBtn = buttons.find(btn => {
        const t = btn.textContent?.trim()?.toLowerCase() || '';
        return (t === 'not now' || t === 'pas maintenant');
      });
      if (notNowBtn) { notNowBtn.click(); return true; }
      return false;
    });
    if (notifDismissed) {
      console.log('   🔔 Popup notifications/login auto-fermé');
      dismissed = true;
      await delay(1000);
    }
  } catch (e) {
    // Ignore — page might have navigated
  }

  return dismissed;
}

/**
 * Check if a visible dialog is a known safe Instagram dialog (DM, likers, followers, etc.)
 * These should NOT be treated as blocking challenges.
 * 
 * @param {Page} page - Playwright page
 * @returns {Promise<boolean>} True if the visible dialog is a known safe dialog
 */
async function isKnownSafeDialog(page) {
  try {
    return await page.evaluate(() => {
      const dialogs = document.querySelectorAll('div[role="dialog"]');
      for (const dialog of dialogs) {
        // Check if dialog is actually visible
        const rect = dialog.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        const text = dialog.innerText?.toLowerCase() || '';
        const html = dialog.innerHTML || '';

        // DM popup: has a message textbox
        if (dialog.querySelector('[contenteditable="true"][role="textbox"]') ||
            dialog.querySelector('[data-lexical-editor="true"]')) {
          return true;
        }

        // Likers/Followers/Following list: has a scrollable user list
        if (dialog.querySelector('a[role="link"][href*="/"]') &&
            dialog.querySelectorAll('a[role="link"]').length > 2) {
          return true;
        }

        // Post detail dialog: has an article element
        if (dialog.querySelector('article')) {
          return true;
        }

        // Share dialog
        if (html.includes('shareDialog') || text.includes('share') || text.includes('partager')) {
          // Only if it also has sharing UI elements
          if (dialog.querySelector('input[type="text"]') || 
              dialog.querySelectorAll('button').length > 3) {
            return true;
          }
        }

        // Emoji picker or media picker
        if (dialog.querySelector('[aria-label*="emoji" i]') ||
            dialog.querySelector('[aria-label*="gif" i]')) {
          return true;
        }
      }
      return false;
    });
  } catch (e) {
    return false;
  }
}

/**
 * Detect if an unknown blocking Instagram dialog/modal is visible.
 * Excludes known safe dialogs (DM, likers, followers, post detail, etc.).
 * 
 * @param {Page} page - Playwright page
 * @returns {Promise<{isBlocking: boolean, reason?: string}>}
 */
async function detectBlockingDialog(page) {
  try {
    // Check if any dialog is visible at all
    const hasVisibleDialog = await page.evaluate(() => {
      const dialogs = document.querySelectorAll('div[role="dialog"]');
      for (const dialog of dialogs) {
        const rect = dialog.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 100) {
          return true;
        }
      }
      return false;
    });

    if (!hasVisibleDialog) {
      return { isBlocking: false };
    }

    // Check if it's a known safe dialog
    if (await isKnownSafeDialog(page)) {
      return { isBlocking: false };
    }

    // Unknown dialog detected — check its content for challenge indicators
    const dialogInfo = await page.evaluate(() => {
      const dialogs = document.querySelectorAll('div[role="dialog"]');
      for (const dialog of dialogs) {
        const rect = dialog.getBoundingClientRect();
        if (rect.width <= 100 || rect.height <= 100) continue;
        
        const text = dialog.innerText?.toLowerCase() || '';
        // Truncate for logging
        return text.substring(0, 200);
      }
      return null;
    });

    if (dialogInfo) {
      // Check if dialog text contains challenge-like content
      const challengeIndicators = [
        'suspicious', 'blocked', 'confirm', 'verify', 'captcha', 'robot',
        'humain', 'human', 'identity', 'identité', 'security', 'sécurité',
        'automated', 'automatisé', 'restrict', 'restreint', 'unusual',
        'try again', 'réessayer', 'limit', 'too fast', 'trop rapide'
      ];

      for (const indicator of challengeIndicators) {
        if (dialogInfo.includes(indicator)) {
          return { isBlocking: true, reason: `Blocking dialog with challenge text: "${indicator}" — content: "${dialogInfo.substring(0, 100)}..."` };
        }
      }

      // Even without challenge keywords, an unknown modal is suspicious
      // Log it but don't block (to avoid false positives on new Instagram features)
      console.log(`   ⚠️  Unknown dialog detected (non-bloquant): "${dialogInfo.substring(0, 80)}..."`);
    }

    return { isBlocking: false };
  } catch (e) {
    return { isBlocking: false };
  }
}

/**
 * Detect if the page is an error page (404, blank, "sorry this page isn't available")
 * 
 * @param {Page} page - Playwright page
 * @returns {Promise<{isError: boolean, reason?: string}>}
 */
async function detectErrorPage(page) {
  try {
    const result = await page.evaluate(() => {
      const title = document.title?.toLowerCase() || '';
      const bodyText = document.body?.innerText?.toLowerCase() || '';
      const bodyLength = bodyText.trim().length;

      // Completely blank page (< 50 chars visible)
      // But exclude private profiles which have minimal text
      if (bodyLength < 50) {
        const isPrivate = bodyText.includes('privé') || bodyText.includes('private');
        if (!isPrivate) {
          return { isError: true, reason: 'Page appears blank (< 50 chars)' };
        }
      }

      // Title-based detection
      if (title.includes('page not found') || title.includes('page introuvable') || title === '404') {
        return { isError: true, reason: `Error page title: "${title}"` };
      }

      // Instagram-specific error messages
      const errorPatterns = [
        'sorry, this page isn\'t available',
        'désolé, cette page n\'est pas disponible',
        'the link you followed may be broken',
        'le lien que vous avez suivi est peut-être rompu',
        'content isn\'t available',
        'contenu n\'est pas disponible'
      ];

      for (const pattern of errorPatterns) {
        if (bodyText.includes(pattern)) {
          return { isError: true, reason: `Error page text: "${pattern}"` };
        }
      }

      return { isError: false };
    });

    return result;
  } catch (e) {
    return { isError: false };
  }
}

/**
 * Check if page shows CAPTCHA, challenge, blocking popup, or unexpected state.
 * 
 * Multi-layer detection (ordered by speed and specificity):
 *  1. URL-based detection (fastest)
 *  2. Login redirect detection  
 *  3. Text-based detection (body text, headers)
 *  4. Instagram dialog/modal detection
 *  5. Error page detection
 * 
 * Before blocking, attempts to auto-dismiss known popups (cookies, notifications).
 * 
 * @param {Page} page - Playwright page
 * @returns {Promise<{isChallenge: boolean, reason?: string}>}
 */
async function detectChallenge(page) {
  const url = page.url();
  
  // ── Layer 1: URL-based detection (instant, no DOM access) ──
  const challengeUrls = [
    '/challenge/',
    '/checkpoint/',
    '/accounts/suspended/',
    '/accounts/login/two_factor',
    'instagram.com/logging_out',
    '/accounts/onetap/',          // "Was it you?" verification
    '/privacy/checks/',           // Privacy/identity checks
  ];
  
  for (const pattern of challengeUrls) {
    if (url.includes(pattern)) {
      return { isChallenge: true, reason: `URL contains sensitive pattern: ${pattern}` };
    }
  }
  
  // ── Layer 2: Login redirect detection ──
  // Session expired mid-script → redirected to login page
  if (url.includes('/accounts/login') && !url.includes('two_factor')) {
    return { isChallenge: true, reason: 'Redirected to login page (session expired?)' };
  }

  // ── Layer 3: Text-based detection ──
  const challengePatterns = [
    // English
    'suspicious activity',
    'confirm your identity',
    'try again later',
    'action blocked',
    'we limit how often',
    'verify it\'s you',
    'help us confirm',
    'confirm that you are a human',
    'verify that you are human',
    'we restrict certain activity',
    'temporarily blocked',
    'your account has been temporarily locked',
    'unusual activity',
    'automated behavior',
    'please wait a few minutes',
    'you\'re temporarily blocked',
    // French
    'activité suspecte',
    'confirmer votre identité',
    'réessayer plus tard',
    'action bloquée',
    'confirmez que vous êtes un humain',
    'vérifiez que vous êtes humain',
    'nous restreignons certaines activités',
    'temporairement bloqué',
    'votre compte a été temporairement verrouillé',
    'activité inhabituelle',
    'comportement automatisé',
    'patientez quelques minutes',
    'vous êtes temporairement bloqué',
  ];
  
  try {
    // Check main headings or body text but ignore content-heavy areas like articles/comments
    const bodyText = await page.evaluate(() => {
      // Create a clone of the body to manipulate it safely
      const bodyClone = document.body.cloneNode(true);
      
      // Remove script, style, and noscript tags first
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
    
    // Check for challenge headers (h1, h2)
    const headerChallenge = await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('h1, h2'));
      const challengeTitles = [
        'help us confirm', 'votre compte', 'suspicious activity', 'verify',
        'confirm', 'blocked', 'bloqué', 'security check', 'vérification'
      ];
      const found = headers.find(h => {
        const text = h.innerText?.toLowerCase() || '';
        return challengeTitles.some(title => text.includes(title)) && text.length < 60;
      });
      return found ? found.innerText : null;
    });
    
    if (headerChallenge) {
      return { isChallenge: true, reason: `Challenge header detected: "${headerChallenge}"` };
    }

    // ── Layer 4: Iframe-based CAPTCHA detection ──
    // Some CAPTCHAs (reCAPTCHA, hCaptcha, Arkose/FunCaptcha) are loaded in iframes
    const hasCaptchaIframe = await page.evaluate(() => {
      const iframes = Array.from(document.querySelectorAll('iframe'));
      const captchaSources = [
        'recaptcha', 'hcaptcha', 'captcha', 'arkoselabs', 'funcaptcha',
        'challenges.cloudflare', 'turnstile'
      ];
      return iframes.some(iframe => {
        const src = (iframe.src || '').toLowerCase();
        const title = (iframe.title || '').toLowerCase();
        return captchaSources.some(s => src.includes(s) || title.includes(s));
      });
    });

    if (hasCaptchaIframe) {
      return { isChallenge: true, reason: 'CAPTCHA iframe detected (reCAPTCHA/hCaptcha/Arkose)' };
    }

  } catch (e) {
    // Ignore evaluation errors
  }
  
  // ── Layer 5: Try auto-dismiss known popups before checking for blocking dialogs ──
  const wasDismissed = await tryDismissKnownPopups(page);
  if (wasDismissed) {
    // A known popup was dismissed — no need to block
    return { isChallenge: false };
  }

  // ── Layer 6: Unknown blocking dialog detection ──
  const dialogResult = await detectBlockingDialog(page);
  if (dialogResult.isBlocking) {
    return { isChallenge: true, reason: dialogResult.reason };
  }
  
  // ── Layer 7: Error page detection ──
  const errorResult = await detectErrorPage(page);
  if (errorResult.isError) {
    // Error pages are logged but not blocking (they're handled by page validators)
    // Exception: if we're on a totally blank page, that's suspicious
    if (errorResult.reason.includes('blank')) {
      return { isChallenge: true, reason: errorResult.reason };
    }
  }

  return { isChallenge: false };
}

/**
 * Validate that we're on a profile page with the expected username
 */
async function validateProfilePage(page, expectedUsername) {
  try {
    const url = page.url();
    
    // Check for "Profile/Page not available" or similar messages
    const isUnavailable = await page.evaluate(() => {
        const text = document.body?.innerText?.toLowerCase() || '';
        const patterns = [
            'cette page n\'est pas disponible',
            'cette page n\'est malheureusement pas disponible',
            'page a été supprimée',
            'profile n\u2019est pas disponible',
            'profile is not available',
            'sorry, this page isn\'t available',
            'this page isn\'t available',
            'le lien que vous avez suivi est peut-être rompu',
            'lien est peut-être brisé',
            'link you followed may be broken',
            'link may be broken',
            'page introuvable',
            'page not found',
            'contenu n\'est pas disponible',
            'content isn\'t available'
        ];
        return patterns.some(p => text.includes(p));
    });

    if (isUnavailable) {
        return { valid: false, reason: 'Profile unavailable (blocked/deleted)', isFatal: true };
    }

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
      
      // If it's a fatal error (like profile unavailable), do not block
      if (validationResult.isFatal) {
          console.log('   ⚠️ Erreur fatale détectée (profil indisponible), non-bloquant.');
          result.success = false;
          result.reason = validationResult.reason;
          result.blocked = false;
          return result;
      }

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
  try {
    const result = await verifyPage(page, { expectedType: 'any', blockOnFailure: true });
    return !result.success;
  } catch (err) {
    if (err.message === 'CAPTCHA_NON_INTERACTIVE') {
      // Page might just be slow to load — wait and retry before concluding it's a real challenge
      console.log(`   ⏳ Page may still be loading — waiting 5s before retrying...`);
      await new Promise(r => setTimeout(r, 5000));
      try {
        const retryResult = await verifyPage(page, { expectedType: 'any', blockOnFailure: false });
        if (retryResult.success) {
          console.log(`   ✅ Page loaded after retry — no challenge`);
          return false;
        }
      } catch (e) { /* ignore */ }
      console.log(`   ⚠️ CAPTCHA detected in non-interactive mode — treating as challenge`);
      return true;
    }
    throw err;
  }
}
