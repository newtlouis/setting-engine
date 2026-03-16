/**
 * A/B Variant Tests
 *
 * Tests the A/B variant feature across entities, PromptComposer, and data flow.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { composeSystemPrompt } from '../services/PromptComposer.js';
import { FunnelStage } from '../entities/FunnelStage.js';
import { Lead } from '../entities/Lead.js';
import { AccountPersona } from '../entities/AccountPersona.js';

// ============================================================
// HELPERS
// ============================================================

function makePersona(overrides = {}) {
  return new AccountPersona({
    id: 1,
    account_id: 1,
    persona_name: 'TestCoach',
    niche: 'coaching',
    ...overrides
  });
}

function makeStagesWithVariants() {
  return [
    new FunnelStage({
      id: 1, account_id: 1, stage_order: 1,
      stage_name: 'contact', stage_label: 'STEP_1',
      conversation_script: '[STEP_1] Script A: Prénom ?',
      conversation_script_b: '[STEP_1] Script B: Hello Prénom, tu proposes un accompagnement ?'
    }),
    new FunnelStage({
      id: 2, account_id: 1, stage_order: 2,
      stage_name: 'connexion', stage_label: 'STEP_2',
      conversation_script: '[STEP_2] Script A connexion',
      conversation_script_b: '[STEP_2] Script B connexion alternative'
    }),
    new FunnelStage({
      id: 3, account_id: 1, stage_order: 3,
      stage_name: 'exploration', stage_label: 'STEP_3',
      conversation_script: '[STEP_3] Script A exploration',
      conversation_script_b: null // No B script — should fallback to A
    })
  ];
}

// ============================================================
// FunnelStage ENTITY
// ============================================================

describe('FunnelStage — variant B support', () => {

  test('constructor reads conversation_script_b from DB row format', () => {
    const stage = FunnelStage.fromDbRow({
      id: 1, account_id: 1, stage_order: 1,
      stage_name: 'test', stage_label: 'STEP_1',
      conversation_script: 'A script',
      conversation_script_b: 'B script'
    });

    assert.strictEqual(stage.conversationScript, 'A script');
    assert.strictEqual(stage.conversationScriptB, 'B script');
  });

  test('constructor reads conversationScriptB from camelCase format', () => {
    const stage = new FunnelStage({
      stageOrder: 1, stageName: 'test', stageLabel: 'STEP_1',
      conversationScript: 'A', conversationScriptB: 'B'
    });

    assert.strictEqual(stage.conversationScriptB, 'B');
  });

  test('toDbRow includes conversation_script_b', () => {
    const stage = new FunnelStage({
      stage_order: 1, stage_name: 'test', stage_label: 'STEP_1',
      conversation_script: 'A', conversation_script_b: 'B'
    });

    const row = stage.toDbRow();
    assert.strictEqual(row.conversation_script, 'A');
    assert.strictEqual(row.conversation_script_b, 'B');
  });

  test('toJSON includes conversationScriptB', () => {
    const stage = new FunnelStage({
      stage_order: 1, stage_name: 'test', stage_label: 'STEP_1',
      conversation_script: 'A', conversation_script_b: 'B'
    });

    const json = stage.toJSON();
    assert.strictEqual(json.conversationScript, 'A');
    assert.strictEqual(json.conversationScriptB, 'B');
  });

  test('create factory accepts conversationScriptB option', () => {
    const stage = FunnelStage.create(1, 1, 'test', 'STEP_1', {
      conversationScript: 'A', conversationScriptB: 'B'
    });

    assert.strictEqual(stage.conversationScript, 'A');
    assert.strictEqual(stage.conversationScriptB, 'B');
  });

  test('defaults to null when no B script provided', () => {
    const stage = new FunnelStage({
      stage_order: 1, stage_name: 'test', stage_label: 'STEP_1',
      conversation_script: 'A'
    });

    assert.strictEqual(stage.conversationScriptB, null);
  });
});

// ============================================================
// Lead ENTITY
// ============================================================

describe('Lead — variant field', () => {

  test('defaults to A when not specified', () => {
    const lead = Lead.create('testuser', 1, 'prospect');
    assert.strictEqual(lead.variant, 'A');
  });

  test('reads variant from constructor data', () => {
    const lead = new Lead({ username: 'test', variant: 'B' });
    assert.strictEqual(lead.variant, 'B');
  });

  test('toDbRow includes variant', () => {
    const lead = new Lead({ username: 'test', variant: 'B' });
    assert.strictEqual(lead.toDbRow().variant, 'B');
  });

  test('toJSON includes variant', () => {
    const lead = new Lead({ username: 'test', variant: 'B' });
    assert.strictEqual(lead.toJSON().variant, 'B');
  });

  test('fromDbRow preserves variant', () => {
    const lead = Lead.fromDbRow({ username: 'test', variant: 'B', status: 'new' });
    assert.strictEqual(lead.variant, 'B');
  });

  test('fromDbRow defaults to A when variant missing', () => {
    const lead = Lead.fromDbRow({ username: 'test', status: 'new' });
    assert.strictEqual(lead.variant, 'A');
  });
});

// ============================================================
// PromptComposer — VARIANT LOGIC
// ============================================================

describe('composeSystemPrompt — variant parameter', () => {

  test('variant A uses conversationScript (default)', () => {
    const stages = makeStagesWithVariants();
    const prompt = composeSystemPrompt({
      persona: makePersona(),
      stages,
      variant: 'A'
    });

    assert.ok(prompt.includes('Script A: Prénom ?'), 'Should use A script for step 1');
    assert.ok(prompt.includes('Script A connexion'), 'Should use A script for step 2');
    assert.ok(!prompt.includes('Script B:'), 'Should not contain B scripts');
  });

  test('variant B uses conversationScriptB when available', () => {
    const stages = makeStagesWithVariants();
    const prompt = composeSystemPrompt({
      persona: makePersona(),
      stages,
      variant: 'B'
    });

    assert.ok(prompt.includes('Script B: Hello Prénom'), 'Should use B script for step 1');
    assert.ok(prompt.includes('Script B connexion alternative'), 'Should use B script for step 2');
  });

  test('variant B falls back to A when B script is null', () => {
    const stages = makeStagesWithVariants();
    const prompt = composeSystemPrompt({
      persona: makePersona(),
      stages,
      variant: 'B'
    });

    // Stage 3 has no B script — should use A
    assert.ok(prompt.includes('Script A exploration'), 'Should fallback to A for step 3');
  });

  test('default variant (omitted) uses A', () => {
    const stages = makeStagesWithVariants();
    const prompt = composeSystemPrompt({
      persona: makePersona(),
      stages
      // variant not passed
    });

    assert.ok(prompt.includes('Script A: Prénom ?'), 'Default should be variant A');
    assert.ok(!prompt.includes('Script B:'), 'Should not use B by default');
  });

  test('focused mode (currentStep) respects variant B', () => {
    const stages = makeStagesWithVariants();
    const prompt = composeSystemPrompt({
      persona: makePersona(),
      stages,
      currentStep: 2,
      variant: 'B'
    });

    // Current step 2 should show full B script
    assert.ok(prompt.includes('Script B connexion alternative'), 'Focused mode should use B script');
    // Step 3 upcoming (objective only) — shouldn't show full scripts
    assert.ok(prompt.includes('STEP_3'), 'Should reference upcoming step 3');
  });

  test('focused mode (currentStep) uses A when variant is A', () => {
    const stages = makeStagesWithVariants();
    const prompt = composeSystemPrompt({
      persona: makePersona(),
      stages,
      currentStep: 1,
      variant: 'A'
    });

    assert.ok(prompt.includes('Script A: Prénom ?'), 'Focused mode should use A script');
    assert.ok(!prompt.includes('Script B:'), 'Should not contain B scripts');
  });

  test('variant does not affect non-stage sections', () => {
    const stages = makeStagesWithVariants();
    const persona = makePersona({
      communication_rules: 'Tutoiement',
      knowledge_base: 'Règles générales'
    });

    const promptA = composeSystemPrompt({ persona, stages, variant: 'A' });
    const promptB = composeSystemPrompt({ persona, stages, variant: 'B' });

    // Persona and rules sections should be identical
    assert.ok(promptA.includes('TestCoach') && promptB.includes('TestCoach'));
    assert.ok(promptA.includes('Tutoiement') && promptB.includes('Tutoiement'));
    assert.ok(promptA.includes('Règles générales') && promptB.includes('Règles générales'));
  });

  test('all stages empty B → variant B identical to A', () => {
    const stages = [
      new FunnelStage({
        stage_order: 1, stage_name: 's1', stage_label: 'STEP_1',
        conversation_script: 'Only A script',
        conversation_script_b: null
      })
    ];

    const promptA = composeSystemPrompt({ persona: makePersona(), stages, variant: 'A' });
    const promptB = composeSystemPrompt({ persona: makePersona(), stages, variant: 'B' });

    assert.strictEqual(promptA, promptB, 'When no B scripts exist, A and B prompts should be identical');
  });
});
