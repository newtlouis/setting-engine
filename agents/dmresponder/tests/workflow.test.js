/**
 * Conversation Workflow Integration Tests
 *
 * Tests the full conversation workflow from Step 1 to Step 9,
 * including objection handling and special scenarios.
 *
 * Uses mocked LLM responses to ensure deterministic and fast tests.
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { generateResponse, clearPromptCache } from '../src/engine.js';
import { parseFunnelStep, isNotInterested, isBookingAlert, needsManualIntervention, stripControlTags } from '../../../shared/domain/services/FunnelStepParser.js';

// Mock axios for OpenAI API calls
let axiosMock = null;
let originalEnv = null;

/**
 * Creates a mock LLM response with the expected format
 */
function createMockLlmResponse(message, stepUsed, bookingIntent = null) {
  return {
    data: {
      choices: [{
        message: {
          content: JSON.stringify({
            message,
            step_used: stepUsed,
            booking_intent: bookingIntent
          })
        }
      }]
    }
  };
}

/**
 * Setup mock for axios to intercept OpenAI API calls
 */
async function setupAxiosMock(mockResponse) {
  const axios = await import('axios');

  // Store original post
  if (!axiosMock) {
    axiosMock = axios.default.post;
  }

  // Replace with mock
  axios.default.post = mock.fn(async (url, data, config) => {
    if (url.includes('openai.com')) {
      return typeof mockResponse === 'function'
        ? mockResponse(data.messages)
        : mockResponse;
    }
    return axiosMock(url, data, config);
  });

  return axios.default.post;
}

/**
 * Restore original axios
 */
async function restoreAxios() {
  if (axiosMock) {
    const axios = await import('axios');
    axios.default.post = axiosMock;
  }
}

// ============================================
// WORKFLOW STEP TESTS (1-9)
// ============================================

describe('Conversation Workflow Steps', () => {
  beforeEach(() => {
    originalEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    clearPromptCache();
  });

  afterEach(async () => {
    process.env.OPENAI_API_KEY = originalEnv;
    await restoreAxios();
  });

  test('STEP_1: First contact with unknown name should generate cold opener', async () => {
    await setupAxiosMock(createMockLlmResponse('[STEP_1] Hey ! 🙂', '1'));

    // Note: Engine requires at least one message in history (system context)
    // For step 1, we simulate the scenario where user initiated contact first
    const result = await generateResponse({
      conversationHistory: [
        { role: 'user', text: '👋' } // Minimal user initiation
      ],
      leadContext: { username: 'test_user', conversation_step: 0 }
    });

    assert.ok(result.next_message, 'Should have a message');
    assert.strictEqual(result.step_used, '1', 'Should be step 1');

    const step = parseFunnelStep(result.next_message);
    assert.strictEqual(step, 1, 'Message should contain STEP_1 tag');
  });

  test('STEP_1: First contact with known name should personalize', async () => {
    await setupAxiosMock(createMockLlmResponse('[STEP_1] Marie ? 🙂', '1'));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'user', text: 'Salut' } // Minimal user initiation
      ],
      leadContext: {
        username: 'marie_durand',
        fullName: 'Marie Durand',
        conversation_step: 0
      }
    });

    assert.ok(result.next_message.includes('Marie') || result.next_message.includes('Hey'),
      'Should use name or generic greeting');
    assert.strictEqual(result.step_used, '1');
  });

  test('STEP_2: After lead responds, should create emotional connection', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_2] Coucou, j\'espère que tu vas bien 🌸 J\'ai vu que tu t\'intéressais à du contenu autour de la dépendance affective. C\'est plutôt personnel ou par curiosité ? 😊',
      '2'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_1] Hey ! 🙂' },
        { role: 'user', text: 'Salut ! Oui c\'est moi ^^' }
      ],
      leadContext: { username: 'test_user', conversation_step: 1 }
    });

    assert.strictEqual(result.step_used, '2', 'Should progress to step 2');
    assert.ok(result.next_message.length > 20, 'Should be a substantial message');
  });

  test('STEP_3: Should explore the situation when lead opens up', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_3] Je vois 🙏 Tu peux m\'en dire plus sur ce que tu vis ? C\'est plus en amour, en amitié, au travail... ? Si c\'est ok pour toi bien sûr 😊',
      '3'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_2] Coucou 🌸 Tu t\'intéresses à la dépendance affective ?' },
        { role: 'user', text: 'Oui c\'est personnel, j\'ai du mal avec mes relations...' }
      ],
      leadContext: { username: 'test_user', conversation_step: 2 }
    });

    assert.strictEqual(result.step_used, '3');
    const step = parseFunnelStep(result.next_message);
    assert.strictEqual(step, 3);
  });

  test('STEP_3.2: Should dig deeper after initial exploration', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_3.2] Merci pour ta confiance 🙏 C\'est pas toujours évident d\'en parler, alors bravo déjà pour ça 💛 Ça fait combien de temps que ça te pèse ?',
      '3'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_3] Dans quel domaine ça se manifeste ?' },
        { role: 'user', text: 'Surtout en amour, je fais toujours les mauvais choix...' }
      ],
      leadContext: { username: 'test_user', conversation_step: 3 }
    });

    assert.strictEqual(result.step_used, '3');
    // Sub-step 3.2 should still parse as step 3
    const step = parseFunnelStep(result.next_message);
    assert.strictEqual(step, 3);
  });

  test('STEP_4: Should focus on objectives and projection', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_4] Je vois… et à ton sens, quel serait ton plus grand objectif dans les prochains mois ? Retrouver plus d\'équilibre émotionnel, apprendre à te choisir davantage... ou autre chose ? 🌸',
      '4'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_3.2] Depuis combien de temps ça te pèse ?' },
        { role: 'user', text: 'Ça fait 3 ans maintenant, j\'en ai vraiment marre...' }
      ],
      leadContext: { username: 'test_user', conversation_step: 3 }
    });

    assert.strictEqual(result.step_used, '4');
  });

  test('STEP_5: Should propose discovery call (PIVOT)', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_5] C\'est déjà une belle prise de conscience 💫 Ce que je peux te proposer, c\'est de prendre 30 minutes ensemble cette semaine pour faire le point. Tu serais dispo ces prochains jours ? 🌼',
      '5'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_4] Quel serait ton plus grand objectif ?' },
        { role: 'user', text: 'J\'aimerais retrouver confiance en moi et avoir des relations saines' }
      ],
      leadContext: { username: 'test_user', conversation_step: 4 }
    });

    assert.strictEqual(result.step_used, '5');
    assert.ok(
      result.next_message.toLowerCase().includes('appel') ||
      result.next_message.toLowerCase().includes('minutes') ||
      result.next_message.toLowerCase().includes('dispo'),
      'Should mention call or availability'
    );
  });

  test('STEP_6: Should propose specific time slots', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_6] Super 🌸 Pour cette semaine, je peux te proposer mardi à 14h ou jeudi à 10h. Qu\'est-ce qui t\'arrangerait le mieux ? 🌷',
      '6'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_5] Tu serais dispo ces prochains jours ?' },
        { role: 'user', text: 'Oui pourquoi pas ! Je suis assez flexible cette semaine' }
      ],
      leadContext: { username: 'test_user', conversation_step: 5 }
    });

    assert.strictEqual(result.step_used, '6');
  });

  test('STEP_7: Should request contact info after slot validation', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_7] Super pour mardi à 14h ! 🌸 Pour que je puisse bloquer le créneau et t\'envoyer l\'invitation, tu peux me donner ton adresse email et ton numéro de téléphone ? 🌷',
      '7'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_6] Mardi 14h ou jeudi 10h ?' },
        { role: 'user', text: 'Mardi 14h c\'est parfait !' }
      ],
      leadContext: { username: 'test_user', conversation_step: 6 }
    });

    assert.strictEqual(result.step_used, '7');
    assert.ok(
      result.next_message.toLowerCase().includes('email') ||
      result.next_message.toLowerCase().includes('téléphone'),
      'Should request contact info'
    );
  });

  test('STEP_8: Should confirm booking after receiving contact info', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_8] [ALERT_BOOKING] C\'est tout bon ! ✅ Je t\'ai bien réservé ton créneau pour mardi à 14h. Tu as dû recevoir une invitation par mail 🌸',
      '8',
      { slot: '2026-02-10T14:00:00Z', email: 'marie@mail.com', phone: '0612345678' }
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_7] Tu peux me donner ton email et téléphone ?' },
        { role: 'user', text: 'Bien sûr ! marie@mail.com et 0612345678' }
      ],
      leadContext: { username: 'test_user', conversation_step: 7 }
    });

    assert.strictEqual(result.step_used, '8');
    assert.ok(isBookingAlert(result.next_message), 'Should contain ALERT_BOOKING');
  });

  test('STEP_9: Closing - should handle post-booking naturally', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_9] Avec plaisir ! On se parle mardi alors 🌸 Passe une bonne fin de journée !',
      '9'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_8] C\'est tout bon ! Tu as reçu l\'invitation.' },
        { role: 'user', text: 'Merci beaucoup ! J\'ai hâte d\'y être !' }
      ],
      leadContext: { username: 'test_user', conversation_step: 8 }
    });

    assert.strictEqual(result.step_used, '9');
  });
});

// ============================================
// OBJECTION HANDLING TESTS
// ============================================

describe('Objection Handling', () => {
  beforeEach(() => {
    originalEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    clearPromptCache();
  });

  afterEach(async () => {
    process.env.OPENAI_API_KEY = originalEnv;
    await restoreAxios();
  });

  test('Objection: "C\'est payant ?" - Should explain free call', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_5] L\'appel de 30 min est 100% gratuit et offert 🎁 C\'est un moment pour faire le point. Tu serais dispo quand ?',
      '5'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_5] Je te propose 30 minutes ensemble cette semaine.' },
        { role: 'user', text: 'C\'est payant ?' }
      ],
      leadContext: { username: 'test_user', conversation_step: 5 }
    });

    assert.ok(
      result.next_message.toLowerCase().includes('gratuit') ||
      result.next_message.toLowerCase().includes('offert'),
      'Should mention free call'
    );
  });

  test('Objection: "J\'ai pas le temps" (logistical) - Should validate and propose later', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_5] Je comprends totalement, on court tous après le temps 😅 Reviens vers moi dès que tu auras un moment plus calme ! 🌸',
      '5'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_5] Tu serais dispo ces prochains jours ?' },
        { role: 'user', text: 'Pas le temps en ce moment, je suis débordée avec le travail' }
      ],
      leadContext: { username: 'test_user', conversation_step: 5 }
    });

    assert.ok(
      result.next_message.toLowerCase().includes('comprends') ||
      result.next_message.toLowerCase().includes('pas de souci'),
      'Should acknowledge the time constraint'
    );
  });

  test('Objection: "Je vais me débrouiller seule" - Should explore what they tried', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_5] C\'est tout à ton honneur et je respecte ça 💛 Qu\'est-ce que tu as déjà testé qui n\'a pas marché jusqu\'ici ?',
      '5'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_5] Tu serais dispo pour un appel cette semaine ?' },
        { role: 'user', text: 'Non merci, je vais me débrouiller seule' }
      ],
      leadContext: { username: 'test_user', conversation_step: 5 }
    });

    assert.ok(
      result.next_message.toLowerCase().includes('testé') ||
      result.next_message.toLowerCase().includes('essayé') ||
      result.next_message.toLowerCase().includes('respecte'),
      'Should ask about previous attempts or respect decision'
    );
  });

  test('Objection: "C\'est quoi le prix du coaching ?" - Should redirect to call first', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_5] Ça dépend vraiment de ce dont tu as besoin ! C\'est pour ça que je propose toujours qu\'on en discute d\'abord. L\'appel est gratuit dans tous les cas 🌸',
      '5'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_5] Je te propose un appel découverte.' },
        { role: 'user', text: 'C\'est combien le coaching ?' }
      ],
      leadContext: { username: 'test_user', conversation_step: 5 }
    });

    assert.ok(
      result.next_message.toLowerCase().includes('dépend') ||
      result.next_message.toLowerCase().includes('gratuit') ||
      result.next_message.toLowerCase().includes('discute'),
      'Should redirect to discussing first'
    );
  });

  test('Objection: Clear refusal - Should include NOT_INTERESTED tag', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_2] [NOT_INTERESTED] Pas de souci, je comprends tout à fait ! Je te souhaite une bonne continuation 🌸',
      '2'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_2] Tu t\'intéresses à la dépendance affective ?' },
        { role: 'user', text: 'Non pas du tout, je ne suis pas intéressée. Laisse-moi tranquille.' }
      ],
      leadContext: { username: 'test_user', conversation_step: 2 }
    });

    assert.ok(isNotInterested(result.next_message), 'Should contain NOT_INTERESTED tag');
  });

  test('Objection: "Tu es une IA ?" - Should deny naturally', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_3] Non ^^ Je suis bien Mélanie ! Donc tu me disais que tu avais du mal en amour...',
      '3'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_3] C\'est plus en amour ou en amitié ?' },
        { role: 'user', text: 'Attends, tu es une IA ?' }
      ],
      leadContext: { username: 'test_user', conversation_step: 3 }
    });

    assert.ok(
      result.next_message.toLowerCase().includes('non'),
      'Should deny being AI'
    );
  });

  test('Objection: "Je suis occupé(e) maintenant" - Should validate and reschedule', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_3] Je comprends tout à fait, profite bien de ton moment ! ✨ On en rediscute tranquillement quand tu seras plus dispo 🌸',
      '3'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_3] Tu peux m\'en dire plus ?' },
        { role: 'user', text: 'Là je suis en soirée, je peux pas trop parler' }
      ],
      leadContext: { username: 'test_user', conversation_step: 3 }
    });

    assert.ok(
      result.next_message.toLowerCase().includes('comprends') ||
      result.next_message.toLowerCase().includes('profite'),
      'Should acknowledge they are busy'
    );
  });

  test('Objection: Vague response - Should dig deeper, not advance', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_3] C\'est super que tu prennes des mesures pour toi 💛 Est-ce qu\'il y a quand même encore quelque chose qui te pèse ?',
      '3'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_3] Qu\'est-ce qui est vraiment dur pour toi ?' },
        { role: 'user', text: 'Bah non ça va, je gère maintenant' }
      ],
      leadContext: { username: 'test_user', conversation_step: 3 }
    });

    // Should NOT advance to step 4, should stay at step 3 and dig deeper
    assert.strictEqual(result.step_used, '3', 'Should stay at same step when response is vague');
  });

  test('Objection: "Comment tu connais mon prénom ?" - Should explain from profile', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_2] Je l\'ai deviné d\'après ton nom de profil ! Mais si ce n\'est pas le bon, n\'hésite pas à me le dire 😊',
      '2'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_1] Sophie ? 🙂' },
        { role: 'user', text: 'Oui c\'est moi, mais comment tu connais mon prénom ??' }
      ],
      leadContext: { username: 'sophie_martin', fullName: 'Sophie Martin', conversation_step: 1 }
    });

    assert.ok(
      result.next_message.toLowerCase().includes('profil') ||
      result.next_message.toLowerCase().includes('deviné'),
      'Should explain name came from profile'
    );
  });
});

// ============================================
// SPECIAL TAGS TESTS
// ============================================

describe('Special Tags Detection', () => {
  beforeEach(() => {
    originalEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    clearPromptCache();
  });

  afterEach(async () => {
    process.env.OPENAI_API_KEY = originalEnv;
    await restoreAxios();
  });

  test('[ALERT_BOOKING] should trigger when lead validates a slot', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_6] [ALERT_BOOKING] C\'est noté pour mardi à 14h ! Tu peux me donner ton email pour l\'invitation ? 🌸',
      '6'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_6] Mardi 14h ou jeudi 10h ?' },
        { role: 'user', text: 'Mardi 14h ça me va !' }
      ],
      leadContext: { username: 'test_user', conversation_step: 6 }
    });

    assert.ok(isBookingAlert(result.next_message), 'Should contain ALERT_BOOKING');
  });

  test('[MANUAL] should trigger for complex situations', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_7] [MANUAL] Je comprends, c\'est une situation particulière. Je vais voir ce que je peux faire.',
      '7'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_7] Tu peux me donner ton email ?' },
        { role: 'user', text: 'Je veux bien un appel mais je suis sourde, il faudrait une alternative' }
      ],
      leadContext: { username: 'test_user', conversation_step: 7 }
    });

    assert.ok(needsManualIntervention(result.next_message), 'Should contain MANUAL tag');
  });

  test('stripControlTags should clean message for sending', async () => {
    const rawMessage = '[STEP_5] [ALERT_BOOKING] C\'est noté pour mardi !';
    const cleanMessage = stripControlTags(rawMessage);

    assert.strictEqual(cleanMessage, 'C\'est noté pour mardi !');
    assert.ok(!cleanMessage.includes('[STEP'), 'Should not contain STEP tag');
    assert.ok(!cleanMessage.includes('[ALERT'), 'Should not contain ALERT tag');
  });
});

// ============================================
// EDGE CASES TESTS
// ============================================

describe('Edge Cases', () => {
  beforeEach(() => {
    originalEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    clearPromptCache();
  });

  afterEach(async () => {
    process.env.OPENAI_API_KEY = originalEnv;
    await restoreAxios();
  });

  test('New conversation should start at step 1', async () => {
    await setupAxiosMock(createMockLlmResponse('[STEP_1] Hey ! 🙂', '1'));

    // Engine requires at least one message - simulate user initiating
    const result = await generateResponse({
      conversationHistory: [
        { role: 'user', text: 'Bonjour' }
      ],
      leadContext: { username: 'new_lead', conversation_step: 0 }
    });

    assert.strictEqual(result.step_used, '1');
  });

  test('Very short user response should still progress appropriately', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_2] Coucou ! 🌸 J\'ai vu que tu t\'intéressais à du contenu sur la dépendance affective. C\'est personnel ou par curiosité ?',
      '2'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_1] Hey !' },
        { role: 'user', text: 'Cc' }
      ],
      leadContext: { username: 'test_user', conversation_step: 1 }
    });

    assert.ok(result.next_message, 'Should handle short responses');
  });

  test('Long conversation history should still work', async () => {
    const longHistory = [];
    for (let i = 1; i <= 20; i++) {
      longHistory.push({ role: 'assistant', text: `Message assistant ${i}` });
      longHistory.push({ role: 'user', text: `Message user ${i}` });
    }

    await setupAxiosMock(createMockLlmResponse('[STEP_5] Tu serais dispo pour un appel ?', '5'));

    const result = await generateResponse({
      conversationHistory: longHistory,
      leadContext: { username: 'test_user', conversation_step: 5 }
    });

    assert.ok(result.next_message, 'Should handle long conversation history');
  });

  test('Missing lead context should still work', async () => {
    await setupAxiosMock(createMockLlmResponse('[STEP_1] Hey ! 🙂', '1'));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'user', text: 'Salut' }
      ]
      // No leadContext provided
    });

    assert.ok(result.next_message, 'Should work without lead context');
  });

  test('User sends emoji only - should handle gracefully', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_2] 😊 Tu vas bien ? J\'ai vu que tu t\'intéresses à la dépendance affective, c\'est personnel ou par curiosité ?',
      '2'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_1] Hey !' },
        { role: 'user', text: '👋😊' }
      ],
      leadContext: { username: 'test_user', conversation_step: 1 }
    });

    assert.ok(result.next_message, 'Should handle emoji-only responses');
  });

  test('User sends voice note indicator - should continue flow', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_3] Je vois que tu m\'as envoyé un vocal ! Je t\'écoute et je te réponds 🌸',
      '3'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_2] C\'est personnel ou par curiosité ?' },
        { role: 'user', text: '[Audio message]' }
      ],
      leadContext: { username: 'test_user', conversation_step: 2 }
    });

    assert.ok(result.next_message, 'Should handle voice note indicators');
  });

  test('User asks unrelated question - should answer then redirect', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_3] Il fait plutôt gris ici aussi 😅 Mais dis-moi, tu me parlais de tes difficultés en amour... ça se manifeste comment concrètement ?',
      '3'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_3] C\'est plus en amour ou en amitié ?' },
        { role: 'user', text: 'Il fait beau chez toi ?' }
      ],
      leadContext: { username: 'test_user', conversation_step: 3 }
    });

    assert.ok(result.next_message, 'Should answer and redirect');
    assert.strictEqual(result.step_used, '3', 'Should maintain current step');
  });
});

// ============================================
// STEP PARSING TESTS
// ============================================

describe('Step Parsing from LLM Response', () => {
  test('Should parse standard step format', () => {
    assert.strictEqual(parseFunnelStep('[STEP_1] Hello'), 1);
    assert.strictEqual(parseFunnelStep('[STEP_5] Proposition'), 5);
    assert.strictEqual(parseFunnelStep('[STEP_9] Clôture'), 9);
  });

  test('Should parse sub-steps correctly', () => {
    assert.strictEqual(parseFunnelStep('[STEP_3.1] First sub'), 3);
    assert.strictEqual(parseFunnelStep('[STEP_3.2] Second sub'), 3);
    assert.strictEqual(parseFunnelStep('[STEP_4.1] Projection'), 4);
  });

  test('Should cap at step 9', () => {
    assert.strictEqual(parseFunnelStep('[STEP_10] Beyond'), 9);
    assert.strictEqual(parseFunnelStep('[STEP_99] Way beyond'), 9);
  });

  test('Should return null for invalid formats', () => {
    assert.strictEqual(parseFunnelStep('Hello without step'), null);
    assert.strictEqual(parseFunnelStep('[STEP] No number'), null);
    assert.strictEqual(parseFunnelStep(''), null);
    assert.strictEqual(parseFunnelStep(null), null);
  });
});

// ============================================
// RELANCE (FOLLOW-UP) SCENARIOS
// ============================================

describe('Follow-up Scenarios', () => {
  beforeEach(() => {
    originalEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    clearPromptCache();
  });

  afterEach(async () => {
    process.env.OPENAI_API_KEY = originalEnv;
    await restoreAxios();
  });

  test('Should handle lead who went silent after step 2', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_2] Coucou ! 🌸 J\'espère que tu vas bien. Tu as eu le temps de réfléchir à ce qu\'on discutait ?',
      '2'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_2] C\'est personnel ou par curiosité ?' },
        // No user response - this is a follow-up scenario
      ],
      leadContext: {
        username: 'test_user',
        conversation_step: 2,
        total_messages_sent: 2,
        total_messages_received: 1
      }
    });

    assert.ok(result.next_message, 'Should generate follow-up');
    assert.strictEqual(result.step_used, '2', 'Should stay at same step for follow-up');
  });

  test('Empathic follow-up when lead refuses to talk', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_3] Je comprends, souvent quand on va pas bien on préfère garder les choses pour soi. Même si parfois ça nous aide aussi d\'exprimer les choses... Est-ce que tu serais complètement fermée à l\'idée d\'en parler ?',
      '3'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_3] Tu peux m\'en dire plus ?' },
        { role: 'user', text: 'Je préfère pas en parler' }
      ],
      leadContext: { username: 'test_user', conversation_step: 3 }
    });

    assert.ok(
      result.next_message.toLowerCase().includes('comprends') ||
      result.next_message.toLowerCase().includes('fermée'),
      'Should use empathic follow-up approach'
    );
  });

  test('Second refusal after empathic follow-up should mark NOT_INTERESTED', async () => {
    await setupAxiosMock(createMockLlmResponse(
      '[STEP_3] [NOT_INTERESTED] Je comprends tout à fait et je respecte ça 💛 Je te souhaite une bonne continuation !',
      '3'
    ));

    const result = await generateResponse({
      conversationHistory: [
        { role: 'assistant', text: '[STEP_3] Tu peux m\'en dire plus ?' },
        { role: 'user', text: 'Je préfère pas en parler' },
        { role: 'assistant', text: '[STEP_3] Je comprends... Est-ce que tu serais complètement fermée à l\'idée d\'en parler ?' },
        { role: 'user', text: 'Oui vraiment, j\'ai pas envie' }
      ],
      leadContext: { username: 'test_user', conversation_step: 3 }
    });

    assert.ok(isNotInterested(result.next_message), 'Should mark as NOT_INTERESTED after second refusal');
  });
});

// ============================================
// COMPLETE WORKFLOW SIMULATION
// ============================================

describe('Complete Workflow Simulation', () => {
  beforeEach(() => {
    originalEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    clearPromptCache();
  });

  afterEach(async () => {
    process.env.OPENAI_API_KEY = originalEnv;
    await restoreAxios();
  });

  test('Full successful workflow from Step 1 to Step 8', async () => {
    // This test simulates a complete successful conversation flow
    const workflow = [
      // Step 1: Cold opener (user initiated with a greeting)
      {
        history: [
          { role: 'user', text: 'Salut !' }
        ],
        mockResponse: '[STEP_1] Marie ? 🙂',
        mockStep: '1',
        expectedStep: 1
      },
      // Step 2: Connection after response
      {
        history: [
          { role: 'assistant', text: '[STEP_1] Marie ? 🙂' },
          { role: 'user', text: 'Oui c\'est moi ! Tu es qui ?' }
        ],
        mockResponse: '[STEP_2] Coucou Marie 🌸 Je suis Mélanie, j\'accompagne des femmes sur les sujets de dépendance affective. Tu t\'y intéresses personnellement ?',
        mockStep: '2',
        expectedStep: 2
      },
      // Step 3: Exploration
      {
        history: [
          { role: 'assistant', text: '[STEP_2] Tu t\'y intéresses personnellement ?' },
          { role: 'user', text: 'Oui c\'est vraiment mon sujet, j\'en souffre depuis longtemps' }
        ],
        mockResponse: '[STEP_3] Je vois 🙏 Tu peux m\'en dire plus ? C\'est plus en amour, en amitié ?',
        mockStep: '3',
        expectedStep: 3
      },
      // Step 4: Projection
      {
        history: [
          { role: 'assistant', text: '[STEP_3] C\'est plus en amour, en amitié ?' },
          { role: 'user', text: 'En amour surtout, je m\'attache trop vite et ça fait fuir les gens' }
        ],
        mockResponse: '[STEP_4] Quel serait ton plus grand objectif dans les prochains mois ?',
        mockStep: '4',
        expectedStep: 4
      },
      // Step 5: Proposition
      {
        history: [
          { role: 'assistant', text: '[STEP_4] Quel serait ton objectif ?' },
          { role: 'user', text: 'J\'aimerais apprendre à moins m\'attacher et avoir des relations saines' }
        ],
        mockResponse: '[STEP_5] C\'est super comme objectif ! Je te propose 30 min ensemble pour en parler. Tu serais dispo ?',
        mockStep: '5',
        expectedStep: 5
      },
      // Step 6: Slots
      {
        history: [
          { role: 'assistant', text: '[STEP_5] Tu serais dispo pour 30 min ?' },
          { role: 'user', text: 'Oui pourquoi pas !' }
        ],
        mockResponse: '[STEP_6] Super 🌸 Je peux mardi 14h ou jeudi 10h ?',
        mockStep: '6',
        expectedStep: 6
      },
      // Step 7: Contact info
      {
        history: [
          { role: 'assistant', text: '[STEP_6] Mardi 14h ou jeudi 10h ?' },
          { role: 'user', text: 'Mardi 14h c\'est parfait' }
        ],
        mockResponse: '[STEP_7] [ALERT_BOOKING] Super pour mardi ! Tu peux me donner ton email et téléphone ?',
        mockStep: '7',
        expectedStep: 7
      },
      // Step 8: Confirmation
      {
        history: [
          { role: 'assistant', text: '[STEP_7] Tu peux me donner ton email et téléphone ?' },
          { role: 'user', text: 'marie@mail.com et 0612345678' }
        ],
        mockResponse: '[STEP_8] C\'est tout bon ! ✅ RDV confirmé pour mardi 14h. Tu as reçu l\'invitation !',
        mockStep: '8',
        expectedStep: 8,
        bookingIntent: { slot: '2026-02-10T14:00:00Z', email: 'marie@mail.com', phone: '0612345678' }
      }
    ];

    for (const step of workflow) {
      await setupAxiosMock(createMockLlmResponse(
        step.mockResponse,
        step.mockStep,
        step.bookingIntent || null
      ));

      const result = await generateResponse({
        conversationHistory: step.history,
        leadContext: {
          username: 'marie_test',
          fullName: 'Marie',
          conversation_step: step.expectedStep - 1
        }
      });

      const parsedStep = parseFunnelStep(result.next_message);
      assert.strictEqual(
        parsedStep,
        step.expectedStep,
        `Expected step ${step.expectedStep}, got ${parsedStep}`
      );
    }
  });
});

console.log('✅ Workflow tests loaded successfully');
