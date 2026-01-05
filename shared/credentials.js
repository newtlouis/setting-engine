/**
 * Utility to resolve Instagram credentials based on profile name.
 * Supports pattern-based environment variables: INSTAGRAM_USERNAME_<PROFILE>
 */

/**
 * Normalizes a profile name for use in environment variable keys.
 * Example: 'my-profile' -> 'MY_PROFILE'
 * 
 * @param {string} profileName 
 * @returns {string}
 */
export function normalizeProfileName(profileName) {
  if (!profileName || profileName === 'default') return '';
  return profileName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/**
 * Gets credentials for a specific profile, falling back to global credentials.
 * 
 * @param {string} profileName 
 * @returns {{username: string, password: string}}
 */
export function getCredentialsForProfile(profileName) {
  const normalized = normalizeProfileName(profileName);
  
  let username = '';
  let password = '';
  
  if (normalized) {
    const userKey = `INSTAGRAM_USERNAME_${normalized}`;
    const passKey = `INSTAGRAM_PASSWORD_${normalized}`;
    
    username = process.env[userKey];
    password = process.env[passKey];
  }
  
  // Fallback to global if not found for profile
  return {
    username: username || process.env.INSTAGRAM_USERNAME || '',
    password: password || process.env.INSTAGRAM_PASSWORD || ''
  };
}
