/**
 * E2E LLM Evaluation Tests
 *
 * Calls the REAL OpenAI API with real DB prompts/funnel stages.
 * Simulates multi-turn conversations and evaluates quality via LLM-as-judge.
 *
 * SKIPPED automatically if no real OPENAI_API_KEY found.
 * Run manually: cd agents/dmresponder && npm run test:e2e
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { generateResponse, clearPromptCache } from '../src/engine.js';
import { getContainer, resetContainer } from '../../../shared/container.js';
import {
  parseFunnelStep,
  isNotInterested,
  stripControlTags
} from '../../../shared/domain/services/FunnelStepParser.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

const HAS_REAL_KEY = process.env.OPENAI_API_KEY &&
  process.env.OPENAI_API_KEY !== 'test-key' &&
  process.env.OPENAI_API_KEY.startsWith('sk-');

// ============================================
// EVALUATOR PROMPT
// ============================================

const EVALUATOR_PROMPT = `Tu es un evaluateur de qualite pour un chatbot de prospection Instagram dans la niche du developpement personnel / dependance affective.

Evalue la reponse du chatbot selon ces criteres (note de 1 a 5) :

1. **Pertinence** : La reponse correspond-elle au message du prospect et au contexte de la conversation ?
2. **Ton** : Le ton est-il naturel, empathique, decontracte (tutoiement, emojis, phrases courtes, pas commercial, pas robotique) ?
3. **Script** : La reponse suit-elle le script de l'etape du funnel (connexion emotionnelle en step 2, exploration en step 3, projection en step 4, proposition d'appel en step 5) ?
4. **Progression** : L'etape indiquee ([STEP_X]) est-elle logique vu la conversation ?
5. **Tags** : Les tags ([STEP_X], [NOT_INTERESTED]) sont-ils corrects et presents quand necessaire ?

Un score de 3/5 est "acceptable". 4/5 est "bon". 5/5 est "excellent".
Une note globale < 3 = FAIL. >= 3 = PASS.

Reponds UNIQUEMENT en JSON valide :
{
  "scores": { "pertinence": 0, "ton": 0, "script": 0, "progression": 0, "tags": 0 },
  "note_globale": 0.0,
  "verdict": "PASS",
  "commentaire": "Explication courte"
}`;

// ============================================
// SCENARIOS
// ============================================

const SCENARIOS = [
  {
    name: 'Happy path: progression step 1 -> 5',
    initialStep: 1,
    userMessages: [
      {
        text: 'Oui salut !',
        expectedStepRange: [2, 2],
        expectNotInterested: false,
      },
      {
        text: "Oui c'est tres personnel, j'en souffre au quotidien",
        expectedStepRange: [2, 3],
        expectNotInterested: false,
      },
      {
        text: "C'est surtout en amour, je m'attache trop vite et ca fait fuir les gens",
        expectedStepRange: [3, 4],
        expectNotInterested: false,
      },
      {
        text: "J'aimerais juste me sentir bien seule, ne plus dependre des autres",
        expectedStepRange: [4, 5],
        expectNotInterested: false,
      },
    ],
    hardAssertions: {
      noNotInterested: true,
      finalStepMin: 3,
    }
  },
  {
    name: 'Not interested early (step 2)',
    initialStep: 1,
    userMessages: [
      {
        text: 'Salut',
        expectedStepRange: [2, 2],
        expectNotInterested: false,
      },
      {
        text: 'Non pas spécialement, juste par curiosité',
        expectedStepRange: [2, 3],
        expectNotInterested: true,
      },
    ],
    hardAssertions: {
      mustHaveNotInterested: true,
    }
  },
  {
    name: 'Not interested after exploration',
    initialStep: 1,
    userMessages: [
      {
        text: 'Oui salut !',
        expectedStepRange: [2, 2],
        expectNotInterested: false,
      },
      {
        text: "C'est personnel oui, la dependance affective",
        expectedStepRange: [2, 3],
        expectNotInterested: false,
      },
      {
        text: "En amour principalement",
        expectedStepRange: [3, 4],
        expectNotInterested: false,
      },
      {
        text: "Non merci, je vais me débrouiller seule, ça ira",
        expectedStepRange: [3, 5],
        expectNotInterested: 'optional', // LLM may try to retain or tag NOT_INTERESTED
      },
    ],
    hardAssertions: {}
  },
  {
    name: 'Objection prix (step 5)',
    initialStep: 1,
    userMessages: [
      {
        text: 'Oui salut !',
        expectedStepRange: [2, 2],
        expectNotInterested: false,
      },
      {
        text: "Oui c'est personnel, la dependance affective c'est dur",
        expectedStepRange: [2, 3],
        expectNotInterested: false,
      },
      {
        text: "En amour, je m'attache trop vite",
        expectedStepRange: [3, 4],
        expectNotInterested: false,
      },
      {
        text: "Hmm c'est payant tout ca ?",
        expectedStepRange: [3, 5],
        expectNotInterested: false,
        requiredKeywords: ['gratuit', 'offert', 'pas payant', 'rien a payer', 'aucun frais', 'pas de frais'],
      },
    ],
    hardAssertions: {
      noNotInterested: true,
    }
  },
];

// ============================================
// HELPERS
// ============================================

let accountId = 1;
let savedCalendlyToken = null;
let apiCallCount = 0;

async function evaluateResponse(conversationHistory, lastResponse, expectedStepRange, currentStep) {
  const conversationText = conversationHistory
    .map(m => `${m.role === 'user' ? 'PROSPECT' : 'ASSISTANT'}: ${m.text}`)
    .join('\n');

  const userPrompt = `Conversation:\n${conversationText}\n\n` +
    `Reponse evaluee: ${lastResponse}\n` +
    `Etape detectee: ${currentStep}\n` +
    `Etape attendue (range): ${expectedStepRange[0]}-${expectedStepRange[1]}`;

  try {
    apiCallCount++;
    const response = await axios.post(OPENAI_API_URL, {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: EVALUATOR_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0,
      max_tokens: 512,
      response_format: { type: 'json_object' }
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    return JSON.parse(response.data.choices[0].message.content);
  } catch (e) {
    console.error('  [Evaluator error]', e.message);
    return { scores: {}, note_globale: 0, verdict: 'ERROR', commentaire: e.message };
  }
}

async function runScenario(scenario) {
  const conversationHistory = [];
  const results = [];
  let currentStep = scenario.initialStep;

  // Start with standard STEP_1 opener
  conversationHistory.push({ role: 'assistant', text: '[STEP_1] Hey ! \u{1F642}' });

  for (const turn of scenario.userMessages) {
    conversationHistory.push({ role: 'user', text: turn.text });

    apiCallCount++;
    const response = await generateResponse({
      conversationHistory,
      leadContext: {
        account_id: accountId,
        username: 'test_e2e_lead',
        funnel_step: currentStep,
      }
    });

    const rawMessage = response.next_message || response.message || '';
    const stepUsed = parseInt(response.step_used) || parseFunnelStep(rawMessage);
    const notInterested = isNotInterested(rawMessage);
    const cleanMessage = stripControlTags(rawMessage);

    conversationHistory.push({ role: 'assistant', text: rawMessage });

    if (stepUsed && stepUsed > currentStep) currentStep = stepUsed;

    const evaluation = await evaluateResponse(
      conversationHistory, rawMessage, turn.expectedStepRange, stepUsed
    );

    results.push({
      userMessage: turn.text,
      rawResponse: rawMessage,
      cleanMessage,
      parsedStep: stepUsed,
      stepUsed: response.step_used,
      notInterested,
      expectedStepRange: turn.expectedStepRange,
      expectNotInterested: turn.expectNotInterested,
      requiredKeywords: turn.requiredKeywords || null,
      evaluation,
    });

    if (notInterested) break;
  }

  return { results, finalStep: currentStep };
}

function printScenarioReport(name, results) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SCENARIO: ${name}`);
  console.log('='.repeat(60));

  let allPassed = true;
  let totalScore = 0;
  let scoreCount = 0;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const stepOk = r.parsedStep !== null &&
      r.parsedStep >= r.expectedStepRange[0] &&
      r.parsedStep <= r.expectedStepRange[1];
    const stepIcon = stepOk ? '\u2713' : '\u2717';

    const score = r.evaluation.note_globale || 0;
    const verdict = r.evaluation.verdict || 'N/A';
    totalScore += score;
    scoreCount++;

    const userSnippet = r.userMessage.length > 40
      ? r.userMessage.substring(0, 37) + '...'
      : r.userMessage;

    console.log(`  Turn ${i + 1}: "${userSnippet}"`);
    console.log(`    Response: ${r.cleanMessage.substring(0, 80)}${r.cleanMessage.length > 80 ? '...' : ''}`);
    console.log(`    Step: ${r.parsedStep} (${r.expectedStepRange[0]}-${r.expectedStepRange[1]}) ${stepIcon} | Score: ${score}/5 ${verdict}`);
    if (r.notInterested) console.log(`    [NOT_INTERESTED] detected`);
    if (r.evaluation.commentaire) console.log(`    Judge: ${r.evaluation.commentaire}`);

    if (!stepOk) allPassed = false;
  }

  const avg = scoreCount > 0 ? (totalScore / scoreCount).toFixed(1) : '0.0';
  console.log(`  RESULT: ${allPassed ? 'PASS' : 'WARN'} (avg score: ${avg}/5, ${results.length} turns)`);

  return { passed: allPassed, avgScore: parseFloat(avg) };
}

// ============================================
// TESTS
// ============================================

describe('E2E LLM Evaluation', {
  skip: !HAS_REAL_KEY && 'No real OPENAI_API_KEY - skipping E2E LLM tests',
  timeout: 180_000,
}, () => {

  before(async () => {
    // Disable Calendly to avoid side effects
    savedCalendlyToken = process.env.CALENDLY_TOKEN || null;
    delete process.env.CALENDLY_TOKEN;
    // Also disable profile-specific tokens
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('CALENDLY_TOKEN_')) {
        process.env[`_SAVED_${key}`] = process.env[key];
        delete process.env[key];
      }
    }

    await getContainer();
    clearPromptCache();

    // Find default account
    const container = await getContainer();
    const db = container.getDb();
    const defaultAcc = db.prepare('SELECT id FROM accounts WHERE is_default = 1').get();
    if (defaultAcc) accountId = defaultAcc.id;

    apiCallCount = 0;
    console.log(`\nE2E LLM Evaluation - account_id: ${accountId}`);
    console.log('Using real OpenAI API with real DB prompts\n');
  });

  after(async () => {
    // Restore Calendly tokens
    if (savedCalendlyToken) process.env.CALENDLY_TOKEN = savedCalendlyToken;
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('_SAVED_CALENDLY_TOKEN_')) {
        const realKey = key.replace('_SAVED_', '');
        process.env[realKey] = process.env[key];
        delete process.env[key];
      }
    }

    await resetContainer();

    console.log(`\nTotal API calls: ${apiCallCount}`);
  });

  // Scenario 1: Happy path
  test('Happy path: step progression 1 -> 5', { timeout: 60_000 }, async () => {
    const scenario = SCENARIOS[0];
    const { results, finalStep } = await runScenario(scenario);
    const report = printScenarioReport(scenario.name, results);

    // Hard assertions
    for (const r of results) {
      assert.ok(r.cleanMessage, 'Response should not be empty');
      assert.ok(!r.notInterested, `NOT_INTERESTED should not appear in happy path. Got: "${r.rawResponse.substring(0, 100)}"`);
      assert.ok(
        r.parsedStep >= r.expectedStepRange[0] && r.parsedStep <= r.expectedStepRange[1],
        `Step ${r.parsedStep} not in range [${r.expectedStepRange}] for turn "${r.userMessage.substring(0, 30)}"`
      );
    }

    assert.ok(finalStep >= 3, `Final step should be >= 3, got ${finalStep}`);
  });

  // Scenario 2: Not interested early
  test('Not interested early at step 2', { timeout: 60_000 }, async () => {
    const scenario = SCENARIOS[1];
    const { results } = await runScenario(scenario);
    const report = printScenarioReport(scenario.name, results);

    // Hard assertion: at least one response must have NOT_INTERESTED
    const hasNI = results.some(r => r.notInterested);
    assert.ok(hasNI, 'Should detect NOT_INTERESTED when user says "pas spécialement, juste par curiosité"');

    for (const r of results) {
      assert.ok(r.cleanMessage, 'Response should not be empty');
    }
  });

  // Scenario 3: Not interested after exploration
  test('Not interested after exploration', { timeout: 60_000 }, async () => {
    const scenario = SCENARIOS[2];
    const { results } = await runScenario(scenario);
    const report = printScenarioReport(scenario.name, results);

    // Soft check: last response should either have NOT_INTERESTED or be objection handling
    const lastResult = results[results.length - 1];
    if (!lastResult.notInterested) {
      console.log('  [INFO] LLM chose to handle objection instead of NOT_INTERESTED (acceptable)');
    }

    for (const r of results) {
      assert.ok(r.cleanMessage, 'Response should not be empty');
    }
  });

  // Scenario 4: Price objection
  test('Price objection handling', { timeout: 60_000 }, async () => {
    const scenario = SCENARIOS[3];
    const { results } = await runScenario(scenario);
    const report = printScenarioReport(scenario.name, results);

    // Hard assertions
    for (const r of results) {
      assert.ok(r.cleanMessage, 'Response should not be empty');
      assert.ok(!r.notInterested, 'NOT_INTERESTED should not appear for price objection');
    }

    // Check last response contains keyword about gratuit/free
    const lastResult = results[results.length - 1];
    if (lastResult.requiredKeywords) {
      const lower = lastResult.cleanMessage.toLowerCase();
      const hasKeyword = lastResult.requiredKeywords.some(kw => lower.includes(kw));
      assert.ok(hasKeyword,
        `Response should mention one of [${lastResult.requiredKeywords.join(', ')}] but got: "${lastResult.cleanMessage.substring(0, 100)}"`
      );
    }
  });
});
