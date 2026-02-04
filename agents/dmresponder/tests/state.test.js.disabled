/**
 * State Machine Tests
 * 
 * Tests for conversation stage detection and intent analysis.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { analyzeConversationStage, detectIntent, extractPainPoints } from '../src/state_machine.js';

test('detectIntent should identify price objections', () => {
  const text = 'That sounds expensive, I can\'t afford it right now';
  const intent = detectIntent(text);
  
  assert.strictEqual(intent.type, 'objection');
  assert.strictEqual(intent.objection, 'price');
});

test('detectIntent should identify time objections', () => {
  const text = 'I don\'t have time for this right now, too busy';
  const intent = detectIntent(text);
  
  assert.strictEqual(intent.type, 'objection');
  assert.strictEqual(intent.objection, 'time');
});

test('detectIntent should identify questions', () => {
  const text = 'How does this program work?';
  const intent = detectIntent(text);
  
  assert.strictEqual(intent.type, 'asking_question');
});

test('detectIntent should identify pain expression', () => {
  const text = 'I\'m really struggling with my fitness and need help';
  const intent = detectIntent(text);
  
  assert.strictEqual(intent.type, 'expressing_pain');
});

test('extractPainPoints should extract struggles', () => {
  const text = 'I\'m struggling with motivation and can\'t seem to stay consistent';
  const painPoints = extractPainPoints(text);
  
  assert.ok(painPoints.length > 0);
  assert.ok(painPoints.some(p => p.includes('motivation')));
});

test('analyzeConversationStage should identify initial rapport stage', () => {
  const conversation = [
    { role: 'user', text: 'Hey, I saw your post about fitness' }
  ];
  
  const stage = analyzeConversationStage(conversation, null);
  assert.strictEqual(stage, 'initial_rapport');
});

test('analyzeConversationStage should identify scheduling stage', () => {
  const conversation = [
    { role: 'user', text: 'When can we schedule a call?' },
    { role: 'assistant', text: 'How about tomorrow?' },
    { role: 'user', text: 'That works for me' }
  ];
  
  const stage = analyzeConversationStage(conversation, null);
  assert.strictEqual(stage, 'scheduling');
});

test('analyzeConversationStage should identify objection handling', () => {
  const conversation = [
    { role: 'user', text: 'This sounds good but it\'s too expensive for me' }
  ];
  
  const stage = analyzeConversationStage(conversation, null);
  assert.strictEqual(stage, 'objection_handling');
});
