/**
 * Shared Instagram Selectors
 *
 * Centralized selectors for Instagram UI elements used across agents.
 * Update these when Instagram changes their DOM structure.
 */

/**
 * Contact/Message button selectors on profile pages
 * Ordered by specificity (most specific first)
 */
export const CONTACT_BUTTON = [
  // Scoped to profile header (preferred)
  'main header div[role="button"]:has-text("Contacter")',
  'main header div[role="button"]:has-text("Message")',
  'main header button:has-text("Contacter")',
  'main header button:has-text("Message")',
  // Fallback within main content
  'main div[role="button"]:has-text("Contacter")',
  'main div[role="button"]:has-text("Message")',
  'main button:has-text("Contacter")',
  'main button:has-text("Message")'
];

/**
 * Message input field selectors in DM view
 */
export const MESSAGE_INPUT = [
  'div[contenteditable="true"][role="textbox"]',
  'div[aria-label*="message" i][contenteditable="true"]',
  'div[aria-label*="Message" i][contenteditable="true"]',
  'div[aria-placeholder*="message" i][contenteditable="true"]',
  'div[data-lexical-editor="true"]'
];

/**
 * Send button selectors in DM view
 */
export const SEND_BUTTON = [
  'button[type="submit"]',
  'div[role="button"]:has-text("Send")',
  'div[role="button"]:has-text("Envoyer")'
];

/**
 * Challenge/verification detection selectors
 */
export const CHALLENGE_INDICATOR = 'form[id*="challenge"]';

/**
 * Profile "not found" text patterns
 */
export const PROFILE_NOT_FOUND = [
  'text=/sorry, this page/i',
  'text=/cette page n\'est pas disponible/i',
  'text=/page not available/i'
];

/**
 * Private account detection patterns
 */
export const PRIVATE_ACCOUNT_TEXT = [
  'this account is private',
  'ce compte est privé',
  'compte privé'
];

/**
 * Following button selectors (to check if already following private account)
 */
export const FOLLOWING_BUTTON = [
  'button:has-text("Following")',
  'button:has-text("Abonné(e)")'
];

/**
 * Cookie popup selectors (various languages)
 */
export const COOKIE_POPUP = [
  'button:has-text("Allow all cookies")',
  'button:has-text("Autoriser tous les cookies")',
  'button:has-text("Autoriser les cookies essentiels")',
  'button:has-text("Accept")',
  'button:has-text("Accepter")',
  'button:has-text("Allow essential and optional cookies")',
  '[role="dialog"] button:has-text("Allow")',
  '[role="dialog"] button:has-text("Autoriser")'
];

/**
 * All selectors grouped for convenience
 */
export const SELECTORS = {
  CONTACT_BUTTON,
  MESSAGE_INPUT,
  SEND_BUTTON,
  CHALLENGE_INDICATOR,
  PROFILE_NOT_FOUND,
  PRIVATE_ACCOUNT_TEXT,
  FOLLOWING_BUTTON,
  COOKIE_POPUP
};

export default SELECTORS;
