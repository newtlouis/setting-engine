/**
 * Booking Pipeline Tests
 *
 * Tests the full booking_intent chain from LLM response
 * through generateResponse() output.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { generateResponse, clearPromptCache } from '../src/engine.js';
import { setupMocks, restoreAllMocks, createMockLlmResponse } from './helpers/mock-axios.js';
import { normalizePhone } from '../../../shared/utils/calendly.js';

let originalEnv;

describe('Booking Pipeline', () => {
  beforeEach(() => {
    originalEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    clearPromptCache();
  });

  afterEach(async () => {
    process.env.OPENAI_API_KEY = originalEnv;
    await restoreAllMocks();
  });

  test('LLM returns complete booking_intent → passed in result', async () => {
    const bookingIntent = {
      slot: '2026-02-10T14:00:00Z',
      email: 'marie@mail.com',
      phone: '0612345678'
    };

    await setupMocks({
      llmResponse: createMockLlmResponse(
        '[STEP_8] C\'est noté !', '8', bookingIntent
      )
    });

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_7] Ton email et téléphone ?' },
        { role: 'user', text: 'marie@mail.com et 0612345678' }
      ],
      leadContext: { funnel_step: 7 }
    });

    assert.ok(result.booking_intent, 'Should have booking_intent');
    assert.strictEqual(result.booking_intent.email, 'marie@mail.com');
    assert.strictEqual(result.booking_intent.slot, '2026-02-10T14:00:00Z');
    assert.strictEqual(result.booking_intent.phone, '0612345678');
  });

  test('LLM returns booking_intent null → result.booking_intent is null', async () => {
    await setupMocks({
      llmResponse: createMockLlmResponse('[STEP_5] Tu serais dispo ?', '5', null)
    });

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_4] Quel objectif ?' },
        { role: 'user', text: 'Avoir confiance en moi' }
      ],
      leadContext: { funnel_step: 4 }
    });

    assert.strictEqual(result.booking_intent, null, 'booking_intent should be null');
  });

  test('booking_intent without email → still passed through', async () => {
    const bookingIntent = {
      slot: '2026-02-10T14:00:00Z',
      email: null,
      phone: '0612345678'
    };

    await setupMocks({
      llmResponse: createMockLlmResponse('[STEP_7] Ton email ?', '7', bookingIntent)
    });

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_6] Mardi 14h ?' },
        { role: 'user', text: 'Ok pour mardi ! Mon tel: 0612345678' }
      ],
      leadContext: { funnel_step: 6 }
    });

    assert.ok(result.booking_intent, 'Should have booking_intent');
    assert.strictEqual(result.booking_intent.email, null, 'Email should be null');
  });

  test('Phone normalized correctly in normalizePhone (used before Calendly)', () => {
    // Verify normalizePhone works correctly before it's used in createBooking
    assert.strictEqual(normalizePhone('0612345678'), '+33612345678');
    assert.strictEqual(normalizePhone('0475123456', 'belge'), '+32475123456');
    assert.strictEqual(normalizePhone('5145551234', 'canada'), '+15145551234');
  });

  test('step_used is propagated correctly from LLM response', async () => {
    await setupMocks({
      llmResponse: createMockLlmResponse('[STEP_6] Mardi ou jeudi ?', '6')
    });

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_5] Dispo cette semaine ?' },
        { role: 'user', text: 'Oui !' }
      ],
      leadContext: { funnel_step: 5 }
    });

    assert.strictEqual(result.step_used, '6');
  });

  test('LLM returns invalid JSON → fallback to raw message', async () => {
    const axios = await import('axios');

    await setupMocks({
      llmResponse: {
        data: {
          choices: [{
            message: {
              content: 'Not valid JSON at all'
            }
          }]
        }
      }
    });

    const result = await generateResponse({
      conversationHistory: [
        { role: 'user', text: 'Salut' }
      ]
    });

    assert.ok(result.next_message, 'Should still have a message');
    assert.strictEqual(result.step_used, null, 'step_used should be null on JSON parse failure');
    assert.strictEqual(result.booking_intent, null, 'booking_intent should be null');
  });
});
