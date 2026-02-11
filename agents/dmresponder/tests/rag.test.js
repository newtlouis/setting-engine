/**
 * RAG Retriever Tests
 *
 * Tests keyword search, step filtering, deduplication,
 * and prompt formatting in the RAG pipeline.
 *
 * Uses an in-memory SQLite database (no OpenAI calls for embeddings).
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createTestDb } from './helpers/test-db.js';

let ctx;

describe('RAG Keyword Search', () => {
  beforeEach(() => { ctx = createTestDb(); });
  afterEach(() => { ctx.cleanup(); });

  test('"par curiosite" matches entry #1 via keyword "curiosite"', async () => {
    const results = await ctx.knowledgeRepo.searchByKeywords(1, 'je suis la par curiosite');
    assert.ok(results.length >= 1, 'Should find at least one match');
    assert.ok(results.some(r => r.id === 1), 'Should match entry #1');
  });

  test('"pas specialement" matches entry #2', async () => {
    const results = await ctx.knowledgeRepo.searchByKeywords(1, 'pas specialement ahah');
    assert.ok(results.length >= 1);
    assert.ok(results.some(r => r.id === 2), 'Should match entry #2');
  });

  test('No match on response content (only trigger_keywords)', async () => {
    // "Pas de souci" is in the content of entry #1 but not in keywords
    const results = await ctx.knowledgeRepo.searchByKeywords(1, 'Pas de souci');
    assert.strictEqual(results.length, 0, 'Should not match on content text');
  });

  test('"gratuit" matches entry #3', async () => {
    const results = await ctx.knowledgeRepo.searchByKeywords(1, 'c\'est gratuit ?');
    assert.ok(results.some(r => r.id === 3));
  });
});

describe('RAG Step Filtering', () => {
  beforeEach(() => { ctx = createTestDb(); });
  afterEach(() => { ctx.cleanup(); });

  test('Entry with steps=[1,2] excluded at step 3', () => {
    const entry = {
      id: 4, content: 'test', applicableSteps: [1, 2], score: 0.9
    };
    const filtered = ctx.ragRetriever.filterByStep([entry], 3);
    assert.strictEqual(filtered.length, 0, 'Entry should be excluded at step 3');
  });

  test('Entry with steps=[1,2] included at step 1', () => {
    const entry = {
      id: 4, content: 'test', applicableSteps: [1, 2], score: 0.9
    };
    const filtered = ctx.ragRetriever.filterByStep([entry], 1);
    assert.strictEqual(filtered.length, 1, 'Entry should be included at step 1');
  });

  test('Entry without applicableSteps included everywhere', () => {
    const entry = {
      id: 5, content: 'test', applicableSteps: null, score: 0.85
    };
    const filtered3 = ctx.ragRetriever.filterByStep([entry], 3);
    const filtered7 = ctx.ragRetriever.filterByStep([entry], 7);
    assert.strictEqual(filtered3.length, 1);
    assert.strictEqual(filtered7.length, 1);
  });

  test('Entry with empty applicableSteps array included everywhere', () => {
    const entry = {
      id: 5, content: 'test', applicableSteps: [], score: 0.85
    };
    const filtered = ctx.ragRetriever.filterByStep([entry], 5);
    assert.strictEqual(filtered.length, 1);
  });
});

describe('RAG Deduplication', () => {
  beforeEach(() => { ctx = createTestDb(); });
  afterEach(() => { ctx.cleanup(); });

  test('Same entry in semantic + keyword → appears once', () => {
    const semantic = [{ id: 1, content: 'test', score: 0.9 }];
    const keyword = [{ id: 1, content: 'test', matchedKeyword: 'curiosite' }];
    const deduped = ctx.ragRetriever.deduplicateResults(semantic, keyword);
    assert.strictEqual(deduped.length, 1, 'Should not duplicate');
    assert.strictEqual(deduped[0].score, 0.9, 'Should keep semantic score');
  });

  test('Entry only in keyword → added with score 0.8', () => {
    const semantic = [{ id: 1, content: 'a', score: 0.9 }];
    const keyword = [{ id: 2, content: 'b', matchedKeyword: 'test' }];
    const deduped = ctx.ragRetriever.deduplicateResults(semantic, keyword);
    assert.strictEqual(deduped.length, 2);
    const kwEntry = deduped.find(r => r.id === 2);
    assert.strictEqual(kwEntry.score, 0.8);
    assert.strictEqual(kwEntry.matchType, 'keyword');
  });

  test('Results sorted by score descending', () => {
    const semantic = [{ id: 1, content: 'a', score: 0.7 }];
    const keyword = [{ id: 2, content: 'b', matchedKeyword: 'x' }];
    const deduped = ctx.ragRetriever.deduplicateResults(semantic, keyword);
    assert.ok(deduped[0].score >= deduped[1].score, 'Should be sorted desc');
  });
});

describe('RAG Formatting', () => {
  beforeEach(() => { ctx = createTestDb(); });
  afterEach(() => { ctx.cleanup(); });

  test('formatForPrompt generates "CONNAISSANCES PERTINENTES" section', () => {
    const ragResults = {
      relevantKnowledge: [
        { id: 1, category: 'objection', situation: 'Test', content: 'Réponse test', score: 0.9 }
      ],
      similarConversations: []
    };
    const formatted = ctx.ragRetriever.formatForPrompt(ragResults);
    assert.ok(formatted.includes('CONNAISSANCES PERTINENTES'), 'Should contain header');
    assert.ok(formatted.includes('OBJECTION'), 'Should contain category label');
    assert.ok(formatted.includes('Réponse test'), 'Should contain content');
  });

  test('hasRelevantResults returns false when empty', () => {
    assert.ok(!ctx.ragRetriever.hasRelevantResults({
      relevantKnowledge: [],
      similarConversations: []
    }));
  });

  test('hasRelevantResults returns true with knowledge', () => {
    assert.ok(ctx.ragRetriever.hasRelevantResults({
      relevantKnowledge: [{ id: 1 }],
      similarConversations: []
    }));
  });
});
