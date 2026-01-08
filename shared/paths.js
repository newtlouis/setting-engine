import path from 'path';
import { fileURLToPath } from 'url';
import { unlinkSync, lstatSync } from 'fs';

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
 * Clean up stale Chromium lock files that cause crashes on macOS
 * @param {string} profile - Profile name
 */
export function cleanupBrowserLocks(profile) {
  const userDataDir = getBrowserDataDir(profile);
  const locks = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
  
  locks.forEach(lock => {
    const lockPath = path.join(userDataDir, lock);
    try {
      // Check if it exists (lstat to handle symlinks which Chromium uses for locks)
      const stats = lstatSync(lockPath);
      if (stats) {
        console.log(`🧹 Removing stale browser lock: ${lock}`);
        unlinkSync(lockPath);
      }
    } catch (err) {
      // Ignore if not found or other errors
    }
  });
}

export default {
  PROJECT_ROOT,
  SHARED_BROWSER_DATA_DIR,
  getBrowserDataDir,
  cleanupBrowserLocks
};
