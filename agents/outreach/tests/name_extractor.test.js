import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { isCommonWord, isUsernameFragment, isRealFirstName } from '../src/name_extractor.js';

/**
 * Helper: creates a mock fetch that returns OpenAI + Genderize responses
 */
function mockFetch(aiName, genderizeCount = 500) {
  return mock.fn(async (url) => {
    if (url.includes('api.openai.com')) {
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: aiName } }]
        })
      };
    }
    if (url.includes('genderize.io')) {
      return {
        ok: true,
        json: async () => ({ count: genderizeCount, name: aiName.toLowerCase() })
      };
    }
    return { ok: false };
  });
}

describe('isCommonWord', () => {
  it('rejects French articles and prepositions', () => {
    assert.ok(isCommonWord('De'));
    assert.ok(isCommonWord('du'));
    assert.ok(isCommonWord('La'));
    assert.ok(isCommonWord('les'));
    assert.ok(isCommonWord('pour'));
    assert.ok(isCommonWord('avec'));
  });

  it('rejects English articles and prepositions', () => {
    assert.ok(isCommonWord('The'));
    assert.ok(isCommonWord('and'));
    assert.ok(isCommonWord('For'));
    assert.ok(isCommonWord('with'));
  });

  it('rejects business/role words', () => {
    assert.ok(isCommonWord('Coach'));
    assert.ok(isCommonWord('coaching'));
    assert.ok(isCommonWord('Formatrice'));
    assert.ok(isCommonWord('Thérapeute'));
  });

  it('rejects abstract concepts', () => {
    assert.ok(isCommonWord('Présence'));
    assert.ok(isCommonWord('Harmonie'));
    assert.ok(isCommonWord('Essence'));
    assert.ok(isCommonWord('Énergie'));
  });

  it('handles accent normalization', () => {
    assert.ok(isCommonWord('présence'));
    assert.ok(isCommonWord('presence'));
    assert.ok(isCommonWord('Présence'));
  });

  it('accepts real first names', () => {
    assert.ok(!isCommonWord('Marie'));
    assert.ok(!isCommonWord('Jean'));
    assert.ok(!isCommonWord('Pati'));
    assert.ok(!isCommonWord('Annelise'));
    assert.ok(!isCommonWord('Guilherme'));
  });
});

describe('isUsernameFragment', () => {
  it('rejects ALL CAPS short strings (acronyms)', () => {
    assert.ok(isUsernameFragment('ABC', 'abctalktv'));
    assert.ok(isUsernameFragment('FIT', 'fitpro'));
  });

  it('rejects segments ending with brand suffixes', () => {
    assert.ok(isUsernameFragment('fitpro', 'fitpro_paris'));
    assert.ok(isUsernameFragment('abctalk', 'abctalk_tv'));
  });

  it('rejects very short fragments from username', () => {
    assert.ok(isUsernameFragment('abc', 'abctalktv'));
    assert.ok(isUsernameFragment('Max', 'max123'));
  });

  it('accepts real names that happen to be in the username', () => {
    assert.ok(!isUsernameFragment('Marie', 'marie.yoga.paris'));
    assert.ok(!isUsernameFragment('Julie', 'julie_coach'));
    assert.ok(!isUsernameFragment('Annelise', 'annelisebasque_formations'));
  });

  it('returns false when result is not in username', () => {
    assert.ok(!isUsernameFragment('Patricia', 'someuser123'));
  });
});

describe('isRealFirstName (Genderize.io)', () => {
  let originalFetch;

  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('accepts names with count >= 100', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ count: 5000, name: 'marie' })
    }));
    assert.ok(await isRealFirstName('Marie'));
  });

  it('rejects names with count < 100', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ count: 12, name: 'wellme' })
    }));
    assert.ok(!(await isRealFirstName('Wellme')));
  });

  it('rejects on API error (zero false positive)', async () => {
    globalThis.fetch = mock.fn(async () => ({ ok: false }));
    assert.ok(!(await isRealFirstName('Marie')));
  });

  it('rejects on network failure (zero false positive)', async () => {
    globalThis.fetch = mock.fn(async () => { throw new Error('Network error'); });
    assert.ok(!(await isRealFirstName('Marie')));
  });
});
