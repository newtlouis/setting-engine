/**
 * Leads Database Module
 *
 * Handles all lead-related database operations.
 */

import { getDb } from './core.js';

/**
 * Internal helper to upsert a singleton lead
 */
export function upsertLead(lead) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO leads (username, profile_url, lead_source, lead_type, account_id, funnel_step, updated_at)
    VALUES (@username, @profile_url, @lead_source, @lead_type, @account_id, @funnel_step, datetime('now'))
    ON CONFLICT(username, account_id) DO UPDATE SET
      updated_at = datetime('now'),
      lead_source = COALESCE(NULLIF(NULLIF(lead_source, ''), 'unknown'), @lead_source),
      funnel_step = COALESCE(NULLIF(@funnel_step, 0), funnel_step)
    RETURNING *
  `);

  return stmt.get({
    username: lead.username,
    profile_url: lead.profile_url || `https://instagram.com/${lead.username}`,
    lead_source: lead.lead_source || null,
    lead_type: lead.lead_type || 'cold',
    account_id: lead.account_id || null,
    funnel_step: lead.funnel_step || lead.conversation_step || 0
  });
}

/**
 * Insert or update a lead
 *
 * @param {Object} lead - Lead data
 * @returns {Object} Inserted/updated lead with id
 */
export function saveLeads(leadsData) {
  const db = getDb();
  // Prepare bulk insert statement
  const insert = db.prepare(`
    INSERT INTO leads (
      username, profile_url, lead_source, lead_type, account_id, funnel_step, updated_at
    ) VALUES (
      @username, @profile_url, @lead_source, @lead_type, @account_id, @funnel_step, datetime('now')
    )
    ON CONFLICT(username, account_id) DO UPDATE SET
      updated_at = datetime('now')
  `); // Minimal update now since we don't have scraped profile data columns

  const insertComment = db.prepare(`
    INSERT INTO comments (
      lead_id, post_url, comment_text, posted_at, is_owner, is_spam
    ) VALUES (
      @lead_id, @post_url, @comment_text, @posted_at, @is_owner, @is_spam
    )
  `);

  const updateLeadStats = db.prepare(`
    UPDATE leads SET
      total_comments = (SELECT COUNT(*) FROM comments WHERE lead_id = leads.id AND is_spam = 0),
      warmth = CASE
        WHEN (SELECT COUNT(*) FROM comments WHERE lead_id = leads.id AND is_spam = 0) >= 3 THEN 'hot'
        WHEN (SELECT COUNT(*) FROM comments WHERE lead_id = leads.id AND is_spam = 0) >= 1 THEN 'warm'
        ELSE 'cold'
      END,
      updated_at = datetime('now')
    WHERE id = ?
  `);

  const insertTransaction = db.transaction((leads) => {
    let newLeads = 0;

    for (const lead of leads) {
      if (!lead.username) continue; // Skip invalid

      try {
        // Insert/Update Lead
        insert.run({
          username: lead.username,
          profile_url: lead.profileUrl || `https://instagram.com/${lead.username}`,
          lead_source: lead.source || null, // Allow passing source
          lead_type: lead.type || 'cold',    // Default to cold
          account_id: lead.account_id || null,
          funnel_step: lead.funnel_step || lead.conversation_step || 0
        });

        // Get lead ID
        const leadId = db.prepare('SELECT id FROM leads WHERE username = ? AND account_id = ?').get(lead.username, lead.account_id || null).id;

        // Insert Comment
        if (lead.comment) {
             insertComment.run({
                lead_id: leadId,
                post_url: lead.postUrl,
                comment_text: lead.comment,
                posted_at: lead.postedAt || new Date().toISOString(),
                is_owner: 0,
                is_spam: 0
             });
        }

        // Update Stats
        updateLeadStats.run(leadId);

        newLeads++;
      } catch (err) {
        console.error(`Error saving lead ${lead.username}: ${err.message}`);
      }
    }
    return newLeads;
  });

  return insertTransaction(leadsData);
}

/**
 * Get a lead by username
 */
export function getLeadByUsername(username, account_id = null) {
  const db = getDb();
  let query = 'SELECT * FROM leads WHERE username = ?';
  const params = [username];

  if (account_id) {
    query += ' AND account_id = ?';
    params.push(account_id);
  }

  return db.prepare(query).get(...params);
}

/**
 * Get a lead by ID
 */
export function getLeadById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
}

/**
 * Get all leads with optional filters
 */
export function getLeads(filters = {}) {
  const db = getDb();
  let query = 'SELECT * FROM leads WHERE 1=1';
  const params = {};

  // Account filter (REQUIRED for multi-account)
  if (filters.account_id) {
    query += ' AND account_id = @account_id';
    params.account_id = filters.account_id;
  }

  if (filters.status) {
    query += ' AND status = @status';
    params.status = filters.status;
  }

  if (filters.warmth) {
    query += ' AND warmth = @warmth';
    params.warmth = filters.warmth;
  }

  if (filters.min_engagement_score) {
    query += ' AND engagement_score >= @min_engagement_score';
    params.min_engagement_score = filters.min_engagement_score;
  }

  // Exclude ignored by default (unless explicitly requested)
  if (filters.include_ignored !== true) {
    query += ' AND is_ignored = 0';
  }

  query += ' ORDER BY engagement_score DESC, updated_at DESC';

  if (filters.limit) {
    query += ' LIMIT @limit';
    params.limit = filters.limit;
  }

  return db.prepare(query).all(params);
}

/**
 * Update lead engagement metrics
 */
export function updateLeadEngagement(username, metrics) {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE leads SET
      total_comments = @total_comments,
      engagement_score = @engagement_score,
      updated_at = datetime('now')
    WHERE username = @username
  `);

  return stmt.run({
    username,
    total_comments: metrics.total_comments,
    engagement_score: metrics.engagement_score
  });
}

/**
 * Update lead status
 */
export function updateLeadStatus(username, status) {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE leads SET
      status = @status,
      updated_at = datetime('now')
    WHERE username = @username
  `);

  return stmt.run({ username, status });
}

/**
 * Update lead profile data
 */
export function updateLeadProfile(username, profileData) {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE leads SET
      full_name = COALESCE(@full_name, full_name),
      bio = COALESCE(@bio, bio),
      updated_at = datetime('now')
    WHERE username = @username
  `);

  return stmt.run({
    username,
    full_name: profileData.full_name || null,
    bio: profileData.bio || null
  });
}

/**
 * Mark a lead as generally uncontactable (e.g. no button)
 * Uses new simplified 'failed' status
 */
export function markLeadUncontactable(username) {
  const db = getDb();
  return db.prepare(`
    UPDATE leads SET
      status = 'failed',
      notes = COALESCE(notes || ' | ', '') || 'Not contactable (no DM button)',
      updated_at = datetime('now')
    WHERE username = ?
  `).run(username);
}

/**
 * Mark a lead as failed (technical error)
 * Uses new simplified 'failed' status
 */
export function markLeadFailed(username, reason) {
  const db = getDb();
  return db.prepare(`
    UPDATE leads SET
      status = 'failed',
      notes = ?,
      updated_at = datetime('now')
    WHERE username = ?
  `).run(reason || 'unknown_error', username);
}

/**
 * Update lead status with optional dm_url for Outreach
 */
export function updateLeadDmStatus(username, status, dmUrl = null) {
  const db = getDb();
  if (!username) {
    throw new Error('Username is required');
  }
  const stmt = db.prepare(`
    UPDATE leads SET
      status = COALESCE(@status, status),
      dm_url = COALESCE(@dm_url, dm_url),
      last_contact_at = datetime('now'),
      updated_at = datetime('now')
    WHERE username = @username
  `);
  return stmt.run({
    username,
    status: status || null,
    dm_url: dmUrl
  });
}

/**
 * Higher-level update for DM Responder
 * Supports status, notes, booking_status and metadata
 */
export function updateDmThreadStatus(username, status, updates = {}) {
  const db = getDb();
  const notes = updates.last_error || updates.notes || null;
  const funnelStep = updates.funnel_step || updates.conversation_step;
  const bookingStatus = updates.booking_status;
  const bookingIntent = updates.booking_intent ? JSON.stringify(updates.booking_intent) : null;
  const bookingUrl = updates.booking_url || null;
  const bookingAttempts = updates.booking_attempts;

  const stmt = db.prepare(`
    UPDATE leads SET
      status = @status,
      notes = COALESCE(@notes, notes),
      funnel_step = COALESCE(@funnel_step, funnel_step),
      booking_status = COALESCE(@booking_status, booking_status),
      booking_intent = COALESCE(@booking_intent, booking_intent),
      booking_url = COALESCE(@booking_url, booking_url),
      booking_attempts = COALESCE(@booking_attempts, booking_attempts),
      booking_confirmed_at = CASE
        WHEN @booking_status = 'confirmed' AND booking_confirmed_at IS NULL
        THEN datetime('now')
        ELSE booking_confirmed_at
      END,
      updated_at = datetime('now')
    WHERE username = @username
  `);

  return stmt.run({
    username,
    status,
    notes,
    funnel_step: funnelStep !== undefined ? Math.floor(funnelStep) : null,
    booking_status: bookingStatus || null,
    booking_intent: bookingIntent,
    booking_url: bookingUrl,
    booking_attempts: bookingAttempts !== undefined ? bookingAttempts : null
  });
}

/**
 * Full UPSERT for a lead with metadata
 */
export function fullUpsertLead(username, account_id, data = {}) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO leads (
      username, account_id, profile_url, status,
      full_name, bio, dm_url, lead_source, funnel_step, notes, updated_at
    ) VALUES (
      @username, @account_id, @profile_url, @status,
      @full_name, @bio, @dm_url, @lead_source, @funnel_step, @notes, datetime('now')
    )
    ON CONFLICT(username, account_id) DO UPDATE SET
      status = COALESCE(@status, status),
      full_name = COALESCE(@full_name, full_name),
      bio = COALESCE(@bio, bio),
      dm_url = COALESCE(@dm_url, dm_url),
      lead_source = COALESCE(lead_source, @lead_source),
      funnel_step = COALESCE(NULLIF(@funnel_step, 0), funnel_step),
      notes = COALESCE(@notes, notes),
      updated_at = datetime('now')
    RETURNING *
  `);

  return stmt.get({
    username,
    account_id,
    profile_url: data.profile_url || `https://www.instagram.com/${username}/`,
    status: data.status || 'new',
    full_name: data.full_name || null,
    bio: data.bio || null,
    dm_url: data.dm_url || null,
    lead_source: data.lead_source || null,
    funnel_step: data.funnel_step || data.conversation_step || 0,
    notes: data.notes || null
  });
}

/**
 * Get leads for DM Responder (replaces getDmThreads)
 * Filters by status and requires dm_url
 */
export function getLeadsForResponder(filters = {}) {
  const db = getDb();
  let query = `
    SELECT *
    FROM leads
    WHERE is_ignored = 0
  `;
  const params = [];

  // Account filter (REQUIRED for multi-account)
  const accountId = filters.account_id || filters.accountId;
  if (accountId) {
    query += ' AND account_id = ?';
    params.push(accountId);
  }

  if (filters.statuses && filters.statuses.length > 0) {
    const placeholders = filters.statuses.map(() => '?').join(',');
    query += ` AND status IN (${placeholders})`;
    params.push(...filters.statuses);
  }

  // Exclude booked leads (confirmed/completed)
  query += " AND (booking_status IS NULL OR booking_status NOT IN ('confirmed', 'completed'))";

  if (filters.onlyWithUrl) {
    query += " AND dm_url IS NOT NULL AND dm_url <> ''";
  }

  if (filters.username) {
    query += ' AND username = ?';
    params.push(filters.username);
  }

  query += ' ORDER BY updated_at DESC';

  if (filters.limit) {
    query += ' LIMIT ?';
    params.push(filters.limit);
  }

  return db.prepare(query).all(...params);
}
