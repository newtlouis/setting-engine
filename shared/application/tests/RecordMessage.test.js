/**
 * RecordMessage Use Case Tests
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { RecordMessage } from '../use-cases/RecordMessage.js';
import { Lead } from '../../domain/entities/Lead.js';
import { LeadStatus } from '../../domain/value-objects/LeadStatus.js';
import { ConversationStep } from '../../domain/value-objects/ConversationStep.js';
import { MessageRole } from '../../domain/entities/Message.js';

/**
 * Create mock repositories for testing
 */
function createMockRepositories(initialLead = null) {
  let savedLead = initialLead;
  const messages = [];

  return {
    leadRepository: {
      findByUsername: mock.fn(async () => savedLead),
      save: mock.fn(async (lead) => {
        savedLead = lead;
        if (!savedLead.id) savedLead.id = 1;
        return savedLead;
      })
    },
    conversationRepository: {
      addMessage: mock.fn(async (leadId, message) => {
        messages.push({ leadId, message });
        return message;
      }),
      getMessages: () => messages
    }
  };
}

describe('RecordMessage.execute', () => {
  test('should create new lead for unknown username', async () => {
    const repos = createMockRepositories(null);
    const useCase = new RecordMessage(repos);

    const result = await useCase.execute({
      username: 'new_user',
      text: 'Hello!',
      direction: 'outgoing'
    });

    assert.ok(result.lead);
    assert.strictEqual(result.lead.username, 'new_user');
    assert.strictEqual(repos.leadRepository.save.mock.callCount(), 2); // Create + update
  });

  test('should update existing lead', async () => {
    const existingLead = Lead.create('existing_user', 1);
    const repos = createMockRepositories(existingLead);
    const useCase = new RecordMessage(repos);

    const result = await useCase.execute({
      username: 'existing_user',
      text: 'Follow up',
      direction: 'outgoing'
    });

    assert.strictEqual(result.lead.username, 'existing_user');
    assert.strictEqual(repos.leadRepository.save.mock.callCount(), 1); // Only update
  });

  test('should increment totalMessagesSent for outgoing messages', async () => {
    const lead = Lead.create('test_user', 1);
    lead.totalMessagesSent = 2;
    const repos = createMockRepositories(lead);
    const useCase = new RecordMessage(repos);

    const result = await useCase.execute({
      username: 'test_user',
      text: 'Message',
      direction: 'outgoing'
    });

    assert.strictEqual(result.lead.totalMessagesSent, 3);
  });

  test('should increment totalMessagesReceived for incoming messages', async () => {
    const lead = Lead.create('test_user', 1);
    lead.status = LeadStatus.CONTACTED;
    lead.totalMessagesReceived = 0;
    const repos = createMockRepositories(lead);
    const useCase = new RecordMessage(repos);

    const result = await useCase.execute({
      username: 'test_user',
      text: 'Reply from lead',
      direction: 'incoming'
    });

    assert.strictEqual(result.lead.totalMessagesReceived, 1);
  });

  test('should update status from NEW to CONTACTED on first outgoing', async () => {
    const lead = Lead.create('test_user', 1);
    assert.strictEqual(lead.status, LeadStatus.NEW);

    const repos = createMockRepositories(lead);
    const useCase = new RecordMessage(repos);

    const result = await useCase.execute({
      username: 'test_user',
      text: 'First contact',
      direction: 'outgoing'
    });

    assert.strictEqual(result.lead.status, LeadStatus.CONTACTED);
    assert.strictEqual(result.isFirstContact, true);
  });

  test('should update status from CONTACTED to REPLIED on first incoming', async () => {
    const lead = Lead.create('test_user', 1);
    lead.status = LeadStatus.CONTACTED;
    lead.totalMessagesSent = 1;

    const repos = createMockRepositories(lead);
    const useCase = new RecordMessage(repos);

    const result = await useCase.execute({
      username: 'test_user',
      text: 'First reply',
      direction: 'incoming'
    });

    assert.strictEqual(result.lead.status, LeadStatus.REPLIED);
    assert.strictEqual(result.isFirstReply, true);
  });

  test('should update conversationStep based on message counts', async () => {
    const lead = Lead.create('test_user', 1);
    const repos = createMockRepositories(lead);
    const useCase = new RecordMessage(repos);

    // First outgoing
    let result = await useCase.execute({
      username: 'test_user',
      text: 'Hello',
      direction: 'outgoing'
    });
    assert.strictEqual(result.lead.conversationStep, ConversationStep.FIRST_MESSAGE);
  });

  test('should save message to conversation repository', async () => {
    const lead = Lead.create('test_user', 1);
    lead.id = 42;
    const repos = createMockRepositories(lead);
    const useCase = new RecordMessage(repos);

    await useCase.execute({
      username: 'test_user',
      text: 'Test message',
      direction: 'outgoing'
    });

    assert.strictEqual(repos.conversationRepository.addMessage.mock.callCount(), 1);
    const savedMessages = repos.conversationRepository.getMessages();
    assert.strictEqual(savedMessages[0].message.text, 'Test message');
    assert.strictEqual(savedMessages[0].message.role, MessageRole.ASSISTANT);
  });

  test('should create message with USER role for incoming', async () => {
    const lead = Lead.create('test_user', 1);
    lead.id = 42;
    lead.status = LeadStatus.CONTACTED;
    const repos = createMockRepositories(lead);
    const useCase = new RecordMessage(repos);

    await useCase.execute({
      username: 'test_user',
      text: 'Reply',
      direction: 'incoming'
    });

    const savedMessages = repos.conversationRepository.getMessages();
    assert.strictEqual(savedMessages[0].message.role, MessageRole.USER);
  });
});

describe('RecordMessage.recordOutgoing', () => {
  test('should call execute with outgoing direction', async () => {
    const lead = Lead.create('test_user', 1);
    const repos = createMockRepositories(lead);
    const useCase = new RecordMessage(repos);

    const result = await useCase.recordOutgoing('test_user', 'Hello!');

    assert.strictEqual(result.lead.totalMessagesSent, 1);
  });
});

describe('RecordMessage.recordIncoming', () => {
  test('should call execute with incoming direction', async () => {
    const lead = Lead.create('test_user', 1);
    lead.status = LeadStatus.CONTACTED;
    const repos = createMockRepositories(lead);
    const useCase = new RecordMessage(repos);

    const result = await useCase.recordIncoming('test_user', 'Reply');

    assert.strictEqual(result.lead.totalMessagesReceived, 1);
  });
});
