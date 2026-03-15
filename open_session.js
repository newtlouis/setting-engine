import { chromium } from 'playwright';
import dotenv from 'dotenv';
import { getBrowserDataDir, cleanupBrowserLocks } from './shared/paths.js';
import { getStealthContextOptions, applyStealthToPage } from './shared/stealth.js';
import { handleCookiePopup, isLoggedIn, autoLoginInstagram, dismissPostLoginPopups } from './shared/browser/loginHandler.js';
import { getCredentialsForProfile } from './shared/credentials.js';

// Load .env from dmresponder (has most credentials)
dotenv.config({ path: './agents/dmresponder/.env' });

// Support both positional arg and --profile flag (for dashboard compatibility)
const profileFlagIndex = process.argv.indexOf('--profile');
const profile = profileFlagIndex !== -1 ? process.argv[profileFlagIndex + 1] : (process.argv[2] || 'default');
const userDataDir = getBrowserDataDir(profile);

console.log(`Opening Instagram for profile: ${profile}`);
console.log(`User data directory: ${userDataDir}`);

cleanupBrowserLocks(profile);

const stealthOptions = getStealthContextOptions(userDataDir, {
  headless: false,
  slowMo: 50,
});

const browserContext = await chromium.launchPersistentContext(userDataDir, stealthOptions);
const page = await browserContext.newPage();
await applyStealthToPage(page);

await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });

// Wait for page to settle
await page.waitForTimeout(3000);

// Handle cookie popup
await handleCookiePopup(page);

// Check if already logged in, otherwise auto-login
if (await isLoggedIn(page)) {
  console.log('✅ Already logged in!');
} else {
  const creds = getCredentialsForProfile(profile);
  if (creds.username && creds.password) {
    console.log(`🔐 Auto-login with credentials for profile: ${profile}`);
    const success = await autoLoginInstagram(page, creds.username, creds.password);
    if (success) {
      console.log('✅ Login successful!');
    } else {
      console.log('⚠️ Auto-login failed. Please login manually in the browser.');
    }
  } else {
    console.log('⚠️ No credentials found. Please login manually in the browser.');
  }
}

console.log('Browser is open. Close it manually or stop this process to exit.');
// Keep process alive
await new Promise(() => {});
