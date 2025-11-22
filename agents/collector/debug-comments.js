/**
 * Debug script to inspect Instagram comment structure
 * 
 * Usage: node debug-comments.js <post-url>
 */

import { chromium } from 'playwright';
import { createInterface } from 'readline';

const postUrl = process.argv[2] || 'https://www.instagram.com/p/DP82LJBCAzq/';

console.log('🔍 Inspecting Instagram post structure...');
console.log(`📱 Post: ${postUrl}\n`);

const browser = await chromium.launch({
  headless: false,
  slowMo: 500
});

const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
});

const page = await context.newPage();

console.log('⏳ Waiting for manual login...');
console.log('Please login and navigate to the post, then press Enter here...\n');

await page.goto('https://www.instagram.com/accounts/login/', {
  waitUntil: 'domcontentloaded',
  timeout: 60000
});

// Wait for user input
await new Promise((resolve) => {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.question('', () => {
    rl.close();
    resolve();
  });
});

console.log('\n✅ Continuing...\n');

// Navigate to post
await page.goto(postUrl, {
  waitUntil: 'domcontentloaded',
  timeout: 60000
});

await page.waitForTimeout(3000);

// Scroll to comments
await page.evaluate(() => {
  window.scrollBy({ top: 500, behavior: 'smooth' });
});
await page.waitForTimeout(2000);

console.log('📊 Analyzing page structure...\n');

// Try to find comment-like elements
const analysis = await page.evaluate(() => {
  const results = {
    selectors: {},
    structure: {}
  };

  // Test various selectors
  const selectorsToTry = [
    'article ul li[role="menuitem"]',
    'article ul li',
    'ul ul li',
    'article div[role="button"]',
    'article span[dir="auto"]',
    'div[role="button"] span',
    'ul li span',
    'article section',
    'article > div > div',
    'div[style*="flex"]'
  ];

  selectorsToTry.forEach(selector => {
    const elements = document.querySelectorAll(selector);
    results.selectors[selector] = {
      count: elements.length,
      sample: elements.length > 0 ? elements[0].textContent.substring(0, 100) : null
    };
  });

  // Find all elements with significant text in article
  const article = document.querySelector('article');
  if (article) {
    const allElements = article.querySelectorAll('*');
    const textElements = Array.from(allElements)
      .filter(el => {
        const text = el.textContent.trim();
        return text.length > 10 && text.length < 500 && 
               !el.querySelector('*')?.textContent?.includes(text);
      })
      .slice(0, 20);

    results.structure.textElements = textElements.map(el => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      class: el.className,
      text: el.textContent.substring(0, 80),
      parent: el.parentElement?.tagName.toLowerCase(),
      hasLink: !!el.querySelector('a')
    }));
  }

  // Look for username patterns
  const links = Array.from(document.querySelectorAll('article a[href*="/"]'));
  results.structure.userLinks = links.slice(0, 10).map(a => ({
    href: a.href,
    text: a.textContent,
    parent: a.parentElement?.tagName.toLowerCase()
  }));

  return results;
});

console.log('═'.repeat(60));
console.log('SELECTOR TEST RESULTS');
console.log('═'.repeat(60));

Object.entries(analysis.selectors).forEach(([selector, data]) => {
  if (data.count > 0) {
    console.log(`\n✅ ${selector}`);
    console.log(`   Count: ${data.count}`);
    console.log(`   Sample: "${data.sample}"`);
  } else {
    console.log(`\n❌ ${selector} - No elements found`);
  }
});

console.log('\n' + '═'.repeat(60));
console.log('TEXT ELEMENTS IN ARTICLE');
console.log('═'.repeat(60));

if (analysis.structure.textElements && analysis.structure.textElements.length > 0) {
  analysis.structure.textElements.forEach((elem, i) => {
    console.log(`\n[${i + 1}] <${elem.tag}> ${elem.role ? `role="${elem.role}"` : ''}`);
    console.log(`    Parent: ${elem.parent}`);
    console.log(`    Has link: ${elem.hasLink}`);
    console.log(`    Text: "${elem.text}"`);
  });
} else {
  console.log('No text elements found');
}

console.log('\n' + '═'.repeat(60));
console.log('USER LINKS');
console.log('═'.repeat(60));

if (analysis.structure.userLinks && analysis.structure.userLinks.length > 0) {
  analysis.structure.userLinks.forEach((link, i) => {
    console.log(`\n[${i + 1}] ${link.href}`);
    console.log(`    Text: "${link.text}"`);
    console.log(`    Parent: ${link.parent}`);
  });
}

console.log('\n' + '═'.repeat(60));
console.log('\n💡 RECOMMENDATIONS:');
console.log('Look for selectors with multiple elements that contain comment-like text.');
console.log('The parent tags and structure will help identify the right selector.\n');

console.log('Browser will stay open for manual inspection.');
console.log('Check DevTools to inspect comment elements directly.');
console.log('Press Ctrl+C to exit.\n');

// Keep browser open
await new Promise(() => {});
