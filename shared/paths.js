import path from 'path';
import { fileURLToPath } from 'url';
import { rmSync, lstatSync, existsSync, unlinkSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root is two levels up from this file (shared/paths.js)
export const PROJECT_ROOT = path.resolve(__dirname, '..');

// Shared browser data directory
export const SHARED_BROWSER_DATA_DIR = path.join(PROJECT_ROOT, 'browser-data');

/**
 * Get the standardized browser data directory for a given profile
 * @param {string} profile - Profile name
 * @returns {string} Absolute path to the profile's browser data directory
 */
export function getBrowserDataDir(profile) {
  const safeProfile = profile || 'anonymous';
  return path.join(SHARED_BROWSER_DATA_DIR, `browser-data-${safeProfile}`);
}

/**
 * Clean up stale Chromium lock files and problematic caches that cause crashes on macOS (SIGTRAP)
 * @param {string} profile - Profile name
 */
export function cleanupBrowserLocks(profile) {
  const userDataDir = getBrowserDataDir(profile);
  
  if (!existsSync(userDataDir)) return;

  const itemsToClean = [
    // Root locks
    'SingletonLock', 
    'SingletonCookie', 
    'SingletonSocket',
    // Sub-locks
    path.join('Default', 'LOCK'),
    path.join('Default', 'GPUCache'),
    path.join('Default', 'Cache'),
    path.join('Default', 'Code Cache'),
    // Global caches
    'GrShaderCache',
    'ShaderCache',
    'GraphiteDawnCache',
    'BrowserMetrics',
    'OriginTrials',
    'Local State'
  ];
  
  // console.log(`🧹 Aggressive cleanup for profile: ${profile}`);
  itemsToClean.forEach(item => {
    const itemPath = path.join(userDataDir, item);
    try {
      // Use lstatSync to detect symlinks (rmSync sometimes fails on broken macOS symlinks)
      const stats = lstatSync(itemPath);
      if (stats.isSymbolicLink()) {
        unlinkSync(itemPath);
      } else {
        rmSync(itemPath, { recursive: true, force: true });
      }
    } catch (err) {
      // Ignore if file doesn't exist or other errors
    }
  });
}

export default {
  PROJECT_ROOT,
  SHARED_BROWSER_DATA_DIR,
  getBrowserDataDir,
  cleanupBrowserLocks
};
