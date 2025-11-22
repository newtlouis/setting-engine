/**
 * Quick test script for V5 scraper
 * 
 * Usage: node test-v5.js
 */

import { chromium } from 'playwright';
import { scrapePostComments } from './src/scrape_post_v8.js';
import { createInterface } from 'readline';
import { writeFileSync } from 'fs';

const TEST_POST = 'https://www.instagram.com/p/DP82LJBCAzq/';

console.log('🧪 Testing V8 Comment Scraper (DIV-only structure)');
console.log(`📱 Test post: ${TEST_POST}\n`);

const browser = await chromium.launch({
  headless: false,
  slowMo: 300
});

const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
});

const page = await context.newPage();

console.log('⏳ Step 1: Login to Instagram');
console.log('Please login, then press Enter...\n');

await page.goto('https://www.instagram.com/accounts/login/', {
  waitUntil: 'domcontentloaded',
  timeout: 60000
});

await new Promise((resolve) => {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.question('Press Enter after login: ', () => {
    rl.close();
    resolve();
  });
});

console.log('\n✅ Starting V5 test...\n');

try {
  // Exclude additional usernames if needed (optional, usually not required)
  const excludeUsers = []; // Auto-detection should work now
  const comments = await scrapePostComments(page, TEST_POST, 50, excludeUsers);
  
  console.log('\n' + '═'.repeat(80));
  console.log('📊 TEST RESULTS');
  console.log('═'.repeat(80));
  console.log(`Total comments extracted: ${comments.length}`);
  
  if (comments.length > 0) {
    console.log('\n✅ SUCCESS! Comments extracted:\n');
    
    comments.slice(0, 10).forEach((comment, i) => {
      console.log(`[${i + 1}] @${comment.username}`);
      console.log(`    Comment: "${comment.comment_text}"`);
      console.log(`    Profile: ${comment.profile_url}`);
      console.log(`    Date: ${comment.comment_date || 'N/A'}`);
      console.log('');
    });
    
    if (comments.length > 10) {
      console.log(`... and ${comments.length - 10} more comments\n`);
    }
    
    // Check for issues
    console.log('🔍 Quality check:');
    const hasJSCode = comments.some(c => c.comment_text.includes('{') && c.comment_text.includes('require'));
    const hasUIText = comments.some(c => ['verified', 'more options', 'j\'aime'].includes(c.comment_text.toLowerCase()));
    const hasDuplicates = new Set(comments.map(c => c.username + c.comment_text)).size !== comments.length;
    
    console.log(`   JS code detected: ${hasJSCode ? '❌ YES (bad)' : '✅ NO (good)'}`);
    console.log(`   UI text detected: ${hasUIText ? '❌ YES (bad)' : '✅ NO (good)'}`);
    console.log(`   Duplicates: ${hasDuplicates ? '⚠️  YES' : '✅ NO (good)'}`);
    
    // Save to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFile = `./test-v5-results-${timestamp}.json`;
    writeFileSync(outputFile, JSON.stringify(comments, null, 2));
    console.log(`\n💾 Full results saved to: ${outputFile}`);
    
  } else {
    console.log('❌ FAILED: No comments extracted');
    console.log('\nPossible reasons:');
    console.log('  1. No comments on this post');
    console.log('  2. Comments not loaded (need more scroll time)');
    console.log('  3. Instagram changed class names');
    console.log('  4. Bot detection preventing comment display');
    console.log('\n💡 Try inspecting the page manually to verify comments are visible');
  }
  
} catch (error) {
  console.error('\n❌ ERROR during test:', error.message);
  console.error(error.stack);
} finally {
  console.log('\n🌐 Browser will stay open for manual inspection.');
  console.log('Press Ctrl+C to exit.\n');
  
  // Keep browser open for inspection
  await new Promise(() => {});
}
