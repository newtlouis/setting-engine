import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root of the project (assuming shared/utils location)
const PROJECT_ROOT = path.resolve(__dirname, '../../');

/**
 * Clean profile name (alphanumeric only)
 */
export function normalizeProfileName(name) {
  if (!name) return 'default';
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

/**
 * Load profile configuration
 * Supports both .js (preferred) and .json files.
 * 
 * @param {string} profileName - Name of the profile (e.g. 'hercule')
 * @returns {Promise<Object>} Profile configuration object or null if not found
 */
export async function loadProfileConfig(profileName) {
  if (!profileName) return null;

  const normalizedName = normalizeProfileName(profileName);
  const profilesDir = path.join(PROJECT_ROOT, 'config', 'profiles');
  
  // Try .js first (for multi-line support)
  const jsPath = path.join(profilesDir, `${normalizedName}.config.js`);
  try {
    // Dynamic import needs file:// URL on Windows/Mac for absolute paths sometimes
    const moduleUrl = pathToFileURL(jsPath).href;
    const module = await import(moduleUrl);
    return module.default;
  } catch (err) {
    // If JS doesn't exist or fails, try .json
    if (err.code !== 'ERR_MODULE_NOT_FOUND' && !err.message.includes('Cannot find module')) {
        console.warn(`⚠️ Error importing JS config for ${normalizedName}: ${err.message}`);
    }
  }

  // Fallback to .json
  const jsonPath = path.join(profilesDir, `${normalizedName}.json`);
  try {
    const data = await fs.readFile(jsonPath, 'utf-8');
    const config = JSON.parse(data);
    console.log(`✅ Loaded JSON configuration for profile: ${normalizedName}`);
    return config;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`⚠️  No configuration file found for profile: ${normalizedName}`);
      console.warn(`   Checked: ${jsPath} and ${jsonPath}`);
      return null;
    }
    console.error(`❌ Error loading profile config: ${err.message}`);
    throw err;
  }
}
