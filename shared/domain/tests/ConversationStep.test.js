/**
 * ConversationStep Value Object Tests
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  ConversationStep,
  STEP_LABELS,
  isValidStep,
  calculateStep,
  needsFollowUp,
  isAwaitingReply,
  isFollowUpExhausted,
  isActiveConversation,
  getStepLabel,
  parseStep
} from '../value-objects/ConversationStep.js';

describe('ConversationStep enum', () => {
  test('should have all expected steps', () => {
    assert.strictEqual(ConversationStep.NO_CONTACT, 0);
    assert.strictEqual(ConversationStep.FIRST_MESSAGE, 1);
    assert.strictEqual(ConversationStep.FIRST_REPLY, 2);
    assert.strictEqual(ConversationStep.ONGOING, 3);
    assert.strictEqual(ConversationStep.FOLLOW_UP_1, 4);
    assert.strictEqual(ConversationStep.FOLLOW_UP_2, 5);
    assert.strictEqual(ConversationStep.FOLLOW_UP_3, 6);
    assert.strictEqual(ConversationStep.FOLLOW_UP_4, 7);
    assert.strictEqual(ConversationStep.FOLLOW_UP_5, 8);
  });

  test('should be frozen (immutable)', () => {
    assert.ok(Object.isFrozen(ConversationStep));
  });
});

describe('isValidStep', () => {
  test('should return true for valid steps (0-8)', () => {
    for (let i = 0; i <= 8; i++) {
      assert.strictEqual(isValidStep(i), true, `Step ${i} should be valid`);
    }
  });

  test('should return false for invalid steps', () => {
    assert.strictEqual(isValidStep(-1), false);
    assert.strictEqual(isValidStep(9), false);
    assert.strictEqual(isValidStep(1.5), false);
    assert.strictEqual(isValidStep('1'), false);
    assert.strictEqual(isValidStep(null), false);
  });
});

describe('calculateStep', () => {
  test('should return NO_CONTACT when no messages', () => {
    assert.strictEqual(calculateStep(0, 0), ConversationStep.NO_CONTACT);
  });

  test('should return FIRST_MESSAGE when 1 sent, no reply', () => {
    assert.strictEqual(calculateStep(1, 0), ConversationStep.FIRST_MESSAGE);
  });

  test('should return FOLLOW_UP_1 when 2 sent, no reply', () => {
    assert.strictEqual(calculateStep(2, 0), ConversationStep.FOLLOW_UP_1);
  });

  test('should return FOLLOW_UP_2 when 3 sent, no reply', () => {
    assert.strictEqual(calculateStep(3, 0), ConversationStep.FOLLOW_UP_2);
  });

  test('should return FOLLOW_UP_3 when 4 sent, no reply', () => {
    assert.strictEqual(calculateStep(4, 0), ConversationStep.FOLLOW_UP_3);
  });

  test('should return FOLLOW_UP_4 when 5 sent, no reply', () => {
    assert.strictEqual(calculateStep(5, 0), ConversationStep.FOLLOW_UP_4);
  });

  test('should return FOLLOW_UP_5 when 6+ sent, no reply', () => {
    assert.strictEqual(calculateStep(6, 0), ConversationStep.FOLLOW_UP_5);
    assert.strictEqual(calculateStep(10, 0), ConversationStep.FOLLOW_UP_5);
  });

  test('should return FIRST_REPLY when received one reply', () => {
    assert.strictEqual(calculateStep(1, 1), ConversationStep.FIRST_REPLY);
    assert.strictEqual(calculateStep(5, 1), ConversationStep.FIRST_REPLY);
  });

  test('should return ONGOING when multiple replies', () => {
    assert.strictEqual(calculateStep(3, 2), ConversationStep.ONGOING);
    assert.strictEqual(calculateStep(5, 10), ConversationStep.ONGOING);
  });

  test('reply resets follow-up progression', () => {
    // Even after many follow-ups, one reply moves to FIRST_REPLY
    assert.strictEqual(calculateStep(6, 1), ConversationStep.FIRST_REPLY);
  });
});

describe('needsFollowUp', () => {
  test('should return true for FIRST_MESSAGE', () => {
    assert.strictEqual(needsFollowUp(ConversationStep.FIRST_MESSAGE), true);
  });

  test('should return true for FOLLOW_UP_1 through FOLLOW_UP_4', () => {
    assert.strictEqual(needsFollowUp(ConversationStep.FOLLOW_UP_1), true);
    assert.strictEqual(needsFollowUp(ConversationStep.FOLLOW_UP_2), true);
    assert.strictEqual(needsFollowUp(ConversationStep.FOLLOW_UP_3), true);
    assert.strictEqual(needsFollowUp(ConversationStep.FOLLOW_UP_4), true);
  });

  test('should return false for FOLLOW_UP_5 (exhausted)', () => {
    assert.strictEqual(needsFollowUp(ConversationStep.FOLLOW_UP_5), false);
  });

  test('should return false for NO_CONTACT', () => {
    assert.strictEqual(needsFollowUp(ConversationStep.NO_CONTACT), false);
  });

  test('should return false for active conversations', () => {
    assert.strictEqual(needsFollowUp(ConversationStep.FIRST_REPLY), false);
    assert.strictEqual(needsFollowUp(ConversationStep.ONGOING), false);
  });
});

describe('isAwaitingReply', () => {
  test('should return true for all non-replied steps', () => {
    assert.strictEqual(isAwaitingReply(ConversationStep.FIRST_MESSAGE), true);
    assert.strictEqual(isAwaitingReply(ConversationStep.FOLLOW_UP_1), true);
    assert.strictEqual(isAwaitingReply(ConversationStep.FOLLOW_UP_5), true);
  });

  test('should return false for NO_CONTACT', () => {
    assert.strictEqual(isAwaitingReply(ConversationStep.NO_CONTACT), false);
  });

  test('should return false for replied steps', () => {
    assert.strictEqual(isAwaitingReply(ConversationStep.FIRST_REPLY), false);
    assert.strictEqual(isAwaitingReply(ConversationStep.ONGOING), false);
  });
});

describe('isFollowUpExhausted', () => {
  test('should return true only for FOLLOW_UP_5', () => {
    assert.strictEqual(isFollowUpExhausted(ConversationStep.FOLLOW_UP_5), true);
  });

  test('should return false for other steps', () => {
    assert.strictEqual(isFollowUpExhausted(ConversationStep.FIRST_MESSAGE), false);
    assert.strictEqual(isFollowUpExhausted(ConversationStep.FOLLOW_UP_4), false);
    assert.strictEqual(isFollowUpExhausted(ConversationStep.ONGOING), false);
  });
});

describe('isActiveConversation', () => {
  test('should return true for FIRST_REPLY and ONGOING', () => {
    assert.strictEqual(isActiveConversation(ConversationStep.FIRST_REPLY), true);
    assert.strictEqual(isActiveConversation(ConversationStep.ONGOING), true);
  });

  test('should return true for follow-up steps (still in conversation)', () => {
    assert.strictEqual(isActiveConversation(ConversationStep.FOLLOW_UP_1), true);
    assert.strictEqual(isActiveConversation(ConversationStep.FOLLOW_UP_5), true);
  });

  test('should return false for NO_CONTACT and FIRST_MESSAGE', () => {
    assert.strictEqual(isActiveConversation(ConversationStep.NO_CONTACT), false);
    assert.strictEqual(isActiveConversation(ConversationStep.FIRST_MESSAGE), false);
  });
});

describe('getStepLabel', () => {
  test('should return French labels for known steps', () => {
    assert.strictEqual(getStepLabel(ConversationStep.NO_CONTACT), 'Pas contacté');
    assert.strictEqual(getStepLabel(ConversationStep.FIRST_MESSAGE), 'Premier message envoyé');
    assert.strictEqual(getStepLabel(ConversationStep.FIRST_REPLY), 'Première réponse reçue');
    assert.strictEqual(getStepLabel(ConversationStep.ONGOING), 'Conversation en cours');
    assert.strictEqual(getStepLabel(ConversationStep.FOLLOW_UP_1), 'Relance 1');
    assert.strictEqual(getStepLabel(ConversationStep.FOLLOW_UP_5), 'Relance finale');
  });

  test('should return fallback for unknown steps', () => {
    assert.strictEqual(getStepLabel(99), 'Étape 99');
  });
});

describe('parseStep', () => {
  test('should parse valid step', () => {
    assert.strictEqual(parseStep(3), 3);
    assert.strictEqual(parseStep('5'), 5);
  });

  test('should return fallback for invalid', () => {
    assert.strictEqual(parseStep('invalid'), ConversationStep.NO_CONTACT);
    assert.strictEqual(parseStep(null), ConversationStep.NO_CONTACT);
    assert.strictEqual(parseStep(99), ConversationStep.NO_CONTACT);
  });

  test('should use custom fallback', () => {
    assert.strictEqual(parseStep('invalid', 3), 3);
  });
});
