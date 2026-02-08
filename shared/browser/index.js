/**
 * Browser Module Index
 *
 * Re-exports all browser-related functionality.
 */

// Main service
export { BrowserService, BrowserSession } from './BrowserService.js';
export { default } from './BrowserService.js';

// Login handling
export {
  autoLoginInstagram,
  handleCookiePopup,
  isLoggedIn,
  handle2FA,
  dismissPostLoginPopups,
  waitForManualLogin
} from './loginHandler.js';

// Interactions
export {
  delay,
  typeFast,
  typeHumanLike,
  typeIntoSelector,
  gotoWithRetry
} from './interactions.js';
