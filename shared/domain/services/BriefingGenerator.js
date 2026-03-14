/**
 * BriefingGenerator - Generates a pre-call briefing for the account owner
 *
 * Called when a booking is confirmed. Analyzes the conversation history
 * to extract key insights and produce a structured briefing.
 */

import axios from 'axios';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

const BRIEFING_PROMPT = `Tu es un assistant specialise dans l'analyse de conversations commerciales en DM Instagram.

A partir de l'historique de conversation ci-dessous, genere un BRIEFING PRE-APPEL structure pour le coach qui va prendre l'appel.

Extrais les informations suivantes :

1. **ACTIVITE** : Quel est le metier/l'activite du prospect ? (coach, therapeute, formatrice, etc.)
2. **MATURITE** : Quel est son niveau ? (debutante, en place avec clients, business etabli qui scale)
3. **BLOCAGES** : Quels problemes/frustrations a-t-elle exprime ? (cite ses mots exacts entre guillemets)
4. **OBJECTIF** : Qu'est-ce qu'elle veut atteindre ? (cite ses mots exacts entre guillemets)
5. **SIGNAUX CLES** : Indices importants reveles pendant la conversation (charge mentale, CA irregulier, travaille seule, etc.)
6. **VERBATIMS** : Les 2-3 phrases les plus revelantes du prospect (citations exactes)
7. **ANGLES DE VENTE** : 2-3 angles recommandes pour l'appel bases sur ce que le prospect a dit

Reponds en francais. Sois concis et actionnable. Si une info n'a pas ete revelee dans la conversation, ecris "Non mentionne".

Format de sortie (texte brut, pas de JSON) :

ACTIVITE : ...
MATURITE : ...
BLOCAGES : ...
OBJECTIF : ...
SIGNAUX CLES : ...
VERBATIMS :
- "..."
- "..."
ANGLES DE VENTE :
- ...
- ...`;

/**
 * Generate a pre-call briefing from conversation history
 *
 * @param {Array} conversationHistory - Array of {role, text, timestamp} messages
 * @param {Object} leadContext - Lead data (username, bio, pain_points, etc.)
 * @returns {Promise<string>} The briefing text, or null if generation fails
 */
export async function generateBriefing(conversationHistory, leadContext = {}) {
    if (!process.env.OPENAI_API_KEY) {
        console.error('[BriefingGenerator] OPENAI_API_KEY not set');
        return null;
    }

    if (!conversationHistory || conversationHistory.length === 0) {
        console.log('[BriefingGenerator] No conversation history, skipping briefing');
        return null;
    }

    try {
        // Build conversation text for the prompt
        const conversationText = conversationHistory
            .map(msg => `${msg.role === 'user' ? 'PROSPECT' : 'ASSISTANT'}: ${msg.text}`)
            .join('\n');

        const bioSection = leadContext.bio ? `\nBIO INSTAGRAM : ${leadContext.bio}` : '';

        const messages = [
            { role: 'system', content: BRIEFING_PROMPT },
            { role: 'user', content: `${bioSection}\n\nHISTORIQUE DE CONVERSATION :\n${conversationText}` }
        ];

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        };

        const response = await axios.post(OPENAI_API_URL, {
            model: 'gpt-4o-mini',
            messages,
            temperature: 0.3,
            max_tokens: 600
        }, { headers });

        if (response.data.choices && response.data.choices.length > 0) {
            const briefing = response.data.choices[0].message.content.trim();
            console.log(`[BriefingGenerator] Briefing generated (${briefing.length} chars)`);
            return briefing;
        }

        return null;
    } catch (error) {
        console.error('[BriefingGenerator] Error generating briefing:', error.message);
        return null;
    }
}
