/**
 * Lead Qualification Module
 * 
 * Uses OpenAI API to analyze Instagram bios and determine if a lead
 * is a competitor (coach, therapist, professional in personal development).
 */

import { CONFIG } from './config.js';

/**
 * Qualify a lead based on their Instagram bio
 * 
 * @param {string} bio - The Instagram bio text
 * @param {string} [customPrompt] - Optional custom prompt override
 * @returns {Promise<{qualified: boolean, reason?: string, raw?: string}>}
 */
export async function qualifyLead(bio, customPrompt = null, username = 'unknown') {
  // Skip if qualification is disabled or no API key
  if (!CONFIG.QUALIFICATION_ENABLED) {
    return { qualified: true, reason: 'qualification_disabled' };
  }
  
  if (!CONFIG.OPENAI_API_KEY) {
    console.warn('   ⚠️  OPENAI_API_KEY not set - skipping qualification');
    return { qualified: true, reason: 'no_api_key' };
  }
  
  // Handle empty/missing/too-short bio (a single word like a city name is not a real bio)
  if (!bio || bio.trim().length === 0) {
    console.log('   ℹ️  No bio found - proceeding with outreach');
    return { qualified: true, reason: 'no_bio' };
  }

  const wordCount = bio.trim().split(/\s+/).length;
  if (wordCount <= 2) {
    console.log(`   ℹ️  Bio too short to qualify ("${bio.trim()}") - proceeding with outreach`);
    return { qualified: true, reason: 'bio_too_short' };
  }
  
  try {
    const basePrompt = customPrompt || CONFIG.QUALIFICATION_PROMPT;
    let prompt = basePrompt.replace('{bio}', bio.trim());
    prompt = prompt.replace('{username}', username);
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'user', content: prompt }
        ],
        max_tokens: 10,
        temperature: 0
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('   ❌ OpenAI API error:', errorData.error?.message || response.statusText);
      // On API error, proceed with outreach (fail-safe)
      return { qualified: true, reason: 'api_error' };
    }
    
    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content?.trim().toUpperCase() || '';
    
    console.log(`   🤖 OpenAI qualification: "${answer}"`);
    
    if (answer.includes('NON')) {
      console.log(`   ❌ Bio REJETÉE → Profil concurrent détecté`);
      return { 
        qualified: false, 
        reason: 'Profil concurrent (coach/accompagnateur)',
        raw: answer 
      };
    }
    
    if (answer.includes('OUI')) {
      console.log(`   ✅ Bio ACCEPTÉE → Lead qualifié pour outreach`);
      return { qualified: true, raw: answer };
    }
    
    // Ambiguous response - proceed with caution
    console.warn(`   ⚠️  Ambiguous qualification response: "${answer}" - proceeding`);
    return { qualified: true, reason: 'ambiguous_response', raw: answer };
    
  } catch (error) {
    console.error('   ❌ Qualification error:', error.message);
    // On error, proceed with outreach (fail-safe)
    return { qualified: true, reason: 'error' };
  }
}

export default { qualifyLead };
