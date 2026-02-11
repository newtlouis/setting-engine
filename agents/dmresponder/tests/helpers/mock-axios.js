/**
 * Mock Axios Helper
 *
 * Shared mock utilities for intercepting HTTP calls to OpenAI, Calendly,
 * and the Embeddings API in tests.
 */

import { mock } from 'node:test';

let originalPost = null;
let originalGet = null;

/**
 * Create a mock LLM (OpenAI) response in the expected axios format.
 */
export function createMockLlmResponse(message, stepUsed, bookingIntent = null) {
  return {
    data: {
      choices: [{
        message: {
          content: JSON.stringify({
            message,
            step_used: stepUsed,
            booking_intent: bookingIntent
          })
        }
      }]
    }
  };
}

/**
 * Create a mock Calendly availability response.
 * @param {{ thisWeek: {primary: Array, backup: Array}, nextWeek: {primary: Array, backup: Array} }} availability
 */
export function createMockCalendlyAvailability(availability = null) {
  if (!availability) {
    return {
      thisWeek: { primary: [], backup: [] },
      nextWeek: { primary: [], backup: [] }
    };
  }
  return availability;
}

/**
 * Create mock Calendly slots for testing.
 * @param {number} count Number of slots to generate
 * @returns {{ thisWeek: {primary: Array, backup: Array}, nextWeek: {primary: Array, backup: Array} }}
 */
export function createMockSlots(count = 3) {
  const baseDate = new Date('2026-02-12T10:00:00Z');
  const slots = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + i);
    d.setHours(14 + (i % 3), 0, 0, 0);
    slots.push({ start_time: d.toISOString(), status: 'available' });
  }
  return {
    thisWeek: {
      primary: slots.slice(0, 2),
      backup: slots.slice(2)
    },
    nextWeek: {
      primary: [],
      backup: []
    }
  };
}

/**
 * Setup axios mocks for OpenAI POST and optionally Calendly GET.
 *
 * @param {Object} options
 * @param {Object|Function} options.llmResponse - Mock response for OpenAI (or function(messages) => response)
 * @param {Object|null} options.calendlyAvailability - If set, mock fetchAvailability
 * @param {Function|null} options.onSystemPrompt - Callback receiving the system prompt content
 */
export async function setupMocks({ llmResponse, calendlyAvailability = undefined, onSystemPrompt = null }) {
  const axios = await import('axios');

  // Store originals
  if (!originalPost) originalPost = axios.default.post;
  if (!originalGet) originalGet = axios.default.get;

  // Mock POST (OpenAI + Calendly booking)
  axios.default.post = mock.fn(async (url, data, config) => {
    if (url.includes('openai.com') && url.includes('chat')) {
      // Capture system prompt if callback provided
      if (onSystemPrompt && data.messages) {
        const systemMsg = data.messages.find(m => m.role === 'system');
        if (systemMsg) onSystemPrompt(systemMsg.content);
      }
      return typeof llmResponse === 'function'
        ? llmResponse(data.messages)
        : llmResponse;
    }
    if (url.includes('openai.com') && url.includes('embeddings')) {
      // Mock embeddings — return a fake 16-dim vector
      const input = Array.isArray(data.input) ? data.input : [data.input];
      return {
        data: {
          data: input.map((_, i) => ({
            index: i,
            embedding: new Array(16).fill(0.1)
          }))
        }
      };
    }
    if (url.includes('calendly.com') && url.includes('invitees')) {
      return {
        data: {
          resource: { uri: 'https://calendly.com/test/booking-123' }
        }
      };
    }
    return originalPost(url, data, config);
  });

  // Mock GET (Calendly availability)
  axios.default.get = mock.fn(async (url, config) => {
    if (url.includes('calendly.com') && url.includes('users/me')) {
      return { data: { resource: { uri: 'https://api.calendly.com/users/test-user' } } };
    }
    if (url.includes('calendly.com') && url.includes('event_types')) {
      return {
        data: {
          collection: [{
            uri: 'https://api.calendly.com/event_types/test-event',
            slug: 'r1-diagnostic',
            locations: [{ kind: 'google_meet' }]
          }]
        }
      };
    }
    if (url.includes('calendly.com') && url.includes('available_times')) {
      const slots = calendlyAvailability?.raw || [];
      return { data: { collection: slots.map(s => ({ start_time: s.start_time })) } };
    }
    if (originalGet) return originalGet(url, config);
  });
}

/**
 * Convenience: setup only OpenAI mock (backward compat with existing tests pattern)
 */
export async function setupAxiosMock(mockResponse) {
  await setupMocks({ llmResponse: mockResponse });
}

/**
 * Restore original axios methods.
 */
export async function restoreAllMocks() {
  const axios = await import('axios');
  if (originalPost) {
    axios.default.post = originalPost;
    originalPost = null;
  }
  if (originalGet) {
    axios.default.get = originalGet;
    originalGet = null;
  }
}
