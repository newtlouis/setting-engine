/**
 * Browser Interactions Module
 *
 * Human-like typing, navigation with retry, and delay utilities.
 * Consolidated from utils.js and dm_sender.js.
 */

/**
 * Delay execution
 *
 * @param {number} ms - Milliseconds to delay (or min if max provided)
 * @param {number} [max] - Optional max for random delay
 */
export async function delay(ms, max = null) {
  if (max !== null) {
    // Random delay between ms and max
    const delayTime = Math.floor(Math.random() * (max - ms + 1)) + ms;
    return new Promise(resolve => setTimeout(resolve, delayTime));
  }
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Paste text instantly into an input field (fast mode)
 * Uses clipboard to paste instead of typing character by character
 *
 * @param {Page} page - Playwright page object
 * @param {string} text - Text to paste
 */
export async function typeFast(page, text) {
  // Split by newlines, insertText each line, Shift+Enter for line breaks
  // This handles contenteditable (Instagram DM) correctly
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 0) {
      await page.evaluate((line) => {
        document.execCommand('insertText', false, line);
      }, lines[i]);
    }
    if (i < lines.length - 1) {
      await page.keyboard.press('Shift+Enter');
    }
  }
  await delay(100, 200);
}

/**
 * Type text into an input field in a human-like manner
 * Unified implementation from dm_sender.js (best version with emoji support)
 *
 * @param {Page} page - Playwright page object
 * @param {string} text - Text to type (the input should already be focused)
 * @param {Object} [options] - Optional configuration
 * @param {boolean} [options.focusSelector] - Selector to focus before typing
 */
export async function typeHumanLike(page, text, options = {}) {
  if (options.focusSelector) {
    await page.focus(options.focusSelector);
    await delay(Math.random() * 500 + 200);
  }

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

  // Final pause after finishing
  if (options.focusSelector) {
    await delay(Math.random() * 500 + 200);
  }
}

/**
 * Type into a specific selector with human-like behavior
 * Wrapper that focuses the selector first
 *
 * @param {Page} page - Playwright page object
 * @param {string} selector - Selector for the input field
 * @param {string} text - Text to type
 */
export async function typeIntoSelector(page, selector, text) {
  await typeHumanLike(page, text, { focusSelector: selector });
}

/**
 * Navigate with retry logic for resilience against temporary blocks or network issues
 *
 * @param {Page} page - Playwright page object
 * @param {string} url - URL to navigate to
 * @param {Object} [options] - Navigation options
 * @param {number} [maxRetries=2] - Maximum retry attempts
 */
export async function gotoWithRetry(page, url, options = {}, maxRetries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const waitTime = attempt * 5000;
        console.log(`   ⏳ Retry attempt ${attempt}/${maxRetries} in ${waitTime / 1000}s...`);
        await delay(waitTime);
      }
      return await page.goto(url, options);
    } catch (error) {
      lastError = error;
      console.log(`   ⚠️  Navigation attempt ${attempt + 1} failed: ${error.message}`);

      // If it's a specific "Response code failure" or interrupted navigation, we definitely want to retry
      const shouldRetry = error.message.includes('ERR_HTTP_RESPONSE_CODE_FAILURE') ||
                          error.message.includes('interrupted') ||
                          error.message.includes('timeout');

      if (!shouldRetry || attempt === maxRetries) break;
    }
  }
  throw lastError;
}
