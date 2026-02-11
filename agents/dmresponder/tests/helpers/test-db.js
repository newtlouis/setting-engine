/**
 * Test Database Helper
 *
 * Creates an in-memory SQLite database with the same schema as production,
 * seeded with minimal test data for deterministic tests.
 */

import Database from 'better-sqlite3';
import { createSqliteKnowledgeRepository } from '../../../../shared/infrastructure/repositories/SqliteKnowledgeRepository.js';
import { createSqliteFunnelRepository } from '../../../../shared/infrastructure/repositories/SqliteFunnelRepository.js';
import { RagRetriever } from '../../../../shared/domain/services/RagRetriever.js';
import { serializeEmbedding } from '../../../../shared/utils/embeddings.js';

/**
 * Create an in-memory test database with schema + seed data.
 * @returns {{ db, knowledgeRepo, funnelRepo, ragRetriever, cleanup }}
 */
export function createTestDb() {
  const db = new Database(':memory:');

  // ---- Schema ----
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

    CREATE TABLE leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      account_id INTEGER REFERENCES accounts(id),
      full_name TEXT,
      status TEXT DEFAULT 'new',
      funnel_step INTEGER DEFAULT 0,
      conversation_step INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(username, account_id)
    );

    CREATE TABLE followup_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stage_id INTEGER REFERENCES funnel_stages(id) ON DELETE CASCADE,
      account_id INTEGER REFERENCES accounts(id),
      template_order INTEGER NOT NULL,
      template_text TEXT NOT NULL,
      template_name TEXT,
      is_active INTEGER DEFAULT 1,
      usage_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(stage_id, template_order)
    );

    CREATE INDEX idx_kb_account_active ON knowledge_base(account_id, is_active);
  `);

  // ---- Seed data ----

  // Account
  db.prepare(`INSERT INTO accounts (id, name, ig_username) VALUES (1, 'test_account', 'test_ig')`).run();

  // Persona
  db.prepare(`
    INSERT INTO account_personas (account_id, persona_name, niche, communication_rules)
    VALUES (1, 'Mélanie', 'dépendance affective', 'Tutoiement, emojis, phrases courtes')
  `).run();

  // Funnel stages (9 steps with minimal scripts)
  const stages = [
    [1, 'premier_contact', 'STEP_1', 'Premier message', '[STEP_1] Premier contact'],
    [2, 'connexion', 'STEP_2', 'Connexion', '[STEP_2] Connexion émotionnelle'],
    [3, 'exploration', 'STEP_3', 'Exploration', '[STEP_3] Explorer la situation'],
    [4, 'projection', 'STEP_4', 'Projection', '[STEP_4] Objectifs et projection'],
    [5, 'proposition_appel', 'STEP_5', 'Proposition appel', '[STEP_5] Proposer un appel'],
    [6, 'creneaux', 'STEP_6', 'Créneaux', '[STEP_6] Proposer des créneaux'],
    [7, 'infos_contact', 'STEP_7', 'Infos contact', '[STEP_7] Récupérer email/tel'],
    [8, 'confirmation', 'STEP_8', 'Confirmation', '[STEP_8] Confirmer le RDV'],
    [9, 'cloture', 'STEP_9', 'Clôture', '[STEP_9] Fin du workflow'],
  ];
  const insertStage = db.prepare(`
    INSERT INTO funnel_stages (account_id, stage_order, stage_name, stage_label, description, conversation_script)
    VALUES (1, ?, ?, ?, ?, ?)
  `);
  for (const s of stages) insertStage.run(...s);

  // Knowledge Base entries for RAG tests
  const kbEntries = [
    {
      id: 1,
      category: 'objection',
      keywords: ['curiosite', 'curiosité', 'par curiosité'],
      situation: 'Le prospect dit agir par curiosité',
      content: '[NOT_INTERESTED] Pas de souci, merci pour ta réponse ! Si jamais le sujet te parle un jour, n\'hésite pas.',
      steps: [2, 3],
    },
    {
      id: 2,
      category: 'objection',
      keywords: ['pas specialement', 'pas spécialement', 'pas vraiment'],
      situation: 'Le prospect montre un désintérêt poli',
      content: '[NOT_INTERESTED] Je comprends totalement ! Belle journée à toi.',
      steps: [2, 3],
    },
    {
      id: 3,
      category: 'faq',
      keywords: ['gratuit', 'prix', 'payant', 'combien'],
      situation: 'Question sur le prix ou la gratuité',
      content: 'L\'appel découverte de 30 min est 100% gratuit. C\'est un moment pour faire le point.',
      steps: [5, 6],
    },
    {
      id: 4,
      category: 'faq',
      keywords: ['appel', 'comment ça se passe'],
      situation: 'Question sur le format de l\'appel',
      content: 'L\'appel dure 30 min en visio. On fait le point sur ta situation.',
      steps: [1, 2],
    },
    {
      id: 5,
      category: 'technique',
      keywords: ['dépendance affective'],
      situation: 'Information générale sur la dépendance affective',
      content: 'La dépendance affective se manifeste par un besoin excessif de l\'autre.',
      steps: null, // applicable to all steps
    },
  ];

  // Generate a simple fake embedding (all zeros, 16 dimensions for test)
  const fakeEmbedding = new Array(16).fill(0);

  const insertKb = db.prepare(`
    INSERT INTO knowledge_base (id, account_id, category, trigger_keywords, situation, content, embedding, applicable_steps, is_active)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, 1)
  `);
  for (const e of kbEntries) {
    insertKb.run(
      e.id,
      e.category,
      JSON.stringify(e.keywords),
      e.situation,
      e.content,
      serializeEmbedding(fakeEmbedding),
      e.steps ? JSON.stringify(e.steps) : null
    );
  }

  // Wire up repositories
  const getDb = () => db;
  const knowledgeRepo = createSqliteKnowledgeRepository({ getDb });
  const funnelRepo = createSqliteFunnelRepository({ getDb });
  const ragRetriever = new RagRetriever({ knowledgeRepository: knowledgeRepo });

  const cleanup = () => db.close();

  return { db, knowledgeRepo, funnelRepo, ragRetriever, cleanup, accountId: 1 };
}
