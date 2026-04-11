/**
 * Outreach Config Loader
 *
 * Loads outreach configuration from database with config file fallback.
 * Consolidates: outreach templates, qualification prompt, CTA resources, prospector sources.
 */

import { getDb } from '../../agents/collector/src/db/core.js';

/**
 * Load outreach config from DB, fallback to config file
 *
 * @param {number} accountId - The account ID
 * @param {Object} profileConfig - The loaded config file (fallback)
 * @returns {Object} Unified outreach config
 */
export function loadOutreachConfig(accountId, profileConfig) {
    const db = getDb();

    // 1. Outreach templates
    const dbTemplates = db.prepare(
        'SELECT template_type, template_text FROM outreach_templates WHERE account_id = ? AND is_active = 1'
    ).all(accountId);

    const templateMap = {};
    for (const t of dbTemplates) templateMap[t.template_type] = t.template_text;

    // 2. Persona data from account_personas
    const persona = db.prepare(
        'SELECT qualification_prompt, niche, post_booking_message, prospect_mode_hashtag, prospect_mode_profile, prospect_message_a, prospect_message_b, bio_keywords, max_followers, female_only FROM account_personas WHERE account_id = ?'
    ).get(accountId);

    // 3. CTA resources
    const dbCta = db.prepare(
        'SELECT keyword, resource_url, message_addon, outreach_template FROM cta_resources WHERE account_id = ? AND is_active = 1'
    ).all(accountId);

    // 4. Prospector sources
    const dbSources = db.prepare(
        'SELECT source_value FROM prospector_sources WHERE account_id = ? AND is_active = 1 ORDER BY source_order'
    ).all(accountId);

    // Build CTA map (same structure as config file)
    const ctaFromDb = {};
    for (const r of dbCta) {
        ctaFromDb[r.keyword] = {
            url: r.resource_url,
            message_addon: r.message_addon,
            outreach_template: r.outreach_template
        };
    }

    return {
        followerTemplate: templateMap.follower || profileConfig?.outreach?.follower_template || null,
        likeTemplate: templateMap.like || profileConfig?.outreach?.like_outreach_template || null,
        commentTemplate: templateMap.comment || profileConfig?.outreach?.comment_outreach_template || null,
        qualificationPrompt: persona?.qualification_prompt || profileConfig?.outreach?.qualification_prompt || null,
        niche: persona?.niche || profileConfig?.niche || null,
        postBookingMessage: persona?.post_booking_message || profileConfig?.post_booking_message || null,
        ctaResources: dbCta.length > 0 ? ctaFromDb : (profileConfig?.outreach?.cta_resources || {}),
        prospectorSources: dbSources.length > 0
            ? dbSources.map(s => s.source_value)
            : (profileConfig?.prospector?.sources || []),
        prospectModeHashtag: persona?.prospect_mode_hashtag || 'comments',
        prospectModeProfile: persona?.prospect_mode_profile || 'comments',
        prospectMessageA: persona?.prospect_message_a || null,
        prospectMessageB: persona?.prospect_message_b || null,
        bioKeywords: persona?.bio_keywords ? persona.bio_keywords.split(',').map(k => k.trim().toLowerCase()) : null,
        maxFollowers: persona?.max_followers || null,
        femaleOnly: !!persona?.female_only
    };
}
