/**
 * PromptComposer Unit Tests
 *
 * Tests the system prompt composition from persona, stages, and lead context.
 * This is the core function that builds the LLM instruction set.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { composeSystemPrompt, getDefaultConversationScripts } from '../../../shared/domain/services/PromptComposer.js';
import { AccountPersona } from '../../../shared/domain/entities/AccountPersona.js';
import { FunnelStage } from '../../../shared/domain/entities/FunnelStage.js';

// Helper: create a persona with defaults
function makePersona(overrides = {}) {
  return new AccountPersona({
    id: 1,
    account_id: 1,
    persona_name: 'Mélanie',
    niche: 'dépendance affective',
    communication_rules: 'Tutoiement, emojis, phrases courtes',
    ...overrides
  });
}

// Helper: create minimal stages
function makeStages(count = 3) {
  const stages = [];
  for (let i = 1; i <= count; i++) {
    stages.push(new FunnelStage({
      id: i,
      account_id: 1,
      stage_order: i,
      stage_name: `step_${i}`,
      stage_label: `STEP_${i}`,
      description: `Description étape ${i}`,
      conversation_script: `[STEP_${i}] Script de l'étape ${i}`
    }));
  }
  return stages;
}

describe('composeSystemPrompt', () => {

  // === PERSONA SECTION ===

  test('Full persona → "QUI TU ES" section with name and niche', () => {
    const prompt = composeSystemPrompt({
      persona: makePersona(),
      stages: []
    });

    assert.ok(prompt.includes('QUI TU ES'), 'Should have persona header');
    assert.ok(prompt.includes('Mélanie'), 'Should include persona name');
    assert.ok(prompt.includes('dépendance affective'), 'Should include niche');
  });

  test('Persona without niche → name only, no "expert(e) en"', () => {
    const prompt = composeSystemPrompt({
      persona: makePersona({ niche: '' }),
      stages: []
    });

    assert.ok(prompt.includes('Mélanie'), 'Should include name');
    assert.ok(!prompt.includes('expert(e) en'), 'Should not include niche phrase');
  });

  test('Null persona → no "QUI TU ES" section', () => {
    const prompt = composeSystemPrompt({
      persona: null,
      stages: makeStages(1)
    });

    assert.ok(!prompt.includes('QUI TU ES'), 'Should not have persona section');
    // But should still have base rules
    assert.ok(prompt.includes('RÈGLES CRITIQUES'), 'Should have base rules');
  });

  // === BASE RULES ===

  test('Base rules always present', () => {
    const prompt = composeSystemPrompt({
      persona: makePersona(),
      stages: []
    });

    assert.ok(prompt.includes('RÈGLES CRITIQUES'), 'Should have critical rules');
    assert.ok(prompt.includes('LABELS D\'ÉTAPE'), 'Should mention step labels');
    assert.ok(prompt.includes('[STEP_X]'), 'Should have step label example');
    assert.ok(prompt.includes('FORMAT DE RÉPONSE'), 'Should have JSON format');
    assert.ok(prompt.includes('booking_intent'), 'Should mention booking_intent');
  });

  // === COMMUNICATION RULES ===

  test('Persona with communicationRules → "RÈGLES SPÉCIFIQUES" section', () => {
    const prompt = composeSystemPrompt({
      persona: makePersona({ communication_rules: 'Vouvoiement, ton formel' }),
      stages: []
    });

    assert.ok(prompt.includes('RÈGLES SPÉCIFIQUES'), 'Should have custom rules section');
    assert.ok(prompt.includes('Vouvoiement, ton formel'), 'Should include actual rules');
  });

  test('Persona without communicationRules → no "RÈGLES SPÉCIFIQUES"', () => {
    const prompt = composeSystemPrompt({
      persona: makePersona({ communication_rules: null }),
      stages: []
    });

    assert.ok(!prompt.includes('RÈGLES SPÉCIFIQUES'), 'Should not have custom rules');
  });

  // === STAGES SECTION ===

  test('Stages with conversationScript → "FLOW DE CONVERSATION" with scripts', () => {
    const stages = makeStages(3);
    const prompt = composeSystemPrompt({
      persona: makePersona(),
      stages
    });

    assert.ok(prompt.includes('FLOW DE CONVERSATION'), 'Should have flow header');
    assert.ok(prompt.includes('[STEP_1] Script de l\'étape 1'), 'Should include stage 1 script');
    assert.ok(prompt.includes('[STEP_2] Script de l\'étape 2'), 'Should include stage 2 script');
    assert.ok(prompt.includes('[STEP_3] Script de l\'étape 3'), 'Should include stage 3 script');
  });

  test('Stage without conversationScript → fallback to label + name + description', () => {
    const stage = new FunnelStage({
      id: 1,
      account_id: 1,
      stage_order: 1,
      stage_name: 'premier_contact',
      stage_label: 'STEP_1',
      description: 'Premier message',
      conversation_script: null // No script!
    });

    const prompt = composeSystemPrompt({
      persona: makePersona(),
      stages: [stage]
    });

    assert.ok(prompt.includes('FLOW DE CONVERSATION'), 'Should still have flow header');
    assert.ok(prompt.includes('[STEP_1]'), 'Should include stage label');
    assert.ok(prompt.includes('PREMIER_CONTACT'), 'Should include stage name uppercased');
    assert.ok(prompt.includes('Premier message'), 'Should include description');
  });

  test('Empty stages array → no "FLOW DE CONVERSATION"', () => {
    const prompt = composeSystemPrompt({
      persona: makePersona(),
      stages: []
    });

    assert.ok(!prompt.includes('FLOW DE CONVERSATION'), 'Should not have flow section');
  });

  test('All 9 stages → all present in order', () => {
    const stages = makeStages(9);
    const prompt = composeSystemPrompt({
      persona: makePersona(),
      stages
    });

    for (let i = 1; i <= 9; i++) {
      assert.ok(prompt.includes(`[STEP_${i}] Script de l'étape ${i}`),
        `Should include stage ${i}`);
    }

    // Verify order: STEP_1 appears before STEP_9
    const pos1 = prompt.indexOf('[STEP_1]');
    const pos9 = prompt.indexOf('[STEP_9]');
    assert.ok(pos1 < pos9, 'Stages should be in order');
  });

  // === KNOWLEDGE BASE ===

  test('Persona with knowledgeBase → "RÈGLES GÉNÉRALES" section', () => {
    const prompt = composeSystemPrompt({
      persona: makePersona({ knowledge_base: 'Ne jamais recommander de médicaments' }),
      stages: []
    });

    assert.ok(prompt.includes('RÈGLES GÉNÉRALES'), 'Should have general rules section');
    assert.ok(prompt.includes('Ne jamais recommander de médicaments'), 'Should include KB content');
  });

  test('Persona without knowledgeBase → no "RÈGLES GÉNÉRALES"', () => {
    const prompt = composeSystemPrompt({
      persona: makePersona({ knowledge_base: null }),
      stages: []
    });

    assert.ok(!prompt.includes('RÈGLES GÉNÉRALES'), 'Should not have general rules section');
  });

  // === LEAD CONTEXT ===

  test('Full leadContext → "CONTEXTE DU PROSPECT" with all fields', () => {
    const prompt = composeSystemPrompt({
      persona: makePersona(),
      stages: [],
      leadContext: {
        username: 'marie_test',
        fullName: 'Marie Dupont',
        biography: 'Coach en bien-être',
        pain_points: 'Solitude, manque de confiance',
        goals: 'Retrouver l\'estime de soi',
        funnel_step: 3,
        notes: 'Très réceptive'
      }
    });

    assert.ok(prompt.includes('CONTEXTE DU PROSPECT'), 'Should have prospect context header');
    assert.ok(prompt.includes('@marie_test'), 'Should include username with @');
    assert.ok(prompt.includes('Marie Dupont'), 'Should include full name');
    assert.ok(prompt.includes('Coach en bien-être'), 'Should include biography');
    assert.ok(prompt.includes('Solitude, manque de confiance'), 'Should include pain points');
    assert.ok(prompt.includes('Retrouver l\'estime de soi'), 'Should include goals');
    assert.ok(prompt.includes('STEP_3'), 'Should include funnel step');
    assert.ok(prompt.includes('Très réceptive'), 'Should include notes');
  });

  test('Partial leadContext → only present fields shown', () => {
    const prompt = composeSystemPrompt({
      persona: makePersona(),
      stages: [],
      leadContext: { username: 'test_user' }
    });

    assert.ok(prompt.includes('@test_user'), 'Should include username');
    assert.ok(!prompt.includes('Nom:'), 'Should not include empty fullName');
    assert.ok(!prompt.includes('Bio:'), 'Should not include empty biography');
    assert.ok(!prompt.includes('Problèmes'), 'Should not include empty pain_points');
  });

  test('Null leadContext → no "CONTEXTE DU PROSPECT"', () => {
    const prompt = composeSystemPrompt({
      persona: makePersona(),
      stages: [],
      leadContext: null
    });

    assert.ok(!prompt.includes('CONTEXTE DU PROSPECT'), 'Should not have context section');
  });

  // === COMPOSITION ORDER ===

  test('Sections appear in correct order: persona → rules → stages → context', () => {
    const prompt = composeSystemPrompt({
      persona: makePersona(),
      stages: makeStages(1),
      leadContext: { username: 'test' }
    });

    const posPersona = prompt.indexOf('QUI TU ES');
    const posRules = prompt.indexOf('RÈGLES CRITIQUES');
    const posCustom = prompt.indexOf('RÈGLES SPÉCIFIQUES');
    const posFlow = prompt.indexOf('FLOW DE CONVERSATION');
    const posContext = prompt.indexOf('CONTEXTE DU PROSPECT');

    assert.ok(posPersona < posRules, 'Persona before base rules');
    assert.ok(posRules < posCustom, 'Base rules before custom rules');
    assert.ok(posCustom < posFlow, 'Custom rules before flow');
    assert.ok(posFlow < posContext, 'Flow before context');
  });

  // === FULL INTEGRATION ===

  test('Full prompt with all sections → produces valid complete prompt', () => {
    const stages = makeStages(9);
    const prompt = composeSystemPrompt({
      persona: makePersona({
        communication_rules: 'Tutoiement uniquement',
        knowledge_base: 'Spécialiste en coaching relationnel'
      }),
      stages,
      leadContext: {
        username: 'prospect1',
        fullName: 'Jean Martin',
        funnel_step: 5,
        pain_points: 'Dépendance affective'
      }
    });

    // Should be a non-trivial string
    assert.ok(prompt.length > 500, `Prompt should be substantial (got ${prompt.length} chars)`);

    // All sections present
    assert.ok(prompt.includes('QUI TU ES'));
    assert.ok(prompt.includes('RÈGLES CRITIQUES'));
    assert.ok(prompt.includes('RÈGLES SPÉCIFIQUES'));
    assert.ok(prompt.includes('FLOW DE CONVERSATION'));
    assert.ok(prompt.includes('RÈGLES GÉNÉRALES'));
    assert.ok(prompt.includes('CONTEXTE DU PROSPECT'));
  });
});

describe('getDefaultConversationScripts', () => {

  test('Returns scripts for all 9 steps', () => {
    const scripts = getDefaultConversationScripts();

    for (let i = 1; i <= 9; i++) {
      assert.ok(scripts[i], `Should have script for step ${i}`);
      assert.ok(typeof scripts[i] === 'string', `Step ${i} should be a string`);
      assert.ok(scripts[i].includes(`[STEP_${i}]`), `Step ${i} script should contain [STEP_${i}]`);
    }
  });

  test('Step 1 contains primer contact patterns', () => {
    const scripts = getDefaultConversationScripts();
    assert.ok(scripts[1].includes('PREMIER CONTACT'), 'Step 1 should mention PREMIER CONTACT');
  });

  test('Step 2 contains NOT_INTERESTED detection', () => {
    const scripts = getDefaultConversationScripts();
    assert.ok(scripts[2].includes('NOT_INTERESTED'), 'Step 2 should mention NOT_INTERESTED');
    assert.ok(scripts[2].includes('Pas spécialement'), 'Step 2 should include soft rejection example');
  });

  test('Step 5 contains call proposition', () => {
    const scripts = getDefaultConversationScripts();
    assert.ok(scripts[5].includes('30 minutes'), 'Step 5 should mention 30 minutes');
    assert.ok(scripts[5].includes('PIVOT'), 'Step 5 should be labeled as PIVOT');
  });

  test('Step 6 contains Calendly instruction', () => {
    const scripts = getDefaultConversationScripts();
    assert.ok(scripts[6].includes('CALENDLY'), 'Step 6 should mention CALENDLY');
    assert.ok(scripts[6].includes('PROPOSITION PRIMAIRE'), 'Step 6 should mention primary slots');
  });

  test('Step 7 contains email/phone collection', () => {
    const scripts = getDefaultConversationScripts();
    assert.ok(scripts[7].includes('email'), 'Step 7 should mention email');
    assert.ok(scripts[7].includes('téléphone'), 'Step 7 should mention phone');
    assert.ok(scripts[7].includes('MANUAL'), 'Step 7 should mention MANUAL fallback');
  });

  test('Step 9 is closing with no sales objective', () => {
    const scripts = getDefaultConversationScripts();
    assert.ok(scripts[9].includes('CLÔTURE'), 'Step 9 should be closing');
    assert.ok(scripts[9].includes('sans objectif de vente'), 'Step 9 should have no sales objective');
  });

  test('No step 0 or step 10', () => {
    const scripts = getDefaultConversationScripts();
    assert.strictEqual(scripts[0], undefined, 'Should have no step 0');
    assert.strictEqual(scripts[10], undefined, 'Should have no step 10');
  });
});

describe('composeSystemPrompt with DB-like data', () => {

  test('Stages from FunnelStage.fromDbRow work correctly', () => {
    const dbRows = [
      { id: 1, account_id: 1, stage_order: 1, stage_name: 'premier_contact', stage_label: 'STEP_1', description: 'Premier message', conversation_script: '[STEP_1] Hello !' },
      { id: 2, account_id: 1, stage_order: 2, stage_name: 'connexion', stage_label: 'STEP_2', description: 'Connexion', conversation_script: '[STEP_2] Connexion émotionnelle' },
    ];
    const stages = dbRows.map(r => FunnelStage.fromDbRow(r));
    const persona = AccountPersona.fromDbRow({
      id: 1, account_id: 1, persona_name: 'Test', niche: 'coaching'
    });

    const prompt = composeSystemPrompt({ persona, stages });

    assert.ok(prompt.includes('[STEP_1] Hello !'), 'Should include step 1 script from DB');
    assert.ok(prompt.includes('[STEP_2] Connexion émotionnelle'), 'Should include step 2 script from DB');
    assert.ok(prompt.includes('Test'), 'Should include persona name from DB');
  });

  test('Mixed stages: some with script, some without', () => {
    const stages = [
      new FunnelStage({ stage_order: 1, stage_name: 'step1', stage_label: 'STEP_1', conversation_script: '[STEP_1] Script complet' }),
      new FunnelStage({ stage_order: 2, stage_name: 'step2', stage_label: 'STEP_2', description: 'Étape sans script', conversation_script: null }),
    ];

    const prompt = composeSystemPrompt({ persona: makePersona(), stages });

    assert.ok(prompt.includes('[STEP_1] Script complet'), 'Should include scripted stage');
    assert.ok(prompt.includes('STEP2'), 'Should include fallback label for scriptless stage');
    assert.ok(prompt.includes('Étape sans script'), 'Should include description as fallback');
  });
});
