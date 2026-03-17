/**
 * AI Name Extractor Module
 * 
 * Uses OpenAI API to extract/guess the first name from Instagram username and profile name.
 */

import { CONFIG } from './config.js';

// Common French/English words that AI might mistake for first names
const COMMON_WORDS = new Set([
  // Abstract/spiritual/wellness concepts often used as Instagram profile names
  'présence', 'presence', 'harmonie', 'harmony', 'essence', 'éveil', 'eveil',
  'lumière', 'lumiere', 'énergie', 'energie', 'energy', 'sérénité', 'serenite',
  'serenity', 'sagesse', 'wisdom', 'grâce', 'grace', 'esprit', 'spirit',
  'liberté', 'liberte', 'liberty', 'beauté', 'beaute', 'beauty', 'nature',
  'silence', 'douceur', 'tendresse', 'passion', 'inspiration', 'intuition',
  'conscience', 'équilibre', 'equilibre', 'balance', 'confiance', 'courage',
  'force', 'lumineuse', 'lumineux', 'soleil', 'lune', 'étoile', 'etoile',
  'phoenix', 'phenix', 'papillon', 'butterfly', 'renaissance', 'envol',
  'souffle', 'flamme', 'flow', 'bloom', 'blossom', 'glow', 'shine', 'spark',
  'zen', 'karma', 'yoga', 'pilates', 'reiki', 'mantra', 'chakra',
  // Business/role words
  'coach', 'coaching', 'mentor', 'thérapeute', 'therapeute', 'therapist',
  'praticien', 'praticienne', 'consultant', 'consultante', 'formatrice',
  'formateur', 'créatrice', 'creatrice', 'fondatrice', 'fondateur',
  'artisan', 'artiste', 'artist', 'wellness', 'holistic', 'holistique',
  // Common adjectives/words
  'petit', 'petite', 'grand', 'grande', 'belle', 'beau', 'nouveau', 'nouvelle',
  'libre', 'douce', 'doux', 'pure', 'pur', 'vrai', 'vraie', 'simple',
  'positive', 'positif', 'creative', 'créative', 'happy', 'love', 'life',
  'dream', 'hope', 'soul', 'heart', 'mind', 'body', 'magic', 'miracle',
  'voyage', 'aventure', 'adventure', 'chemin', 'sentier', 'path',
  // Generic profile words
  'official', 'officiel', 'officielle', 'studio', 'atelier', 'maison',
  'plus', 'pro', 'world', 'global', 'design', 'style', 'mode', 'fashion',
]);

/**
 * Check if a string is a common word (not a real first name)
 * @param {string} name
 * @returns {boolean}
 */
function isCommonWord(name) {
  return COMMON_WORDS.has(name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim())
      || COMMON_WORDS.has(name.toLowerCase().trim());
}

/**
 * Extract First Name using OpenAI
 *
 * @param {string} username - Instagram username
 * @param {string} fullName - Profile full name (can be empty or contain emojis/titles)
 * @param {string} [bio] - Profile bio text
 * @returns {Promise<string|null>} Extracted Name or null if not found
 */
export async function extractNameWithAI(username, fullName, bio = null) {
  // Check requirements
  if (!CONFIG.OPENAI_API_KEY) {
    if (process.env.DEBUG) console.warn('   ⚠️  OPENAI_API_KEY not set - skipping AI name extraction');
    return null;
  }
  
  try {
    const prompt = `
I will give you an Instagram username, a profile "full name", and optionally a bio.
Your goal is to identify the **First Name** of the person to use in a friendly message (e.g. "Hello [Name]").

Rules:
1. Look for a human first name in ALL three sources: Full Name, Bio, and Username.
2. Prioritize the "Full Name" field if it contains a human name.
3. If Full Name is empty or contains only titles/business words, check the "Bio" for a first name (e.g. "Annelise, formatrice en..." → "Annelise").
4. If neither Full Name nor Bio contain a name, look at the "Username" to guess (e.g. "annelisebasque_formations" → "Annelise").
5. Ignore titles like "Coach", "Therapist", "Psychologue", "Formatrice", "Formateur", emojis, or business words — these are NOT names.
6. If the name is composed (e.g. Jean-Pierre), keep it.
7. Return ONLY the First Name (Capitalized).
8. If you CANNOT identify a human First Name with confidence, return exactly "UNKNOWN".
9. IMPORTANT: Common words, abstract concepts, roles, or brand names are NOT first names. Examples: "Présence", "Harmonie", "Formatrice", "Coaching", "Essence" → return "UNKNOWN".

Data:
Username: ${username || 'N/A'}
Full Name: ${fullName || 'N/A'}
Bio: ${bio || 'N/A'}
    `.trim();

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a helpful assistant that extracts first names from social media profiles.' },
          { role: 'user', content: prompt }
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
    const result = data.choices?.[0]?.message?.content?.trim();
    
    // Clean result (remove quotes if any)
    const cleanResult = result.replace(/["']/g, '');

    if (cleanResult === 'UNKNOWN' || cleanResult.length < 2) {
      if (process.env.DEBUG) console.log(`   🤖 AI Name Extraction: Failed to find name for @${username}`);
      return null;
    }

    // Reject common French/English words that are NOT first names
    if (isCommonWord(cleanResult)) {
      console.log(`   🤖 AI Name Extraction: @${username} -> "${cleanResult}" rejected (common word)`);
      return null;
    }

    if (process.env.DEBUG) console.log(`   🤖 AI Name Extraction: @${username} -> "${cleanResult}"`);
    return cleanResult;
    
  } catch (error) {
    console.error('   ❌ Name Extraction Error:', error.message);
    return null;
  }
}

export default { extractNameWithAI };
