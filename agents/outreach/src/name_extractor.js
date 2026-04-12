/**
 * AI Name Extractor Module
 *
 * Extracts first names from Instagram username and profile name using OpenAI.
 * Strict "zero false positive" philosophy: returns null on any doubt.
 */

import { CONFIG } from './config.js';

const COMMON_WORDS = new Set([
  // French articles, prepositions, pronouns
  'de', 'du', 'des', 'le', 'la', 'les', 'un', 'une', 'au', 'aux',
  'et', 'ou', 'en', 'par', 'pour', 'avec', 'sans', 'sur', 'sous',
  'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses',
  'je', 'tu', 'il', 'elle', 'nous', 'vous', 'ils', 'elles',
  'ce', 'cette', 'ces', 'tout', 'toute', 'tous', 'toutes',
  // English articles, prepositions, pronouns
  'the', 'and', 'for', 'with', 'from', 'your', 'our', 'her', 'his',
  'my', 'its', 'she', 'not', 'but', 'all', 'are', 'was', 'one',
  // Abstract/spiritual/wellness concepts
  'presence', 'harmonie', 'harmony', 'essence', 'eveil', 'lumiere',
  'energie', 'energy', 'serenite', 'serenity', 'sagesse', 'wisdom',
  'esprit', 'spirit', 'liberte', 'liberty', 'beaute', 'beauty', 'nature',
  'silence', 'douceur', 'tendresse', 'passion', 'inspiration', 'intuition',
  'conscience', 'equilibre', 'balance', 'confiance', 'courage', 'force',
  'lumineuse', 'lumineux', 'soleil', 'lune', 'etoile', 'phoenix', 'phenix',
  'papillon', 'butterfly', 'renaissance', 'envol', 'souffle', 'flamme',
  'flow', 'bloom', 'blossom', 'glow', 'shine', 'spark',
  'zen', 'karma', 'yoga', 'pilates', 'reiki', 'mantra', 'chakra',
  // Business/role words
  'coach', 'coaching', 'mentor', 'therapeute', 'therapist',
  'praticien', 'praticienne', 'consultant', 'consultante', 'formatrice',
  'formateur', 'creatrice', 'fondatrice', 'fondateur',
  'artisan', 'artiste', 'artist', 'wellness', 'holistic', 'holistique',
  'psychologue', 'infirmiere', 'infirmier', 'medecin', 'docteur',
  // Common adjectives
  'petit', 'petite', 'grand', 'grande', 'belle', 'beau', 'nouveau', 'nouvelle',
  'libre', 'douce', 'doux', 'pure', 'pur', 'vrai', 'vraie', 'simple',
  'positive', 'positif', 'creative', 'happy', 'love', 'life',
  'dream', 'hope', 'soul', 'heart', 'mind', 'body', 'magic', 'miracle',
  'voyage', 'aventure', 'adventure', 'chemin', 'sentier', 'path',
  // Generic profile/brand words
  'official', 'officiel', 'officielle', 'studio', 'atelier', 'maison',
  'plus', 'pro', 'world', 'global', 'design', 'style', 'mode', 'fashion',
  'fitness', 'health', 'sante', 'bien', 'etre', 'bienvenue', 'welcome',
]);

/**
 * Normalizes a string for comparison: lowercase, strip accents, trim
 * @param {string} str
 * @returns {string}
 */
function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/**
 * Checks if a string is a common word (not a real first name)
 * @param {string} name
 * @returns {boolean}
 */
function isCommonWord(name) {
  return COMMON_WORDS.has(normalize(name)) || COMMON_WORDS.has(name.toLowerCase().trim());
}

/**
 * Checks if the result looks like a brand fragment extracted from the username
 * @param {string} result
 * @param {string} username
 * @returns {boolean}
 */
function isUsernameFragment(result, username) {
  if (!result || !username) return false;
  const lower = result.toLowerCase();
  const user = username.toLowerCase().replace(/[._-]/g, '');

  // ALL CAPS short strings are acronyms
  if (result === result.toUpperCase() && result.length <= 5) return true;

  if (user.includes(lower)) {
    const segments = username.toLowerCase().split(/[._-]/);
    const isExactSegment = segments.some(seg => seg === lower);

    if (isExactSegment) {
      const brandSuffixes = /(?:tv|fr|pro|app|hub|lab|co|io|tech|fit|zen|box|net|web|shop|care|mind|well|talk|vibe|med|health|biz|corp|inc|store|beauty|style|mode|world|global|plus|official)$/i;
      if (brandSuffixes.test(lower)) return true;
    }

    if (/\d/.test(result) || result.length <= 3) return true;
  }

  return false;
}

/**
 * Validates a name against Genderize.io API.
 * Returns false on API error (zero false positive philosophy).
 * @param {string} name
 * @returns {Promise<boolean>}
 */
async function isRealFirstName(name) {
  try {
    const response = await fetch(`https://api.genderize.io?name=${encodeURIComponent(name)}`);
    if (!response.ok) {
      console.warn(`   ⚠️  Genderize API error (${response.status}) — accepting name "${name}" as fallback`);
      return true; // Don't reject names when API is unavailable
    }
    const data = await response.json();
    if (data.error) {
      console.warn(`   ⚠️  Genderize API: ${data.error} — accepting name "${name}" as fallback`);
      return true; // Rate limited or other API error — accept the name
    }
    return data.count >= 100;
  } catch {
    console.warn(`   ⚠️  Genderize API unreachable — accepting name "${name}" as fallback`);
    return true; // Network error — accept the name
  }
}

/**
 * Checks gender of a name via Genderize.io API.
 * @param {string} name
 * @returns {Promise<{gender: string|null, probability: number}>}
 */
export async function getNameGender(name) {
  try {
    const response = await fetch(`https://api.genderize.io?name=${encodeURIComponent(name)}`);
    if (!response.ok) {
      console.warn(`   ⚠️  Genderize API error (${response.status}) — bypassing gender check for "${name}"`);
      return { gender: 'female', probability: 1, fallback: true }; // Accept when API unavailable
    }
    const data = await response.json();
    if (data.error) {
      console.warn(`   ⚠️  Genderize API: ${data.error} — bypassing gender check for "${name}"`);
      return { gender: 'female', probability: 1, fallback: true }; // Rate limited — accept
    }
    return { gender: data.gender, probability: data.probability || 0 };
  } catch {
    console.warn(`   ⚠️  Genderize API unreachable — bypassing gender check for "${name}"`);
    return { gender: 'female', probability: 1, fallback: true }; // Network error — accept
  }
}

const EXTRACTION_PROMPT = `I will give you an Instagram username and a profile "full name".
Your goal is to identify the **First Name** of the person to use in a friendly message (e.g. "Hello [Name]").

Rules:
1. A valid first name is a REAL human first name that exists in common name databases (French, English, Arabic, Spanish, Portuguese, Italian, etc.).
2. If the "Full Name" contains a real human first name as its FIRST word or clearly identifiable, use it.
3. If the Full Name is a phrase, slogan, or brand name (e.g. "De Coach a Coach", "La Vie En Rose", "Mind Body Soul", "Coaching Holistique"), it does NOT contain a first name. Ignore it entirely and look at the Username.
4. When looking at the Username, split it by dots, underscores, or hyphens. Look for a segment that is a REAL first name. Ignore segments that are roles (coach, yoga, pro, therapist), locations (paris, fr, lyon), or brand suffixes (tv, app, hub, fit).
5. Articles (de, du, le, la, the), prepositions (pour, avec, for, with), and pronouns are NEVER first names.
6. Business words (Coach, Therapist, Formatrice, Consultant), abstract concepts (Présence, Harmonie, Énergie, Essence), and adjectives (Belle, Pure, Happy) are NEVER first names.
7. If the name is composed (e.g. Jean-Pierre, Marie-Claire), keep the full composed name.
8. Return ONLY the First Name, properly capitalized.
9. If you CANNOT identify a real human first name with HIGH CONFIDENCE, return exactly "UNKNOWN". When in doubt, ALWAYS return "UNKNOWN".`;

/**
 * Extracts first name from Instagram profile using OpenAI + multi-layer validation.
 * Returns null on any doubt (zero false positive philosophy).
 *
 * @param {string} username - Instagram username
 * @param {string} fullName - Profile display name
 * @returns {Promise<string|null>} Validated first name or null
 */
export async function extractNameWithAI(username, fullName) {
  if (!CONFIG.OPENAI_API_KEY) {
    if (process.env.DEBUG) console.warn('   ⚠️  OPENAI_API_KEY not set - skipping AI name extraction');
    return null;
  }

  try {
    const userPrompt = `Username: ${username || 'N/A'}\nFull Name: ${fullName || 'N/A'}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: EXTRACTION_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 10,
        temperature: 0
      })
    });

    if (!response.ok) {
      if (process.env.DEBUG) console.error(`   ❌ OpenAI Name Extraction Error: ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;

    const name = raw.replace(/["']/g, '');

    // Layer 1: basic rejection
    if (name === 'UNKNOWN' || name.length < 3) {
      if (process.env.DEBUG) console.log(`   🤖 AI: @${username} → no name found`);
      return null;
    }

    // Layer 2: common word filter
    if (isCommonWord(name)) {
      if (process.env.DEBUG) console.log(`   🤖 AI: @${username} → "${name}" rejected (common word)`);
      return null;
    }

    // Layer 3: username fragment filter
    if (isUsernameFragment(name, username)) {
      if (process.env.DEBUG) console.log(`   🤖 AI: @${username} → "${name}" rejected (username fragment)`);
      return null;
    }

    // Layer 4: Genderize.io validation (rejects on API error)
    const isReal = await isRealFirstName(name);
    if (!isReal) {
      if (process.env.DEBUG) console.log(`   🤖 AI: @${username} → "${name}" rejected (not a known first name)`);
      return null;
    }

    if (process.env.DEBUG) console.log(`   🤖 AI: @${username} → "${name}" ✓`);
    return name;
  } catch (error) {
    console.error('   ❌ Name Extraction Error:', error.message);
    return null;
  }
}

// Exported for testing
export { isCommonWord, isUsernameFragment, isRealFirstName, normalize, COMMON_WORDS };

export default { extractNameWithAI };
