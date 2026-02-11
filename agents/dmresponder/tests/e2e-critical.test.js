/**
 * E2E Critical Scenario Tests
 *
 * Reproduces real bugs encountered in production.
 * Each test simulates a full scenario with mocked LLM
 * and verifies the exact behavior that was broken before.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { generateResponse, clearPromptCache } from '../src/engine.js';
import { setupMocks, restoreAllMocks, createMockLlmResponse } from './helpers/mock-axios.js';
import { createTestDb } from './helpers/test-db.js';
import { parseFunnelStep } from '../../../shared/domain/services/FunnelStepParser.js';

let originalEnv;
let originalCalendlyToken;

describe('E2E Critical Scenarios', () => {
  beforeEach(() => {
    originalEnv = process.env.OPENAI_API_KEY;
    originalCalendlyToken = process.env.CALENDLY_TOKEN;
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.CALENDLY_TOKEN = 'test-calendly-token';
    clearPromptCache();
  });

  afterEach(async () => {
    process.env.OPENAI_API_KEY = originalEnv;
    if (originalCalendlyToken !== undefined) {
      process.env.CALENDLY_TOKEN = originalCalendlyToken;
    } else {
      delete process.env.CALENDLY_TOKEN;
    }
    await restoreAllMocks();
  });

  test('CURIOSITE_NOT_INTERESTED: RAG injects [NOT_INTERESTED] entry for "par curiosite"', async () => {
    // Bug: RAG didn't trigger for "curiosité" → LLM continued conversation instead of closing
    const ctx = createTestDb();
    try {
      // Search the test DB for keyword match
      const matches = await ctx.knowledgeRepo.searchByKeywords(1, 'par curiosite');
      assert.ok(matches.length > 0, 'RAG should find "curiosite" keyword match');
      assert.ok(
        matches.some(m => m.content.includes('[NOT_INTERESTED]')),
        'Matched entry should contain [NOT_INTERESTED] tag'
      );

      // Verify the entry would be included at step 2
      const filtered = ctx.ragRetriever.filterByStep(
        matches.map(m => ({
          ...m,
          applicableSteps: m.applicableSteps || (m.applicable_steps ? JSON.parse(m.applicable_steps) : null)
        })),
        2
      );
      assert.ok(filtered.length > 0, 'Entry should pass step filter for step 2');

      // Format for prompt
      const ragResults = {
        relevantKnowledge: filtered.map(f => ({ ...f, score: 0.8, category: f.category })),
        similarConversations: []
      };
      const formatted = ctx.ragRetriever.formatForPrompt(ragResults);
      assert.ok(formatted.includes('NOT_INTERESTED'), 'Formatted prompt should contain NOT_INTERESTED guidance');
    } finally {
      ctx.cleanup();
    }
  });

  test('STEP3_DOMAIN_NO_SKIP: Step 3 with "en amour" stays at step 3', async () => {
    // Bug: LLM jumped from step 3 to step 4+ when prospect answered the domain question
    await setupMocks({
      llmResponse: createMockLlmResponse(
        '[STEP_3.2] Merci pour ta confiance 🙏 Ça fait combien de temps que ça te pèse ?',
        '3'
      )
    });

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_3] C\'est plus en amour, en amitié, au travail... ?' },
        { role: 'user', text: 'En amour surtout' }
      ],
      leadContext: { username: 'test_user', funnel_step: 3 }
    });

    assert.strictEqual(result.step_used, '3', 'Should stay at step 3');
    const parsed = parseFunnelStep(result.next_message);
    assert.strictEqual(parsed, 3, 'Message should contain [STEP_3] variant');
  });

  test('STEP5_AGREEMENT_CALENDLY: Step 5 agreement → Calendly slots in prompt', async () => {
    // Bug: Calendly slots not injected at step 5 when prospect agreed
    let capturedPrompt = '';
    const slots = [
      { start_time: '2026-02-12T14:00:00Z' },
      { start_time: '2026-02-13T10:00:00Z' },
    ];

    await setupMocks({
      llmResponse: createMockLlmResponse('[STEP_6] Mardi 14h ou mercredi 10h ?', '6'),
      calendlyAvailability: { raw: slots },
      onSystemPrompt: (prompt) => { capturedPrompt = prompt; }
    });

    await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_5] Tu serais dispo ces prochains jours ?' },
        { role: 'user', text: 'd\'accord' }
      ],
      leadContext: { funnel_step: 5 },
      profileConfig: { profile_name: 'test' }
    });

    assert.ok(capturedPrompt.includes('DISPONIBILIT'),
      'Prompt should contain Calendly availability at step 5');
  });

  test('CALL_PROPOSED_LOW_STEP: Slots injected when "on prenne 30 min" at step 3', async () => {
    // Bug: Calendly slots only injected at step 5+, missed when call was proposed early
    let capturedPrompt = '';
    const slots = [
      { start_time: '2026-02-12T14:00:00Z' },
    ];

    await setupMocks({
      llmResponse: createMockLlmResponse('[STEP_3] Super !', '3'),
      calendlyAvailability: { raw: slots },
      onSystemPrompt: (prompt) => { capturedPrompt = prompt; }
    });

    await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: 'Ce que je te propose c\'est qu\'on prenne 30 min ensemble' },
        { role: 'user', text: 'Ok pourquoi pas' }
      ],
      leadContext: { funnel_step: 3 },
      profileConfig: { profile_name: 'test' }
    });

    assert.ok(
      capturedPrompt.includes('DISPONIBILIT') || capturedPrompt.includes('invente PAS'),
      'Calendly should be injected when callProposed=true at step 3'
    );
  });

  test('FULL_BOOKING_FLOW: Step 7 with email+phone → booking_intent passed through', async () => {
    // Bug: booking_intent not propagated from LLM response
    const bookingIntent = {
      slot: '2026-02-10T14:00:00Z',
      email: 'test@mail.com',
      phone: '0612345678'
    };

    await setupMocks({
      llmResponse: createMockLlmResponse(
        '[STEP_8] [ALERT_BOOKING] C\'est noté !', '8', bookingIntent
      )
    });

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_7] Ton email et téléphone ?' },
        { role: 'user', text: 'test@mail.com et 0612345678' }
      ],
      leadContext: { funnel_step: 7 }
    });

    assert.ok(result.booking_intent, 'booking_intent should be present');
    assert.strictEqual(result.booking_intent.email, 'test@mail.com');
    assert.strictEqual(result.booking_intent.phone, '0612345678');
    assert.strictEqual(result.booking_intent.slot, '2026-02-10T14:00:00Z');
  });

  test('RAG_STEP_FILTER: Entry with steps=[1,2] filtered out at step 3', async () => {
    // Bug: RAG entries with step restrictions were not filtered
    const ctx = createTestDb();
    try {
      // Entry #4 has steps=[1,2], keywords=["appel"]
      const matches = await ctx.knowledgeRepo.searchByKeywords(1, 'un appel');
      assert.ok(matches.length > 0, 'Should find keyword match for "appel"');

      // Simulate filtering at step 3
      const withParsedSteps = matches.map(m => ({
        ...m,
        applicableSteps: m.applicable_steps ? JSON.parse(m.applicable_steps) : null
      }));
      const filtered = ctx.ragRetriever.filterByStep(withParsedSteps, 3);

      // Entry #4 (steps=[1,2]) should be excluded at step 3
      assert.ok(
        !filtered.some(f => f.id === 4),
        'Entry #4 with steps=[1,2] should be excluded at step 3'
      );

      // Entry #5 (steps=null, keyword "dépendance affective") should be unaffected if matched
      // But "appel" only matches entry #4, so filtered may be empty
      // That's the expected behavior: step-restricted entries get filtered
    } finally {
      ctx.cleanup();
    }
  });
});
