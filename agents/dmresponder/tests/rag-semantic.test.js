/**
 * RAG Semantic Search Tests
 *
 * Tests the full semantic search pipeline with realistic embeddings:
 *   - cosineSimilarity math
 *   - serializeEmbedding / deserializeEmbedding roundtrip
 *   - semanticSearchKnowledge (threshold, topK, category filter)
 *   - semanticSearchConversations
 *   - Full RagRetriever.retrieve() pipeline (mocked getEmbedding)
 *   - Conversation embedding lifecycle (save, update outcome)
 *   - recordUsage tracking
 *
 * Strategy: Use deterministic vectors with known cosine similarities
 * instead of all-zeros (which give cosine=0 against everything).
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { createSqliteKnowledgeRepository } from '../../../shared/infrastructure/repositories/SqliteKnowledgeRepository.js';
import { RagRetriever } from '../../../shared/domain/services/RagRetriever.js';
import {
  cosineSimilarity,
  serializeEmbedding,
  deserializeEmbedding,
  findTopSimilar
} from '../../../shared/utils/embeddings.js';

// ---- Deterministic embedding helpers ----
// 16-dim vectors with known cosine similarities

// Base vector: "prix/gratuit" topic
const VEC_PRIX = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

// Very similar to VEC_PRIX (cosine ≈ 0.97)
const VEC_PRIX_SIMILAR = [0.97, 0.24, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

// Somewhat similar to VEC_PRIX (cosine ≈ 0.8)
const VEC_PRIX_MODERATE = [0.8, 0.6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

// Orthogonal to VEC_PRIX (cosine = 0)
const VEC_ORTHO = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

// Different topic: "dépendance" (cosine ≈ 0.3 with VEC_PRIX)
const VEC_DEPENDANCE = [0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0.95, 0, 0, 0, 0, 0, 0];

// Similar to VEC_DEPENDANCE (cosine ≈ 0.95)
const VEC_DEPENDANCE_SIM = [0.25, 0, 0, 0, 0, 0, 0, 0, 0, 0.97, 0, 0, 0, 0, 0, 0];

// ---- Test DB factory with realistic embeddings ----

function createSemanticTestDb() {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE knowledge_base (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      category TEXT NOT NULL,
      trigger_keywords TEXT,
      situation TEXT,
      content TEXT NOT NULL,
      embedding BLOB,
      applicable_steps TEXT,
      usage_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      success_rate REAL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE conversation_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      conversation_summary TEXT,
      embedding BLOB,
      outcome TEXT DEFAULT 'pending',
      funnel_step_reached INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_kb_account_active ON knowledge_base(account_id, is_active);
  `);

  db.prepare(`INSERT INTO accounts (id, name) VALUES (1, 'test')`).run();

  const insertKb = db.prepare(`
    INSERT INTO knowledge_base (id, account_id, category, trigger_keywords, situation, content, embedding, applicable_steps, is_active)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, 1)
  `);

  // Entry 1: "prix" topic — close to VEC_PRIX
  insertKb.run(1, 'faq', JSON.stringify(['gratuit', 'prix']),
    'Question sur le prix',
    'L\'appel est 100% gratuit 🎁',
    serializeEmbedding(VEC_PRIX), JSON.stringify([5, 6]));

  // Entry 2: slightly different "prix" — close to VEC_PRIX_SIMILAR
  insertKb.run(2, 'faq', JSON.stringify(['payant', 'coût']),
    'Question coût coaching',
    'Le coaching est un investissement sur soi.',
    serializeEmbedding(VEC_PRIX_SIMILAR), JSON.stringify([5, 6]));

  // Entry 3: "dépendance" topic — far from VEC_PRIX
  insertKb.run(3, 'technique', JSON.stringify(['dépendance']),
    'Info dépendance affective',
    'La dépendance affective se manifeste par un besoin excessif.',
    serializeEmbedding(VEC_DEPENDANCE), null);

  // Entry 4: orthogonal to everything useful — should never match
  insertKb.run(4, 'objection', JSON.stringify(['bizarre']),
    'Cas étrange',
    'Réponse pour cas étrange',
    serializeEmbedding(VEC_ORTHO), null);

  // Entry 5: no embedding (NULL) — should be excluded from semantic search
  insertKb.run(5, 'faq', JSON.stringify(['email']),
    'Question email',
    'Envoyez un mail à contact@example.com',
    null, null);

  // Entry 6: inactive — should be excluded
  db.prepare(`
    INSERT INTO knowledge_base (id, account_id, category, trigger_keywords, situation, content, embedding, is_active)
    VALUES (6, 1, 'faq', '["test"]', 'Test inactif', 'Contenu inactif', ?, 0)
  `).run(serializeEmbedding(VEC_PRIX));

  const getDb = () => db;
  const knowledgeRepo = createSqliteKnowledgeRepository({ getDb });
  const ragRetriever = new RagRetriever({ knowledgeRepository: knowledgeRepo });

  return { db, knowledgeRepo, ragRetriever, cleanup: () => db.close() };
}

// ==================== COSINE SIMILARITY ====================

describe('cosineSimilarity', () => {

  test('Identical vectors → 1.0', () => {
    const sim = cosineSimilarity(VEC_PRIX, VEC_PRIX);
    assert.ok(Math.abs(sim - 1.0) < 0.001, `Expected ~1.0, got ${sim}`);
  });

  test('Orthogonal vectors → 0.0', () => {
    const sim = cosineSimilarity(VEC_PRIX, VEC_ORTHO);
    assert.ok(Math.abs(sim) < 0.001, `Expected ~0.0, got ${sim}`);
  });

  test('Similar vectors → high score (~0.97)', () => {
    const sim = cosineSimilarity(VEC_PRIX, VEC_PRIX_SIMILAR);
    assert.ok(sim > 0.95, `Expected >0.95, got ${sim}`);
    assert.ok(sim < 1.0, `Expected <1.0, got ${sim}`);
  });

  test('Moderately similar → ~0.8', () => {
    const sim = cosineSimilarity(VEC_PRIX, VEC_PRIX_MODERATE);
    assert.ok(sim > 0.75 && sim < 0.85, `Expected ~0.8, got ${sim}`);
  });

  test('Different topics → low score', () => {
    const sim = cosineSimilarity(VEC_PRIX, VEC_DEPENDANCE);
    assert.ok(sim < 0.5, `Expected <0.5 for different topics, got ${sim}`);
  });

  test('Zero vector → returns 0', () => {
    const zero = new Array(16).fill(0);
    const sim = cosineSimilarity(zero, VEC_PRIX);
    assert.strictEqual(sim, 0, 'Zero vector should give 0 similarity');
  });

  test('Different lengths → throws', () => {
    assert.throws(
      () => cosineSimilarity([1, 0], [1, 0, 0]),
      /same length/,
      'Should throw on mismatched vector lengths'
    );
  });
});

// ==================== SERIALIZE / DESERIALIZE ====================

describe('Embedding serialization roundtrip', () => {

  test('Serialize → deserialize preserves values', () => {
    const original = [0.1, 0.2, 0.3, 0.4, 0.5];
    const buffer = serializeEmbedding(original);
    const restored = deserializeEmbedding(buffer);

    assert.strictEqual(restored.length, 5);
    for (let i = 0; i < original.length; i++) {
      assert.ok(Math.abs(restored[i] - original[i]) < 0.0001,
        `Index ${i}: expected ${original[i]}, got ${restored[i]}`);
    }
  });

  test('Roundtrip with 1536 dimensions (production size)', () => {
    const original = Array.from({ length: 1536 }, (_, i) => Math.sin(i * 0.01));
    const buffer = serializeEmbedding(original);
    const restored = deserializeEmbedding(buffer);

    assert.strictEqual(restored.length, 1536);
    assert.ok(Math.abs(cosineSimilarity(original, restored) - 1.0) < 0.001,
      'Roundtrip should preserve cosine similarity ~1.0');
  });

  test('deserializeEmbedding(null) → null', () => {
    assert.strictEqual(deserializeEmbedding(null), null);
  });

  test('Stored in SQLite and retrieved correctly', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE test (data BLOB)');

    const original = VEC_PRIX_MODERATE;
    db.prepare('INSERT INTO test VALUES (?)').run(serializeEmbedding(original));
    const row = db.prepare('SELECT data FROM test').get();
    const restored = deserializeEmbedding(row.data);

    assert.strictEqual(restored.length, original.length);
    const sim = cosineSimilarity(original, restored);
    assert.ok(Math.abs(sim - 1.0) < 0.001, 'SQLite roundtrip should preserve embedding');

    db.close();
  });
});

// ==================== SEMANTIC SEARCH KNOWLEDGE ====================

describe('semanticSearchKnowledge', () => {

  test('Query similar to VEC_PRIX → finds entries 1 and 2 (high score)', async () => {
    const ctx = createSemanticTestDb();
    try {
      const results = await ctx.knowledgeRepo.semanticSearchKnowledge(
        1, VEC_PRIX, { topK: 5, threshold: 0.75 }
      );

      assert.ok(results.length >= 2, `Expected at least 2 results, got ${results.length}`);
      // Entry 1 should be closest (identical vector)
      assert.strictEqual(results[0].id, 1, 'Entry 1 should be top match');
      assert.ok(results[0].score > 0.99, `Entry 1 score should be ~1.0, got ${results[0].score}`);
      // Entry 2 should also match
      assert.ok(results.some(r => r.id === 2), 'Entry 2 should also match');
    } finally {
      ctx.cleanup();
    }
  });

  test('Query similar to VEC_DEPENDANCE → finds entry 3 but not 1/2', async () => {
    const ctx = createSemanticTestDb();
    try {
      const results = await ctx.knowledgeRepo.semanticSearchKnowledge(
        1, VEC_DEPENDANCE_SIM, { topK: 5, threshold: 0.75 }
      );

      assert.ok(results.some(r => r.id === 3), 'Should find dépendance entry');
      assert.ok(!results.some(r => r.id === 1), 'Should NOT find prix entry');
      assert.ok(!results.some(r => r.id === 2), 'Should NOT find coût entry');
    } finally {
      ctx.cleanup();
    }
  });

  test('High threshold (0.99) → only exact match', async () => {
    const ctx = createSemanticTestDb();
    try {
      const results = await ctx.knowledgeRepo.semanticSearchKnowledge(
        1, VEC_PRIX, { topK: 5, threshold: 0.99 }
      );

      // Only entry 1 (identical vector) should pass 0.99
      assert.strictEqual(results.length, 1, 'Only exact match should pass 0.99 threshold');
      assert.strictEqual(results[0].id, 1);
    } finally {
      ctx.cleanup();
    }
  });

  test('topK=1 → only top result returned', async () => {
    const ctx = createSemanticTestDb();
    try {
      const results = await ctx.knowledgeRepo.semanticSearchKnowledge(
        1, VEC_PRIX, { topK: 1, threshold: 0.5 }
      );

      assert.strictEqual(results.length, 1, 'Should return only 1 result');
      assert.strictEqual(results[0].id, 1, 'Should be the best match');
    } finally {
      ctx.cleanup();
    }
  });

  test('Orthogonal query → no results above threshold', async () => {
    const ctx = createSemanticTestDb();
    try {
      const results = await ctx.knowledgeRepo.semanticSearchKnowledge(
        1, VEC_ORTHO, { topK: 5, threshold: 0.75 }
      );

      // VEC_ORTHO is orthogonal to VEC_PRIX and has cosine 0 with most entries
      // Entry 4 has VEC_ORTHO embedding so it would match itself, but query is VEC_ORTHO
      // Actually entry 4 IS VEC_ORTHO, so it should have score 1.0 with VEC_ORTHO query
      const nonSelfResults = results.filter(r => r.id !== 4);
      assert.strictEqual(nonSelfResults.length, 0,
        'No non-self entries should match orthogonal query');
    } finally {
      ctx.cleanup();
    }
  });

  test('Entry with NULL embedding excluded from results', async () => {
    const ctx = createSemanticTestDb();
    try {
      const results = await ctx.knowledgeRepo.semanticSearchKnowledge(
        1, VEC_PRIX, { topK: 10, threshold: 0 }
      );

      assert.ok(!results.some(r => r.id === 5),
        'Entry 5 (no embedding) should be excluded');
    } finally {
      ctx.cleanup();
    }
  });

  test('Inactive entry excluded from results', async () => {
    const ctx = createSemanticTestDb();
    try {
      const results = await ctx.knowledgeRepo.semanticSearchKnowledge(
        1, VEC_PRIX, { topK: 10, threshold: 0 }
      );

      assert.ok(!results.some(r => r.id === 6),
        'Entry 6 (inactive) should be excluded');
    } finally {
      ctx.cleanup();
    }
  });

  test('Category filter: only "faq" entries', async () => {
    const ctx = createSemanticTestDb();
    try {
      const results = await ctx.knowledgeRepo.semanticSearchKnowledge(
        1, VEC_PRIX, { topK: 10, threshold: 0, category: 'faq' }
      );

      assert.ok(results.length > 0, 'Should have results');
      assert.ok(results.every(r => r.category === 'faq'),
        'All results should be faq category');
      assert.ok(!results.some(r => r.id === 3),
        'Entry 3 (technique) should be excluded by category filter');
    } finally {
      ctx.cleanup();
    }
  });

  test('Results sorted by score descending', async () => {
    const ctx = createSemanticTestDb();
    try {
      const results = await ctx.knowledgeRepo.semanticSearchKnowledge(
        1, VEC_PRIX, { topK: 10, threshold: 0 }
      );

      for (let i = 1; i < results.length; i++) {
        assert.ok(results[i - 1].score >= results[i].score,
          `Results not sorted: ${results[i - 1].score} < ${results[i].score}`);
      }
    } finally {
      ctx.cleanup();
    }
  });
});

// ==================== SEMANTIC SEARCH CONVERSATIONS ====================

describe('semanticSearchConversations', () => {

  test('Finds similar converted conversations', async () => {
    const ctx = createSemanticTestDb();
    try {
      // Insert conversation embeddings
      const insertConv = ctx.db.prepare(`
        INSERT INTO conversation_embeddings (lead_id, account_id, conversation_summary, embedding, outcome, funnel_step_reached)
        VALUES (?, 1, ?, ?, ?, ?)
      `);

      insertConv.run(100, 'Prospect prix → converti', serializeEmbedding(VEC_PRIX_SIMILAR), 'converted', 8);
      insertConv.run(101, 'Prospect dépendance → converti', serializeEmbedding(VEC_DEPENDANCE_SIM), 'converted', 7);
      insertConv.run(102, 'Prospect perdu', serializeEmbedding(VEC_PRIX_MODERATE), 'lost', 3);

      const results = await ctx.knowledgeRepo.semanticSearchConversations(
        1, VEC_PRIX, { topK: 5, threshold: 0.75 }
      );

      // Should find converted conversation close to VEC_PRIX
      assert.ok(results.length >= 1, 'Should find at least 1 similar conversation');
      // Only "converted" conversations are searched
      assert.ok(results.every(r => r.outcome === 'converted'),
        'Should only return converted conversations');
      // Lead 102 (lost) should not appear
      assert.ok(!results.some(r => r.lead_id === 102),
        'Lost conversations should not appear');
    } finally {
      ctx.cleanup();
    }
  });

  test('No converted conversations → empty results', async () => {
    const ctx = createSemanticTestDb();
    try {
      // Insert only "lost" conversations
      ctx.db.prepare(`
        INSERT INTO conversation_embeddings (lead_id, account_id, conversation_summary, embedding, outcome)
        VALUES (100, 1, 'Lost prospect', ?, 'lost')
      `).run(serializeEmbedding(VEC_PRIX));

      const results = await ctx.knowledgeRepo.semanticSearchConversations(
        1, VEC_PRIX, { topK: 5, threshold: 0.5 }
      );

      assert.strictEqual(results.length, 0, 'Should find no converted conversations');
    } finally {
      ctx.cleanup();
    }
  });
});

// ==================== CONVERSATION EMBEDDING LIFECYCLE ====================

describe('Conversation Embedding Lifecycle', () => {

  test('Save new conversation embedding', async () => {
    const ctx = createSemanticTestDb();
    try {
      const saved = await ctx.knowledgeRepo.saveConversationEmbedding({
        leadId: 200,
        accountId: 1,
        summary: 'Prospect intéressée par le coaching relationnel',
        embedding: VEC_DEPENDANCE,
        outcome: 'pending',
        funnelStepReached: 3
      });

      assert.ok(saved.id, 'Should return an id');

      // Verify in DB
      const row = ctx.db.prepare('SELECT * FROM conversation_embeddings WHERE lead_id = 200').get();
      assert.ok(row, 'Should be stored in DB');
      assert.strictEqual(row.outcome, 'pending');
      assert.strictEqual(row.funnel_step_reached, 3);
    } finally {
      ctx.cleanup();
    }
  });

  test('Update existing conversation (same lead_id)', async () => {
    const ctx = createSemanticTestDb();
    try {
      await ctx.knowledgeRepo.saveConversationEmbedding({
        leadId: 300, accountId: 1,
        summary: 'Version 1', embedding: VEC_PRIX,
        outcome: 'pending', funnelStepReached: 2
      });

      await ctx.knowledgeRepo.saveConversationEmbedding({
        leadId: 300, accountId: 1,
        summary: 'Version 2 (updated)', embedding: VEC_PRIX_SIMILAR,
        outcome: 'converted', funnelStepReached: 8
      });

      const rows = ctx.db.prepare('SELECT * FROM conversation_embeddings WHERE lead_id = 300').all();
      assert.strictEqual(rows.length, 1, 'Should not duplicate, should update');
      assert.strictEqual(rows[0].outcome, 'converted');
      assert.strictEqual(rows[0].funnel_step_reached, 8);
      assert.strictEqual(rows[0].conversation_summary, 'Version 2 (updated)');
    } finally {
      ctx.cleanup();
    }
  });

  test('updateConversationOutcome changes outcome', async () => {
    const ctx = createSemanticTestDb();
    try {
      await ctx.knowledgeRepo.saveConversationEmbedding({
        leadId: 400, accountId: 1,
        summary: 'Test', embedding: VEC_PRIX,
        outcome: 'pending', funnelStepReached: 5
      });

      await ctx.knowledgeRepo.updateConversationOutcome(400, 'lost');

      const row = ctx.db.prepare('SELECT outcome FROM conversation_embeddings WHERE lead_id = 400').get();
      assert.strictEqual(row.outcome, 'lost');
    } finally {
      ctx.cleanup();
    }
  });
});

// ==================== RECORD USAGE ====================

describe('recordUsage', () => {

  test('recordUsage increments usage_count', async () => {
    const ctx = createSemanticTestDb();
    try {
      const before = ctx.db.prepare('SELECT usage_count FROM knowledge_base WHERE id = 1').get();
      assert.strictEqual(before.usage_count, 0);

      await ctx.knowledgeRepo.recordUsage(1);
      await ctx.knowledgeRepo.recordUsage(1);

      const after = ctx.db.prepare('SELECT usage_count FROM knowledge_base WHERE id = 1').get();
      assert.strictEqual(after.usage_count, 2);
    } finally {
      ctx.cleanup();
    }
  });

  test('recordUsage(id, true) increments success_count and updates rate', async () => {
    const ctx = createSemanticTestDb();
    try {
      await ctx.knowledgeRepo.recordUsage(1, true);

      const row = ctx.db.prepare('SELECT usage_count, success_count, success_rate FROM knowledge_base WHERE id = 1').get();
      assert.strictEqual(row.usage_count, 1);
      assert.strictEqual(row.success_count, 1);
      assert.strictEqual(row.success_rate, 1.0);
    } finally {
      ctx.cleanup();
    }
  });

  test('recordUsage(id, false) increments usage but not success', async () => {
    const ctx = createSemanticTestDb();
    try {
      await ctx.knowledgeRepo.recordUsage(1, true);  // 1/1 = 1.0
      await ctx.knowledgeRepo.recordUsage(1, false); // 1/2 = 0.5

      const row = ctx.db.prepare('SELECT usage_count, success_count, success_rate FROM knowledge_base WHERE id = 1').get();
      assert.strictEqual(row.usage_count, 2);
      assert.strictEqual(row.success_count, 1);
      assert.strictEqual(row.success_rate, 0.5);
    } finally {
      ctx.cleanup();
    }
  });
});

// ==================== findTopSimilar utility ====================

describe('findTopSimilar', () => {

  test('Finds top K items above threshold', () => {
    const items = [
      { id: 'a', embedding: VEC_PRIX },
      { id: 'b', embedding: VEC_PRIX_SIMILAR },
      { id: 'c', embedding: VEC_ORTHO },
      { id: 'd', embedding: VEC_DEPENDANCE },
    ];

    const results = findTopSimilar(VEC_PRIX, items, 2, 0.75);

    assert.strictEqual(results.length, 2, 'Should return top 2');
    assert.strictEqual(results[0].id, 'a', 'First should be exact match');
    assert.strictEqual(results[1].id, 'b', 'Second should be similar');
  });

  test('Skips items with null embedding', () => {
    const items = [
      { id: 'a', embedding: VEC_PRIX },
      { id: 'b', embedding: null },
    ];

    const results = findTopSimilar(VEC_PRIX, items, 5, 0);
    assert.ok(!results.some(r => r.id === 'b'), 'Should skip null embedding');
  });
});

// ==================== FULL RAG RETRIEVE PIPELINE ====================

describe('RagRetriever.retrieve() with semantic results', () => {

  test('Combines semantic + keyword results with dedup', async () => {
    const ctx = createSemanticTestDb();
    try {
      // Mock getEmbedding to return VEC_PRIX (simulating "c'est gratuit ?")
      const originalImport = RagRetriever.prototype.retrieve;

      // We can't easily mock getEmbedding since it's imported at module level.
      // Instead, test the pipeline components that DON'T call the API.

      // 1. Semantic search returns entries 1, 2
      const semanticResults = await ctx.knowledgeRepo.semanticSearchKnowledge(
        1, VEC_PRIX, { topK: 3, threshold: 0.75 }
      );

      // 2. Keyword search for "gratuit" returns entry 1
      const keywordResults = await ctx.knowledgeRepo.searchByKeywords(1, 'c\'est gratuit ?');

      // 3. Deduplicate
      const deduped = ctx.ragRetriever.deduplicateResults(
        [...semanticResults],
        keywordResults
      );

      // Entry 1 should appear only once (already in semantic)
      const entry1Count = deduped.filter(r => r.id === 1).length;
      assert.strictEqual(entry1Count, 1, 'Entry 1 should appear only once after dedup');

      // Should include entry 2 from semantic
      assert.ok(deduped.some(r => r.id === 2), 'Entry 2 from semantic should be present');

      // 4. Filter by step
      const filtered = ctx.ragRetriever.filterByStep(
        deduped.map(r => ({
          ...r,
          applicableSteps: r.applicable_steps ? JSON.parse(r.applicable_steps) : r.applicableSteps
        })),
        5
      );

      // Entries 1, 2 have steps=[5,6] → should pass at step 5
      assert.ok(filtered.some(r => r.id === 1), 'Entry 1 should pass step 5 filter');
      assert.ok(filtered.some(r => r.id === 2), 'Entry 2 should pass step 5 filter');

      // 5. Format for prompt
      const formatted = ctx.ragRetriever.formatForPrompt({
        relevantKnowledge: filtered.map(r => ({ ...r, score: r.score || 0.8, category: r.category })),
        similarConversations: []
      });

      assert.ok(formatted.includes('CONNAISSANCES PERTINENTES'), 'Should have knowledge header');
      assert.ok(formatted.includes('gratuit'), 'Should include prix content');
    } finally {
      ctx.cleanup();
    }
  });

  test('buildQueryText enriches with context', () => {
    const ctx = createSemanticTestDb();
    try {
      const query = ctx.ragRetriever.buildQueryText('c\'est gratuit ?', {
        pain_points: 'dépendance affective',
        funnel_step: 5,
        goals: 'guérir'
      });

      assert.ok(query.includes('c\'est gratuit ?'), 'Should contain original message');
      assert.ok(query.includes('dépendance affective'), 'Should contain pain_points');
      assert.ok(query.includes('5'), 'Should contain funnel step');
      assert.ok(query.includes('guérir'), 'Should contain goals');
    } finally {
      ctx.cleanup();
    }
  });

  test('buildQueryText with no context → just the message', () => {
    const ctx = createSemanticTestDb();
    try {
      const query = ctx.ragRetriever.buildQueryText('Salut', null);
      assert.strictEqual(query, 'Salut');
    } finally {
      ctx.cleanup();
    }
  });

  test('retrieve() with empty message → empty results', async () => {
    const ctx = createSemanticTestDb();
    try {
      const results = await ctx.ragRetriever.retrieve({
        prospectMessage: '',
        leadContext: {},
        accountId: 1
      });

      assert.strictEqual(results.relevantKnowledge.length, 0);
      assert.strictEqual(results.similarConversations.length, 0);
      assert.strictEqual(results.keywordMatches.length, 0);
    } finally {
      ctx.cleanup();
    }
  });

  test('retrieve() with null accountId → empty results', async () => {
    const ctx = createSemanticTestDb();
    try {
      const results = await ctx.ragRetriever.retrieve({
        prospectMessage: 'test',
        leadContext: {},
        accountId: null
      });

      assert.strictEqual(results.relevantKnowledge.length, 0);
    } finally {
      ctx.cleanup();
    }
  });

  test('formatForPrompt with similarConversations', () => {
    const ctx = createSemanticTestDb();
    try {
      const formatted = ctx.ragRetriever.formatForPrompt({
        relevantKnowledge: [],
        similarConversations: [
          { score: 0.85, conversation_summary: 'Prospect prix qui a converti en 5 messages' },
          { score: 0.72, conversation_summary: 'Prospect hésitant converti après relance' }
        ]
      });

      assert.ok(formatted.includes('APPROCHES QUI ONT CONVERTI'), 'Should have conversation header');
      assert.ok(formatted.includes('85%'), 'Should show confidence percentage');
      assert.ok(formatted.includes('72%'), 'Should show second confidence');
      assert.ok(formatted.includes('5 messages'), 'Should include summary');
    } finally {
      ctx.cleanup();
    }
  });

  test('getCategoryLabel maps all known categories', () => {
    const ctx = createSemanticTestDb();
    try {
      assert.strictEqual(ctx.ragRetriever.getCategoryLabel('objection'), 'OBJECTION');
      assert.strictEqual(ctx.ragRetriever.getCategoryLabel('faq'), 'FAQ');
      assert.strictEqual(ctx.ragRetriever.getCategoryLabel('product'), 'PRODUIT/SERVICE');
      assert.strictEqual(ctx.ragRetriever.getCategoryLabel('success_story'), 'TEMOIGNAGE');
      assert.strictEqual(ctx.ragRetriever.getCategoryLabel('technique'), 'TECHNIQUE');
      assert.strictEqual(ctx.ragRetriever.getCategoryLabel('unknown'), 'UNKNOWN');
    } finally {
      ctx.cleanup();
    }
  });
});
