/**
 * SaveLeadsFromComments Use Case Tests
 */

import { test, describe, mock } from 'node:test';
import assert from 'node:assert';
import { SaveLeadsFromComments } from '../use-cases/SaveLeadsFromComments.js';
import { Lead } from '../../domain/entities/Lead.js';

/**
 * Create mock repositories for testing
 */
function createMockRepositories(existingLeads = {}) {
  const leads = { ...existingLeads };
  const comments = [];

  return {
    leadRepository: {
      findByUsername: mock.fn(async (username) => leads[username] || null),
      save: mock.fn(async (lead) => {
        leads[lead.username] = lead;
        if (!lead.id) lead.id = Object.keys(leads).length;
        return lead;
      }),
      getLeads: () => leads
    },
    commentRepository: {
      save: mock.fn(async (comment) => {
        comments.push(comment);
        return comment;
      }),
      getComments: () => comments
    }
  };
}

describe('SaveLeadsFromComments.execute', () => {
  test('should create new leads from quality comments', async () => {
    const repos = createMockRepositories();
    const useCase = new SaveLeadsFromComments({
      leadRepository: repos.leadRepository
    });

    const comments = [
      { username: 'real_person', comment_text: 'How can I improve my fitness routine? I have been struggling for months.' }
    ];

    const result = await useCase.execute(comments, 1);

    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.saved, 1);
    assert.strictEqual(result.spam, 0);
    assert.strictEqual(repos.leadRepository.save.mock.callCount(), 1);
  });

  test('should filter spam comments', async () => {
    const repos = createMockRepositories();
    const useCase = new SaveLeadsFromComments({
      leadRepository: repos.leadRepository
    });

    const comments = [
      { username: 'spam_bot', comment_text: '🔥🔥🔥' },
      { username: 'normal_user', comment_text: 'This is a thoughtful comment with a question. How do you approach this?' }
    ];

    const result = await useCase.execute(comments, 1);

    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.spam, 1);
    assert.strictEqual(result.saved, 1);
    assert.ok(result.spamReasons.emojiOnly >= 1);
  });

  test('should update existing leads', async () => {
    const existingLead = Lead.create('returning_user', 1);
    existingLead.totalComments = 2;
    existingLead.engagementScore = 20;

    const repos = createMockRepositories({
      'returning_user': existingLead
    });
    const useCase = new SaveLeadsFromComments({
      leadRepository: repos.leadRepository
    });

    const comments = [
      { username: 'returning_user', comment_text: 'Another quality comment about my struggles with health and wellness.' }
    ];

    const result = await useCase.execute(comments, 1);

    assert.strictEqual(result.updated, 1);
    assert.strictEqual(result.saved, 0);

    const updatedLead = repos.leadRepository.getLeads()['returning_user'];
    assert.strictEqual(updatedLead.totalComments, 3);
    assert.ok(updatedLead.engagementScore > 20);
  });

  test('should skip users with only spam comments', async () => {
    const repos = createMockRepositories();
    const useCase = new SaveLeadsFromComments({
      leadRepository: repos.leadRepository
    });

    const comments = [
      { username: 'spammer', comment_text: '🔥' },
      { username: 'spammer', comment_text: 'nice!' }
    ];

    const result = await useCase.execute(comments, 1);

    assert.strictEqual(result.saved, 0);
    assert.strictEqual(result.updated, 0);
    assert.strictEqual(result.spam, 2);
  });

  test('should group comments by username', async () => {
    const repos = createMockRepositories();
    const useCase = new SaveLeadsFromComments({
      leadRepository: repos.leadRepository
    });

    const comments = [
      { username: 'active_user', comment_text: 'First comment with good content about health.' },
      { username: 'active_user', comment_text: 'Second comment with even more value and questions?' },
      { username: 'other_person', comment_text: 'Different user asking about fitness tips.' }
    ];

    const result = await useCase.execute(comments, 1);

    assert.strictEqual(result.saved, 2); // Two unique users

    const activeUser = repos.leadRepository.getLeads()['active_user'];
    assert.strictEqual(activeUser.totalComments, 2);
  });

  test('should normalize usernames', async () => {
    const repos = createMockRepositories();
    const useCase = new SaveLeadsFromComments({
      leadRepository: repos.leadRepository
    });

    const comments = [
      { username: '  @UserName  ', comment_text: 'Quality comment with good content.' }
    ];

    const result = await useCase.execute(comments, 1);

    assert.strictEqual(result.saved, 1);
    const leads = repos.leadRepository.getLeads();
    assert.ok(leads['username']); // Should be normalized
  });

  test('should save comments when commentRepository is provided', async () => {
    const repos = createMockRepositories();
    const useCase = new SaveLeadsFromComments({
      leadRepository: repos.leadRepository,
      commentRepository: repos.commentRepository
    });

    const comments = [
      { username: 'person', comment_text: 'Quality comment worth saving for reference.' }
    ];

    await useCase.execute(comments, 1);

    const savedComments = repos.commentRepository.getComments();
    assert.strictEqual(savedComments.length, 1);
    assert.strictEqual(savedComments[0].username, 'person');
    assert.strictEqual(savedComments[0].isSpam, false);
  });

  test('should track spam reasons breakdown', async () => {
    const repos = createMockRepositories();
    const useCase = new SaveLeadsFromComments({
      leadRepository: repos.leadRepository
    });

    const comments = [
      { username: 'bot1', comment_text: '🔥🔥🔥' },
      { username: 'bot2', comment_text: '😍😍😍' },
      { username: 'promo', comment_text: 'Check my profile for deals!' }
    ];

    const result = await useCase.execute(comments, 1);

    assert.strictEqual(result.spam, 3);
    assert.ok(result.spamReasons.emojiOnly >= 2);
    assert.ok(result.spamReasons.promoSpam >= 1);
  });

  test('should handle empty comments array', async () => {
    const repos = createMockRepositories();
    const useCase = new SaveLeadsFromComments({
      leadRepository: repos.leadRepository
    });

    const result = await useCase.execute([], 1);

    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.saved, 0);
    assert.strictEqual(result.spam, 0);
  });

  test('should skip comments with invalid usernames', async () => {
    const repos = createMockRepositories();
    const useCase = new SaveLeadsFromComments({
      leadRepository: repos.leadRepository
    });

    const comments = [
      { username: '', comment_text: 'Comment without username' },
      { username: 'valid_user', comment_text: 'Comment with valid username and good content.' }
    ];

    const result = await useCase.execute(comments, 1);

    assert.strictEqual(result.saved, 1);
  });
});
