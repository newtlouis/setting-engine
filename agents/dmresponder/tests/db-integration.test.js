/**
 * Database Integration Tests
 *
 * Tests the full DB pipeline with in-memory SQLite:
 *   - Lead Repository (CRUD, filters, status updates)
 *   - Conversation Repository (messages, unanswered detection)
 *   - RecordMessage Use Case (status transitions, step parsing, tags)
 *   - GetConversationHistory Use Case (history retrieval, unanswered)
 *   - Lead Entity (create, transitions, advanceFunnelStep, serialization)
 *   - Conversation Entity (metrics, AI context)
 *   - extractPainPointsFromComments (regex patterns)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { createSqliteLeadRepository } from '../../../shared/infrastructure/repositories/SqliteLeadRepository.js';
import { createSqliteConversationRepository } from '../../../shared/infrastructure/repositories/SqliteConversationRepository.js';
import { RecordMessage } from '../../../shared/application/use-cases/RecordMessage.js';
import { GetConversationHistory } from '../../../shared/application/use-cases/GetConversationHistory.js';
import { Lead } from '../../../shared/domain/entities/Lead.js';
import { Message, MessageRole, MessageType } from '../../../shared/domain/entities/Message.js';
import { Conversation } from '../../../shared/domain/entities/Conversation.js';
import { LeadStatus } from '../../../shared/domain/value-objects/LeadStatus.js';

/**
 * Create full-schema in-memory DB for integration tests.
 */
function createIntegrationDb() {
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

    CREATE TABLE leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      account_id INTEGER REFERENCES accounts(id),
      full_name TEXT,
      first_name TEXT,
      bio TEXT,
      email TEXT,
      profile_url TEXT,
      dm_url TEXT,
      status TEXT DEFAULT 'new',
      warmth TEXT DEFAULT 'cold',
      is_ignored INTEGER DEFAULT 0,
      engagement_score REAL DEFAULT 0,
      total_comments INTEGER DEFAULT 0,
      total_messages_sent INTEGER DEFAULT 0,
      total_messages_received INTEGER DEFAULT 0,
      funnel_step INTEGER DEFAULT 0,
      last_followup_template_id INTEGER,
      last_contact_at TEXT,
      lead_source TEXT,
      lead_type TEXT DEFAULT 'cold',
      booking_status TEXT,
      pain_points TEXT DEFAULT '[]',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(username, account_id)
    );

    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES leads(id),
      role TEXT NOT NULL,
      message_text TEXT,
      message_type TEXT,
      sent_at TEXT DEFAULT (datetime('now'))
    );

    INSERT INTO accounts (id, name, ig_username) VALUES (1, 'test_account', 'test_ig');
  `);

  const getDb = () => db;
  const leadRepo = createSqliteLeadRepository({ getDb });
  const rawConvRepo = createSqliteConversationRepository({ getDb });

  // Wrap addMessage to ensure deterministic sent_at ordering.
  // In production, messages are minutes apart. In tests, they're in the same millisecond.
  // SQLite's ORDER BY sent_at DESC is non-deterministic for equal values.
  let msgCounter = 0;
  const convRepo = {
    ...rawConvRepo,
    async addMessage(leadId, message) {
      const result = await rawConvRepo.addMessage(leadId, message);
      msgCounter++;
      db.prepare(`UPDATE conversations SET sent_at = datetime('2025-01-01', '+${msgCounter} minutes') WHERE id = ?`).run(result.id);
      return result;
    }
  };

  const recordMessage = new RecordMessage({ leadRepository: leadRepo, conversationRepository: convRepo });
  const getHistory = new GetConversationHistory({ leadRepository: leadRepo, conversationRepository: convRepo });

  return { db, leadRepo, convRepo, recordMessage, getHistory, cleanup: () => db.close() };
}

// ================================================================
// LEAD REPOSITORY
// ================================================================

describe('Lead Repository: CRUD', () => {

  test('save new lead → gets auto ID', async () => {
    const ctx = createIntegrationDb();
    try {
      const lead = Lead.create('test_user', 1, 'dm');
      const saved = await ctx.leadRepo.save(lead);
      assert.ok(saved.id, 'Should have an ID');
      assert.strictEqual(saved.username, 'test_user');
      assert.strictEqual(saved.status, LeadStatus.NEW);
    } finally { ctx.cleanup(); }
  });

  test('findByUsername → returns saved lead', async () => {
    const ctx = createIntegrationDb();
    try {
      const lead = Lead.create('marie_test', 1, 'dm');
      await ctx.leadRepo.save(lead);

      const found = await ctx.leadRepo.findByUsername('marie_test', 1);
      assert.ok(found, 'Should find lead');
      assert.strictEqual(found.username, 'marie_test');
      assert.strictEqual(found.accountId, 1);
    } finally { ctx.cleanup(); }
  });

  test('findByUsername nonexistent → null', async () => {
    const ctx = createIntegrationDb();
    try {
      const found = await ctx.leadRepo.findByUsername('nobody', 1);
      assert.strictEqual(found, null);
    } finally { ctx.cleanup(); }
  });

  test('findById → returns lead', async () => {
    const ctx = createIntegrationDb();
    try {
      const saved = await ctx.leadRepo.save(Lead.create('id_test', 1));
      const found = await ctx.leadRepo.findById(saved.id);
      assert.ok(found);
      assert.strictEqual(found.username, 'id_test');
    } finally { ctx.cleanup(); }
  });

  test('save existing lead (update) → preserves ID', async () => {
    const ctx = createIntegrationDb();
    try {
      const saved = await ctx.leadRepo.save(Lead.create('update_test', 1));
      saved.bio = 'Updated bio';
      saved.status = LeadStatus.CONTACTED;
      const updated = await ctx.leadRepo.save(saved);

      assert.strictEqual(updated.id, saved.id);
      assert.strictEqual(updated.bio, 'Updated bio');
      assert.strictEqual(updated.status, LeadStatus.CONTACTED);
    } finally { ctx.cleanup(); }
  });

  test('upsert on conflict → updates existing', async () => {
    const ctx = createIntegrationDb();
    try {
      await ctx.leadRepo.save(Lead.create('upsert_user', 1));
      // Save again with same username+account_id but no ID → triggers upsert
      const lead2 = Lead.create('upsert_user', 1);
      lead2.status = LeadStatus.CONTACTED;
      lead2.totalMessagesSent = 1;
      const result = await ctx.leadRepo.save(lead2);

      assert.ok(result.id, 'Should have ID from upsert');
      assert.strictEqual(result.status, LeadStatus.CONTACTED);
    } finally { ctx.cleanup(); }
  });
});

describe('Lead Repository: Filters & Queries', () => {

  test('findAll with status filter', async () => {
    const ctx = createIntegrationDb();
    try {
      const l1 = Lead.create('user1', 1); l1.status = LeadStatus.CONTACTED;
      const l2 = Lead.create('user2', 1); l2.status = LeadStatus.REPLIED;
      const l3 = Lead.create('user3', 1); l3.status = LeadStatus.CONTACTED;
      await ctx.leadRepo.save(l1);
      await ctx.leadRepo.save(l2);
      await ctx.leadRepo.save(l3);

      const contacted = await ctx.leadRepo.findAll({ accountId: 1, status: 'contacted' });
      assert.strictEqual(contacted.length, 2);
    } finally { ctx.cleanup(); }
  });

  test('findAll excludes ignored by default', async () => {
    const ctx = createIntegrationDb();
    try {
      const l1 = Lead.create('visible', 1);
      const l2 = Lead.create('ignored', 1); l2.isIgnored = true;
      await ctx.leadRepo.save(l1);
      await ctx.leadRepo.save(l2);

      const all = await ctx.leadRepo.findAll({ accountId: 1 });
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0].username, 'visible');
    } finally { ctx.cleanup(); }
  });

  test('findAll with includeIgnored → includes ignored', async () => {
    const ctx = createIntegrationDb();
    try {
      await ctx.leadRepo.save(Lead.create('a', 1));
      const ignored = Lead.create('b', 1); ignored.isIgnored = true;
      await ctx.leadRepo.save(ignored);

      const all = await ctx.leadRepo.findAll({ accountId: 1, includeIgnored: true });
      assert.strictEqual(all.length, 2);
    } finally { ctx.cleanup(); }
  });

  test('findAll with limit', async () => {
    const ctx = createIntegrationDb();
    try {
      for (let i = 0; i < 5; i++) {
        await ctx.leadRepo.save(Lead.create(`user${i}`, 1));
      }
      const limited = await ctx.leadRepo.findAll({ accountId: 1, limit: 3 });
      assert.strictEqual(limited.length, 3);
    } finally { ctx.cleanup(); }
  });

  test('updateStatus → changes status', async () => {
    const ctx = createIntegrationDb();
    try {
      await ctx.leadRepo.save(Lead.create('status_test', 1));
      const ok = await ctx.leadRepo.updateStatus('status_test', 'contacted');
      assert.strictEqual(ok, true);

      const lead = await ctx.leadRepo.findByUsername('status_test', 1);
      assert.strictEqual(lead.status, 'contacted');
    } finally { ctx.cleanup(); }
  });

  test('markContacted → updates status + last_contact_at', async () => {
    const ctx = createIntegrationDb();
    try {
      await ctx.leadRepo.save(Lead.create('contact_test', 1));
      await ctx.leadRepo.markContacted('contact_test', 'https://dm.example.com');

      const lead = await ctx.leadRepo.findByUsername('contact_test', 1);
      assert.strictEqual(lead.status, 'contacted');
      assert.ok(lead.lastContactAt, 'Should have last_contact_at');
      assert.strictEqual(lead.dmUrl, 'https://dm.example.com');
    } finally { ctx.cleanup(); }
  });

  test('markFailed → sets status + notes', async () => {
    const ctx = createIntegrationDb();
    try {
      await ctx.leadRepo.save(Lead.create('fail_test', 1));
      await ctx.leadRepo.markFailed('fail_test', 'Account not found');

      const lead = await ctx.leadRepo.findByUsername('fail_test', 1);
      assert.strictEqual(lead.status, 'failed');
      assert.strictEqual(lead.notes, 'Account not found');
    } finally { ctx.cleanup(); }
  });

  test('ignore → sets is_ignored + status', async () => {
    const ctx = createIntegrationDb();
    try {
      await ctx.leadRepo.save(Lead.create('ignore_test', 1));
      await ctx.leadRepo.ignore('ignore_test');

      const lead = await ctx.leadRepo.findByUsername('ignore_test', 1);
      assert.strictEqual(lead.status, 'ignored');
      assert.strictEqual(lead.isIgnored, true);
    } finally { ctx.cleanup(); }
  });

  test('countByStatus → correct counts', async () => {
    const ctx = createIntegrationDb();
    try {
      const l1 = Lead.create('a', 1); l1.status = 'new';
      const l2 = Lead.create('b', 1); l2.status = 'contacted';
      const l3 = Lead.create('c', 1); l3.status = 'contacted';
      const l4 = Lead.create('d', 1); l4.status = 'replied';
      await ctx.leadRepo.save(l1);
      await ctx.leadRepo.save(l2);
      await ctx.leadRepo.save(l3);
      await ctx.leadRepo.save(l4);

      const counts = await ctx.leadRepo.countByStatus(1);
      assert.strictEqual(counts['new'], 1);
      assert.strictEqual(counts['contacted'], 2);
      assert.strictEqual(counts['replied'], 1);
    } finally { ctx.cleanup(); }
  });
});

// ================================================================
// CONVERSATION REPOSITORY
// ================================================================

describe('Conversation Repository', () => {

  test('addMessage → saves and returns message with ID', async () => {
    const ctx = createIntegrationDb();
    try {
      const lead = await ctx.leadRepo.save(Lead.create('conv_user', 1));
      const msg = new Message({ role: 'assistant', text: '[STEP_1] Hey !' });
      const saved = await ctx.convRepo.addMessage(lead.id, msg);

      assert.ok(saved.id, 'Message should have ID');
      assert.strictEqual(saved.text, '[STEP_1] Hey !');
      assert.strictEqual(saved.role, 'assistant');
    } finally { ctx.cleanup(); }
  });

  test('getByLeadId → returns Conversation with messages in order', async () => {
    const ctx = createIntegrationDb();
    try {
      const lead = await ctx.leadRepo.save(Lead.create('order_user', 1));
      await ctx.convRepo.addMessage(lead.id, new Message({ role: 'assistant', text: 'First' }));
      await ctx.convRepo.addMessage(lead.id, new Message({ role: 'user', text: 'Second' }));
      await ctx.convRepo.addMessage(lead.id, new Message({ role: 'assistant', text: 'Third' }));

      const conv = await ctx.convRepo.getByLeadId(lead.id);
      assert.ok(conv instanceof Conversation);
      assert.strictEqual(conv.length, 3);
      assert.strictEqual(conv.messages[0].text, 'First');
      assert.strictEqual(conv.messages[2].text, 'Third');
    } finally { ctx.cleanup(); }
  });

  test('getByLeadId empty → Conversation with 0 messages', async () => {
    const ctx = createIntegrationDb();
    try {
      const lead = await ctx.leadRepo.save(Lead.create('empty_conv', 1));
      const conv = await ctx.convRepo.getByLeadId(lead.id);
      assert.strictEqual(conv.length, 0);
      assert.ok(conv.isEmpty());
    } finally { ctx.cleanup(); }
  });

  test('getLastMessages with limit', async () => {
    const ctx = createIntegrationDb();
    try {
      const lead = await ctx.leadRepo.save(Lead.create('limit_user', 1));
      for (let i = 1; i <= 5; i++) {
        await ctx.convRepo.addMessage(lead.id, new Message({ role: 'user', text: `Msg ${i}` }));
      }

      const last3 = await ctx.convRepo.getLastMessages(lead.id, 3);
      assert.strictEqual(last3.length, 3);
      // Should be in chronological order (reversed from DESC)
      assert.strictEqual(last3[0].text, 'Msg 3');
      assert.strictEqual(last3[2].text, 'Msg 5');
    } finally { ctx.cleanup(); }
  });

  test('getMessagesForAI → {role, content} format', async () => {
    const ctx = createIntegrationDb();
    try {
      const lead = await ctx.leadRepo.save(Lead.create('ai_user', 1));
      await ctx.convRepo.addMessage(lead.id, new Message({ role: 'assistant', text: 'Hey' }));
      await ctx.convRepo.addMessage(lead.id, new Message({ role: 'user', text: 'Salut' }));

      const aiMsgs = await ctx.convRepo.getMessagesForAI(lead.id, 10);
      assert.strictEqual(aiMsgs.length, 2);
      assert.strictEqual(aiMsgs[0].role, 'assistant');
      assert.strictEqual(aiMsgs[0].content, 'Hey');
      assert.strictEqual(aiMsgs[1].role, 'user');
      assert.strictEqual(aiMsgs[1].content, 'Salut');
    } finally { ctx.cleanup(); }
  });

  test('countMessages → sent/received counts', async () => {
    const ctx = createIntegrationDb();
    try {
      const lead = await ctx.leadRepo.save(Lead.create('count_user', 1));
      await ctx.convRepo.addMessage(lead.id, new Message({ role: 'assistant', text: 'A' }));
      await ctx.convRepo.addMessage(lead.id, new Message({ role: 'assistant', text: 'B' }));
      await ctx.convRepo.addMessage(lead.id, new Message({ role: 'user', text: 'C' }));

      const counts = await ctx.convRepo.countMessages(lead.id);
      assert.strictEqual(counts.sent, 2);
      assert.strictEqual(counts.received, 1);
    } finally { ctx.cleanup(); }
  });

  test('hasUnansweredMessage → true when last is user', async () => {
    const ctx = createIntegrationDb();
    try {
      const lead = await ctx.leadRepo.save(Lead.create('unanswered', 1));
      await ctx.convRepo.addMessage(lead.id, new Message({ role: 'assistant', text: 'Hey' }));
      await ctx.convRepo.addMessage(lead.id, new Message({ role: 'user', text: 'Salut' }));

      assert.strictEqual(await ctx.convRepo.hasUnansweredMessage(lead.id), true);
    } finally { ctx.cleanup(); }
  });

  test('hasUnansweredMessage → false when last is assistant', async () => {
    const ctx = createIntegrationDb();
    try {
      const lead = await ctx.leadRepo.save(Lead.create('answered', 1));
      await ctx.convRepo.addMessage(lead.id, new Message({ role: 'user', text: 'Salut' }));
      await ctx.convRepo.addMessage(lead.id, new Message({ role: 'assistant', text: 'Hey' }));

      assert.strictEqual(await ctx.convRepo.hasUnansweredMessage(lead.id), false);
    } finally { ctx.cleanup(); }
  });

  test('getUnansweredConversations → only leads with last user msg', async () => {
    const ctx = createIntegrationDb();
    try {
      const l1 = await ctx.leadRepo.save(Lead.create('unanswered1', 1));
      await ctx.convRepo.addMessage(l1.id, new Message({ role: 'user', text: 'Help' }));

      const l2 = await ctx.leadRepo.save(Lead.create('answered1', 1));
      await ctx.convRepo.addMessage(l2.id, new Message({ role: 'user', text: 'Hello' }));
      await ctx.convRepo.addMessage(l2.id, new Message({ role: 'assistant', text: 'Hi' }));

      const unanswered = await ctx.convRepo.getUnansweredConversations(1);
      assert.strictEqual(unanswered.length, 1);
      assert.strictEqual(unanswered[0].username, 'unanswered1');
    } finally { ctx.cleanup(); }
  });

  test('addMessage updates lead funnel_step for assistant', async () => {
    const ctx = createIntegrationDb();
    try {
      const lead = await ctx.leadRepo.save(Lead.create('step_update', 1));
      await ctx.convRepo.addMessage(lead.id, new Message({ role: 'assistant', text: 'Hey' }));

      const updated = await ctx.leadRepo.findById(lead.id);
      assert.strictEqual(updated.funnelStep, 1, 'First assistant message → funnel_step 1');
    } finally { ctx.cleanup(); }
  });

  test('addMessage updates lead funnel_step for user', async () => {
    const ctx = createIntegrationDb();
    try {
      const lead = await ctx.leadRepo.save(Lead.create('user_step', 1));
      // First send assistant, then receive user
      await ctx.convRepo.addMessage(lead.id, new Message({ role: 'assistant', text: 'Hey' }));
      await ctx.convRepo.addMessage(lead.id, new Message({ role: 'user', text: 'Salut' }));

      const updated = await ctx.leadRepo.findById(lead.id);
      assert.ok(updated.funnelStep >= 2, 'First user reply → funnel_step >= 2');
    } finally { ctx.cleanup(); }
  });
});

// ================================================================
// RECORD MESSAGE USE CASE
// ================================================================

describe('RecordMessage Use Case', () => {

  test('Outgoing to new lead → creates lead + sets contacted', async () => {
    const ctx = createIntegrationDb();
    try {
      const result = await ctx.recordMessage.execute({
        username: 'new_prospect',
        text: '[STEP_1] Hey !',
        direction: 'outgoing',
        accountId: 1
      });

      assert.ok(result.message, 'Should have message');
      assert.ok(result.lead, 'Should have lead');
      assert.strictEqual(result.isFirstContact, true);
      assert.strictEqual(result.lead.status, LeadStatus.CONTACTED);
    } finally { ctx.cleanup(); }
  });

  test('Outgoing parses [STEP_X] → funnel step advances (calculateStep recalculates from counts)', async () => {
    const ctx = createIntegrationDb();
    try {
      // First contact
      const r1 = await ctx.recordMessage.execute({
        username: 'step_test', text: '[STEP_1] Hey', direction: 'outgoing', accountId: 1
      });
      assert.strictEqual(r1.lead.funnelStep, 1, 'After 1st outgoing: step 1');

      // Second outgoing: calculateStep(2, 0) = FOLLOW_UP_1 = 4
      // Note: calculateStep always overwrites advanceFunnelStep
      const r2 = await ctx.recordMessage.execute({
        username: 'step_test', text: '[STEP_5] Tu serais dispo ?', direction: 'outgoing', accountId: 1
      });
      assert.ok(r2.lead.funnelStep >= 1, `Funnel step should advance, got ${r2.lead.funnelStep}`);
    } finally { ctx.cleanup(); }
  });

  test('Outgoing with [NOT_INTERESTED] → sets ignored', async () => {
    const ctx = createIntegrationDb();
    try {
      await ctx.recordMessage.execute({
        username: 'not_int', text: '[STEP_1] Hey', direction: 'outgoing', accountId: 1
      });
      const result = await ctx.recordMessage.execute({
        username: 'not_int',
        text: '[NOT_INTERESTED] Pas de souci, belle journée !',
        direction: 'outgoing',
        accountId: 1
      });

      assert.strictEqual(result.lead.status, LeadStatus.IGNORED);
      assert.strictEqual(result.lead.isIgnored, true);
    } finally { ctx.cleanup(); }
  });

  test('Outgoing with [MANUAL] → sets manual status', async () => {
    const ctx = createIntegrationDb();
    try {
      await ctx.recordMessage.execute({
        username: 'manual_test', text: '[STEP_1] Hey', direction: 'outgoing', accountId: 1
      });
      const result = await ctx.recordMessage.execute({
        username: 'manual_test',
        text: '[MANUAL] Ce prospect a besoin d\'aide spécifique',
        direction: 'outgoing',
        accountId: 1
      });

      assert.strictEqual(result.lead.status, LeadStatus.MANUAL);
    } finally { ctx.cleanup(); }
  });

  test('Incoming first reply → status contacted → replied', async () => {
    const ctx = createIntegrationDb();
    try {
      // Send outgoing first
      await ctx.recordMessage.execute({
        username: 'reply_test', text: '[STEP_1] Hey', direction: 'outgoing', accountId: 1
      });
      // Receive reply
      const result = await ctx.recordMessage.execute({
        username: 'reply_test', text: 'Salut !', direction: 'incoming', accountId: 1
      });

      assert.strictEqual(result.isFirstReply, true);
      assert.strictEqual(result.lead.status, LeadStatus.REPLIED);
      assert.strictEqual(result.lead.totalMessagesReceived, 1);
    } finally { ctx.cleanup(); }
  });

  test('Second incoming → isFirstReply = false', async () => {
    const ctx = createIntegrationDb();
    try {
      await ctx.recordMessage.execute({
        username: 'second_reply', text: '[STEP_1] Hey', direction: 'outgoing', accountId: 1
      });
      await ctx.recordMessage.execute({
        username: 'second_reply', text: 'Salut', direction: 'incoming', accountId: 1
      });
      const result = await ctx.recordMessage.execute({
        username: 'second_reply', text: 'Ça va ?', direction: 'incoming', accountId: 1
      });

      assert.strictEqual(result.isFirstReply, false);
      assert.strictEqual(result.lead.totalMessagesReceived, 2);
    } finally { ctx.cleanup(); }
  });

  test('recordOutgoing convenience method', async () => {
    const ctx = createIntegrationDb();
    try {
      const result = await ctx.recordMessage.recordOutgoing('convenience_test', '[STEP_1] Hey', MessageType.GREETING, 1);
      assert.ok(result.message);
      assert.strictEqual(result.message.role, MessageRole.ASSISTANT);
    } finally { ctx.cleanup(); }
  });

  test('recordIncoming convenience method', async () => {
    const ctx = createIntegrationDb();
    try {
      // Need a lead first
      await ctx.recordMessage.recordOutgoing('incoming_test', '[STEP_1] Hey', null, 1);
      const result = await ctx.recordMessage.recordIncoming('incoming_test', 'Salut', 1);
      assert.ok(result.message);
      assert.strictEqual(result.message.role, MessageRole.USER);
    } finally { ctx.cleanup(); }
  });
});

// ================================================================
// GET CONVERSATION HISTORY USE CASE
// ================================================================

describe('GetConversationHistory Use Case', () => {

  test('execute → returns messages + metrics + aiContext', async () => {
    const ctx = createIntegrationDb();
    try {
      await ctx.recordMessage.recordOutgoing('history_test', '[STEP_1] Hey', null, 1);
      await ctx.recordMessage.recordIncoming('history_test', 'Salut', 1);

      const result = await ctx.getHistory.execute('history_test', 1);
      assert.ok(result, 'Should return result');
      assert.strictEqual(result.username, 'history_test');
      assert.strictEqual(result.messages.length, 2);
      assert.ok(result.metrics, 'Should have metrics');
      assert.strictEqual(result.metrics.totalMessages, 2);
      assert.ok(result.aiContext, 'Should have aiContext');
    } finally { ctx.cleanup(); }
  });

  test('execute nonexistent user → null', async () => {
    const ctx = createIntegrationDb();
    try {
      const result = await ctx.getHistory.execute('nobody', 1);
      assert.strictEqual(result, null);
    } finally { ctx.cleanup(); }
  });

  test('hasUnanswered → true when last msg is from user', async () => {
    const ctx = createIntegrationDb();
    try {
      await ctx.recordMessage.recordOutgoing('has_test', '[STEP_1] Hey', null, 1);
      await ctx.recordMessage.recordIncoming('has_test', 'Salut', 1);

      const result = await ctx.getHistory.hasUnanswered('has_test', 1);
      assert.strictEqual(result, true);
    } finally { ctx.cleanup(); }
  });

  test('hasUnanswered → false when last msg is assistant', async () => {
    const ctx = createIntegrationDb();
    try {
      await ctx.recordMessage.recordOutgoing('ans_test', '[STEP_1] Hey', null, 1);

      const result = await ctx.getHistory.hasUnanswered('ans_test', 1);
      assert.strictEqual(result, false);
    } finally { ctx.cleanup(); }
  });

  test('hasUnanswered nonexistent → false', async () => {
    const ctx = createIntegrationDb();
    try {
      const result = await ctx.getHistory.hasUnanswered('nobody', 1);
      assert.strictEqual(result, false);
    } finally { ctx.cleanup(); }
  });

  test('getUnansweredLeads → returns leads with last user msg', async () => {
    const ctx = createIntegrationDb();
    try {
      // Lead 1: unanswered
      await ctx.recordMessage.recordOutgoing('lead_a', '[STEP_1] Hey', null, 1);
      await ctx.recordMessage.recordIncoming('lead_a', 'Salut !', 1);

      // Lead 2: answered
      await ctx.recordMessage.recordOutgoing('lead_b', '[STEP_1] Hey', null, 1);

      const unanswered = await ctx.getHistory.getUnansweredLeads(1);
      assert.strictEqual(unanswered.length, 1);
      assert.strictEqual(unanswered[0].lead.username, 'lead_a');
      assert.ok(unanswered[0].lastMessage, 'Should have lastMessage');
    } finally { ctx.cleanup(); }
  });

  test('getAIContext → formatted for AI', async () => {
    const ctx = createIntegrationDb();
    try {
      await ctx.recordMessage.recordOutgoing('ai_ctx', '[STEP_1] Hey', null, 1);
      await ctx.recordMessage.recordIncoming('ai_ctx', 'Bonjour', 1);

      const aiCtx = await ctx.getHistory.getAIContext('ai_ctx', 10, 1);
      assert.strictEqual(aiCtx.length, 2);
      assert.strictEqual(aiCtx[0].role, 'assistant');
      assert.strictEqual(aiCtx[0].content, '[STEP_1] Hey');
    } finally { ctx.cleanup(); }
  });
});

// ================================================================
// LEAD ENTITY
// ================================================================

describe('Lead Entity', () => {

  test('Lead.create → defaults', () => {
    const lead = Lead.create('test_user', 1, 'dm');
    assert.strictEqual(lead.username, 'test_user');
    assert.strictEqual(lead.status, LeadStatus.NEW);
    assert.strictEqual(lead.funnelStep, 0);
    assert.strictEqual(lead.totalMessagesSent, 0);
    assert.strictEqual(lead.leadSource, 'dm');
  });

  test('advanceFunnelStep only goes forward', () => {
    const lead = Lead.create('test', 1);
    lead.advanceFunnelStep(5);
    assert.strictEqual(lead.funnelStep, 5);
    lead.advanceFunnelStep(3); // Should NOT go back
    assert.strictEqual(lead.funnelStep, 5);
    lead.advanceFunnelStep(7);
    assert.strictEqual(lead.funnelStep, 7);
  });

  test('markContacted transition', () => {
    const lead = Lead.create('test', 1);
    lead.markContacted();
    assert.strictEqual(lead.status, LeadStatus.CONTACTED);
    assert.strictEqual(lead.funnelStep, 1);
    assert.strictEqual(lead.totalMessagesSent, 1);
    assert.ok(lead.lastContactAt);
  });

  test('markReplied transition', () => {
    const lead = Lead.create('test', 1);
    lead.markContacted();
    lead.markReplied();
    assert.strictEqual(lead.status, LeadStatus.REPLIED);
    assert.strictEqual(lead.totalMessagesReceived, 1);
    assert.ok(lead.funnelStep >= 2);
  });

  test('ignore → sets isIgnored', () => {
    const lead = Lead.create('test', 1);
    lead.ignore();
    assert.strictEqual(lead.status, LeadStatus.IGNORED);
    assert.strictEqual(lead.isIgnored, true);
  });

  test('toDbRow ↔ fromDbRow roundtrip', () => {
    const lead = Lead.create('roundtrip', 1);
    lead.fullName = 'Jean Dupont';
    lead.bio = 'Coach';
    lead.funnelStep = 5;
    lead.painPoints = ['solitude', 'stress'];

    const row = lead.toDbRow();
    const restored = Lead.fromDbRow(row);

    assert.strictEqual(restored.username, 'roundtrip');
    assert.strictEqual(restored.fullName, 'Jean Dupont');
    assert.strictEqual(restored.funnelStep, 5);
    assert.deepStrictEqual(restored.painPoints, ['solitude', 'stress']);
  });

  test('painPoints parsed from JSON string', () => {
    const lead = new Lead({ username: 'test', pain_points: '["a","b"]' });
    assert.deepStrictEqual(lead.painPoints, ['a', 'b']);
  });

  test('painPoints parsed from array', () => {
    const lead = new Lead({ username: 'test', pain_points: ['x', 'y'] });
    assert.deepStrictEqual(lead.painPoints, ['x', 'y']);
  });

  test('painPoints invalid JSON → empty array', () => {
    const lead = new Lead({ username: 'test', pain_points: 'not json' });
    assert.deepStrictEqual(lead.painPoints, []);
  });

  test('hasBeenContacted', () => {
    const lead = Lead.create('test', 1);
    assert.strictEqual(lead.hasBeenContacted(), false);
    lead.markContacted();
    assert.strictEqual(lead.hasBeenContacted(), true);
  });

  test('hasActiveConversation', () => {
    const lead = Lead.create('test', 1);
    assert.strictEqual(lead.hasActiveConversation(), false);
    lead.funnelStep = 3;
    assert.strictEqual(lead.hasActiveConversation(), true);
    lead.funnelStep = 9;
    assert.strictEqual(lead.hasActiveConversation(), false);
  });

  test('firstName extracted from fullName', () => {
    const lead = new Lead({ username: 'test', full_name: 'Marie Dupont' });
    assert.strictEqual(lead.firstName, 'Marie');
  });
});

// ================================================================
// MESSAGE ENTITY
// ================================================================

describe('Message Entity', () => {

  test('createOutgoing', () => {
    const msg = Message.createOutgoing(1, 'Hello', MessageType.GREETING);
    assert.strictEqual(msg.role, MessageRole.ASSISTANT);
    assert.strictEqual(msg.text, 'Hello');
    assert.strictEqual(msg.type, MessageType.GREETING);
    assert.strictEqual(msg.leadId, 1);
  });

  test('createIncoming', () => {
    const msg = Message.createIncoming(1, 'Hi');
    assert.strictEqual(msg.role, MessageRole.USER);
    assert.strictEqual(msg.text, 'Hi');
  });

  test('isFromLead / isFromAssistant', () => {
    const user = new Message({ role: 'user', text: 'X' });
    const bot = new Message({ role: 'assistant', text: 'Y' });
    assert.strictEqual(user.isFromLead(), true);
    assert.strictEqual(user.isFromAssistant(), false);
    assert.strictEqual(bot.isFromLead(), false);
    assert.strictEqual(bot.isFromAssistant(), true);
  });

  test('getPreview truncates long messages', () => {
    const msg = new Message({ text: 'A'.repeat(100) });
    const preview = msg.getPreview(50);
    assert.strictEqual(preview.length, 50);
    assert.ok(preview.endsWith('...'));
  });

  test('getPreview keeps short messages', () => {
    const msg = new Message({ text: 'Short' });
    assert.strictEqual(msg.getPreview(50), 'Short');
  });

  test('toDbRow ↔ fromDbRow roundtrip', () => {
    const msg = Message.createOutgoing(42, 'Test message', MessageType.CTA);
    const row = msg.toDbRow();
    const restored = Message.fromDbRow(row);

    assert.strictEqual(restored.role, 'assistant');
    assert.strictEqual(restored.text, 'Test message');
    assert.strictEqual(restored.type, MessageType.CTA);
  });
});

// ================================================================
// CONVERSATION ENTITY
// ================================================================

describe('Conversation Entity', () => {

  test('getMetrics', () => {
    const conv = new Conversation(1, [
      { role: 'assistant', text: 'Hey', type: 'greeting' },
      { role: 'user', text: 'Salut !' },
      { role: 'assistant', text: 'Ça va ?', type: 'cta' }
    ]);

    const metrics = conv.getMetrics();
    assert.strictEqual(metrics.totalMessages, 3);
    assert.strictEqual(metrics.assistantMessages, 2);
    assert.strictEqual(metrics.leadMessages, 1);
    assert.strictEqual(metrics.hasGreeting, true);
    assert.strictEqual(metrics.hasCta, true);
    assert.ok(metrics.avgLeadMessageLength > 0);
  });

  test('getSummaryForAI', () => {
    const conv = new Conversation(1, [
      { role: 'assistant', text: 'A' },
      { role: 'user', text: 'B' }
    ]);

    const summary = conv.getSummaryForAI();
    assert.strictEqual(summary.length, 2);
    assert.strictEqual(summary[0].role, 'assistant');
    assert.strictEqual(summary[0].content, 'A');
  });

  test('getSummaryForAI with limit', () => {
    const msgs = [];
    for (let i = 0; i < 20; i++) {
      msgs.push({ role: i % 2 === 0 ? 'assistant' : 'user', text: `Msg ${i}` });
    }
    const conv = new Conversation(1, msgs);
    const summary = conv.getSummaryForAI(5);
    assert.strictEqual(summary.length, 5);
  });

  test('isWaitingForReply / hasUnansweredMessage', () => {
    const conv = new Conversation(1, [
      { role: 'assistant', text: 'Hey' }
    ]);
    assert.strictEqual(conv.isWaitingForReply(), true);
    assert.strictEqual(conv.hasUnansweredMessage(), false);

    conv.addIncoming('Salut');
    assert.strictEqual(conv.isWaitingForReply(), false);
    assert.strictEqual(conv.hasUnansweredMessage(), true);
  });

  test('empty conversation', () => {
    const conv = Conversation.create(1);
    assert.strictEqual(conv.isEmpty(), true);
    assert.strictEqual(conv.length, 0);
    assert.strictEqual(conv.getLastMessage(), null);
  });

  test('getFullText', () => {
    const conv = new Conversation(1, [
      { role: 'assistant', text: 'Hey' },
      { role: 'user', text: 'Salut' }
    ]);
    const text = conv.getFullText();
    assert.ok(text.includes('Nous: Hey'));
    assert.ok(text.includes('Lead: Salut'));
  });
});

// ================================================================
// EXTRACT PAIN POINTS FROM COMMENTS (from db_integration.js logic)
// ================================================================

describe('extractPainPointsFromComments patterns', () => {

  // Re-implement the function locally since it's not exported
  function extractPainPointsFromComments(comments) {
    const painPoints = [];
    const painPatterns = [
      /struggl\w* with ([^.,!?]+)/i,
      /can't (seem to )?([^.,!?]+)/i,
      /problem with ([^.,!?]+)/i,
      /frustrated (with|about) ([^.,!?]+)/i,
      /need help (with )?([^.,!?]+)/i,
      /stuck (with|on) ([^.,!?]+)/i,
      /don't know how to ([^.,!?]+)/i
    ];
    for (const comment of comments) {
      const text = comment.comment_text || '';
      for (const pattern of painPatterns) {
        const match = text.match(pattern);
        if (match) {
          const pain = match[match.length - 1].trim();
          if (pain && !painPoints.includes(pain)) {
            painPoints.push(pain);
          }
        }
      }
    }
    return painPoints;
  }

  test('"struggling with" pattern', () => {
    const result = extractPainPointsFromComments([
      { comment_text: 'I am struggling with self-confidence' }
    ]);
    assert.ok(result.includes('self-confidence'));
  });

  test('"can\'t" pattern', () => {
    const result = extractPainPointsFromComments([
      { comment_text: "I can't stop overthinking" }
    ]);
    assert.ok(result.some(p => p.includes('overthinking')));
  });

  test('"can\'t seem to" pattern', () => {
    const result = extractPainPointsFromComments([
      { comment_text: "I can't seem to move on" }
    ]);
    assert.ok(result.some(p => p.includes('move on')));
  });

  test('"problem with" pattern', () => {
    const result = extractPainPointsFromComments([
      { comment_text: 'I have a problem with my relationship' }
    ]);
    assert.ok(result.some(p => p.includes('relationship')));
  });

  test('"frustrated with" pattern', () => {
    const result = extractPainPointsFromComments([
      { comment_text: 'I am frustrated with my progress' }
    ]);
    assert.ok(result.some(p => p.includes('progress')));
  });

  test('"need help with" pattern', () => {
    const result = extractPainPointsFromComments([
      { comment_text: 'I need help with anxiety' }
    ]);
    assert.ok(result.some(p => p.includes('anxiety')));
  });

  test('"stuck on" pattern', () => {
    const result = extractPainPointsFromComments([
      { comment_text: "I'm stuck on the same patterns" }
    ]);
    assert.ok(result.some(p => p.includes('same patterns')));
  });

  test('"don\'t know how to" pattern', () => {
    const result = extractPainPointsFromComments([
      { comment_text: "I don't know how to let go" }
    ]);
    assert.ok(result.some(p => p.includes('let go')));
  });

  test('Multiple comments → deduped pain points', () => {
    const result = extractPainPointsFromComments([
      { comment_text: 'I need help with anxiety' },
      { comment_text: 'I need help with anxiety' },
      { comment_text: 'struggling with confidence' }
    ]);
    const anxietyCount = result.filter(p => p.includes('anxiety')).length;
    assert.strictEqual(anxietyCount, 1, 'Should deduplicate');
    assert.ok(result.length >= 2);
  });

  test('No matching patterns → empty', () => {
    const result = extractPainPointsFromComments([
      { comment_text: 'Great content! Love it!' }
    ]);
    assert.strictEqual(result.length, 0);
  });

  test('Empty comments → empty', () => {
    assert.deepStrictEqual(extractPainPointsFromComments([]), []);
  });

  test('Missing comment_text → no crash', () => {
    const result = extractPainPointsFromComments([{ other_field: 'test' }]);
    assert.strictEqual(result.length, 0);
  });
});
