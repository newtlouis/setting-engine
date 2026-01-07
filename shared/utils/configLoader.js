import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
 * 
 * @param {string} profileName - Name of the profile (e.g. 'hercule')
 * @returns {Promise<Object>} Profile configuration object or null if not found
 */
export async function loadProfileConfig(profileName) {
  if (!profileName) return null;

  const normalizedName = normalizeProfileName(profileName);
  const configPath = path.join(PROJECT_ROOT, 'config', 'profiles', `${normalizedName}.json`);

  try {
    const data = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(data);
    console.log(`✅ Loaded configuration for profile: ${normalizedName}`);
    return config;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`⚠️  No configuration file found for profile: ${normalizedName}`);
      console.warn(`   Expected at: ${configPath}`);
      return null;
    }
    console.error(`❌ Error loading profile config: ${err.message}`);
    throw err;
  }
}
