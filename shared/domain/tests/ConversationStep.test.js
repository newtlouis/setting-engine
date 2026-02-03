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

  test('should return FIRST_MESSAGE when sent but no reply', () => {
    assert.strictEqual(calculateStep(1, 0), ConversationStep.FIRST_MESSAGE);
    assert.strictEqual(calculateStep(5, 0), ConversationStep.FIRST_MESSAGE);
  });

  test('should return FIRST_REPLY when received one reply', () => {
    assert.strictEqual(calculateStep(1, 1), ConversationStep.FIRST_REPLY);
  });

  test('should return ONGOING when multiple replies', () => {
    assert.strictEqual(calculateStep(3, 2), ConversationStep.ONGOING);
    assert.strictEqual(calculateStep(5, 10), ConversationStep.ONGOING);
  });
});

describe('needsFollowUp', () => {
  test('should return true for FIRST_MESSAGE step', () => {
    assert.strictEqual(needsFollowUp(ConversationStep.FIRST_MESSAGE), true);
  });

  test('should return false for other steps', () => {
    assert.strictEqual(needsFollowUp(ConversationStep.NO_CONTACT), false);
    assert.strictEqual(needsFollowUp(ConversationStep.FIRST_REPLY), false);
    assert.strictEqual(needsFollowUp(ConversationStep.ONGOING), false);
  });
});

describe('isActiveConversation', () => {
  test('should return true for FIRST_REPLY and above', () => {
    assert.strictEqual(isActiveConversation(ConversationStep.FIRST_REPLY), true);
    assert.strictEqual(isActiveConversation(ConversationStep.ONGOING), true);
    assert.strictEqual(isActiveConversation(ConversationStep.FOLLOW_UP_1), true);
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
