/**
 * FunnelStepParser Service Tests
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  parseFunnelStep,
  isNotInterested,
  isBookingAlert,
  needsManualIntervention,
  stripControlTags
} from '../services/FunnelStepParser.js';

describe('parseFunnelStep', () => {
  test('should parse simple step labels', () => {
    assert.strictEqual(parseFunnelStep('[STEP_1] Hello!'), 1);
    assert.strictEqual(parseFunnelStep('[STEP_2] Coucou'), 2);
    assert.strictEqual(parseFunnelStep('[STEP_5] Super!'), 5);
  });

  test('should parse sub-step labels', () => {
    assert.strictEqual(parseFunnelStep('[STEP_3.1] Je vois...'), 3);
    assert.strictEqual(parseFunnelStep('[STEP_3.2] Merci pour ta confiance'), 3);
    assert.strictEqual(parseFunnelStep('[STEP_4.1] Quel serait ton objectif?'), 4);
    assert.strictEqual(parseFunnelStep('[STEP_4.2] Et si ça reste comme ça?'), 4);
  });

  test('should return null for messages without step labels', () => {
    assert.strictEqual(parseFunnelStep('Hello there!'), null);
    assert.strictEqual(parseFunnelStep('How are you?'), null);
    assert.strictEqual(parseFunnelStep(''), null);
    assert.strictEqual(parseFunnelStep(null), null);
  });

  test('should be case insensitive', () => {
    assert.strictEqual(parseFunnelStep('[step_3] test'), 3);
    assert.strictEqual(parseFunnelStep('[Step_5] test'), 5);
  });

  test('should cap at step 9', () => {
    assert.strictEqual(parseFunnelStep('[STEP_10] beyond'), 9);
    assert.strictEqual(parseFunnelStep('[STEP_99] way beyond'), 9);
  });
});

describe('isNotInterested', () => {
  test('should detect NOT_INTERESTED tag', () => {
    assert.strictEqual(isNotInterested('[STEP_2] [NOT_INTERESTED] Ok, pas de souci!'), true);
    assert.strictEqual(isNotInterested('[NOT_INTERESTED] Merci quand même'), true);
  });

  test('should return false when tag is absent', () => {
    assert.strictEqual(isNotInterested('[STEP_3] Je comprends'), false);
    assert.strictEqual(isNotInterested('Hello'), false);
    assert.strictEqual(isNotInterested(null), false);
  });
});

describe('isBookingAlert', () => {
  test('should detect ALERT_BOOKING tag', () => {
    assert.strictEqual(isBookingAlert('[STEP_6] [ALERT_BOOKING] Super, mardi à 14h!'), true);
    assert.strictEqual(isBookingAlert('[ALERT_BOOKING] Je te réserve ce créneau'), true);
  });

  test('should return false when tag is absent', () => {
    assert.strictEqual(isBookingAlert('[STEP_5] Tu serais dispo quand?'), false);
    assert.strictEqual(isBookingAlert(null), false);
  });
});

describe('needsManualIntervention', () => {
  test('should detect MANUAL tag', () => {
    assert.strictEqual(needsManualIntervention('[STEP_7] [MANUAL] Je vais voir ce que je peux faire'), true);
    assert.strictEqual(needsManualIntervention('[MANUAL] Situation complexe'), true);
  });

  test('should return false when tag is absent', () => {
    assert.strictEqual(needsManualIntervention('[STEP_5] Normal flow'), false);
    assert.strictEqual(needsManualIntervention(null), false);
  });
});

describe('stripControlTags', () => {
  test('should remove STEP tags', () => {
    assert.strictEqual(stripControlTags('[STEP_3] Hello'), 'Hello');
    assert.strictEqual(stripControlTags('[STEP_4.2] Bonjour'), 'Bonjour');
  });

  test('should remove multiple tags', () => {
    const input = '[STEP_6] [ALERT_BOOKING] Je te confirme mardi!';
    assert.strictEqual(stripControlTags(input), 'Je te confirme mardi!');
  });

  test('should remove NOT_INTERESTED tag', () => {
    const input = '[STEP_2] [NOT_INTERESTED] Pas de souci, bonne continuation!';
    assert.strictEqual(stripControlTags(input), 'Pas de souci, bonne continuation!');
  });

  test('should remove MANUAL tag', () => {
    const input = '[STEP_7] [MANUAL] Je vais gérer ça';
    assert.strictEqual(stripControlTags(input), 'Je vais gérer ça');
  });

  test('should handle messages without tags', () => {
    assert.strictEqual(stripControlTags('Just a normal message'), 'Just a normal message');
    assert.strictEqual(stripControlTags(''), '');
    assert.strictEqual(stripControlTags(null), null);
  });
});
