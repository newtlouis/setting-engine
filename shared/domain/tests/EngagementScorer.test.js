/**
 * EngagementScorer Domain Service Tests
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { EngagementScorer, SCORING_WEIGHTS, ENGAGEMENT_THRESHOLDS } from '../services/EngagementScorer.js';
import { Warmth } from '../value-objects/Warmth.js';

describe('EngagementScorer.calculate', () => {
  test('should return zero score for no engagement', () => {
    const result = EngagementScorer.calculate({});
    assert.strictEqual(result.score, 0);
    assert.strictEqual(result.warmth, Warmth.COLD);
    assert.strictEqual(result.breakdown.total, 0);
  });

  test('should calculate score from comments', () => {
    const result = EngagementScorer.calculate({ totalComments: 2, avgCommentQuality: 5 });
    const expectedCommentScore = 2 * SCORING_WEIGHTS.COMMENT.BASE * 1.0; // quality multiplier 1.0
    assert.strictEqual(result.breakdown.comments, expectedCommentScore);
  });

  test('should apply higher multiplier for high quality comments', () => {
    const highQuality = EngagementScorer.calculate({ totalComments: 1, avgCommentQuality: 10 });
    const lowQuality = EngagementScorer.calculate({ totalComments: 1, avgCommentQuality: 3 });
    assert.ok(highQuality.score > lowQuality.score);
  });

  test('should add score for messages sent', () => {
    const result = EngagementScorer.calculate({ totalMessagesSent: 3 });
    assert.strictEqual(result.breakdown.messagesSent, 3 * SCORING_WEIGHTS.MESSAGE.SENT);
  });

  test('should add higher score for messages received', () => {
    const received = EngagementScorer.calculate({ totalMessagesReceived: 2 });
    const sent = EngagementScorer.calculate({ totalMessagesSent: 2 });
    assert.ok(received.score > sent.score);
  });

  test('should cap score at 100', () => {
    const result = EngagementScorer.calculate({
      totalComments: 10,
      totalMessagesSent: 10,
      totalMessagesReceived: 10,
      avgCommentQuality: 10
    });
    assert.strictEqual(result.score, 100);
    assert.ok(result.breakdown.total > 100); // Raw total exceeds cap
  });

  test('should return hot warmth for high engagement', () => {
    const result = EngagementScorer.calculate({ totalMessagesReceived: 6 }); // 6 * 15 = 90
    assert.strictEqual(result.warmth, Warmth.HOT);
  });

  test('should return warm warmth for medium engagement', () => {
    const result = EngagementScorer.calculate({ totalMessagesReceived: 3 }); // 3 * 15 = 45
    assert.strictEqual(result.warmth, Warmth.WARM);
  });
});

describe('EngagementScorer.calculateWarmthFromComments', () => {
  test('should return cold for zero comments', () => {
    assert.strictEqual(EngagementScorer.calculateWarmthFromComments(0), Warmth.COLD);
  });

  test('should return warm for 1-2 comments', () => {
    assert.strictEqual(EngagementScorer.calculateWarmthFromComments(1), Warmth.WARM);
    assert.strictEqual(EngagementScorer.calculateWarmthFromComments(2), Warmth.WARM);
  });

  test('should return hot for 3+ comments', () => {
    assert.strictEqual(EngagementScorer.calculateWarmthFromComments(3), Warmth.HOT);
    assert.strictEqual(EngagementScorer.calculateWarmthFromComments(10), Warmth.HOT);
  });
});

describe('EngagementScorer.shouldPrioritize', () => {
  test('should prioritize leads who replied', () => {
    const lead = { hasReplied: true, engagementScore: 0, totalComments: 0 };
    assert.strictEqual(EngagementScorer.shouldPrioritize(lead), true);
  });

  test('should prioritize high engagement leads', () => {
    const lead = { hasReplied: false, engagementScore: ENGAGEMENT_THRESHOLDS.HIGH, totalComments: 0 };
    assert.strictEqual(EngagementScorer.shouldPrioritize(lead), true);
  });

  test('should prioritize leads with multiple comments', () => {
    const lead = { hasReplied: false, engagementScore: 10, totalComments: 2 };
    assert.strictEqual(EngagementScorer.shouldPrioritize(lead), true);
  });

  test('should not prioritize low engagement leads', () => {
    const lead = { hasReplied: false, engagementScore: 10, totalComments: 1 };
    assert.strictEqual(EngagementScorer.shouldPrioritize(lead), false);
  });
});

describe('EngagementScorer.rankByPriority', () => {
  test('should rank replied leads first', () => {
    const leads = [
      { id: 1, totalMessagesReceived: 0, engagementScore: 90 },
      { id: 2, totalMessagesReceived: 1, engagementScore: 10 },
      { id: 3, totalMessagesReceived: 0, engagementScore: 50 }
    ];

    const ranked = EngagementScorer.rankByPriority(leads);

    assert.strictEqual(ranked[0].id, 2); // Replied first
    assert.strictEqual(ranked[1].id, 1); // Then highest engagement
    assert.strictEqual(ranked[2].id, 3);
  });

  test('should not mutate original array', () => {
    const leads = [{ id: 1, totalMessagesReceived: 0, engagementScore: 10 }];
    const ranked = EngagementScorer.rankByPriority(leads);
    assert.notStrictEqual(ranked, leads);
  });

  test('should handle missing engagement scores', () => {
    const leads = [
      { id: 1, totalMessagesReceived: 0 },
      { id: 2, totalMessagesReceived: 0, engagementScore: 50 }
    ];

    const ranked = EngagementScorer.rankByPriority(leads);
    assert.strictEqual(ranked[0].id, 2);
  });
});

describe('EngagementScorer.getTier', () => {
  test('should return high for scores >= 80', () => {
    assert.strictEqual(EngagementScorer.getTier(80), 'high');
    assert.strictEqual(EngagementScorer.getTier(100), 'high');
  });

  test('should return medium for scores >= 40 and < 80', () => {
    assert.strictEqual(EngagementScorer.getTier(40), 'medium');
    assert.strictEqual(EngagementScorer.getTier(79), 'medium');
  });

  test('should return low for scores < 40', () => {
    assert.strictEqual(EngagementScorer.getTier(0), 'low');
    assert.strictEqual(EngagementScorer.getTier(39), 'low');
  });
});
