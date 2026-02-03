/**
 * Username Value Object
 *
 * Represents a valid Instagram username.
 * Provides validation and normalization.
 */

// Instagram username rules: 1-30 chars, alphanumeric + underscores + periods, no consecutive periods
const USERNAME_REGEX = /^[a-zA-Z0-9._]{1,30}$/;
const CONSECUTIVE_PERIODS_REGEX = /\.\./;

/**
 * Validate an Instagram username
 * @param {string} username
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    return { valid: false, error: 'Username is required' };
  }

  const trimmed = username.trim();

  if (trimmed.length === 0) {
    return { valid: false, error: 'Username cannot be empty' };
  }

  if (trimmed.length > 30) {
    return { valid: false, error: 'Username cannot exceed 30 characters' };
  }

  if (!USERNAME_REGEX.test(trimmed)) {
    return { valid: false, error: 'Username can only contain letters, numbers, underscores, and periods' };
  }

  if (CONSECUTIVE_PERIODS_REGEX.test(trimmed)) {
    return { valid: false, error: 'Username cannot contain consecutive periods' };
  }

  if (trimmed.startsWith('.') || trimmed.endsWith('.')) {
    return { valid: false, error: 'Username cannot start or end with a period' };
  }

  return { valid: true };
}

/**
 * Check if username is valid
 * @param {string} username
 * @returns {boolean}
 */
export function isValidUsername(username) {
  return validateUsername(username).valid;
}

/**
 * Normalize username (remove @ prefix, trim, lowercase)
 * @param {string} username
 * @returns {string}
 */
export function normalizeUsername(username) {
  if (!username || typeof username !== 'string') {
    return '';
  }

  let normalized = username.trim();

  // Remove @ prefix if present
  if (normalized.startsWith('@')) {
    normalized = normalized.slice(1);
  }

  // Instagram usernames are case-insensitive
  return normalized.toLowerCase();
}

/**
 * Extract username from Instagram URL
 * @param {string} url
 * @returns {string|null}
 */
export function extractUsernameFromUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  // Match instagram.com/username or instagram.com/username/
  const match = url.match(/instagram\.com\/([a-zA-Z0-9._]+)\/?(?:\?|$|\/)/);
  if (match && match[1]) {
    const username = match[1].toLowerCase();
    // Exclude known Instagram paths
    const reserved = ['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'tv'];
    if (!reserved.includes(username)) {
      return username;
    }
  }

  return null;
}

/**
 * Build profile URL from username
 * @param {string} username
 * @returns {string}
 */
export function buildProfileUrl(username) {
  const normalized = normalizeUsername(username);
  return `https://www.instagram.com/${normalized}/`;
}

/**
 * Build DM URL from username
 * @param {string} username
 * @returns {string}
 */
export function buildDmUrl(username) {
  const normalized = normalizeUsername(username);
  return `https://www.instagram.com/direct/t/${normalized}/`;
}
