/**
 * Engine Error Handling Tests
 *
 * Tests resilience of the engine against:
 *   - OpenAI API failures (429, 500, network errors)
 *   - Invalid conversation history
 *   - Missing API key
 *   - Malformed LLM responses
 *   - generateRevivalMessage function
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { generateResponse, generateRevivalMessage, clearPromptCache } from '../src/engine.js';
import { setupMocks, restoreAllMocks, createMockLlmResponse } from './helpers/mock-axios.js';

let originalEnv;

describe('Engine Error Handling', () => {
  beforeEach(() => {
    originalEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    clearPromptCache();
  });

  afterEach(async () => {
    process.env.OPENAI_API_KEY = originalEnv;
    await restoreAllMocks();
  });

  // === MISSING API KEY ===

  test('No OPENAI_API_KEY → throws descriptive error', async () => {
    delete process.env.OPENAI_API_KEY;

    await assert.rejects(
      () => generateResponse({
        conversationHistory: [{ role: 'user', text: 'Salut' }]
      }),
      (err) => {
        assert.ok(err.message.includes('OPENAI_API_KEY'), 'Error should mention OPENAI_API_KEY');
        return true;
      }
    );
  });

  // === INVALID CONVERSATION HISTORY ===

  test('Empty conversation history → throws', async () => {
    await assert.rejects(
      () => generateResponse({ conversationHistory: [] }),
      (err) => {
        assert.ok(err.message.includes('empty'), 'Error should mention empty history');
        return true;
      }
    );
  });

  test('Non-array conversation history → throws', async () => {
    await assert.rejects(
      () => generateResponse({ conversationHistory: 'not an array' }),
      (err) => {
        assert.ok(err.message.includes('array'), 'Error should mention array requirement');
        return true;
      }
    );
  });

  test('Message without role → throws', async () => {
    await assert.rejects(
      () => generateResponse({
        conversationHistory: [{ text: 'missing role' }]
      }),
      (err) => {
        assert.ok(err.message.includes('role'), 'Error should mention role');
        return true;
      }
    );
  });

  test('Message without text → throws', async () => {
    await assert.rejects(
      () => generateResponse({
        conversationHistory: [{ role: 'user' }]
      }),
      (err) => {
        assert.ok(err.message.includes('text'), 'Error should mention text');
        return true;
      }
    );
  });

  test('Invalid role → throws', async () => {
    await assert.rejects(
      () => generateResponse({
        conversationHistory: [{ role: 'system', text: 'hello' }]
      }),
      (err) => {
        assert.ok(err.message.includes('user') || err.message.includes('assistant'),
          'Error should mention valid roles');
        return true;
      }
    );
  });

  // === OPENAI API FAILURES ===

  test('OpenAI returns 429 (rate limit) → throws', async () => {
    const axios = await import('axios');
    const originalPost = axios.default.post;
    axios.default.post = async (url) => {
      if (url.includes('openai.com')) {
        const error = new Error('Rate limit exceeded');
        error.response = { status: 429, data: { error: { message: 'Rate limit exceeded' } } };
        throw error;
      }
      return originalPost(url);
    };

    await assert.rejects(
      () => generateResponse({
        conversationHistory: [{ role: 'user', text: 'Salut' }]
      }),
      (err) => {
        assert.ok(err.message.includes('Failed to get a response'));
        return true;
      }
    );

    axios.default.post = originalPost;
  });

  test('OpenAI returns 500 (server error) → throws', async () => {
    const axios = await import('axios');
    const originalPost = axios.default.post;
    axios.default.post = async (url) => {
      if (url.includes('openai.com')) {
        const error = new Error('Internal Server Error');
        error.response = { status: 500, data: { error: { message: 'Internal server error' } } };
        throw error;
      }
      return originalPost(url);
    };

    await assert.rejects(
      () => generateResponse({
        conversationHistory: [{ role: 'user', text: 'Salut' }]
      }),
      (err) => {
        assert.ok(err.message.includes('Failed to get a response'));
        return true;
      }
    );

    axios.default.post = originalPost;
  });

  test('OpenAI network timeout → throws', async () => {
    const axios = await import('axios');
    const originalPost = axios.default.post;
    axios.default.post = async (url) => {
      if (url.includes('openai.com')) {
        throw new Error('ECONNABORTED: timeout of 30000ms exceeded');
      }
      return originalPost(url);
    };

    await assert.rejects(
      () => generateResponse({
        conversationHistory: [{ role: 'user', text: 'Salut' }]
      }),
      (err) => {
        assert.ok(err.message.includes('Failed to get a response'));
        return true;
      }
    );

    axios.default.post = originalPost;
  });

  // === MALFORMED LLM RESPONSES ===

  test('OpenAI returns empty choices → throws', async () => {
    await setupMocks({
      llmResponse: { data: { choices: [] } }
    });

    await assert.rejects(
      () => generateResponse({
        conversationHistory: [{ role: 'user', text: 'Salut' }]
      }),
      (err) => {
        assert.ok(err.message.includes('Failed to get a response') || err.message.includes('No response'));
        return true;
      }
    );
  });

  test('Valid JSON but missing "message" field → still works (returns undefined message)', async () => {
    await setupMocks({
      llmResponse: {
        data: {
          choices: [{
            message: { content: JSON.stringify({ step_used: '3', booking_intent: null }) }
          }]
        }
      }
    });

    const result = await generateResponse({
      conversationHistory: [{ role: 'user', text: 'Salut' }]
    });

    // The engine returns json.message which would be undefined
    assert.strictEqual(result.step_used, '3');
  });

  test('Valid JSON with extra fields → ignores them', async () => {
    await setupMocks({
      llmResponse: {
        data: {
          choices: [{
            message: {
              content: JSON.stringify({
                message: '[STEP_3] Hello',
                step_used: '3',
                booking_intent: null,
                extra_field: 'ignored',
                another: 123
              })
            }
          }]
        }
      }
    });

    const result = await generateResponse({
      conversationHistory: [{ role: 'user', text: 'Salut' }]
    });

    assert.strictEqual(result.next_message, '[STEP_3] Hello');
    assert.strictEqual(result.step_used, '3');
  });

  test('step_used as number instead of string → passed through', async () => {
    await setupMocks({
      llmResponse: {
        data: {
          choices: [{
            message: {
              content: JSON.stringify({ message: '[STEP_3] Test', step_used: 3, booking_intent: null })
            }
          }]
        }
      }
    });

    const result = await generateResponse({
      conversationHistory: [{ role: 'user', text: 'Test' }]
    });

    assert.strictEqual(result.step_used, 3);
  });

  // === GENERATE REVIVAL MESSAGE ===

  test('generateRevivalMessage produces a follow-up message', async () => {
    await setupMocks({
      llmResponse: createMockLlmResponse(
        'Hey ! Comment tu vas ? Tu as eu le temps de réfléchir ?', null
      )
    });

    const result = await generateRevivalMessage(
      [
        { role: 'assistant', text: 'Ok pas de souci !' },
        { role: 'user', text: 'Je suis occupée là, plus tard' }
      ],
      { username: 'test', funnel_step: 3 }
    );

    assert.ok(result.message, 'Should have a revival message');
    assert.ok(result.message.length > 5, 'Message should be non-trivial');
  });

  test('generateRevivalMessage without API key → throws', async () => {
    delete process.env.OPENAI_API_KEY;

    await assert.rejects(
      () => generateRevivalMessage(
        [{ role: 'user', text: 'Plus tard' }],
        { username: 'test' }
      ),
      (err) => {
        assert.ok(err.message.includes('OPENAI_API_KEY'));
        return true;
      }
    );
  });
});
