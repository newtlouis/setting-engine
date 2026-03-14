/**
 * VideoMatcher — Matches conversation context to relevant video resources
 *
 * Stateless domain service that finds the best video resource
 * based on keyword matching against conversation history and lead context.
 */

/**
 * Scores a video entry against conversation text using trigger keywords
 *
 * @param {Object} videoEntry - Knowledge base entry with category 'video_resource'
 * @param {string} conversationText - Combined conversation text to match against
 * @returns {number} Match score (0 = no match)
 */
function scoreMatch(videoEntry, conversationText) {
    const keywords = Array.isArray(videoEntry.triggerKeywords)
        ? videoEntry.triggerKeywords
        : (videoEntry.trigger_keywords || '').split(',').map(k => k.trim()).filter(Boolean);

    if (keywords.length === 0) return 0;

    const lowerText = conversationText.toLowerCase();
    let matchCount = 0;

    for (const keyword of keywords) {
        if (lowerText.includes(keyword.toLowerCase())) {
            matchCount++;
        }
    }

    return matchCount;
}

/**
 * Finds the best matching video resource for a conversation context
 *
 * @param {Array<Object>} videoEntries - Knowledge base entries with category 'video_resource'
 * @param {Object} params
 * @param {Array<Object>} params.conversationHistory - Array of {role, text} messages
 * @param {Object} [params.leadContext] - Lead data (pain_points, notes, bio)
 * @param {string} [params.applicableContext] - Filter by context: 'post_booking', 'funnel_alternative', or null for any
 * @returns {Object|null} Best matching video entry, or null if no match
 */
export function matchVideo(videoEntries, { conversationHistory = [], leadContext = {}, applicableContext = null } = {}) {
    if (!videoEntries || videoEntries.length === 0) return null;

    // Filter by applicable context if specified
    let candidates = videoEntries;
    if (applicableContext) {
        candidates = videoEntries.filter(entry => {
            const steps = entry.applicable_steps || entry.applicableSteps || '';
            return steps.includes(applicableContext) || steps.includes('both');
        });
    }

    if (candidates.length === 0) return null;

    // Build searchable text from conversation + lead context
    const conversationText = conversationHistory
        .filter(msg => msg.role === 'user')
        .map(msg => msg.text)
        .join(' ');

    const painPoints = Array.isArray(leadContext.pain_points)
        ? leadContext.pain_points.join(' ')
        : (leadContext.pain_points || '');

    const searchText = [conversationText, painPoints, leadContext.notes || ''].join(' ');

    if (!searchText.trim()) return null;

    // Score each candidate and return the best match
    let bestMatch = null;
    let bestScore = 0;

    for (const entry of candidates) {
        const score = scoreMatch(entry, searchText);
        if (score > bestScore) {
            bestScore = score;
            bestMatch = entry;
        }
    }

    return bestMatch;
}
