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
 * @returns {Promise<string|null>} Extracted Name or null if not found
 */
export async function extractNameWithAI(username, fullName) {
  // Check requirements
  if (!CONFIG.OPENAI_API_KEY) {
    if (process.env.DEBUG) console.warn('   ⚠️  OPENAI_API_KEY not set - skipping AI name extraction');
    return null;
  }
  
  try {
    const prompt = `
I will give you an Instagram username and a profile "full name".
Your goal is to identify the **First Name** of the person to use in a friendly message (e.g. "Hello [Name]").

Rules:
1. Prioritize the "Full Name" field if it contains a human name.
2. Ignore titles like "Coach", "Therapist", "Psychologue", emojis, or business words.
3. If Full Name is empty or generic, look at the "Username" to guess the name.
4. If the name is composed (e.g. Jean-Pierre), keep it.
5. Return ONLY the First Name (Capitalized).
6. If you CANNOT identify a human First Name with confidence, return exactly "UNKNOWN".
7. IMPORTANT: Common words, abstract concepts, or brand names are NOT first names. Examples: "Présence", "Harmonie", "Essence", "Éveil", "Lumière", "Énergie", "Sérénité" → return "UNKNOWN".

Data:
Username: ${username || 'N/A'}
Full Name: ${fullName || 'N/A'}
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
