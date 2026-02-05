import { chromium } from 'playwright';
import { getBrowserDataDir, cleanupBrowserLocks } from './shared/paths.js';
import { getStealthContextOptions, applyStealthToPage } from './shared/stealth.js';

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

console.log('Browser is open. Close it manually or stop this process to exit.');
// Keep process alive
await new Promise(() => {});
