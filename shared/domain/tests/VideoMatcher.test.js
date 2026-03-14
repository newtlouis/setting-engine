/**
 * VideoMatcher Domain Service Tests
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { matchVideo } from '../services/VideoMatcher.js';

const VIDEO_ENTRIES = [
    {
        category: 'video_resource',
        trigger_keywords: 'clients,acquisition,trouver des clients,pas de clients',
        content: 'Comment obtenir plus de clients',
        applicable_steps: 'both',
        video_url: 'https://youtu.be/clients'
    },
    {
        category: 'video_resource',
        trigger_keywords: 'vente,conversion,vendre,closing',
        content: 'Techniques de vente',
        applicable_steps: 'funnel_alternative',
        video_url: 'https://youtu.be/vente'
    },
    {
        category: 'video_resource',
        trigger_keywords: 'temps,energie,fatigue,epuisee,surbookee',
        content: 'Gestion du temps',
        applicable_steps: 'post_booking',
        video_url: 'https://youtu.be/temps'
    },
    {
        category: 'video_resource',
        trigger_keywords: 'positionnement,offre,prix',
        content: 'Positionnement et offre',
        applicable_steps: 'both',
        video_url: 'https://youtu.be/positionnement'
    }
];

describe('VideoMatcher.matchVideo', () => {
    test('should return null for empty entries', () => {
        const result = matchVideo([], { conversationHistory: [{ role: 'user', text: 'je veux des clients' }] });
        assert.strictEqual(result, null);
    });

    test('should return null for null entries', () => {
        assert.strictEqual(matchVideo(null), null);
    });

    test('should return null when no conversation text', () => {
        const result = matchVideo(VIDEO_ENTRIES, { conversationHistory: [] });
        assert.strictEqual(result, null);
    });

    test('should match video based on conversation keywords', () => {
        const result = matchVideo(VIDEO_ENTRIES, {
            conversationHistory: [
                { role: 'user', text: 'je galere a trouver des clients pour mon business' }
            ]
        });
        assert.ok(result);
        assert.strictEqual(result.video_url, 'https://youtu.be/clients');
    });

    test('should match video based on multiple keyword hits', () => {
        const result = matchVideo(VIDEO_ENTRIES, {
            conversationHistory: [
                { role: 'user', text: 'je suis fatigue et surbookee, je manque de temps et energie' }
            ]
        });
        assert.ok(result);
        assert.strictEqual(result.video_url, 'https://youtu.be/temps');
    });

    test('should filter by applicableContext post_booking', () => {
        const result = matchVideo(VIDEO_ENTRIES, {
            conversationHistory: [
                { role: 'user', text: 'je galere avec la vente et la conversion' }
            ],
            applicableContext: 'post_booking'
        });
        // vente entry is funnel_alternative only, should not match for post_booking
        assert.ok(!result || result.video_url !== 'https://youtu.be/vente');
    });

    test('should filter by applicableContext funnel_alternative', () => {
        const result = matchVideo(VIDEO_ENTRIES, {
            conversationHistory: [
                { role: 'user', text: 'je suis epuisee, plus de temps' }
            ],
            applicableContext: 'funnel_alternative'
        });
        // temps entry is post_booking only, should not match
        assert.ok(!result || result.video_url !== 'https://youtu.be/temps');
    });

    test('should match entries with applicable_steps=both for any context', () => {
        const result = matchVideo(VIDEO_ENTRIES, {
            conversationHistory: [
                { role: 'user', text: 'mon positionnement est pas clair' }
            ],
            applicableContext: 'funnel_alternative'
        });
        assert.ok(result);
        assert.strictEqual(result.video_url, 'https://youtu.be/positionnement');
    });

    test('should use leadContext pain_points for matching', () => {
        const result = matchVideo(VIDEO_ENTRIES, {
            conversationHistory: [
                { role: 'user', text: 'bonjour' }
            ],
            leadContext: {
                pain_points: ['acquisition de clients', 'pas de clients']
            }
        });
        assert.ok(result);
        assert.strictEqual(result.video_url, 'https://youtu.be/clients');
    });

    test('should only consider user messages, not assistant', () => {
        const result = matchVideo(VIDEO_ENTRIES, {
            conversationHistory: [
                { role: 'assistant', text: 'tu as des problemes de vente et conversion ?' },
                { role: 'user', text: 'non ca va' }
            ]
        });
        // Only user text is searched, no keywords should match strongly
        assert.strictEqual(result, null);
    });

    test('should return best match when multiple entries match', () => {
        const result = matchVideo(VIDEO_ENTRIES, {
            conversationHistory: [
                { role: 'user', text: 'je veux trouver des clients mais aussi mieux vendre' }
            ]
        });
        assert.ok(result);
        // clients entry has "clients" keyword match, vente has "vendre" — both score 1
        // Either is acceptable, just verify we get a result
        assert.ok(result.video_url);
    });

    test('should return null when no applicableContext matches', () => {
        const onlyPostBooking = [VIDEO_ENTRIES[2]]; // temps — post_booking only
        const result = matchVideo(onlyPostBooking, {
            conversationHistory: [
                { role: 'user', text: 'je suis epuisee' }
            ],
            applicableContext: 'funnel_alternative'
        });
        assert.strictEqual(result, null);
    });

    test('should handle triggerKeywords array format', () => {
        const entries = [{
            category: 'video_resource',
            triggerKeywords: ['vente', 'closing', 'conversion'],
            content: 'Video vente',
            applicable_steps: 'both',
            video_url: 'https://youtu.be/vente-array'
        }];
        const result = matchVideo(entries, {
            conversationHistory: [
                { role: 'user', text: 'je dois ameliorer ma conversion' }
            ]
        });
        assert.ok(result);
        assert.strictEqual(result.video_url, 'https://youtu.be/vente-array');
    });

    test('should return null with no applicable context and no keyword match', () => {
        const result = matchVideo(VIDEO_ENTRIES, {
            conversationHistory: [
                { role: 'user', text: 'bonjour comment vas tu' }
            ]
        });
        assert.strictEqual(result, null);
    });
});
