/**
 * Utils Unit Tests
 *
 * Tests all utility functions:
 *   - validateConversation (input validation)
 *   - sanitizeMessage (whitespace cleanup)
 *   - calculateSentiment (positive/negative scoring)
 *   - isLowEffortMessage (short/emoji detection)
 *   - extractQuestions (question splitting)
 *   - isAppropriate (profanity filter)
 *   - formatConversationForDisplay (display formatting)
 *   - getCharacterCount (length)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  validateConversation,
  sanitizeMessage,
  calculateSentiment,
  isLowEffortMessage,
  extractQuestions,
  isAppropriate,
  formatConversationForDisplay,
  getCharacterCount
} from '../src/utils.js';

// === VALIDATE CONVERSATION ===

describe('validateConversation', () => {

  test('Valid conversation → returns true', () => {
    assert.strictEqual(
      validateConversation([
        { role: 'user', text: 'Salut' },
        { role: 'assistant', text: 'Bonjour !' }
      ]),
      true
    );
  });

  test('Single message → valid', () => {
    assert.strictEqual(
      validateConversation([{ role: 'user', text: 'Hello' }]),
      true
    );
  });

  test('Non-array → throws', () => {
    assert.throws(
      () => validateConversation('not an array'),
      /array/
    );
  });

  test('Null → throws', () => {
    assert.throws(
      () => validateConversation(null),
      /array/
    );
  });

  test('Empty array → throws', () => {
    assert.throws(
      () => validateConversation([]),
      /empty/
    );
  });

  test('Missing role → throws', () => {
    assert.throws(
      () => validateConversation([{ text: 'hello' }]),
      /role/
    );
  });

  test('Missing text → throws', () => {
    assert.throws(
      () => validateConversation([{ role: 'user' }]),
      /text/
    );
  });

  test('Invalid role → throws', () => {
    assert.throws(
      () => validateConversation([{ role: 'system', text: 'test' }]),
      /user|assistant/
    );
  });

  test('Non-string text → throws', () => {
    assert.throws(
      () => validateConversation([{ role: 'user', text: 123 }]),
      /string/
    );
  });

  test('Error mentions correct message index', () => {
    assert.throws(
      () => validateConversation([
        { role: 'user', text: 'ok' },
        { role: 'bad', text: 'fail' }
      ]),
      /Message 1/
    );
  });
});

// === SANITIZE MESSAGE ===

describe('sanitizeMessage', () => {

  test('Trims whitespace', () => {
    assert.strictEqual(sanitizeMessage('  hello  '), 'hello');
  });

  test('Collapses multiple spaces to one', () => {
    assert.strictEqual(sanitizeMessage('hello    world'), 'hello world');
  });

  test('Collapses tabs and mixed whitespace', () => {
    assert.strictEqual(sanitizeMessage('hello\t\t  world'), 'hello world');
  });

  test('Newlines collapsed by \\s+ (all whitespace becomes single space)', () => {
    // Note: \s+ runs first, replacing ALL whitespace (including \n) with a single space
    // The \n{3,} regex runs after, but has nothing left to match
    assert.strictEqual(sanitizeMessage('hello\n\n\n\n\nworld'), 'hello world');
  });

  test('Double newlines also collapsed (\\s+ takes precedence)', () => {
    assert.strictEqual(sanitizeMessage('hello\n\nworld'), 'hello world');
  });

  test('Normal message unchanged', () => {
    assert.strictEqual(sanitizeMessage('Bonjour !'), 'Bonjour !');
  });

  test('Empty string after trim', () => {
    assert.strictEqual(sanitizeMessage('   '), '');
  });
});

// === CALCULATE SENTIMENT ===

describe('calculateSentiment', () => {

  test('Positive words → positive score', () => {
    const score = calculateSentiment('This is great and amazing!');
    assert.ok(score > 0, `Expected positive score, got ${score}`);
  });

  test('Negative words → negative score', () => {
    const score = calculateSentiment("I can't do this, frustrated and angry");
    assert.ok(score < 0, `Expected negative score, got ${score}`);
  });

  test('Mixed → net score', () => {
    const score = calculateSentiment('Good but frustrated');
    assert.strictEqual(score, 0); // 1 positive (good) + 1 negative (frustrated) = 0
  });

  test('Neutral text → 0', () => {
    const score = calculateSentiment('Le chat est sur le tapis');
    assert.strictEqual(score, 0);
  });

  test('Case insensitive', () => {
    const score = calculateSentiment('GREAT AMAZING EXCELLENT');
    assert.strictEqual(score, 3);
  });

  test('Multiple positives stack', () => {
    const score = calculateSentiment('yes I am interested and excited, this is perfect');
    assert.ok(score >= 4, `Expected >=4, got ${score}`);
  });

  test('Empty string → 0', () => {
    assert.strictEqual(calculateSentiment(''), 0);
  });
});

// === IS LOW EFFORT MESSAGE ===

describe('isLowEffortMessage', () => {

  test('Very short (<10 chars) → true', () => {
    assert.strictEqual(isLowEffortMessage('Ok'), true);
    assert.strictEqual(isLowEffortMessage('Oui'), true);
    assert.strictEqual(isLowEffortMessage('Non'), true);
  });

  test('Single word (even long) → true', () => {
    assert.strictEqual(isLowEffortMessage('Bonjouuuuuur'), true);
  });

  test('Only emojis → true', () => {
    assert.strictEqual(isLowEffortMessage('😊🌸✨'), true);
    assert.strictEqual(isLowEffortMessage('👍'), true);
  });

  test('Emojis with spaces → true', () => {
    assert.strictEqual(isLowEffortMessage('😊 🌸 ✨'), true);
  });

  test('Normal message → false', () => {
    assert.strictEqual(isLowEffortMessage('Oui je suis intéressée'), false);
  });

  test('Short but multi-word and >=10 chars → false', () => {
    assert.strictEqual(isLowEffortMessage('Oui merci bien'), false);
  });

  test('Leading/trailing spaces trimmed', () => {
    assert.strictEqual(isLowEffortMessage('   Ok   '), true);
  });
});

// === EXTRACT QUESTIONS ===

describe('extractQuestions', () => {

  test('Single question extracted', () => {
    const qs = extractQuestions('Comment tu vas ?');
    assert.strictEqual(qs.length, 1);
    assert.ok(qs[0].includes('Comment tu vas'));
    assert.ok(qs[0].endsWith('?'));
  });

  test('Multiple questions extracted', () => {
    const qs = extractQuestions('Comment tu vas ? Et toi ça roule ?');
    assert.strictEqual(qs.length, 2);
  });

  test('Short fragments (<= 5 chars) filtered out', () => {
    const qs = extractQuestions('Ok ? Non ? Comment tu vas ?');
    // "Ok" (2 chars) and "Non" (3 chars) should be filtered out
    assert.strictEqual(qs.length, 1);
    assert.ok(qs[0].includes('Comment'));
  });

  test('No question marks → text still returned if >5 chars (split returns whole text)', () => {
    // split('?') on text without ? returns the full text as one element
    // filter keeps it if length > 5, then appends '?'
    const qs = extractQuestions('Tout va bien merci');
    assert.strictEqual(qs.length, 1);
    assert.ok(qs[0].endsWith('?'));
  });

  test('Short text without question mark → filtered out', () => {
    const qs = extractQuestions('Oui');
    assert.strictEqual(qs.length, 0);
  });

  test('Empty string → empty', () => {
    assert.deepStrictEqual(extractQuestions(''), []);
  });

  test('Each question ends with ?', () => {
    const qs = extractQuestions('Comment ça va ? Tu fais quoi ?');
    for (const q of qs) {
      assert.ok(q.endsWith('?'), `"${q}" should end with ?`);
    }
  });
});

// === IS APPROPRIATE ===

describe('isAppropriate', () => {

  test('Clean text → true', () => {
    assert.strictEqual(isAppropriate('Bonjour, comment vas-tu ?'), true);
  });

  test('Profanity → false', () => {
    assert.strictEqual(isAppropriate('What the fuck'), false);
    assert.strictEqual(isAppropriate('This is shit'), false);
    assert.strictEqual(isAppropriate('You bitch'), false);
  });

  test('Case insensitive', () => {
    assert.strictEqual(isAppropriate('DAMN it'), false);
  });

  test('Profanity as substring still detected', () => {
    // "ass" is in the profanity list, so "class" would trigger it
    assert.strictEqual(isAppropriate('class assignment'), false);
  });

  test('Empty string → appropriate', () => {
    assert.strictEqual(isAppropriate(''), true);
  });
});

// === FORMAT CONVERSATION FOR DISPLAY ===

describe('formatConversationForDisplay', () => {

  test('User messages shown as PROSPECT', () => {
    const output = formatConversationForDisplay([
      { role: 'user', text: 'Salut' }
    ]);
    assert.ok(output.includes('PROSPECT'));
    assert.ok(output.includes('Salut'));
  });

  test('Assistant messages shown as YOU', () => {
    const output = formatConversationForDisplay([
      { role: 'assistant', text: 'Bonjour !' }
    ]);
    assert.ok(output.includes('YOU'));
    assert.ok(output.includes('Bonjour !'));
  });

  test('Messages numbered starting at 1', () => {
    const output = formatConversationForDisplay([
      { role: 'assistant', text: 'Hey' },
      { role: 'user', text: 'Salut' },
      { role: 'assistant', text: 'Ça va ?' }
    ]);
    assert.ok(output.includes('[1]'));
    assert.ok(output.includes('[2]'));
    assert.ok(output.includes('[3]'));
  });

  test('Messages separated by double newlines', () => {
    const output = formatConversationForDisplay([
      { role: 'user', text: 'A' },
      { role: 'assistant', text: 'B' }
    ]);
    assert.ok(output.includes('\n\n'));
  });

  test('Empty conversation → empty string', () => {
    assert.strictEqual(formatConversationForDisplay([]), '');
  });
});

// === GET CHARACTER COUNT ===

describe('getCharacterCount', () => {

  test('Simple string', () => {
    assert.strictEqual(getCharacterCount('hello'), 5);
  });

  test('Unicode characters', () => {
    assert.strictEqual(getCharacterCount('🌸'), 2); // emoji is 2 .length units
  });

  test('Empty string → 0', () => {
    assert.strictEqual(getCharacterCount(''), 0);
  });

  test('String with spaces counted', () => {
    assert.strictEqual(getCharacterCount('a b c'), 5);
  });
});
