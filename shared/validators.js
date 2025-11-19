/**
 * Shared Validation Utilities
 * 
 * Common validation functions used across multiple agents.
 */

/**
 * Validate Instagram username format
 * 
 * @param {string} username - Username to validate
 * @returns {boolean} True if valid
 */
export function isValidUsername(username) {
  // Instagram usernames: 1-30 chars, letters, numbers, periods, underscores
  const usernameRegex = /^[a-zA-Z0-9._]{1,30}$/;
  return usernameRegex.test(username);
}

/**
 * Validate Instagram post URL
 * 
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid Instagram post URL
 */
export function isValidPostURL(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'www.instagram.com' &&
      (parsed.pathname.startsWith('/p/') || parsed.pathname.startsWith('/reel/'))
    );
  } catch {
    return false;
  }
}

/**
 * Validate Instagram profile URL
 * 
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid Instagram profile URL
 */
export function isValidProfileURL(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'www.instagram.com') return false;
    
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    return pathParts.length === 1 && isValidUsername(pathParts[0]);
  } catch {
    return false;
  }
}

/**
 * Validate warmth classification
 * 
 * @param {string} warmth - Warmth value to validate
 * @returns {boolean} True if valid
 */
export function isValidWarmth(warmth) {
  return ['warm', 'cold', 'irrelevant'].includes(warmth);
}

/**
 * Validate lead score
 * 
 * @param {number} score - Score to validate
 * @returns {boolean} True if valid (0-100)
 */
export function isValidScore(score) {
  return typeof score === 'number' && score >= 0 && score <= 100;
}

/**
 * Validate conversation role
 * 
 * @param {string} role - Role to validate
 * @returns {boolean} True if valid
 */
export function isValidRole(role) {
  return ['user', 'assistant'].includes(role);
}

/**
 * Sanitize text for CSV output
 * 
 * @param {string} text - Text to sanitize
 * @returns {string} Sanitized text
 */
export function sanitizeForCSV(text) {
  if (!text) return '';
  
  // Remove newlines and excessive whitespace
  let sanitized = text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  
  // Escape quotes
  sanitized = sanitized.replace(/"/g, '""');
  
  return sanitized;
}

/**
 * Extract username from profile URL
 * 
 * @param {string} url - Instagram profile URL
 * @returns {string|null} Username or null if invalid
 */
export function extractUsername(url) {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    
    if (pathParts.length === 1 && isValidUsername(pathParts[0])) {
      return pathParts[0];
    }
  } catch {
    return null;
  }
  
  return null;
}

/**
 * Validate ISO 8601 date string
 * 
 * @param {string} dateString - Date string to validate
 * @returns {boolean} True if valid
 */
export function isValidISODate(dateString) {
  if (!dateString) return false;
  
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
}
