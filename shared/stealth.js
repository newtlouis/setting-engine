/**
 * Stealth Configuration for Browser Automation
 * 
 * Centralized anti-detection settings used by all agents to reduce
 * the risk of CAPTCHA triggers and bot detection.
 */

// Current Chrome version (update periodically)
const CHROME_VERSION = '131.0.0.0';

/**
 * Up-to-date Chrome User Agent for macOS
 * Update this every few months to match current Chrome releases
 */
export const USER_AGENT = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;

/**
 * Browser launch arguments for stealth mode
 * These help avoid common automation detection vectors
 */
export const STEALTH_ARGS = [
  // Hide automation control flags
  '--disable-blink-features=AutomationControlled',
  
  // Disable features that can leak automation
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-dev-shm-usage',
  
  // Disable first-run behaviors
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-infobars',
  
  // Disable background processes
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  
  // Disable sync and extensions
  '--disable-sync',
  '--disable-extensions',
  
  // Memory and renderer optimizations
  '--renderer-process-limit=1',
  '--disable-gpu-sandbox'
];

/**
 * Realistic viewport sizes (avoid exact 1280x800 which is default)
 * Slight variations make fingerprint more unique
 */
export function getRandomViewport() {
  // Use conservative sizes that fit most laptop screens (MacBooks)
  // while remaining large enough for Instagram's UI to not switch to mobile mode
  const widths = [1200, 1280, 1150, 1100];
  const heights = [800, 750, 850, 700];
  const idx = Math.floor(Math.random() * widths.length);
  return { width: widths[idx], height: heights[idx] };
}

/**
 * Script to inject on every page to hide automation markers
 * Run via page.addInitScript()
 */
export const STEALTH_INIT_SCRIPT = `
  // Hide webdriver property
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true
  });
  
  // Spoof plugins array (empty array is suspicious)
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const plugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        { name: 'Native Client', filename: 'internal-nacl-plugin' }
      ];
      plugins.item = (i) => plugins[i];
      plugins.namedItem = (n) => plugins.find(p => p.name === n);
      plugins.refresh = () => {};
      return plugins;
    },
    configurable: true
  });
  
  // Spoof languages array
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en', 'fr'],
    configurable: true
  });
  
  // Remove Playwright/CDP indicators
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
  
  // Spoof chrome runtime
  window.chrome = {
    runtime: {},
    loadTimes: function() { return {}; },
    csi: function() { return {}; },
    app: {}
  };
  
  // Override permissions query for notifications
  const originalQuery = window.navigator.permissions?.query;
  if (originalQuery) {
    window.navigator.permissions.query = (parameters) => {
      if (parameters.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission });
      }
      return originalQuery(parameters);
    };
  }
`;

/**
 * Default browser context options for all agents
 */
export function getStealthContextOptions(userDataDir, options = {}) {
  const { headless = false, slowMo = 50, timeout = 60000 } = options;
  const viewport = getRandomViewport();
  
  return {
    headless,
    slowMo,
    viewport,
    userAgent: USER_AGENT,
    locale: 'en-US',
    timezoneId: 'Europe/Paris',
    args: STEALTH_ARGS,
    timeout,
    ignoreDefaultArgs: ['--enable-automation'],
    hasTouch: false,
    isMobile: false,
    deviceScaleFactor: 1,
    javaScriptEnabled: true
  };
}

/**
 * Apply stealth init script to a page
 * Call this after creating a new page
 */
export async function applyStealthToPage(page) {
  await page.addInitScript(STEALTH_INIT_SCRIPT);
}

/**
 * Delay utilities with more human-like variance
 */
export function humanDelay(minMs, maxMs) {
  // Add occasional long pauses (5% chance of 2x delay)
  let base = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  if (Math.random() < 0.05) {
    base *= 2;
  }
  return new Promise(resolve => setTimeout(resolve, base));
}

/**
 * Random pause between actions (more generous than before)
 */
export const TIMING = {
  BETWEEN_PROFILES: { min: 15000, max: 45000 },      // 15-45s between profile visits
  BETWEEN_ACTIONS: { min: 2000, max: 5000 },         // 2-5s between clicks
  AFTER_PAGE_LOAD: { min: 3000, max: 6000 },         // 3-6s after page loads
  TYPING_PAUSE: { min: 500, max: 1500 },             // Pauses during typing
  READING_BREAK: { min: 30000, max: 60000 },         // Occasional long "reading" break
  READING_BREAK_CHANCE: 0.1                          // 10% chance of reading break
};

/**
 * Should we take a reading break? (call occasionally)
 */
export function shouldTakeReadingBreak() {
  return Math.random() < TIMING.READING_BREAK_CHANCE;
}
