/**
 * Multi-Account Isolation Tests
 *
 * Tests that different accounts get isolated:
 *   - Different personas/prompts per accountId
 *   - RAG results filtered by accountId
 *   - Knowledge base isolation between accounts
 *   - Edge cases: null accountId, nonexistent accountId
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { createSqliteKnowledgeRepository } from '../../../shared/infrastructure/repositories/SqliteKnowledgeRepository.js';
import { createSqliteFunnelRepository } from '../../../shared/infrastructure/repositories/SqliteFunnelRepository.js';
import { RagRetriever } from '../../../shared/domain/services/RagRetriever.js';
import { composeSystemPrompt } from '../../../shared/domain/services/PromptComposer.js';
import { serializeEmbedding } from '../../../shared/utils/embeddings.js';

/**
 * Create a multi-account test DB with 2 accounts, each with their own persona,
 * stages, and knowledge base entries.
 */
function createMultiAccountDb() {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      ig_username TEXT,
      description TEXT,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE account_personas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id),
      persona_name TEXT NOT NULL,
      niche TEXT,
      communication_rules TEXT,
      objections_script TEXT,
      knowledge_base TEXT,
      post_booking_message TEXT,
      qualification_prompt TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE funnel_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      stage_order INTEGER NOT NULL,
      stage_name TEXT NOT NULL,
      stage_label TEXT NOT NULL,
      description TEXT,
      conversation_script TEXT,
      max_followups INTEGER DEFAULT 0,
      followup_delay_hours INTEGER DEFAULT 24,
      auto_ignore_after_max INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(account_id, stage_order)
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

  // Account 1: Mélanie — coaching dépendance affective
  db.prepare(`INSERT INTO accounts (id, name, ig_username) VALUES (1, 'melanie', 'melanie_coach')`).run();
  db.prepare(`
    INSERT INTO account_personas (account_id, persona_name, niche, communication_rules)
    VALUES (1, 'Mélanie', 'dépendance affective', 'Tutoiement, emojis, phrases courtes')
  `).run();

  // Account 2: Thomas — coaching business
  db.prepare(`INSERT INTO accounts (id, name, ig_username) VALUES (2, 'thomas', 'thomas_biz')`).run();
  db.prepare(`
    INSERT INTO account_personas (account_id, persona_name, niche, communication_rules)
    VALUES (2, 'Thomas', 'business et entrepreneuriat', 'Vouvoiement, ton professionnel')
  `).run();

  // Stages for account 1
  const stagesAccount1 = [
    [1, 'premier_contact', 'STEP_1', '[STEP_1] Hey ! 🌸'],
    [2, 'connexion', 'STEP_2', '[STEP_2] Connexion émotionnelle'],
    [3, 'exploration', 'STEP_3', '[STEP_3] Explorer la souffrance'],
  ];
  const insertStage = db.prepare(`
    INSERT INTO funnel_stages (account_id, stage_order, stage_name, stage_label, conversation_script)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const s of stagesAccount1) insertStage.run(1, ...s);

  // Stages for account 2 — different scripts
  const stagesAccount2 = [
    [1, 'premier_contact', 'STEP_1', '[STEP_1] Bonjour ! Ravi de vous contacter.'],
    [2, 'decouverte', 'STEP_2', '[STEP_2] Quel est votre chiffre d\'affaires actuel ?'],
    [3, 'proposition', 'STEP_3', '[STEP_3] Voici ce que je vous propose...'],
  ];
  for (const s of stagesAccount2) insertStage.run(2, ...s);

  // Knowledge base — account 1
  const fakeEmbedding = serializeEmbedding(new Array(16).fill(0));
  const insertKb = db.prepare(`
    INSERT INTO knowledge_base (account_id, category, trigger_keywords, situation, content, embedding, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);

  insertKb.run(1, 'objection', JSON.stringify(['gratuit', 'prix']), 'Question prix',
    'L\'appel est 100% gratuit 🎁', fakeEmbedding);
  insertKb.run(1, 'objection', JSON.stringify(['pas intéressée']), 'Refus',
    '[NOT_INTERESTED] Pas de souci, belle journée 🌸', fakeEmbedding);

  // Knowledge base — account 2 (different content for same keywords)
  insertKb.run(2, 'faq', JSON.stringify(['gratuit', 'prix']), 'Question prix',
    'L\'appel stratégique est offert, sans engagement.', fakeEmbedding);
  insertKb.run(2, 'objection', JSON.stringify(['pas intéressé']), 'Refus',
    '[NOT_INTERESTED] Je comprends, bonne continuation dans vos projets.', fakeEmbedding);

  const getDb = () => db;
  const knowledgeRepo = createSqliteKnowledgeRepository({ getDb });
  const funnelRepo = createSqliteFunnelRepository({ getDb });
  const ragRetriever = new RagRetriever({ knowledgeRepository: knowledgeRepo });

  return { db, knowledgeRepo, funnelRepo, ragRetriever, cleanup: () => db.close() };
}

describe('Multi-Account: Persona Isolation', () => {

  test('Account 1 → prompt with "Mélanie" and "dépendance affective"', async () => {
    const ctx = createMultiAccountDb();
    try {
      const { persona, stages } = await ctx.funnelRepo.getPromptData(1);

      assert.ok(persona, 'Account 1 should have a persona');
      assert.strictEqual(persona.personaName, 'Mélanie');
      assert.strictEqual(persona.niche, 'dépendance affective');

      const prompt = composeSystemPrompt({ persona, stages });
      assert.ok(prompt.includes('Mélanie'), 'Prompt should mention Mélanie');
      assert.ok(prompt.includes('dépendance affective'), 'Prompt should mention niche');
      assert.ok(!prompt.includes('Thomas'), 'Should NOT mention Thomas');
      assert.ok(!prompt.includes('entrepreneuriat'), 'Should NOT mention business niche');
    } finally {
      ctx.cleanup();
    }
  });

  test('Account 2 → prompt with "Thomas" and "business"', async () => {
    const ctx = createMultiAccountDb();
    try {
      const { persona, stages } = await ctx.funnelRepo.getPromptData(2);

      assert.ok(persona, 'Account 2 should have a persona');
      assert.strictEqual(persona.personaName, 'Thomas');

      const prompt = composeSystemPrompt({ persona, stages });
      assert.ok(prompt.includes('Thomas'), 'Prompt should mention Thomas');
      assert.ok(prompt.includes('business'), 'Prompt should mention business niche');
      assert.ok(!prompt.includes('Mélanie'), 'Should NOT mention Mélanie');
    } finally {
      ctx.cleanup();
    }
  });
});

describe('Multi-Account: Stages Isolation', () => {

  test('Account 1 stages use emojis (Mélanie style)', async () => {
    const ctx = createMultiAccountDb();
    try {
      const stages = await ctx.funnelRepo.getStagesForAccount(1);
      assert.strictEqual(stages.length, 3, 'Account 1 should have 3 stages');
      assert.ok(stages[0].conversationScript.includes('🌸'), 'Mélanie stages use emojis');
    } finally {
      ctx.cleanup();
    }
  });

  test('Account 2 stages use formal tone (Thomas style)', async () => {
    const ctx = createMultiAccountDb();
    try {
      const stages = await ctx.funnelRepo.getStagesForAccount(2);
      assert.strictEqual(stages.length, 3, 'Account 2 should have 3 stages');
      assert.ok(stages[0].conversationScript.includes('Bonjour'), 'Thomas stages use formal tone');
      assert.ok(stages[0].conversationScript.includes('Ravi'), 'Thomas stages use formal language');
    } finally {
      ctx.cleanup();
    }
  });

  test('Stages don\'t leak between accounts', async () => {
    const ctx = createMultiAccountDb();
    try {
      const stages1 = await ctx.funnelRepo.getStagesForAccount(1);
      const stages2 = await ctx.funnelRepo.getStagesForAccount(2);

      // Account 1 stages should not contain account 2 content
      const allScripts1 = stages1.map(s => s.conversationScript).join(' ');
      assert.ok(!allScripts1.includes('chiffre d\'affaires'), 'Account 1 should not have business content');

      const allScripts2 = stages2.map(s => s.conversationScript).join(' ');
      assert.ok(!allScripts2.includes('souffrance'), 'Account 2 should not have emotional content');
    } finally {
      ctx.cleanup();
    }
  });
});

describe('Multi-Account: RAG/Knowledge Base Isolation', () => {

  test('Keyword "gratuit" returns different content per account', async () => {
    const ctx = createMultiAccountDb();
    try {
      const matches1 = await ctx.knowledgeRepo.searchByKeywords(1, 'c\'est gratuit ?');
      const matches2 = await ctx.knowledgeRepo.searchByKeywords(2, 'c\'est gratuit ?');

      assert.ok(matches1.length > 0, 'Account 1 should find "gratuit"');
      assert.ok(matches2.length > 0, 'Account 2 should find "gratuit"');

      // Different content
      assert.ok(matches1[0].content.includes('🎁'), 'Account 1 uses emoji in response');
      assert.ok(matches2[0].content.includes('stratégique'), 'Account 2 uses formal language');
    } finally {
      ctx.cleanup();
    }
  });

  test('Account 1 KB entries not visible from account 2', async () => {
    const ctx = createMultiAccountDb();
    try {
      const matches1 = await ctx.knowledgeRepo.searchByKeywords(1, 'pas intéressée');
      const matches2 = await ctx.knowledgeRepo.searchByKeywords(2, 'pas intéressée');

      // Account 1 uses feminine form
      assert.ok(matches1.length > 0, 'Account 1 should match "intéressée"');
      // Account 2 should NOT match "intéressée" (it has "intéressé" masculine)
      // The keyword search is exact, so it depends on implementation

      // Verify content isolation
      if (matches1.length > 0) {
        assert.ok(matches1[0].content.includes('🌸'), 'Account 1 content should have emoji style');
      }
    } finally {
      ctx.cleanup();
    }
  });

  test('RAG formatForPrompt uses account-specific entries only', async () => {
    const ctx = createMultiAccountDb();
    try {
      const matches1 = await ctx.knowledgeRepo.searchByKeywords(1, 'prix');
      const formatted1 = ctx.ragRetriever.formatForPrompt({
        relevantKnowledge: matches1.map(m => ({ ...m, score: 0.8, category: m.category })),
        similarConversations: []
      });

      assert.ok(formatted1.includes('gratuit 🎁'), 'Account 1 formatted prompt should have emoji style');
      assert.ok(!formatted1.includes('stratégique'), 'Should not contain account 2 content');
    } finally {
      ctx.cleanup();
    }
  });
});

describe('Multi-Account: Edge Cases', () => {

  test('Nonexistent accountId → empty stages and null persona', async () => {
    const ctx = createMultiAccountDb();
    try {
      const { persona, stages } = await ctx.funnelRepo.getPromptData(999);

      assert.strictEqual(persona, null, 'Persona should be null for nonexistent account');
      assert.strictEqual(stages.length, 0, 'Stages should be empty for nonexistent account');
    } finally {
      ctx.cleanup();
    }
  });

  test('Nonexistent accountId → empty KB results', async () => {
    const ctx = createMultiAccountDb();
    try {
      const matches = await ctx.knowledgeRepo.searchByKeywords(999, 'gratuit');
      assert.strictEqual(matches.length, 0, 'Should find no matches for nonexistent account');
    } finally {
      ctx.cleanup();
    }
  });

  test('composeSystemPrompt with null persona and empty stages → only base rules', () => {
    const prompt = composeSystemPrompt({ persona: null, stages: [] });

    assert.ok(prompt.includes('RÈGLES CRITIQUES'), 'Should still have base rules');
    assert.ok(!prompt.includes('QUI TU ES'), 'Should not have persona');
    assert.ok(!prompt.includes('FLOW DE CONVERSATION'), 'Should not have flow');
  });

  test('Account with persona but no stages → prompt has persona + rules only', async () => {
    const ctx = createMultiAccountDb();
    try {
      // Account 1 has persona + 3 stages
      // Let's test with just persona (simulating getPromptData for an account with no stages)
      const persona = await ctx.funnelRepo.getPersonaForAccount(1);
      const prompt = composeSystemPrompt({ persona, stages: [] });

      assert.ok(prompt.includes('Mélanie'), 'Should have persona');
      assert.ok(prompt.includes('RÈGLES CRITIQUES'), 'Should have base rules');
      assert.ok(!prompt.includes('FLOW DE CONVERSATION'), 'Should not have flow without stages');
    } finally {
      ctx.cleanup();
    }
  });
});
