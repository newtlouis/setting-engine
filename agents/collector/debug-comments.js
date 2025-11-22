/**
 * Debug script to inspect Instagram comment structure - ENHANCED VERSION
 * 
 * Usage: node debug-comments.js <post-url>
 */

import { chromium } from 'playwright';
import { createInterface } from 'readline';
import { writeFileSync } from 'fs';

const postUrl = process.argv[2] || 'https://www.instagram.com/p/DP82LJBCAzq/';

console.log('🔍 ENHANCED Instagram Structure Inspector');
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

console.log('⏳ Waiting for manual login...');
console.log('Please login, navigate to the post, and SCROLL to see comments');
console.log('Then press Enter here...\n');

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
  rl.question('Press Enter when ready: ', () => {
    rl.close();
    resolve();
  });
});

console.log('\n✅ Starting analysis...\n');

// Navigate to post
await page.goto(postUrl, {
  waitUntil: 'domcontentloaded',
  timeout: 60000
});

await page.waitForTimeout(3000);

// Aggressive scrolling to load comments
console.log('📜 Scrolling to load comments...');
for (let i = 0; i < 5; i++) {
  await page.evaluate(() => {
    window.scrollBy({ top: 300, behavior: 'smooth' });
  });
  await page.waitForTimeout(1000);
}

// Try to click "View more comments" buttons
console.log('🔘 Clicking "View more" buttons...');
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
  buttons.forEach(btn => {
    const text = btn.textContent.toLowerCase();
    if (text.includes('view') || text.includes('more') || text.includes('comment') || text.includes('repl')) {
      try { btn.click(); } catch(e) {}
    }
  });
});
await page.waitForTimeout(2000);

console.log('📊 Running deep analysis...\n');

// ENHANCED: Deep analysis with DOM tree inspection
const analysis = await page.evaluate(() => {
  const results = {
    selectors: {},
    structure: {},
    commentCandidates: [],
    domTree: {},
    scripts: []
  };

  // Test comprehensive selectors
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
    'div[style*="flex"]',
    // NEW: More specific comment selectors
    'article ul[style*="padding"] > div > li',
    'article ul[style*="padding"] li',
    'ul[role="list"] li',
    'div[role="presentation"] ul li',
    'li[class*="comment"]',
    'div[class*="comment"]',
    '[data-comment-id]',
    '[data-testid*="comment"]'
  ];

  selectorsToTry.forEach(selector => {
    try {
      const elements = document.querySelectorAll(selector);
      results.selectors[selector] = {
        count: elements.length,
        samples: Array.from(elements).slice(0, 3).map(el => ({
          text: el.textContent.substring(0, 100),
          classes: el.className,
          hasLink: !!el.querySelector('a'),
          innerHTML: el.innerHTML.substring(0, 200)
        }))
      };
    } catch(e) {
      results.selectors[selector] = { error: e.message };
    }
  });

  // Find article element and analyze its structure
  const article = document.querySelector('article');
  if (article) {
    // Get all UL elements in article
    const uls = article.querySelectorAll('ul');
    results.structure.ulElements = Array.from(uls).map((ul, idx) => {
      const liCount = ul.querySelectorAll('li').length;
      const hasLinks = ul.querySelectorAll('a').length;
      const style = ul.getAttribute('style') || '';
      return {
        index: idx,
        liCount: liCount,
        linkCount: hasLinks,
        style: style.substring(0, 100),
        firstLiText: ul.querySelector('li')?.textContent.substring(0, 100) || 'N/A',
        classes: ul.className
      };
    });

    // NEW: Find elements that look like username + comment pairs
    const allDivs = article.querySelectorAll('div');
    results.commentCandidates = Array.from(allDivs)
      .filter(div => {
        const links = div.querySelectorAll('a');
        const hasProfileLink = Array.from(links).some(a => {
          const href = a.getAttribute('href') || '';
          return href.startsWith('/') && !href.includes('/p/') && href.length < 50;
        });
        const text = div.textContent.trim();
        return hasProfileLink && text.length > 20 && text.length < 1000;
      })
      .slice(0, 10)
      .map(div => {
        const link = Array.from(div.querySelectorAll('a')).find(a => {
          const href = a.getAttribute('href') || '';
          return href.startsWith('/') && !href.includes('/p/');
        });
        
        return {
          username: link?.textContent || 'N/A',
          profileHref: link?.getAttribute('href') || 'N/A',
          fullText: div.textContent.substring(0, 200),
          tag: div.tagName.toLowerCase(),
          classes: div.className,
          parent: div.parentElement?.tagName.toLowerCase(),
          hasTime: !!div.querySelector('time'),
          childCount: div.children.length
        };
      });
  }

  // NEW: Detect script tags with data
  const scriptTags = document.querySelectorAll('script[type="application/json"]');
  results.scripts = Array.from(scriptTags).slice(0, 3).map(script => ({
    id: script.id,
    length: script.textContent.length,
    preview: script.textContent.substring(0, 100)
  }));

  // Look for username links
  const links = Array.from(document.querySelectorAll('article a[href*="/"]'))
    .filter(a => {
      const href = a.getAttribute('href') || '';
      return href.startsWith('/') && !href.includes('/p/') && !href.includes('/reel/');
    });
  
  results.structure.userLinks = links.slice(0, 15).map((a, idx) => {
    const parent = a.parentElement;
    const grandparent = parent?.parentElement;
    
    return {
      index: idx,
      href: a.getAttribute('href'),
      text: a.textContent,
      parentTag: parent?.tagName.toLowerCase(),
      parentClass: parent?.className.substring(0, 50),
      grandparentTag: grandparent?.tagName.toLowerCase(),
      nearbyText: parent?.textContent.substring(0, 150)
    };
  });

  return results;
});

// Save full analysis to JSON file
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputFile = `./debug-output-${timestamp}.json`;
writeFileSync(outputFile, JSON.stringify(analysis, null, 2));
console.log(`💾 Full analysis saved to: ${outputFile}\n`);

console.log('═'.repeat(80));
console.log('🎯 SELECTOR TEST RESULTS');
console.log('═'.repeat(80));

Object.entries(analysis.selectors).forEach(([selector, data]) => {
  if (data.error) {
    console.log(`\n⚠️  ${selector} - ERROR: ${data.error}`);
  } else if (data.count > 0) {
    console.log(`\n✅ ${selector}`);
    console.log(`   Count: ${data.count}`);
    if (data.samples && data.samples.length > 0) {
      data.samples.forEach((sample, i) => {
        console.log(`   Sample ${i + 1}:`);
        console.log(`      Text: "${sample.text}"`);
        console.log(`      Has link: ${sample.hasLink}`);
        console.log(`      Classes: ${sample.classes.substring(0, 60)}`);
      });
    }
  } else {
    console.log(`\n❌ ${selector} - No elements found`);
  }
});

console.log('\n' + '═'.repeat(80));
console.log('🗂️  UL ELEMENTS IN ARTICLE');
console.log('═'.repeat(80));

if (analysis.structure.ulElements && analysis.structure.ulElements.length > 0) {
  analysis.structure.ulElements.forEach(ul => {
    console.log(`\n[UL ${ul.index}]`);
    console.log(`   LI count: ${ul.liCount}`);
    console.log(`   Link count: ${ul.linkCount}`);
    console.log(`   Style: ${ul.style || 'none'}`);
    console.log(`   Classes: ${ul.classes || 'none'}`);
    console.log(`   First LI text: "${ul.firstLiText}"`);
  });
} else {
  console.log('No UL elements found in article');
}

console.log('\n' + '═'.repeat(80));
console.log('💬 COMMENT CANDIDATES (Username + Text pairs)');
console.log('═'.repeat(80));

if (analysis.commentCandidates && analysis.commentCandidates.length > 0) {
  analysis.commentCandidates.forEach((candidate, i) => {
    console.log(`\n[${i + 1}] ${candidate.username} (@${candidate.profileHref})`);
    console.log(`    Tag: <${candidate.tag}> (${candidate.childCount} children)`);
    console.log(`    Parent: ${candidate.parent}`);
    console.log(`    Has time: ${candidate.hasTime}`);
    console.log(`    Classes: ${candidate.classes.substring(0, 60)}`);
    console.log(`    Full text: "${candidate.fullText}"`);
  });
} else {
  console.log('⚠️  No comment candidates found!');
  console.log('Try scrolling more or checking if comments are visible.');
}

console.log('\n' + '═'.repeat(80));
console.log('🔗 USER PROFILE LINKS');
console.log('═'.repeat(80));

if (analysis.structure.userLinks && analysis.structure.userLinks.length > 0) {
  analysis.structure.userLinks.forEach((link, i) => {
    console.log(`\n[${i + 1}] ${link.text} → ${link.href}`);
    console.log(`    Context: ${link.parentTag} > ${link.grandparentTag}`);
    console.log(`    Parent class: ${link.parentClass}`);
    console.log(`    Nearby: "${link.nearbyText}"`);
  });
}

console.log('\n' + '═'.repeat(80));
console.log('📜 SCRIPT TAGS WITH DATA');
console.log('═'.repeat(80));

if (analysis.scripts && analysis.scripts.length > 0) {
  analysis.scripts.forEach((script, i) => {
    console.log(`\n[${i + 1}] Script ${script.id || 'no-id'}`);
    console.log(`    Length: ${script.length} chars`);
    console.log(`    Preview: ${script.preview}...`);
  });
}

console.log('\n' + '═'.repeat(80));
console.log('💡 ANALYSIS COMPLETE');
console.log('═'.repeat(80));
console.log(`\n📊 Summary:`);
console.log(`   - Comment candidates found: ${analysis.commentCandidates?.length || 0}`);
console.log(`   - User links found: ${analysis.structure.userLinks?.length || 0}`);
console.log(`   - UL elements: ${analysis.structure.ulElements?.length || 0}`);
console.log(`   - Full report: ${outputFile}`);

console.log('\n🌐 Browser will stay open for manual inspection.');
console.log('   → Open DevTools (F12)');
console.log('   → Inspect comment elements');
console.log('   → Compare with analysis above');
console.log('\n   Press Ctrl+C when done.\n');

// Keep browser open
await new Promise(() => {});
