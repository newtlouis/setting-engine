/**
 * LeadQualifier Domain Service Tests
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { LeadQualifier, QUALIFICATION_TIERS, DISQUALIFICATION_REASONS } from '../services/LeadQualifier.js';

describe('LeadQualifier.qualify', () => {
  test('should disqualify ignored leads', () => {
    const lead = { isIgnored: true, totalComments: 5 };
    const result = LeadQualifier.qualify(lead);

    assert.strictEqual(result.qualified, false);
    assert.strictEqual(result.tier, 'disqualified');
    assert.ok(result.reasons.includes(DISQUALIFICATION_REASONS.IGNORED));
  });

  test('should disqualify failed leads', () => {
    const lead = { status: 'failed', totalComments: 3 };
    const result = LeadQualifier.qualify(lead);

    assert.strictEqual(result.qualified, false);
    assert.strictEqual(result.tier, 'disqualified');
  });

  test('should disqualify leads with no engagement', () => {
    const lead = { totalComments: 0, engagementScore: 0 };
    const result = LeadQualifier.qualify(lead);

    assert.strictEqual(result.qualified, false);
    assert.ok(result.reasons.includes(DISQUALIFICATION_REASONS.NO_ENGAGEMENT));
  });

  test('should qualify lead with bio', () => {
    const lead = { bio: 'I love fitness', totalComments: 1 };
    const result = LeadQualifier.qualify(lead);

    assert.ok(result.score > 0);
    assert.ok(result.reasons.includes('Has bio'));
  });

  test('should give higher score to leads with email', () => {
    const withEmail = LeadQualifier.qualify({ email: 'test@example.com', totalComments: 1 });
    const withoutEmail = LeadQualifier.qualify({ totalComments: 1 });

    assert.ok(withEmail.score > withoutEmail.score);
    assert.ok(withEmail.reasons.includes('Has email'));
  });

  test('should give higher score to leads who replied', () => {
    const replied = LeadQualifier.qualify({ totalMessagesReceived: 2, totalComments: 1 });
    const noReply = LeadQualifier.qualify({ totalMessagesReceived: 0, totalComments: 1 });

    assert.ok(replied.score > noReply.score);
    assert.ok(replied.reasons.includes('Has replied to messages'));
  });

  test('should give higher score to hot leads', () => {
    const hot = LeadQualifier.qualify({ warmth: 'hot', totalComments: 1 });
    const cold = LeadQualifier.qualify({ warmth: 'cold', totalComments: 1 });

    assert.ok(hot.score > cold.score);
    assert.ok(hot.reasons.includes('High engagement (hot)'));
  });

  test('should give higher score to leads with multiple comments', () => {
    const multiComment = LeadQualifier.qualify({ totalComments: 5 });
    const singleComment = LeadQualifier.qualify({ totalComments: 1 });

    assert.ok(multiComment.score > singleComment.score);
  });

  test('should return highly_qualified tier for high scores', () => {
    const lead = {
      bio: 'Fitness enthusiast',
      email: 'test@test.com',
      totalMessagesReceived: 3,
      warmth: 'hot',
      conversationStep: 3,
      totalComments: 5,
      engagementScore: 50
    };
    const result = LeadQualifier.qualify(lead);

    assert.strictEqual(result.tier, 'highly_qualified');
    assert.ok(result.score >= QUALIFICATION_TIERS.HIGHLY_QUALIFIED);
  });

  test('should support snake_case properties', () => {
    const lead = {
      total_comments: 3,
      total_messages_received: 1,
      engagement_score: 20,
      conversation_step: 2
    };
    const result = LeadQualifier.qualify(lead);

    assert.ok(result.qualified);
    assert.ok(result.score > 0);
  });
});

describe('LeadQualifier.isQualified', () => {
  test('should return true for qualified leads', () => {
    const lead = { bio: 'Test bio', totalComments: 2, warmth: 'warm' };
    assert.strictEqual(LeadQualifier.isQualified(lead), true);
  });

  test('should return false for unqualified leads', () => {
    const lead = { isIgnored: true };
    assert.strictEqual(LeadQualifier.isQualified(lead), false);
  });
});

describe('LeadQualifier.filterQualified', () => {
  test('should filter out unqualified leads', () => {
    const leads = [
      { bio: 'Active user', totalComments: 3, warmth: 'hot' },
      { isIgnored: true, totalComments: 5 },
      { bio: 'Another user', totalComments: 2 },
      { totalComments: 0, engagementScore: 0 }
    ];

    const qualified = LeadQualifier.filterQualified(leads);

    assert.strictEqual(qualified.length, 2);
  });
});

describe('LeadQualifier.rankByQualification', () => {
  test('should rank leads by qualification score', () => {
    const leads = [
      { id: 1, totalComments: 1 },
      { id: 2, bio: 'Bio', email: 'test@test.com', totalMessagesReceived: 5, warmth: 'hot', totalComments: 3 },
      { id: 3, bio: 'Simple bio', totalComments: 2 }
    ];

    const ranked = LeadQualifier.rankByQualification(leads);

    assert.strictEqual(ranked[0].id, 2); // Highest score first
    assert.strictEqual(ranked[2].id, 1); // Lowest score last
  });
});

describe('LeadQualifier.getReadyForOutreach', () => {
  test('should return qualified new leads', () => {
    const leads = [
      { status: 'new', bio: 'Ready for outreach', totalComments: 2 },
      { status: 'contacted', bio: 'Already contacted', totalComments: 5 },
      { status: 'new', isIgnored: true },
      { status: 'new', totalComments: 0, engagementScore: 0 }
    ];

    const ready = LeadQualifier.getReadyForOutreach(leads);

    assert.strictEqual(ready.length, 1);
    assert.strictEqual(ready[0].bio, 'Ready for outreach');
  });
});
