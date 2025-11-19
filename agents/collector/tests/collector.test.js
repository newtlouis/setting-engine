/**
 * Collector Agent Tests
 * 
 * Basic unit tests for utility functions and data validation.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { detectChallenge } from '../src/utils.js';

test('detectChallenge should identify challenge URLs', async () => {
  const mockPage = {
    url: () => 'https://www.instagram.com/challenge/12345/',
    $: async () => null
  };

  const result = await detectChallenge(mockPage);
  assert.strictEqual(result, true, 'Should detect challenge URL');
});

test('detectChallenge should return false for normal URLs', async () => {
  const mockPage = {
    url: () => 'https://www.instagram.com/p/ABC123/',
    $: async () => null
  };

  const result = await detectChallenge(mockPage);
  assert.strictEqual(result, false, 'Should not detect challenge on normal post');
});

test('post data structure validation', () => {
  const post = {
    source_type: 'hashtag',
    source_name: 'fitness',
    post_url: 'https://www.instagram.com/p/ABC123/',
    post_date: '',
    likes: '',
    comments_count: '',
    caption_excerpt: ''
  };

  assert.ok(post.source_type, 'Post should have source_type');
  assert.ok(post.source_name, 'Post should have source_name');
  assert.ok(post.post_url, 'Post should have post_url');
});

test('comment data structure validation', () => {
  const comment = {
    post_url: 'https://www.instagram.com/p/ABC123/',
    username: 'testuser',
    profile_url: 'https://www.instagram.com/testuser/',
    comment_text: 'Great post!',
    comment_date: '2024-01-15T12:00:00.000Z',
    followers_estimate: ''
  };

  assert.ok(comment.post_url, 'Comment should have post_url');
  assert.ok(comment.username, 'Comment should have username');
  assert.ok(comment.comment_text, 'Comment should have comment_text');
});
