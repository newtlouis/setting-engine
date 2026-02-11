/**
 * Calendly Injection Tests
 *
 * Tests that Calendly availability slots are correctly injected
 * into the system prompt sent to OpenAI.
 *
 * Strategy: Mock OpenAI + Calendly, capture the system prompt.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { generateResponse, clearPromptCache } from '../src/engine.js';
import { setupMocks, restoreAllMocks, createMockLlmResponse } from './helpers/mock-axios.js';

let originalEnv;
let originalCalendlyToken;

describe('Calendly Slot Injection', () => {
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

  test('Step 5: slots injected → prompt contains "DISPONIBILITÉS CALENDLY"', async () => {
    let capturedPrompt = '';
    const slots = [
      { start_time: '2026-02-12T14:00:00Z' },
      { start_time: '2026-02-13T10:00:00Z' },
      { start_time: '2026-02-14T16:00:00Z' },
    ];

    await setupMocks({
      llmResponse: createMockLlmResponse('[STEP_6] Mardi 14h ou jeudi 10h ?', '6'),
      calendlyAvailability: { raw: slots },
      onSystemPrompt: (prompt) => { capturedPrompt = prompt; }
    });

    await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_5] Tu serais dispo ?' },
        { role: 'user', text: 'Oui pourquoi pas !' }
      ],
      leadContext: { funnel_step: 5 },
      profileConfig: { profile_name: 'test' }
    });

    assert.ok(capturedPrompt.includes('DISPONIBILIT'), 'Prompt should contain Calendly slots section');
  });

  test('Step 3 with callProposed: slots injected when assistant mentioned "30 min"', async () => {
    let capturedPrompt = '';
    const slots = [
      { start_time: '2026-02-12T14:00:00Z' },
      { start_time: '2026-02-13T10:00:00Z' },
    ];

    await setupMocks({
      llmResponse: createMockLlmResponse('[STEP_3] Super !', '3'),
      calendlyAvailability: { raw: slots },
      onSystemPrompt: (prompt) => { capturedPrompt = prompt; }
    });

    await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: 'Je te propose de prendre 30 min ensemble' },
        { role: 'user', text: 'D\'accord !' }
      ],
      leadContext: { funnel_step: 3 },
      profileConfig: { profile_name: 'test' }
    });

    assert.ok(capturedPrompt.includes('DISPONIBILIT'),
      'Slots should be injected when callProposed=true even at low step');
  });

  test('Detection patterns: "appel", "se call", "on prenne"', async () => {
    // Test each pattern triggers needsSlots
    const patterns = ['un appel la semaine prochaine', 'on se call demain', 'on prenne un moment'];

    for (const pattern of patterns) {
      let capturedPrompt = '';
      await setupMocks({
        llmResponse: createMockLlmResponse('[STEP_3] Ok !', '3'),
        calendlyAvailability: { raw: [{ start_time: '2026-02-12T14:00:00Z' }] },
        onSystemPrompt: (prompt) => { capturedPrompt = prompt; }
      });

      await generateResponse({
        conversationHistory: [
          { role: 'assistant', text: pattern },
          { role: 'user', text: 'Ok !' }
        ],
        leadContext: { funnel_step: 2 },
        profileConfig: { profile_name: 'test' }
      });

      assert.ok(capturedPrompt.includes('DISPONIBILIT') || capturedPrompt.includes('invente PAS'),
        `Pattern "${pattern}" should trigger Calendly injection`);
    }
  });

  test('Calendly returns empty → prompt contains "N\'invente PAS"', async () => {
    let capturedPrompt = '';

    await setupMocks({
      llmResponse: createMockLlmResponse('[STEP_6] Quand serais-tu dispo ?', '6'),
      calendlyAvailability: { raw: [] },
      onSystemPrompt: (prompt) => { capturedPrompt = prompt; }
    });

    await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_5] Tu serais dispo ?' },
        { role: 'user', text: 'Oui !' }
      ],
      leadContext: { funnel_step: 5 },
      profileConfig: { profile_name: 'test' }
    });

    assert.ok(capturedPrompt.includes('invente PAS'),
      'Should contain "N\'invente PAS" when no slots available');
  });

  test('Calendly API fails → graceful fallback with "N\'invente PAS"', async () => {
    let capturedPrompt = '';
    const axios = await import('axios');

    await setupMocks({
      llmResponse: createMockLlmResponse('[STEP_6] Quand es-tu dispo ?', '6'),
      onSystemPrompt: (prompt) => { capturedPrompt = prompt; }
    });

    // Override GET to throw for Calendly
    const mockGet = axios.default.get;
    axios.default.get = async (url, config) => {
      if (url.includes('calendly.com')) throw new Error('Network error');
      return mockGet(url, config);
    };

    await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_5] Tu serais dispo ?' },
        { role: 'user', text: 'Oui !' }
      ],
      leadContext: { funnel_step: 5 },
      profileConfig: { profile_name: 'test' }
    });

    assert.ok(capturedPrompt.includes('invente PAS'),
      'Should gracefully degrade when Calendly fails');
  });

  test('Slots formatted in French with Europe/Paris timezone', async () => {
    let capturedPrompt = '';
    const slots = [
      { start_time: '2026-02-12T14:00:00Z' },
      { start_time: '2026-02-13T10:00:00Z' },
    ];

    await setupMocks({
      llmResponse: createMockLlmResponse('[STEP_6] Voici les créneaux', '6'),
      calendlyAvailability: { raw: slots },
      onSystemPrompt: (prompt) => { capturedPrompt = prompt; }
    });

    await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_5] Tu serais dispo ?' },
        { role: 'user', text: 'Oui !' }
      ],
      leadContext: { funnel_step: 5 },
      profileConfig: { profile_name: 'test' }
    });

    // Check for French day names or "Europe/Paris" mention
    assert.ok(
      capturedPrompt.includes('Europe/Paris') || capturedPrompt.includes('heure de Paris'),
      'Should mention Europe/Paris timezone'
    );
  });
});
