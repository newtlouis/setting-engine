/**
 * Debug script v2 - NO ARTICLE DEPENDENCY
 * Searches the ENTIRE page for comment-like structures
 * 
 * Usage: node debug-comments-v2.js <post-url>
 */

import { chromium } from 'playwright';
import { createInterface } from 'readline';
import { writeFileSync } from 'fs';

const postUrl = process.argv[2] || 'https://www.instagram.com/p/DP82LJBCAzq/';

console.log('🔍 ULTRA-DEEP Instagram Comment Inspector v2');
console.log(`📱 Post: ${postUrl}\n`);

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

console.log('\n⏳ Step 2: Loading post...');
await page.goto(postUrl, {
  waitUntil: 'domcontentloaded',
  timeout: 60000
});
await page.waitForTimeout(5000);

console.log('⏳ Step 3: Scrolling and loading comments...');
for (let i = 0; i < 10; i++) {
  await page.evaluate(() => {
    window.scrollBy({ top: 200, behavior: 'smooth' });
  });
  await page.waitForTimeout(800);
}

// Click all "view more" type buttons
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"]'));
  buttons.forEach(btn => {
    const text = btn.textContent.toLowerCase();
    if (text.includes('view') || text.includes('more') || text.includes('comment') || 
        text.includes('repl') || text.includes('voir') || text.includes('afficher')) {
      try { btn.click(); } catch(e) {}
    }
  });
});
await page.waitForTimeout(3000);

console.log('⏳ Step 4: Deep page analysis...\n');

const deepAnalysis = await page.evaluate(() => {
  const results = {
    pageStructure: {},
    allProfileLinks: [],
    suspiciousTexts: [],
    groupedElements: [],
    recommendations: []
  };

  // 1. Check for article tag
  results.pageStructure.hasArticle = !!document.querySelector('article');
  results.pageStructure.hasMain = !!document.querySelector('main');
  results.pageStructure.totalDivs = document.querySelectorAll('div').length;
  results.pageStructure.totalSpans = document.querySelectorAll('span').length;

  // 2. Find ALL profile links in entire page
  const allLinks = document.querySelectorAll('a[href]');
  allLinks.forEach((a, idx) => {
    const href = a.getAttribute('href') || '';
    const text = a.textContent.trim();
    
    // Profile pattern: /username (not /p/, /reel/, etc.)
    if (href.match(/^\/[a-zA-Z0-9._]+\/?$/) && text.length > 0 && text.length < 30) {
      // Find parent context
      let parent = a.parentElement;
      let depth = 0;
      const parentChain = [];
      
      while (parent && depth < 3) {
        parentChain.push({
          tag: parent.tagName.toLowerCase(),
          classes: parent.className.substring(0, 80),
          textLength: parent.textContent.trim().length
        });
        parent = parent.parentElement;
        depth++;
      }
      
      results.allProfileLinks.push({
        index: idx,
        username: text,
        href: href,
        parentChain: parentChain,
        parentText: a.parentElement?.textContent.trim().substring(0, 200) || ''
      });
    }
  });

  // 3. Find text nodes that might be comments
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        const text = node.textContent.trim();
        // Substantial text only
        if (text.length < 15 || text.length > 500) return NodeFilter.FILTER_REJECT;
        
        // Not code/JSON
        if (text.includes('{') && text.includes('"require"')) return NodeFilter.FILTER_REJECT;
        if (text.includes('__d(') || text.includes('require(')) return NodeFilter.FILTER_REJECT;
        
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let textNode;
  const uiWords = ['like', 'reply', 'follow', 'share', 'save', 'more options', 'verified', 'sponsored'];
  
  while (textNode = walker.nextNode()) {
    const text = textNode.textContent.trim();
    const lower = text.toLowerCase();
    
    // Skip pure UI text
    if (uiWords.includes(lower)) continue;
    if (/^\d+\s*(h|d|w|m|s|hour|day|week|month|min)/.test(lower)) continue;
    
    const parent = textNode.parentElement;
    if (parent) {
      results.suspiciousTexts.push({
        text: text,
        parentTag: parent.tagName.toLowerCase(),
        parentClass: parent.className.substring(0, 80),
        hasLinkNearby: !!parent.querySelector('a') || !!parent.parentElement?.querySelector('a')
      });
    }
  }

  // 4. Try to group username + text pairs
  // Look for divs that contain both a profile link and substantial text
  const allDivs = document.querySelectorAll('div');
  const candidates = [];
  
  allDivs.forEach(div => {
    const links = div.querySelectorAll('a[href]');
    const profileLink = Array.from(links).find(a => {
      const href = a.getAttribute('href') || '';
      return href.match(/^\/[a-zA-Z0-9._]+\/?$/);
    });
    
    if (profileLink) {
      const divText = div.textContent.trim();
      const username = profileLink.textContent.trim();
      
      // If div has username + more text, it might be a comment
      if (divText.length > username.length + 10 && divText.length < 1000) {
        // Extract just the comment text (remove username)
        let commentText = divText.replace(username, '').trim();
        
        // Clean up common UI text
        commentText = commentText.replace(/^(Reply|Like|View replies|·|\d+\s*h|\d+\s*d)\s*/gi, '').trim();
        
        if (commentText.length > 5) {
          candidates.push({
            username: username,
            profileHref: profileLink.getAttribute('href'),
            commentText: commentText.substring(0, 300),
            divDepth: div.querySelectorAll('*').length,
            hasTime: !!div.querySelector('time'),
            divClasses: div.className.substring(0, 100)
          });
        }
      }
    }
  });
  
  results.groupedElements = candidates.slice(0, 20);

  // 5. Generate recommendations
  if (results.groupedElements.length > 0) {
    results.recommendations.push('✅ Found comment-like structures!');
    results.recommendations.push(`Found ${results.groupedElements.length} username+text pairs`);
  } else {
    results.recommendations.push('⚠️  No obvious comment structures found');
    results.recommendations.push('Possible reasons:');
    results.recommendations.push('  - Comments not loaded (need more scrolling)');
    results.recommendations.push('  - Shadow DOM (inspect manually)');
    results.recommendations.push('  - API-only loading (intercept network)');
  }

  return results;
});

// Save results
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputFile = `./debug-v2-output-${timestamp}.json`;
writeFileSync(outputFile, JSON.stringify(deepAnalysis, null, 2));

console.log('═'.repeat(80));
console.log('📊 PAGE STRUCTURE');
console.log('═'.repeat(80));
console.log(`Has <article>: ${deepAnalysis.pageStructure.hasArticle}`);
console.log(`Has <main>: ${deepAnalysis.pageStructure.hasMain}`);
console.log(`Total <div>s: ${deepAnalysis.pageStructure.totalDivs}`);
console.log(`Total <span>s: ${deepAnalysis.pageStructure.totalSpans}`);

console.log('\n' + '═'.repeat(80));
console.log(`🔗 PROFILE LINKS FOUND: ${deepAnalysis.allProfileLinks.length}`);
console.log('═'.repeat(80));

deepAnalysis.allProfileLinks.slice(0, 10).forEach((link, i) => {
  console.log(`\n[${i + 1}] @${link.username} → ${link.href}`);
  console.log(`    Parent chain: ${link.parentChain.map(p => p.tag).join(' > ')}`);
  console.log(`    Context: "${link.parentText}"`);
});

console.log('\n' + '═'.repeat(80));
console.log(`💬 COMMENT CANDIDATES: ${deepAnalysis.groupedElements.length}`);
console.log('═'.repeat(80));

if (deepAnalysis.groupedElements.length > 0) {
  deepAnalysis.groupedElements.slice(0, 10).forEach((elem, i) => {
    console.log(`\n[${i + 1}] @${elem.username}`);
    console.log(`    Comment: "${elem.commentText}"`);
    console.log(`    Has time: ${elem.hasTime}`);
    console.log(`    Div depth: ${elem.divDepth} elements`);
    console.log(`    Classes: ${elem.divClasses}`);
  });
} else {
  console.log('\n⚠️  NO COMMENT CANDIDATES FOUND');
}

console.log('\n' + '═'.repeat(80));
console.log(`📝 SUSPICIOUS TEXT NODES: ${deepAnalysis.suspiciousTexts.length}`);
console.log('═'.repeat(80));

deepAnalysis.suspiciousTexts.slice(0, 10).forEach((txt, i) => {
  console.log(`\n[${i + 1}] "${txt.text}"`);
  console.log(`    Parent: <${txt.parentTag}> ${txt.parentClass}`);
  console.log(`    Has link nearby: ${txt.hasLinkNearby}`);
});

console.log('\n' + '═'.repeat(80));
console.log('💡 RECOMMENDATIONS');
console.log('═'.repeat(80));
deepAnalysis.recommendations.forEach(rec => console.log(`   ${rec}`));

console.log(`\n💾 Full report: ${outputFile}`);
console.log('\n🌐 Browser stays open - inspect elements manually (F12)');
console.log('Press Ctrl+C when done.\n');

await new Promise(() => {});
