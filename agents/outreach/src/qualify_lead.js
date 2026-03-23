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
 * @param {string} [username] - Instagram username for logging
 * @param {Object} [options] - Additional options
 * @param {boolean} [options.extractAccompaniment] - Extract accompaniment/service type from bio
 * @returns {Promise<{qualified: boolean, reason?: string, raw?: string, accompanimentType?: string}>}
 */
export async function qualifyLead(bio, customPrompt = null, username = 'unknown', options = {}) {
  const { extractAccompaniment = false } = options;

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
    let prompt;
    let maxTokens = 10;

    if (extractAccompaniment && !customPrompt) {
      // Enhanced prompt: qualify + language check + extract accompaniment type in one call
      prompt = `Analyse cette bio Instagram.

1. D'abord, vérifie la LANGUE : si la bio n'est PAS en français (espagnol, anglais, portugais, italien, arabe, etc.), réponds uniquement "FOREIGN".
   Note : les emojis, noms propres et mots universels (coach, yoga, etc.) ne comptent pas pour déterminer la langue. Regarde les vrais mots.

2. Si la bio EST en français :
   - Si la personne est un professionnel de l'accompagnement, un coach, un thérapeute, un formateur, ou travaille dans le développement personnel, réponds "NON".
   - Sinon, réponds "OUI" suivi d'un pipe "|" et du type d'accompagnement/service que la personne propose (en quelques mots, ex: yoga, sophrologie, coaching en nutrition, hypnothérapie, naturopathie, bien-être, etc.).
   - Si tu ne peux pas identifier le type d'accompagnement, réponds "OUI|UNKNOWN".

Bio: ${bio.trim()}

Réponse (FOREIGN ou OUI|type ou NON):`;
      maxTokens = 30;
    } else {
      const basePrompt = customPrompt || CONFIG.QUALIFICATION_PROMPT;
      prompt = basePrompt.replace('{bio}', bio.trim());
      prompt = prompt.replace('{username}', username);
    }

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
        max_tokens: maxTokens,
        temperature: 0
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('   ❌ OpenAI API error:', errorData.error?.message || response.statusText);
      return { qualified: true, reason: 'api_error' };
    }

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content?.trim() || '';
    const answerUpper = answer.toUpperCase();

    console.log(`   🤖 OpenAI qualification: "${answer}"`);

    if (answerUpper.includes('FOREIGN')) {
      console.log(`   🌍 Bio REJETÉE → Langue étrangère détectée`);
      return {
        qualified: false,
        reason: 'foreign_language',
        raw: answer
      };
    }

    if (answerUpper.includes('NON')) {
      console.log(`   ❌ Bio REJETÉE → Profil concurrent détecté`);
      return {
        qualified: false,
        reason: 'Profil concurrent (coach/accompagnateur)',
        raw: answer
      };
    }

    if (answerUpper.includes('OUI')) {
      // Parse accompaniment type from "OUI|yoga" format
      let accompanimentType = null;
      if (extractAccompaniment && answer.includes('|')) {
        const type = answer.split('|')[1]?.trim();
        if (type && type.toUpperCase() !== 'UNKNOWN' && type.length > 1) {
          accompanimentType = type.toLowerCase();
          console.log(`   🏷️  Accompaniment type: "${accompanimentType}"`);
        }
      }

      console.log(`   ✅ Bio ACCEPTÉE → Lead qualifié pour outreach`);
      return { qualified: true, raw: answer, accompanimentType };
    }

    // Ambiguous response - proceed with caution
    console.warn(`   ⚠️  Ambiguous qualification response: "${answer}" - proceeding`);
    return { qualified: true, reason: 'ambiguous_response', raw: answer };

  } catch (error) {
    console.error('   ❌ Qualification error:', error.message);
    return { qualified: true, reason: 'error' };
  }
}

export default { qualifyLead };
