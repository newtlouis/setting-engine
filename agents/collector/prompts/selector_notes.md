# Instagram Selector Notes

This document tracks Instagram's DOM structure for scraping purposes.

## Last Updated
2024-01-15

## Current Selectors

### Post Discovery
- **Post links in hashtag/profile grid**: `article a[href*="/p/"], article a[href*="/reel/"]`
  - Posts use `/p/` path
  - Reels use `/reel/` path
  - Located within `<article>` tags

### Post Page
- **Caption**: `article h1`
  - The main caption is typically in the first `<h1>` within the article
  
- **Likes count**: `section a[href$="/liked_by/"] span` or `section span:has-text("likes")`
  - Likes link ends with `/liked_by/`
  - Text format: "1,234 likes"

- **Load more comments button**: `button:has-text("View more comments")` or `button:has-text("more comments")`
  - Text varies by locale
  - May also appear as "View all X comments"

### Comments
- **Comment list items**: `article ul li[role="menuitem"]`
  - Each comment is a `<li>` with role="menuitem"
  
- **Comment username**: `a[role="link"]` (within comment item)
  - First link in the comment item
  
- **Comment text**: `span` (multiple spans, need to filter for content)
  
- **Comment timestamp**: `time[datetime]`
  - Contains ISO datetime in `datetime` attribute

## Known Issues

1. **Dynamic loading**: Instagram uses infinite scroll and lazy loading. Selectors may not find elements until scrolling.

2. **Login walls**: Logged-out users see limited content. Always require manual login.

3. **Rate limiting**: Instagram throttles requests. Use randomized delays (3-7 seconds).

4. **Challenge pages**: Instagram may show challenge/verification pages. Detect by URL pattern `/challenge/` or text content.

5. **Locale variations**: Button text and number formats vary by user locale.

## Update Strategy

When Instagram updates their UI:

1. Open browser DevTools on instagram.com
2. Inspect the target element (post link, comment, etc.)
3. Find unique, stable attributes (avoid generated class names like `_aacl`)
4. Prefer semantic selectors: `role`, `aria-label`, element types
5. Update `src/config.js` SELECTORS object
6. Update this document with change notes

## Selector Stability Tips

- ✅ **Use**: semantic HTML (article, section, time), role attributes, href patterns
- ❌ **Avoid**: generated CSS classes (e.g., `_a1b2c`), deeply nested paths, exact text matching

## Testing Selectors

Use browser console to test:

```javascript
// Test post links
document.querySelectorAll('article a[href*="/p/"]')

// Test comments
document.querySelectorAll('article ul li[role="menuitem"]')
```

## Backup Strategies

If primary selectors fail:

1. **Post links**: Search for `<a>` tags with href containing `/p/` or `/reel/`
2. **Comments**: Look for `<ul>` within `<article>`, then iterate `<li>` children
3. **Caption**: Check `<meta property="og:description">` as fallback
4. **Likes**: Parse from `<meta>` tags or search for text pattern `/\d+ likes/`
