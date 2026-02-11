/**
 * FunnelStepParser Tag Tests
 *
 * Tests detection and stripping of control tags
 * ([STEP_X], [NOT_INTERESTED], [ALERT_BOOKING], [MANUAL]).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  parseFunnelStep,
  isNotInterested,
  isBookingAlert,
  needsManualIntervention,
  stripControlTags
} from '../../../shared/domain/services/FunnelStepParser.js';

describe('Tag Detection', () => {
  test('[NOT_INTERESTED] detected anywhere in message', () => {
    assert.ok(isNotInterested('Merci [NOT_INTERESTED] bonne journée'));
    assert.ok(isNotInterested('[NOT_INTERESTED] Pas de souci'));
    assert.ok(isNotInterested('Fin de conversation [NOT_INTERESTED]'));
  });

  test('[ALERT_BOOKING] detected', () => {
    assert.ok(isBookingAlert('[STEP_6] [ALERT_BOOKING] Super pour mardi !'));
    assert.ok(isBookingAlert('[ALERT_BOOKING]'));
  });

  test('[MANUAL] detected', () => {
    assert.ok(needsManualIntervention('Je vais voir [MANUAL]'));
    assert.ok(needsManualIntervention('[MANUAL] Situation complexe'));
  });

  test('No tags → all checks return false', () => {
    const msg = 'Coucou, comment tu vas ?';
    assert.ok(!isNotInterested(msg));
    assert.ok(!isBookingAlert(msg));
    assert.ok(!needsManualIntervention(msg));
    assert.strictEqual(parseFunnelStep(msg), null);
  });

  test('Null/empty input → all checks return false', () => {
    assert.ok(!isNotInterested(null));
    assert.ok(!isBookingAlert(''));
    assert.ok(!needsManualIntervention(null));
  });
});

describe('stripControlTags', () => {
  test('Strips all tags, preserves content', () => {
    const raw = '[STEP_5] [ALERT_BOOKING] [NOT_INTERESTED] C\'est noté pour mardi !';
    const clean = stripControlTags(raw);
    assert.strictEqual(clean, 'C\'est noté pour mardi !');
  });

  test('Strips STEP with sub-step', () => {
    const raw = '[STEP_3.2] Merci pour ta confiance';
    assert.strictEqual(stripControlTags(raw), 'Merci pour ta confiance');
  });

  test('Handles message with no tags', () => {
    const msg = 'Juste un message normal';
    assert.strictEqual(stripControlTags(msg), msg);
  });
});

describe('parseFunnelStep', () => {
  test('[STEP_3.2] returns 3', () => {
    assert.strictEqual(parseFunnelStep('[STEP_3.2] Exploration'), 3);
  });

  test('[STEP_1] returns 1', () => {
    assert.strictEqual(parseFunnelStep('[STEP_1] Hey !'), 1);
  });

  test('[STEP_9] returns 9', () => {
    assert.strictEqual(parseFunnelStep('[STEP_9] Clôture'), 9);
  });

  test('No step tag returns null', () => {
    assert.strictEqual(parseFunnelStep('Hello world'), null);
  });
});
