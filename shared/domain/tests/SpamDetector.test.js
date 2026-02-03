/**
 * SpamDetector Domain Service Tests
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { SpamDetector, SPAM_PATTERNS, QUALITY_THRESHOLDS } from '../services/SpamDetector.js';

describe('SpamDetector.analyze', () => {
  test('should detect bot usernames', () => {
    const result = SpamDetector.analyze({ text: 'Great post!', username: 'user12345678' });
    assert.strictEqual(result.isSpam, true);
    assert.strictEqual(result.reason, 'bot_username');
  });

  test('should detect competitor usernames', () => {
    const result = SpamDetector.analyze({ text: 'Nice content', username: 'coach_marie' });
    assert.strictEqual(result.isSpam, true);
    assert.strictEqual(result.reason, 'competitor_username');
  });

  test('should detect emoji-only comments', () => {
    const result = SpamDetector.analyze({ text: '🔥🔥🔥', username: 'normal_user' });
    assert.strictEqual(result.isSpam, true);
    assert.strictEqual(result.reason, 'emojiOnly');
  });

  test('should detect too short comments', () => {
    const result = SpamDetector.analyze({ text: 'ok', username: 'normal_user' });
    assert.strictEqual(result.isSpam, true);
    assert.strictEqual(result.reason, 'tooShort');
  });

  test('should detect generic praise', () => {
    const result = SpamDetector.analyze({ text: 'amazing!', username: 'normal_user' });
    assert.strictEqual(result.isSpam, true);
    assert.strictEqual(result.reason, 'genericPraise');
  });

  test('should detect promo spam', () => {
    const result = SpamDetector.analyze({ text: 'Check my profile for deals!', username: 'normal_user' });
    assert.strictEqual(result.isSpam, true);
    assert.strictEqual(result.reason, 'promoSpam');
  });

  test('should detect just tag comments', () => {
    const result = SpamDetector.analyze({ text: '@friend123', username: 'normal_user' });
    assert.strictEqual(result.isSpam, true);
    assert.strictEqual(result.reason, 'justTag');
  });

  test('should accept quality comments', () => {
    const result = SpamDetector.analyze({
      text: 'I have been struggling with this issue for months. How do you recommend starting?',
      username: 'genuine_user'
    });
    assert.strictEqual(result.isSpam, false);
    assert.strictEqual(result.reason, null);
    assert.ok(result.qualityScore >= QUALITY_THRESHOLDS.BASE_SCORE);
  });

  test('should give higher score to questions', () => {
    const withQuestion = SpamDetector.analyze({ text: 'How does this work?', username: 'user' });
    const withoutQuestion = SpamDetector.analyze({ text: 'This is interesting', username: 'user' });
    assert.ok(withQuestion.qualityScore > withoutQuestion.qualityScore);
  });

  test('should give higher score to problem mentions', () => {
    const withProblem = SpamDetector.analyze({ text: 'I struggle with motivation daily', username: 'user' });
    const withoutProblem = SpamDetector.analyze({ text: 'This is a good point', username: 'user' });
    assert.ok(withProblem.qualityScore > withoutProblem.qualityScore);
  });

  test('should give higher score to longer comments', () => {
    const longComment = SpamDetector.analyze({
      text: 'This is a really detailed comment that shares my personal experience with the topic you mentioned.',
      username: 'user'
    });
    const shortComment = SpamDetector.analyze({ text: 'Good point here', username: 'user' });
    assert.ok(longComment.qualityScore > shortComment.qualityScore);
  });
});

describe('SpamDetector.isSpam', () => {
  test('should return true for spam', () => {
    assert.strictEqual(SpamDetector.isSpam('nice!', 'user'), true);
  });

  test('should return false for quality comments', () => {
    assert.strictEqual(SpamDetector.isSpam('How can I improve my routine?', 'user'), false);
  });
});

describe('SpamDetector.getQualityTier', () => {
  test('should return spam for spam analysis', () => {
    const analysis = { isSpam: true, qualityScore: 0 };
    assert.strictEqual(SpamDetector.getQualityTier(analysis), 'spam');
  });

  test('should return high for high quality score', () => {
    const analysis = { isSpam: false, qualityScore: 12 };
    assert.strictEqual(SpamDetector.getQualityTier(analysis), 'high');
  });

  test('should return medium for medium quality score', () => {
    const analysis = { isSpam: false, qualityScore: 7 };
    assert.strictEqual(SpamDetector.getQualityTier(analysis), 'medium');
  });

  test('should return low for low quality score', () => {
    const analysis = { isSpam: false, qualityScore: 4 };
    assert.strictEqual(SpamDetector.getQualityTier(analysis), 'low');
  });
});

describe('SpamDetector.filterComments', () => {
  test('should filter comments and return stats', () => {
    const comments = [
      { comment_text: 'How do you manage stress?', username: 'real_user' },
      { comment_text: '🔥🔥', username: 'emoji_fan' },
      { comment_text: 'Check my profile!', username: 'spammer' },
      { comment_text: 'I struggle with anxiety. Any tips?', username: 'genuine_person' }
    ];

    const result = SpamDetector.filterComments(comments);

    assert.strictEqual(result.all.length, 4);
    assert.strictEqual(result.filtered.length, 2);
    assert.strictEqual(result.stats.spam, 2);
    assert.ok(result.stats.spamReasons.emojiOnly >= 1);
  });

  test('should add spam flags to all comments', () => {
    const comments = [
      { comment_text: '🔥', username: 'spam_lover' },
      { comment_text: 'Great question about health and how to improve', username: 'genuine_person' }
    ];

    const result = SpamDetector.filterComments(comments);

    assert.strictEqual(result.all[0].is_spam, true);
    assert.strictEqual(result.all[1].is_spam, false);
    assert.ok(result.all[1].quality_score > 0);
  });
});
