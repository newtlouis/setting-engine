/**
 * Non-Linear Funnel Tests
 *
 * Tests that the engine handles non-linear funnel progression:
 *   - Backward steps (prospect not ready → step 5 → step 3)
 *   - Same step maintained across multiple messages
 *   - Step skipping (step 3 → step 5)
 *   - Step capping (never above 9)
 *
 * All tests use mocked LLM responses.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { generateResponse, clearPromptCache } from '../src/engine.js';
import { setupMocks, restoreAllMocks, createMockLlmResponse } from './helpers/mock-axios.js';
import { parseFunnelStep } from '../../../shared/domain/services/FunnelStepParser.js';

let originalEnv;

describe('Non-Linear Funnel Progression', () => {
  beforeEach(() => {
    originalEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    clearPromptCache();
  });

  afterEach(async () => {
    process.env.OPENAI_API_KEY = originalEnv;
    await restoreAllMocks();
  });

  // === BACKWARD STEPS ===

  test('Step 5 → step 3: prospect says "actually I\'m not sure"', async () => {
    await setupMocks({
      llmResponse: createMockLlmResponse(
        '[STEP_3] Je comprends, pas de souci ! Tu peux m\'en dire plus ?', '3'
      )
    });

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_5] Tu serais dispo pour un appel cette semaine ?' },
        { role: 'user', text: 'En fait je suis pas sûre, c\'est quoi exactement ?' }
      ],
      leadContext: { funnel_step: 5 }
    });

    assert.strictEqual(result.step_used, '3', 'Should go back to step 3');
    assert.strictEqual(parseFunnelStep(result.next_message), 3, 'Message should be tagged STEP_3');
  });

  test('Step 6 → step 5: prospect rejects slots, needs re-pitching', async () => {
    await setupMocks({
      llmResponse: createMockLlmResponse(
        '[STEP_5] Je comprends 🌸 L\'appel est gratuit et sans engagement, juste pour toi !', '5'
      )
    });

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_6] Mardi 14h ou jeudi 10h ?' },
        { role: 'user', text: 'Non finalement je sais pas si c\'est une bonne idée' }
      ],
      leadContext: { funnel_step: 6 }
    });

    assert.strictEqual(result.step_used, '5', 'Should go back to step 5');
  });

  test('Step 7 → step 6: prospect wants different slot', async () => {
    await setupMocks({
      llmResponse: createMockLlmResponse(
        '[STEP_6] Pas de souci ! Quand serais-tu plus disponible ?', '6'
      )
    });

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_7] Super pour mardi ! Ton email et téléphone ?' },
        { role: 'user', text: 'Ah en fait mardi c\'est mort, y\'a autre chose ?' }
      ],
      leadContext: { funnel_step: 7 }
    });

    assert.strictEqual(result.step_used, '6', 'Should go back to step 6 for new slots');
  });

  // === SAME STEP MULTIPLE MESSAGES ===

  test('Step 3 maintained over 3 exchanges (exploration continues)', async () => {
    await setupMocks({
      llmResponse: createMockLlmResponse(
        '[STEP_3.2] Et depuis combien de temps tu vis ça ?', '3'
      )
    });

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_3] C\'est en amour, en amitié... ?' },
        { role: 'user', text: 'En amour surtout' },
        { role: 'assistant', text: '[STEP_3.1] Je vois 🙏 Tu peux m\'en dire plus ?' },
        { role: 'user', text: 'Bah c\'est compliqué avec mon ex' },
      ],
      leadContext: { funnel_step: 3 }
    });

    assert.strictEqual(result.step_used, '3', 'Should stay at step 3');
    assert.strictEqual(parseFunnelStep(result.next_message), 3, 'Message should still be STEP_3');
  });

  test('Step 2 maintained: vague answer → dig deeper', async () => {
    await setupMocks({
      llmResponse: createMockLlmResponse(
        '[STEP_2] Je vois 😊 Et qu\'est-ce qui t\'a attirée dans ce sujet ?', '2'
      )
    });

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_2] C\'est plutôt personnel ou par curiosité ?' },
        { role: 'user', text: 'Un peu des deux' }
      ],
      leadContext: { funnel_step: 2 }
    });

    assert.strictEqual(result.step_used, '2', 'Should stay at step 2 for vague answer');
  });

  // === STEP SKIPPING ===

  test('Step 3 → step 5: enthusiastic prospect skips projection', async () => {
    await setupMocks({
      llmResponse: createMockLlmResponse(
        '[STEP_5] Je ressens ta motivation 🌸 Ce que je te propose, c\'est 30 min ensemble !', '5'
      )
    });

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_3] Qu\'est-ce qui est vraiment dur pour toi ?' },
        { role: 'user', text: 'J\'en peux plus, il me faut de l\'aide maintenant, je suis prête à tout !' }
      ],
      leadContext: { funnel_step: 3 }
    });

    assert.strictEqual(result.step_used, '5', 'Should skip to step 5 for eager prospect');
  });

  test('Step 1 → step 2: natural transition after first response', async () => {
    await setupMocks({
      llmResponse: createMockLlmResponse(
        '[STEP_2] Hey ! Je vois que tu t\'intéresses au bien-être 🌸', '2'
      )
    });

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_1] Marie ? 🙂' },
        { role: 'user', text: 'Oui c\'est moi ! Salut !' }
      ],
      leadContext: { funnel_step: 1 }
    });

    assert.strictEqual(result.step_used, '2', 'Should move to step 2 after first reply');
  });

  // === STEP CAPPING ===

  test('step_used="9" stays at 9 (max step)', async () => {
    await setupMocks({
      llmResponse: createMockLlmResponse(
        '[STEP_9] Avec plaisir ! Belle journée à toi 🌸', '9'
      )
    });

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_9] C\'est tout bon ! Ton RDV est confirmé ✅' },
        { role: 'user', text: 'Merci beaucoup !!' }
      ],
      leadContext: { funnel_step: 9 }
    });

    assert.strictEqual(result.step_used, '9', 'Should stay at step 9');
    assert.strictEqual(parseFunnelStep(result.next_message), 9);
  });

  // === NOT_INTERESTED AT VARIOUS STEPS ===

  test('NOT_INTERESTED at step 3 → conversation closure', async () => {
    await setupMocks({
      llmResponse: createMockLlmResponse(
        '[NOT_INTERESTED] Je comprends, merci pour ta réponse ! Belle journée 🌸', '3'
      )
    });

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_3] Tu peux m\'en dire plus ?' },
        { role: 'user', text: 'Non franchement ça va moi, j\'ai pas de problème' }
      ],
      leadContext: { funnel_step: 3 }
    });

    assert.ok(result.next_message.includes('NOT_INTERESTED'), 'Should close with NOT_INTERESTED');
  });

  test('NOT_INTERESTED at step 5 → prospect declines call', async () => {
    await setupMocks({
      llmResponse: createMockLlmResponse(
        '[NOT_INTERESTED] Pas de souci du tout ! Si tu changes d\'avis, n\'hésite pas 🌸', '5'
      )
    });

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_5] Tu serais dispo pour 30 min cette semaine ?' },
        { role: 'user', text: 'Non merci, ça m\'intéresse pas' }
      ],
      leadContext: { funnel_step: 5 }
    });

    assert.ok(result.next_message.includes('NOT_INTERESTED'));
  });
});
