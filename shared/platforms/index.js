/**
 * Platform Registry
 *
 * Factory for creating platform-specific adapters.
 * Supports: Instagram, TikTok (future), LinkedIn (future)
 */

import { Platform } from '../application/ports/IPlatformAdapter.js';
import { createInstagramAdapter } from './instagram/InstagramAdapter.js';

/**
 * Platform adapter cache (singleton per platform)
 */
const adapters = {};

/**
 * Get platform adapter
 *
 * @param {string} platform - Platform identifier ('instagram', 'tiktok', 'linkedin')
 * @returns {IPlatformAdapter}
 */
export function getPlatformAdapter(platform = Platform.INSTAGRAM) {
  const normalizedPlatform = platform.toLowerCase();

  // Return cached adapter if exists
  if (adapters[normalizedPlatform]) {
    return adapters[normalizedPlatform];
  }

  // Create new adapter
  let adapter;

  switch (normalizedPlatform) {
    case Platform.INSTAGRAM:
    case 'ig':
    case 'insta':
      adapter = createInstagramAdapter();
      break;

    case Platform.TIKTOK:
    case 'tt':
      throw new Error('TikTok adapter not yet implemented. Coming soon!');

    case Platform.LINKEDIN:
    case 'li':
      throw new Error('LinkedIn adapter not yet implemented. Coming soon!');

    default:
      throw new Error(`Unknown platform: ${platform}. Supported: instagram, tiktok, linkedin`);
  }

  // Cache and return
  adapters[normalizedPlatform] = adapter;
  return adapter;
}

/**
 * Check if platform is supported
 *
 * @param {string} platform
 * @returns {boolean}
 */
export function isPlatformSupported(platform) {
  const supported = [
    Platform.INSTAGRAM, 'ig', 'insta'
    // Platform.TIKTOK, 'tt',        // Coming soon
    // Platform.LINKEDIN, 'li'       // Coming soon
  ];

  return supported.includes(platform.toLowerCase());
}

/**
 * Get list of supported platforms
 *
 * @returns {string[]}
 */
export function getSupportedPlatforms() {
  return [
    { id: Platform.INSTAGRAM, name: 'Instagram', status: 'active' },
    { id: Platform.TIKTOK, name: 'TikTok', status: 'coming_soon' },
    { id: Platform.LINKEDIN, name: 'LinkedIn', status: 'coming_soon' }
  ];
}

export { Platform } from '../application/ports/IPlatformAdapter.js';

export default {
  getPlatformAdapter,
  isPlatformSupported,
  getSupportedPlatforms,
  Platform
};
