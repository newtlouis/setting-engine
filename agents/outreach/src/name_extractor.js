/**
 * AI Name Extractor Module
 * 
 * Uses OpenAI API to extract/guess the first name from Instagram username and profile name.
 */

import { CONFIG } from './config.js';

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

    if (process.env.DEBUG) console.log(`   🤖 AI Name Extraction: @${username} -> "${cleanResult}"`);
    return cleanResult;
    
  } catch (error) {
    console.error('   ❌ Name Extraction Error:', error.message);
    return null;
  }
}

export default { extractNameWithAI };
