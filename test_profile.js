import { chromium } from 'playwright';
import path from 'path';

// Define profile path explicitly
const profilePath = '/Users/louis/opencode/instagram-lead-engine/browser-data/browser-data-melanie';

console.log(`Trying to open browser with profile: ${profilePath}`);

try {
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'] // Simplified args
  });
  
  const page = await context.newPage();
  await page.goto('https://www.instagram.com/');
  console.log('✅ Success! Browser opened without crash.');
  
  // Wait 10s then close
  setTimeout(async () => {
    await context.close();
    console.log('Browser closed cleanly.');
  }, 10000);
  
} catch (e) {
  console.error('❌ Failed to open browser:', e.message);
}
