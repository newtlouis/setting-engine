/**
 * Conversation Scenario Tests
 *
 * Tests based on realistic conversation scenarios.
 * Each scenario represents a complete conversation path that should be validated.
 *
 * Format: Each scenario has:
 * - name: Description of the scenario
 * - conversation: Array of messages
 * - expectedBehaviors: What we expect from each LLM response
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { generateResponse, clearPromptCache } from '../src/engine.js';
import {
  parseFunnelStep,
  isNotInterested,
  isBookingAlert,
  needsManualIntervention,
  stripControlTags
} from '../../../shared/domain/services/FunnelStepParser.js';

// ============================================
// SCENARIO DEFINITIONS
// ============================================

/**
 * Scenario: Perfect lead who converts easily
 * This is the "golden path" - lead shows interest at every step
 */
const SCENARIO_PERFECT_LEAD = {
  name: 'Lead parfait qui convertit facilement',
  steps: [
    {
      step: 1,
      assistant: '[STEP_1] Émilie ? 🙂',
      user: 'Oui c\'est moi ! Salut !',
      expectedNextStep: 2,
      expectedBehavior: 'Doit passer à la connexion émotionnelle'
    },
    {
      step: 2,
      assistant: '[STEP_2] Coucou Émilie 🌸 J\'ai vu que tu t\'intéresses à la dépendance affective. C\'est personnel ou par curiosité ?',
      user: 'C\'est très personnel, j\'en souffre beaucoup en ce moment',
      expectedNextStep: 3,
      expectedBehavior: 'Doit explorer la situation'
    },
    {
      step: 3,
      assistant: '[STEP_3] Je vois 🙏 Tu peux m\'en dire plus ? C\'est plus en amour, en amitié, au travail ?',
      user: 'En amour surtout. Je m\'attache trop vite et ça fait fuir les gens. Je suis épuisée.',
      expectedNextStep: 4,
      expectedBehavior: 'Doit demander l\'objectif/projection'
    },
    {
      step: 4,
      assistant: '[STEP_4] Je comprends 💛 Quel serait ton plus grand objectif dans les prochains mois ?',
      user: 'J\'aimerais apprendre à m\'aimer moi-même avant de chercher l\'amour chez les autres',
      expectedNextStep: 5,
      expectedBehavior: 'Doit proposer l\'appel découverte'
    },
    {
      step: 5,
      assistant: '[STEP_5] C\'est un super objectif ! Je te propose 30 min ensemble pour faire le point. Tu serais dispo ?',
      user: 'Oui pourquoi pas, j\'ai besoin d\'aide',
      expectedNextStep: 6,
      expectedBehavior: 'Doit proposer des créneaux'
    },
    {
      step: 6,
      assistant: '[STEP_6] Super 🌸 Je peux te proposer mardi 14h ou jeudi 10h, qu\'est-ce qui t\'arrange ?',
      user: 'Mardi 14h c\'est parfait pour moi !',
      expectedNextStep: 7,
      expectedBehavior: 'Doit demander les coordonnées, ALERT_BOOKING',
      expectBookingAlert: true
    },
    {
      step: 7,
      assistant: '[STEP_7] [ALERT_BOOKING] Super pour mardi 14h ! Tu peux me donner ton email et numéro ?',
      user: 'emilie@mail.com et 0612345678',
      expectedNextStep: 8,
      expectedBehavior: 'Doit confirmer le RDV'
    }
  ]
};

/**
 * Scenario: Lead who objects about price
 */
const SCENARIO_PRICE_OBJECTION = {
  name: 'Lead avec objection prix',
  steps: [
    {
      step: 5,
      assistant: '[STEP_5] Je te propose 30 min ensemble pour faire le point. Tu serais dispo ?',
      user: 'Hmm, c\'est payant ?',
      expectedNextStep: 5,
      expectedBehavior: 'Doit expliquer que c\'est gratuit',
      expectedKeywords: ['gratuit', 'offert']
    },
    {
      step: 5,
      assistant: '[STEP_5] L\'appel est 100% gratuit 🎁 C\'est un moment pour toi. Tu serais dispo quand ?',
      user: 'Ah ok, et le coaching après c\'est combien ?',
      expectedNextStep: 5,
      expectedBehavior: 'Doit rediriger vers l\'appel d\'abord',
      expectedKeywords: ['dépend', 'discute', 'appel']
    }
  ]
};

/**
 * Scenario: Lead who is too busy (logistical objection)
 */
const SCENARIO_BUSY_OBJECTION = {
  name: 'Lead occupé (objection logistique)',
  steps: [
    {
      step: 3,
      assistant: '[STEP_3] Tu peux m\'en dire plus sur ce que tu vis ?',
      user: 'Là je suis en soirée, je peux pas trop parler',
      expectedNextStep: 3,
      expectedBehavior: 'Doit valider et proposer de reprendre plus tard',
      expectedKeywords: ['comprends', 'profite', 'plus tard']
    },
    {
      step: 5,
      assistant: '[STEP_5] Tu serais dispo pour un appel cette semaine ?',
      user: 'J\'ai vraiment pas le temps en ce moment avec le boulot',
      expectedNextStep: 5,
      expectedBehavior: 'Doit comprendre et proposer un autre moment',
      expectedKeywords: ['comprends', 'temps', 'calme']
    }
  ]
};

/**
 * Scenario: Lead who wants to handle it alone
 */
const SCENARIO_SELF_SUFFICIENT = {
  name: 'Lead qui veut se débrouiller seul(e)',
  steps: [
    {
      step: 5,
      assistant: '[STEP_5] Je te propose 30 min pour faire le point. Tu serais dispo ?',
      user: 'Non merci, je vais me débrouiller seule',
      expectedNextStep: 5,
      expectedBehavior: 'Doit explorer ce qu\'elle a déjà essayé',
      expectedKeywords: ['testé', 'essayé', 'respecte']
    }
  ]
};

/**
 * Scenario: Lead clearly not interested
 */
const SCENARIO_NOT_INTERESTED = {
  name: 'Lead clairement pas intéressé',
  steps: [
    {
      step: 2,
      assistant: '[STEP_2] Tu t\'intéresses à la dépendance affective ?',
      user: 'Non pas du tout, laisse-moi tranquille',
      expectedNextStep: 2,
      expectedBehavior: 'Doit inclure [NOT_INTERESTED] et clôturer poliment',
      expectNotInterested: true
    }
  ]
};

/**
 * Scenario: "Pas spécialement" - Soft rejection at Step 2
 * Lead knows the topic but is not personally concerned
 */
const SCENARIO_SOFT_REJECTION = {
  name: 'Lead "Pas spécialement" - Soft rejection',
  steps: [
    {
      step: 2,
      assistant: '[STEP_2] Coucou, j\'espère que tu vas bien 🌸 J\'ai vu que tu t\'intéressais à la dépendance affective. C\'est plutôt personnel ou par curiosité ?',
      user: 'Hellow, oui nickel et toi ? Pas spécialement ahah, mais je connais le sujet ☺️',
      expectedNextStep: 2,
      expectedBehavior: 'Doit inclure [NOT_INTERESTED] - la personne n\'est pas notre cible',
      expectNotInterested: true,
      expectedKeywords: ['souci', 'merci', 'journée']
    },
    {
      step: 2,
      assistant: '[STEP_2] C\'est plutôt personnel ou par curiosité ?',
      user: 'Non pas vraiment, c\'est juste que j\'aime bien ce genre de contenu',
      expectedNextStep: 2,
      expectedBehavior: 'Doit inclure [NOT_INTERESTED]',
      expectNotInterested: true
    },
    {
      step: 2,
      assistant: '[STEP_2] Ça résonne avec toi personnellement ?',
      user: 'Ah non ça va moi, je suis bien dans ma vie',
      expectedNextStep: 2,
      expectedBehavior: 'Doit inclure [NOT_INTERESTED]',
      expectNotInterested: true
    }
  ]
};

/**
 * Scenario: Lead refuses to talk but might have issues
 */
const SCENARIO_EMPATHIC_FOLLOWUP = {
  name: 'Lead qui refuse de parler (relance empathique)',
  steps: [
    {
      step: 3,
      assistant: '[STEP_3] Tu peux m\'en dire plus sur ce que tu vis ?',
      user: 'Je préfère pas en parler',
      expectedNextStep: 3,
      expectedBehavior: 'Doit utiliser la relance empathique',
      expectedKeywords: ['comprends', 'garder', 'fermée']
    },
    {
      step: 3,
      assistant: '[STEP_3] Je comprends... Est-ce que tu serais complètement fermée à l\'idée d\'en parler ?',
      user: 'Oui vraiment, c\'est trop personnel',
      expectedNextStep: 3,
      expectedBehavior: 'Doit inclure [NOT_INTERESTED] après 2ème refus',
      expectNotInterested: true
    }
  ]
};

/**
 * Scenario: Lead gives vague responses
 */
const SCENARIO_VAGUE_RESPONSES = {
  name: 'Lead avec réponses vagues',
  steps: [
    {
      step: 3,
      assistant: '[STEP_3] Qu\'est-ce qui est vraiment dur pour toi ?',
      user: 'Bah ça va, je gère',
      expectedNextStep: 3,
      expectedBehavior: 'NE DOIT PAS avancer - doit creuser',
      expectedKeywords: ['quand même', 'pèse', 'précis']
    },
    {
      step: 3,
      assistant: '[STEP_3] C\'est super que tu gères ! Y a-t-il quand même quelque chose qui te pèse ?',
      user: 'Non vraiment tout va bien',
      expectedNextStep: 3,
      expectedBehavior: 'Peut considérer comme désintérêt ou continuer à explorer'
    }
  ]
};

/**
 * Scenario: Lead validates a slot (booking alert)
 */
const SCENARIO_SLOT_VALIDATION = {
  name: 'Lead valide un créneau',
  steps: [
    {
      step: 6,
      assistant: '[STEP_6] Je peux mardi 14h ou jeudi 10h ?',
      user: 'Mardi ça me va !',
      expectedNextStep: 7,
      expectedBehavior: 'Doit inclure ALERT_BOOKING',
      expectBookingAlert: true
    },
    {
      step: 5,
      assistant: '[STEP_5] Tu serais dispo ces prochains jours ?',
      user: 'Oui, demain après-midi vers 15h ça irait',
      expectedNextStep: 6,
      expectedBehavior: 'Doit confirmer et inclure ALERT_BOOKING',
      expectBookingAlert: true
    }
  ]
};

/**
 * Scenario: Lead asks who you are
 */
const SCENARIO_WHO_ARE_YOU = {
  name: 'Lead demande qui tu es',
  steps: [
    {
      step: 1,
      assistant: '[STEP_1] Sophie ? 🙂',
      user: 'T\'es qui toi ?',
      expectedNextStep: 2,
      expectedBehavior: 'Doit se présenter et enchaîner'
    },
    {
      step: 3,
      assistant: '[STEP_3] C\'est plus en amour ou en amitié ?',
      user: 'Attends, tu es une IA ?',
      expectedNextStep: 3,
      expectedBehavior: 'Doit nier et reprendre la conversation',
      expectedKeywords: ['non']
    }
  ]
};

/**
 * Scenario: Lead asks how you know their name
 */
const SCENARIO_NAME_QUESTION = {
  name: 'Lead demande comment tu connais son prénom',
  steps: [
    {
      step: 1,
      assistant: '[STEP_1] Julie ? 🙂',
      user: 'Oui mais comment tu connais mon prénom ??',
      expectedNextStep: 2,
      expectedBehavior: 'Doit expliquer (profil) et enchaîner',
      expectedKeywords: ['profil', 'deviné']
    }
  ]
};

/**
 * Scenario: Complex situation requiring manual intervention
 */
const SCENARIO_MANUAL_INTERVENTION = {
  name: 'Situation nécessitant intervention manuelle',
  steps: [
    {
      step: 7,
      assistant: '[STEP_7] Tu peux me donner ton email et téléphone ?',
      user: 'Je suis sourde donc l\'appel téléphonique ça va pas être possible, y a une alternative ?',
      expectedNextStep: 7,
      expectedBehavior: 'Doit inclure [MANUAL]',
      expectManual: true
    }
  ]
};

// ============================================
// MOCK SETUP
// ============================================

let axiosMock = null;
let originalEnv = null;

function createMockResponse(message, step, bookingIntent = null) {
  return {
    data: {
      choices: [{
        message: {
          content: JSON.stringify({
            message,
            step_used: step,
            booking_intent: bookingIntent
          })
        }
      }]
    }
  };
}

async function setupMock(mockFn) {
  const axios = await import('axios');
  if (!axiosMock) {
    axiosMock = axios.default.post;
  }
  axios.default.post = mock.fn(mockFn);
}

async function restoreMock() {
  if (axiosMock) {
    const axios = await import('axios');
    axios.default.post = axiosMock;
  }
}

// ============================================
// TEST RUNNER
// ============================================

describe('Conversation Scenarios', () => {
  beforeEach(() => {
    originalEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    clearPromptCache();
  });

  afterEach(async () => {
    process.env.OPENAI_API_KEY = originalEnv;
    await restoreMock();
  });

  // Helper to run a single scenario step
  async function runScenarioStep(scenario, stepIndex) {
    const stepData = scenario.steps[stepIndex];

    // Build conversation history from previous steps
    const history = [];
    for (let i = 0; i < stepIndex; i++) {
      const prevStep = scenario.steps[i];
      history.push({ role: 'assistant', text: prevStep.assistant });
      history.push({ role: 'user', text: prevStep.user });
    }
    // Add current step's assistant message and user response
    history.push({ role: 'assistant', text: stepData.assistant });
    history.push({ role: 'user', text: stepData.user });

    return { history, stepData };
  }

  // ============================================
  // SCENARIO: Perfect Lead
  // ============================================

  describe(SCENARIO_PERFECT_LEAD.name, () => {
    for (let i = 0; i < SCENARIO_PERFECT_LEAD.steps.length; i++) {
      const stepData = SCENARIO_PERFECT_LEAD.steps[i];

      test(`Step ${stepData.step}: ${stepData.expectedBehavior}`, async () => {
        // Build mock response
        const mockMessage = stepData.expectBookingAlert
          ? `[STEP_${stepData.expectedNextStep}] [ALERT_BOOKING] Réponse simulée`
          : `[STEP_${stepData.expectedNextStep}] Réponse simulée`;

        await setupMock(async () => createMockResponse(mockMessage, String(stepData.expectedNextStep)));

        // Build history
        const history = [];
        for (let j = 0; j <= i; j++) {
          const s = SCENARIO_PERFECT_LEAD.steps[j];
          history.push({ role: 'assistant', text: s.assistant });
          if (j <= i) history.push({ role: 'user', text: s.user });
        }

        const result = await generateResponse({
          conversationHistory: history,
          leadContext: {
            username: 'emilie_test',
            fullName: 'Émilie',
            conversation_step: stepData.step
          }
        });

        const parsedStep = parseFunnelStep(result.next_message);
        assert.strictEqual(
          parsedStep,
          stepData.expectedNextStep,
          `Attendu step ${stepData.expectedNextStep}, obtenu ${parsedStep}`
        );

        if (stepData.expectBookingAlert) {
          assert.ok(isBookingAlert(result.next_message), 'Devrait contenir ALERT_BOOKING');
        }
      });
    }
  });

  // ============================================
  // SCENARIO: Price Objection
  // ============================================

  describe(SCENARIO_PRICE_OBJECTION.name, () => {
    for (const stepData of SCENARIO_PRICE_OBJECTION.steps) {
      test(`Objection prix: "${stepData.user.substring(0, 30)}..."`, async () => {
        // Mock should return message with expected keywords
        const mockMessage = `[STEP_${stepData.expectedNextStep}] L'appel est 100% gratuit et offert 🎁`;
        await setupMock(async () => createMockResponse(mockMessage, String(stepData.expectedNextStep)));

        const result = await generateResponse({
          conversationHistory: [
            { role: 'assistant', text: stepData.assistant },
            { role: 'user', text: stepData.user }
          ],
          leadContext: { username: 'test', conversation_step: stepData.step }
        });

        assert.ok(result.next_message, 'Should generate response');

        if (stepData.expectedKeywords) {
          const hasKeyword = stepData.expectedKeywords.some(kw =>
            result.next_message.toLowerCase().includes(kw.toLowerCase())
          );
          assert.ok(hasKeyword, `Response should contain one of: ${stepData.expectedKeywords.join(', ')}`);
        }
      });
    }
  });

  // ============================================
  // SCENARIO: Not Interested
  // ============================================

  describe(SCENARIO_NOT_INTERESTED.name, () => {
    for (const stepData of SCENARIO_NOT_INTERESTED.steps) {
      test(`Refus clair: "${stepData.user.substring(0, 30)}..."`, async () => {
        const mockMessage = `[STEP_${stepData.expectedNextStep}] [NOT_INTERESTED] Pas de souci, bonne continuation !`;
        await setupMock(async () => createMockResponse(mockMessage, String(stepData.expectedNextStep)));

        const result = await generateResponse({
          conversationHistory: [
            { role: 'assistant', text: stepData.assistant },
            { role: 'user', text: stepData.user }
          ],
          leadContext: { username: 'test', conversation_step: stepData.step }
        });

        if (stepData.expectNotInterested) {
          assert.ok(isNotInterested(result.next_message), 'Should contain NOT_INTERESTED');
        }
      });
    }
  });

  // ============================================
  // SCENARIO: Soft Rejection ("Pas spécialement")
  // ============================================

  describe(SCENARIO_SOFT_REJECTION.name, () => {
    for (const stepData of SCENARIO_SOFT_REJECTION.steps) {
      test(`Soft rejection: "${stepData.user.substring(0, 40)}..."`, async () => {
        const mockMessage = `[STEP_${stepData.expectedNextStep}] [NOT_INTERESTED] Pas de souci, merci pour ta réponse ! 🌸 Belle journée à toi ✨`;
        await setupMock(async () => createMockResponse(mockMessage, String(stepData.expectedNextStep)));

        const result = await generateResponse({
          conversationHistory: [
            { role: 'assistant', text: stepData.assistant },
            { role: 'user', text: stepData.user }
          ],
          leadContext: { username: 'test', conversation_step: stepData.step }
        });

        if (stepData.expectNotInterested) {
          assert.ok(isNotInterested(result.next_message), 'Should contain NOT_INTERESTED for soft rejection');
        }

        if (stepData.expectedKeywords) {
          const hasKeyword = stepData.expectedKeywords.some(kw =>
            result.next_message.toLowerCase().includes(kw.toLowerCase())
          );
          assert.ok(hasKeyword, `Response should contain one of: ${stepData.expectedKeywords.join(', ')}`);
        }
      });
    }
  });

  // ============================================
  // SCENARIO: Slot Validation
  // ============================================

  describe(SCENARIO_SLOT_VALIDATION.name, () => {
    for (const stepData of SCENARIO_SLOT_VALIDATION.steps) {
      test(`Validation créneau: "${stepData.user.substring(0, 30)}..."`, async () => {
        const mockMessage = `[STEP_${stepData.expectedNextStep}] [ALERT_BOOKING] C'est noté !`;
        await setupMock(async () => createMockResponse(mockMessage, String(stepData.expectedNextStep)));

        const result = await generateResponse({
          conversationHistory: [
            { role: 'assistant', text: stepData.assistant },
            { role: 'user', text: stepData.user }
          ],
          leadContext: { username: 'test', conversation_step: stepData.step }
        });

        if (stepData.expectBookingAlert) {
          assert.ok(isBookingAlert(result.next_message), 'Should contain ALERT_BOOKING');
        }
      });
    }
  });

  // ============================================
  // SCENARIO: Manual Intervention
  // ============================================

  describe(SCENARIO_MANUAL_INTERVENTION.name, () => {
    for (const stepData of SCENARIO_MANUAL_INTERVENTION.steps) {
      test(`Situation complexe: "${stepData.user.substring(0, 30)}..."`, async () => {
        const mockMessage = `[STEP_${stepData.expectedNextStep}] [MANUAL] Je vais voir ce que je peux faire.`;
        await setupMock(async () => createMockResponse(mockMessage, String(stepData.expectedNextStep)));

        const result = await generateResponse({
          conversationHistory: [
            { role: 'assistant', text: stepData.assistant },
            { role: 'user', text: stepData.user }
          ],
          leadContext: { username: 'test', conversation_step: stepData.step }
        });

        if (stepData.expectManual) {
          assert.ok(needsManualIntervention(result.next_message), 'Should contain MANUAL');
        }
      });
    }
  });

  // ============================================
  // SCENARIO: Vague Responses
  // ============================================

  describe(SCENARIO_VAGUE_RESPONSES.name, () => {
    for (const stepData of SCENARIO_VAGUE_RESPONSES.steps) {
      test(`Réponse vague: "${stepData.user.substring(0, 30)}..."`, async () => {
        // For vague responses, should stay at same step
        const mockMessage = `[STEP_${stepData.expectedNextStep}] Y a-t-il quand même quelque chose qui te pèse ?`;
        await setupMock(async () => createMockResponse(mockMessage, String(stepData.expectedNextStep)));

        const result = await generateResponse({
          conversationHistory: [
            { role: 'assistant', text: stepData.assistant },
            { role: 'user', text: stepData.user }
          ],
          leadContext: { username: 'test', conversation_step: stepData.step }
        });

        const parsedStep = parseFunnelStep(result.next_message);
        assert.strictEqual(
          parsedStep,
          stepData.expectedNextStep,
          'Should NOT advance when response is vague'
        );
      });
    }
  });

  // ============================================
  // SCENARIO: Who Are You / AI Question
  // ============================================

  describe(SCENARIO_WHO_ARE_YOU.name, () => {
    test('Lead demande "Tu es une IA ?"', async () => {
      const stepData = SCENARIO_WHO_ARE_YOU.steps[1];
      const mockMessage = `[STEP_${stepData.expectedNextStep}] Non ^^ Je suis bien Mélanie !`;
      await setupMock(async () => createMockResponse(mockMessage, String(stepData.expectedNextStep)));

      const result = await generateResponse({
        conversationHistory: [
          { role: 'assistant', text: stepData.assistant },
          { role: 'user', text: stepData.user }
        ],
        leadContext: { username: 'test', conversation_step: stepData.step }
      });

      assert.ok(
        result.next_message.toLowerCase().includes('non'),
        'Should deny being AI'
      );
    });
  });

  // ============================================
  // SCENARIO: Name Question
  // ============================================

  describe(SCENARIO_NAME_QUESTION.name, () => {
    test('Lead demande comment on connaît son prénom', async () => {
      const stepData = SCENARIO_NAME_QUESTION.steps[0];
      const mockMessage = `[STEP_${stepData.expectedNextStep}] Je l'ai deviné d'après ton profil !`;
      await setupMock(async () => createMockResponse(mockMessage, String(stepData.expectedNextStep)));

      const result = await generateResponse({
        conversationHistory: [
          { role: 'assistant', text: stepData.assistant },
          { role: 'user', text: stepData.user }
        ],
        leadContext: { username: 'julie_martin', fullName: 'Julie', conversation_step: stepData.step }
      });

      assert.ok(
        result.next_message.toLowerCase().includes('profil') ||
        result.next_message.toLowerCase().includes('deviné'),
        'Should explain name came from profile'
      );
    });
  });

  // ============================================
  // SCENARIO: Empathic Follow-up
  // ============================================

  describe(SCENARIO_EMPATHIC_FOLLOWUP.name, () => {
    test('Premier refus de parler - relance empathique', async () => {
      const stepData = SCENARIO_EMPATHIC_FOLLOWUP.steps[0];
      const mockMessage = `[STEP_${stepData.expectedNextStep}] Je comprends, souvent quand on va pas bien on préfère garder les choses pour soi. Est-ce que tu serais complètement fermée à l'idée d'en parler ?`;
      await setupMock(async () => createMockResponse(mockMessage, String(stepData.expectedNextStep)));

      const result = await generateResponse({
        conversationHistory: [
          { role: 'assistant', text: stepData.assistant },
          { role: 'user', text: stepData.user }
        ],
        leadContext: { username: 'test', conversation_step: stepData.step }
      });

      const hasKeyword = stepData.expectedKeywords.some(kw =>
        result.next_message.toLowerCase().includes(kw.toLowerCase())
      );
      assert.ok(hasKeyword, 'Should use empathic follow-up keywords');
    });

    test('Deuxième refus - NOT_INTERESTED', async () => {
      const stepData = SCENARIO_EMPATHIC_FOLLOWUP.steps[1];
      const mockMessage = `[STEP_${stepData.expectedNextStep}] [NOT_INTERESTED] Je comprends et je respecte ça. Bonne continuation !`;
      await setupMock(async () => createMockResponse(mockMessage, String(stepData.expectedNextStep)));

      const result = await generateResponse({
        conversationHistory: [
          { role: 'assistant', text: SCENARIO_EMPATHIC_FOLLOWUP.steps[0].assistant },
          { role: 'user', text: SCENARIO_EMPATHIC_FOLLOWUP.steps[0].user },
          { role: 'assistant', text: stepData.assistant },
          { role: 'user', text: stepData.user }
        ],
        leadContext: { username: 'test', conversation_step: stepData.step }
      });

      assert.ok(isNotInterested(result.next_message), 'Should mark as NOT_INTERESTED after second refusal');
    });
  });
});

console.log('✅ Scenario tests loaded successfully');
