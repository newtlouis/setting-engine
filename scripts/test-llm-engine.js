#!/usr/bin/env node
/**
 * Test script for the LLM engine with database-based prompts
 *
 * Usage: node scripts/test-llm-engine.js
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
dotenv.config({ path: path.join(__dirname, '..', 'agents', 'dmresponder', '.env') });

import { generateResponse } from '../agents/dmresponder/src/engine.js';
import { loadProfileConfig } from '../shared/utils/configLoader.js';

async function testEngine() {
    console.log('=== Testing LLM Engine with Database Prompt ===\n');

    if (!process.env.OPENAI_API_KEY) {
        console.error('❌ OPENAI_API_KEY not set. Please check your .env file.');
        process.exit(1);
    }

    // Load simplified config (should now use account_id to get prompt from DB)
    const profileConfig = await loadProfileConfig('melanie');
    console.log(`Profile: ${profileConfig.profile_name}`);
    console.log(`Account ID: ${profileConfig.account_id}`);
    console.log(`Has system_prompt in config: ${!!profileConfig.dm_responder?.system_prompt}`);
    console.log('');

    // Test scenarios
    const testCases = [
        {
            name: "Premier contact - réponse au Hey",
            history: [
                { role: 'assistant', text: 'Hey !' },
                { role: 'user', text: 'Salut ! Oui ?' }
            ],
            leadContext: {
                account_id: 2,
                username: 'marie_test',
                fullName: 'Marie Dupont',
                funnel_step: 1
            }
        },
        {
            name: "Exploration - partage d'un problème",
            history: [
                { role: 'assistant', text: '[STEP_2] Coucou, j\'espère que tu vas bien 🌸 J\'ai vu que tu t\'intéressais à la dépendance affective. C\'est plutôt personnel ou par curiosité ?' },
                { role: 'user', text: 'C\'est personnel oui... j\'ai du mal à sortir d\'une relation toxique' }
            ],
            leadContext: {
                account_id: 2,
                username: 'marie_test',
                fullName: 'Marie',
                funnel_step: 2
            }
        },
        {
            name: "Objection - c'est payant ?",
            history: [
                { role: 'assistant', text: '[STEP_5] Ce que je peux te proposer, c\'est de prendre 30 minutes ensemble cette semaine pour faire le point 🌼' },
                { role: 'user', text: 'C\'est payant ton truc ?' }
            ],
            leadContext: {
                account_id: 2,
                username: 'sophie_test',
                fullName: 'Sophie',
                funnel_step: 5
            }
        }
    ];

    for (const testCase of testCases) {
        console.log(`\n--- Test: ${testCase.name} ---`);
        console.log(`User message: "${testCase.history[testCase.history.length - 1].text}"`);

        try {
            const response = await generateResponse({
                conversationHistory: testCase.history,
                leadContext: testCase.leadContext,
                profileConfig
            });

            console.log(`\n📤 Response (Step ${response.step_used || '?'}):`);
            console.log(`   "${response.next_message}"`);

        } catch (error) {
            console.error(`❌ Error: ${error.message}`);
        }

        // Small delay between tests
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log('\n=== Test Complete ===\n');
}

testEngine().catch(console.error);
