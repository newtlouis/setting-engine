import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { getContainer } from '../../shared/container.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from multiple locations
const possibleEnvPaths = [
    path.join(__dirname, '..', 'dmresponder', '.env'),
    path.join(__dirname, '..', '..', '.env'),
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), 'agents', 'dmresponder', '.env')
];

let envLoaded = false;
for (const envPath of possibleEnvPaths) {
    const result = dotenv.config({ path: envPath });
    if (!result.error) {
        console.log('✅ Loaded .env from:', envPath);
        if (process.env.OPENAI_API_KEY) {
            envLoaded = true;
            break;
        }
    }
}

if (!envLoaded) {
    console.warn('⚠️  Could not find a valid .env file with OPENAI_API_KEY');
}

const app = express();
const PORT = process.env.PORT || 3000;

// Path to shared database
const DB_PATH = path.join(__dirname, '..', 'collector', 'permanent-data', 'leads.db');

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Initialize container and get DB
let db;
let container;
try {
    container = await getContainer();
    db = container.getDb();
    console.log('✅ Connected to SQLite via container.');
} catch (err) {
    console.error('❌ Database initialization failed:', err.message);
}

// ============================================
// COMMAND LAUNCHER REGISTRY & PROCESS MAP
// ============================================

const COMMAND_REGISTRY = {
    Favoris: [
        { name: 'respond:inbox', description: 'Traiter inbox', options: ['--profile', '--all'] },
        { name: 'send-queued', description: 'Envoyer messages en attente', options: ['--limit', '--profile', '--manual'], defaults: '--limit 5 --manual' },
        { name: 'open:session', description: 'Ouvrir Instagram (session Chrome)', options: ['--profile'] },
        { name: 'analyze:steps', description: 'Analyse steps vs scripts funnel', options: ['--profile', '--username', '--save'] },
        { name: 'sync+analyze', description: 'Sync DMs puis analyse des conversations converties', options: ['--profile', '--max'], combo: ['dm-sync', 'analyze'] },
        { name: 'reply:followup', description: 'Relances', options: ['--profile', '--slow'] },
        { name: 'harvest', description: 'Recolter leads', options: ['--target', '--profile', '--prospect-mode'] },
        { name: 'test:e2e', description: 'Test E2E LLM (real API)', options: [] },
    ],
    Collection: [
        { name: 'scrape', description: 'Scrape profiles Instagram', options: ['--profile', '--max'] },
        { name: 'collect', description: 'Traiter et qualifier les leads', options: ['--profile'] },
        { name: 'dm-sync', description: 'Sync DMs Instagram vers DB', options: ['--profile', '--max', '--include-recent'] },
        { name: 'analyze', description: 'Analyser conversations converties', options: ['--profile', '--max'] },
        { name: 'analyze:steps', description: 'Analyse step-by-step vs scripts funnel', options: ['--profile', '--username', '--save'] },
    ],
    Prospecting: [
        { name: 'prospect', description: 'Prospection unifiee', options: ['--profile', '--source', '--mode', '--posts', '--total', '--skip-qualification'] },
    ],
    Outreach: [
        { name: 'send', description: 'Envoyer DMs d\'outreach', options: ['--profile', '--max'] },
        { name: 'send-queued', description: 'Envoyer messages en attente', options: ['--limit', '--profile', '--manual'], defaults: '--limit 5 --manual' },
    ],
    Responder: [
        { name: 'reply', description: 'Repondre a un lead', options: ['--profile'] },
        { name: 'reply:auto', description: 'Cycle auto de reponses', options: ['--profile'] },
        { name: 'reply:conversation', description: 'Repondre leads conversation', options: ['--profile'] },
        { name: 'reply:outreach', description: 'Repondre leads outreach', options: ['--profile'] },
        { name: 'reply:followup', description: 'Relances', options: ['--profile', '--slow'] },
        { name: 'respond:inbox', description: 'Traiter inbox', options: ['--profile', '--all'] },
        { name: 'respond:followers', description: 'Surveiller followers', options: ['--profile', '--track-week'] },
        { name: 'respond:engagement', description: 'Surveiller engagement', options: ['--profile'] },
    ],
    Operations: [
        { name: 'harvest', description: 'Recolter leads', options: ['--target', '--profile', '--prospect-mode'] },
        { name: 'backup', description: 'Backup base de donnees', options: ['--upload'] },
        { name: 'restore', description: 'Restaurer base de donnees', options: ['--remote'] },
    ],
};

// Map of processId -> { process, logs[], listeners[], exitCode, command, startedAt }
const runningProcesses = new Map();

// API Routes

// GET /api/accounts - List all accounts
app.get('/api/accounts', (req, res) => {
    try {
        const accounts = db.prepare('SELECT * FROM accounts ORDER BY name').all();
        res.json(accounts);
    } catch (err) {
        // Table might not exist yet
        res.json([{ id: null, name: 'Tous les comptes' }]);
    }
});

// GET /api/accounts/default - Get the default account
app.get('/api/accounts/default', (req, res) => {
    try {
        const defaultAccount = db.prepare('SELECT * FROM accounts WHERE is_default = 1').get();
        res.json(defaultAccount || null);
    } catch (err) {
        res.json(null);
    }
});

// POST /api/accounts/set-default - Set default account
app.post('/api/accounts/set-default', (req, res) => {
    try {
        const { account_id } = req.body;
        
        db.transaction(() => {
            db.prepare('UPDATE accounts SET is_default = 0').run();
            if (account_id) {
                db.prepare('UPDATE accounts SET is_default = 1 WHERE id = ?').run(account_id);
            }
        })();
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/stats
app.get('/api/stats', (req, res) => {
    try {
        const { account_id } = req.query;
        const accountFilter = account_id ? ' AND account_id = ?' : '';
        const accountParam = account_id ? [parseInt(account_id)] : [];
        
        const totalContacted = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE total_messages_sent > 0 AND is_ignored = 0 ${accountFilter}`).get(...accountParam).c;
        const replied = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE total_messages_sent > 0 AND total_messages_received > 0 AND is_ignored = 0 ${accountFilter}`).get(...accountParam).c;
        const booked = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE booking_status = 'completed' AND is_ignored = 0 ${accountFilter}`).get(...accountParam).c;
        const manual = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE status = 'manual' AND is_ignored = 0 ${accountFilter}`).get(...accountParam).c;
        const conversation = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE status IN ('conversation') AND (booking_status IS NULL OR booking_status = '') AND is_ignored = 0 ${accountFilter}`).get(...accountParam).c;

        const stats = {
            total_contacted: totalContacted,
            reply_rate: totalContacted > 0 ? ((replied / totalContacted) * 100).toFixed(1) : 0,
            conversation: conversation,
            manual: manual,
            booked: booked,
            booking_rate: totalContacted > 0 ? ((booked / totalContacted) * 100).toFixed(1) : 0,
            step_breakdown: {
                step1: db.prepare(`SELECT COUNT(*) as c FROM leads WHERE funnel_step = 1 AND is_ignored = 0 ${accountFilter}`).get(...accountParam).c,
                step2: db.prepare(`SELECT COUNT(*) as c FROM leads WHERE funnel_step = 2 AND is_ignored = 0 ${accountFilter}`).get(...accountParam).c,
                step3: db.prepare(`SELECT COUNT(*) as c FROM leads WHERE funnel_step = 3 AND is_ignored = 0 ${accountFilter}`).get(...accountParam).c,
                step4: db.prepare(`SELECT COUNT(*) as c FROM leads WHERE funnel_step = 4 AND is_ignored = 0 ${accountFilter}`).get(...accountParam).c,
                step5: db.prepare(`SELECT COUNT(*) as c FROM leads WHERE funnel_step = 5 AND is_ignored = 0 ${accountFilter}`).get(...accountParam).c
            }
        };
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/analytics/funnel - Comprehensive funnel analytics with drop-off
app.get('/api/analytics/funnel', (req, res) => {
    try {
        const { account_id } = req.query;
        const accountFilter = account_id ? ' AND account_id = ?' : '';
        const accountParam = account_id ? [parseInt(account_id)] : [];

        // Base counts
        const totalContacted = db.prepare(`
            SELECT COUNT(*) as c FROM leads
            WHERE total_messages_sent > 0 AND is_ignored = 0 ${accountFilter}
        `).get(...accountParam).c;

        const totalReplied = db.prepare(`
            SELECT COUNT(*) as c FROM leads
            WHERE total_messages_sent > 0 AND total_messages_received > 0 AND is_ignored = 0 ${accountFilter}
        `).get(...accountParam).c;

        // Step counts - cumulative (reached at least step N)
        // funnel_step is now the single source of truth (integer 1-9)
        const stepAtLeast = {};
        for (let i = 2; i <= 5; i++) {
            stepAtLeast[i] = db.prepare(`
                SELECT COUNT(*) as c FROM leads
                WHERE funnel_step >= ? AND is_ignored = 0 AND total_messages_received > 0 ${accountFilter}
            `).get(i, ...accountParam).c;
        }
        // Step 2+ = everyone who replied (since step 1 doesn't exist in practice)
        stepAtLeast[2] = totalReplied;

        // Terminal states
        const booked = db.prepare(`
            SELECT COUNT(*) as c FROM leads
            WHERE booking_status = 'completed' AND is_ignored = 0 ${accountFilter}
        `).get(...accountParam).c;

        const notInterested = db.prepare(`
            SELECT COUNT(*) as c FROM leads
            WHERE status = 'not_interested' AND is_ignored = 0 ${accountFilter}
        `).get(...accountParam).c;

        const failed = db.prepare(`
            SELECT COUNT(*) as c FROM leads
            WHERE status IN ('failed', 'failed_outreach') AND is_ignored = 0 ${accountFilter}
        `).get(...accountParam).c;

        // Calculate drop-off rates through the funnel
        // Each step shows: how many reached this point, and what % dropped off before next step
        const funnel = [
            {
                step: 0,
                label: 'Contactés',
                reached: totalContacted,
                dropoff: null,
                lostCount: totalContacted - totalReplied
            },
            {
                step: 1,
                label: 'Ont répondu',
                reached: totalReplied,
                dropoff: totalContacted > 0 ? ((totalContacted - totalReplied) / totalContacted * 100).toFixed(1) : 0,
                lostCount: totalReplied - stepAtLeast[3]
            },
            {
                step: 3,
                label: 'Exploration (Step 3+)',
                reached: stepAtLeast[3],
                dropoff: totalReplied > 0 ? ((totalReplied - stepAtLeast[3]) / totalReplied * 100).toFixed(1) : 0,
                lostCount: stepAtLeast[3] - stepAtLeast[4]
            },
            {
                step: 4,
                label: 'Objectif (Step 4+)',
                reached: stepAtLeast[4],
                dropoff: stepAtLeast[3] > 0 ? ((stepAtLeast[3] - stepAtLeast[4]) / stepAtLeast[3] * 100).toFixed(1) : 0,
                lostCount: stepAtLeast[4] - stepAtLeast[5]
            },
            {
                step: 5,
                label: 'Appel (Step 5)',
                reached: stepAtLeast[5],
                dropoff: stepAtLeast[4] > 0 ? ((stepAtLeast[4] - stepAtLeast[5]) / stepAtLeast[4] * 100).toFixed(1) : 0,
                lostCount: stepAtLeast[5] - booked
            },
            {
                step: 6,
                label: 'RDV Confirmé',
                reached: booked,
                dropoff: stepAtLeast[5] > 0 ? ((stepAtLeast[5] - booked) / stepAtLeast[5] * 100).toFixed(1) : 0,
                lostCount: 0
            }
        ];

        // Conversion rates
        const replyRate = totalContacted > 0 ? (totalReplied / totalContacted * 100).toFixed(1) : 0;
        const bookingRate = totalContacted > 0 ? (booked / totalContacted * 100).toFixed(1) : 0;
        const bookingFromReplies = totalReplied > 0 ? (booked / totalReplied * 100).toFixed(1) : 0;

        // Source performance - resolve hashtags and profiles from posts table
        const sourceStats = db.prepare(`
            SELECT
                COALESCE(
                    CASE
                        WHEN p.source_type = 'hashtag' THEN '#' || p.source_name
                        WHEN p.source_type = 'profile' THEN '@' || p.source_name
                        ELSE NULL
                    END,
                    CASE
                        WHEN l.lead_source LIKE 'hashtag:%' THEN '#' || SUBSTR(l.lead_source, 9)
                        WHEN l.lead_source = 'post_like' THEN 'post_like'
                        WHEN l.lead_source = 'post_comment' THEN 'post_comment'
                        WHEN l.lead_source LIKE 'follower%' OR l.lead_source LIKE 'new_follower%' THEN 'follower'
                        WHEN l.lead_source LIKE 'https://www.instagram.com/%' THEN 'autre_post'
                        ELSE COALESCE(l.lead_source, 'unknown')
                    END
                ) as source_group,
                COUNT(*) as total,
                SUM(CASE WHEN l.total_messages_received > 0 THEN 1 ELSE 0 END) as replied,
                SUM(CASE WHEN l.booking_status = 'completed' THEN 1 ELSE 0 END) as booked
            FROM leads l
            LEFT JOIN posts p ON l.lead_source = p.post_url
            WHERE l.total_messages_sent > 0 AND l.is_ignored = 0 ${accountFilter.replace(/account_id/g, 'l.account_id')}
            GROUP BY source_group
            ORDER BY total DESC
            LIMIT 20
        `).all(...accountParam).map(row => ({
            source: row.source_group || 'Unknown',
            total: row.total,
            replied: row.replied,
            booked: row.booked,
            replyRate: row.total > 0 ? (row.replied / row.total * 100).toFixed(1) : 0,
            bookingRate: row.total > 0 ? (row.booked / row.total * 100).toFixed(1) : 0
        }));

        // Identify biggest drop-off point
        let biggestDropoff = { step: null, rate: 0, label: '' };
        funnel.forEach((f, idx) => {
            if (f.dropoff && parseFloat(f.dropoff) > biggestDropoff.rate) {
                biggestDropoff = { step: f.step, rate: parseFloat(f.dropoff), label: f.label };
            }
        });

        // Step distribution (exact count at each step for the mini-cards)
        const stepDistribution = db.prepare(`
            SELECT
                funnel_step as step,
                COUNT(*) as count
            FROM leads
            WHERE is_ignored = 0 AND total_messages_received > 0 ${accountFilter}
            GROUP BY funnel_step
            ORDER BY step
        `).all(...accountParam);

        res.json({
            summary: {
                totalContacted,
                totalReplied,
                booked,
                notInterested,
                failed,
                replyRate,
                bookingRate,
                bookingFromReplies
            },
            funnel,
            stepDistribution,
            sourceStats,
            insights: {
                biggestDropoff,
                recommendation: biggestDropoff.rate > 30
                    ? `Attention: ${biggestDropoff.rate}% drop-off à "${biggestDropoff.label}". Revoir le script de cette étape.`
                    : null
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/analytics/today - Today's performance by source category
app.get('/api/analytics/today', (req, res) => {
    try {
        const { account_id } = req.query;
        const accountFilter = account_id ? ' AND l.account_id = ?' : '';
        const accountParam = account_id ? [parseInt(account_id)] : [];

        const rows = db.prepare(`
            SELECT
                CASE
                    WHEN l.lead_source LIKE 'follower%' OR l.lead_source = 'new_follower' THEN 'Followers'
                    WHEN l.lead_source = 'post_like' THEN 'Likes'
                    WHEN l.lead_source = 'post_comment' THEN 'Comments'
                    WHEN l.lead_source LIKE 'hashtag:%' THEN '#' || SUBSTR(l.lead_source, 9)
                    WHEN l.lead_source LIKE '#%' THEN l.lead_source
                    WHEN l.lead_source LIKE 'profile:%' THEN '@' || REPLACE(REPLACE(REPLACE(l.lead_source, 'profile:', ''), 'https://www.instagram.com/', ''), '/', '')
                    WHEN l.lead_source LIKE '@%' THEN l.lead_source
                    WHEN l.lead_source LIKE 'https://www.instagram.com/%' THEN 'Post likers'
                    ELSE COALESCE(l.lead_source, 'Autre')
                END as source_category,
                COUNT(*) as total,
                SUM(CASE WHEN l.total_messages_received > 0 THEN 1 ELSE 0 END) as replied,
                SUM(CASE WHEN l.status = 'not_interested' THEN 1 ELSE 0 END) as not_interested,
                SUM(CASE WHEN l.booking_status IN ('completed','confirmed') THEN 1 ELSE 0 END) as booked,
                SUM(CASE WHEN l.funnel_step <= 1 THEN 1 ELSE 0 END) as step_1,
                SUM(CASE WHEN l.funnel_step = 2 THEN 1 ELSE 0 END) as step_2,
                SUM(CASE WHEN l.funnel_step = 3 THEN 1 ELSE 0 END) as step_3,
                SUM(CASE WHEN l.funnel_step = 4 THEN 1 ELSE 0 END) as step_4,
                SUM(CASE WHEN l.funnel_step >= 5 THEN 1 ELSE 0 END) as step_5_plus
            FROM leads l
            INNER JOIN (
                SELECT lead_id, DATE(MIN(sent_at)) as first_contact_day
                FROM conversations
                WHERE role = 'assistant'
                GROUP BY lead_id
            ) fc ON fc.lead_id = l.id
            WHERE l.is_ignored = 0
              AND fc.first_contact_day = DATE('now')
              ${accountFilter}
            GROUP BY source_category
            ORDER BY total DESC
        `).all(...accountParam);

        // Total row
        const totals = {
            source_category: 'Total',
            total: 0, replied: 0, not_interested: 0, booked: 0,
            step_1: 0, step_2: 0, step_3: 0, step_4: 0, step_5_plus: 0
        };
        for (const r of rows) {
            for (const k of Object.keys(totals)) {
                if (k !== 'source_category') totals[k] += r[k];
            }
        }

        res.json({ rows, totals });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/analytics/velocity - Velocity metrics over time
app.get('/api/analytics/velocity', (req, res) => {
    try {
        const { account_id, days = 30 } = req.query;
        const accountFilter = account_id ? ' AND l.account_id = ?' : '';
        const accountParam = account_id ? [parseInt(account_id)] : [];
        const daysInt = parseInt(days);

        // Daily stats: "contacted" = date of FIRST message sent to each lead
        const daily = db.prepare(`
            SELECT first_contact_day as date,
                COUNT(*) as contacted,
                SUM(CASE WHEN l.status = 'not_interested' THEN 1 ELSE 0 END) as not_interested,
                SUM(CASE WHEN l.booking_status = 'completed' THEN 1 ELSE 0 END) as booked
            FROM (
                SELECT c.lead_id, DATE(MIN(c.sent_at)) as first_contact_day
                FROM conversations c
                WHERE c.role = 'assistant'
                GROUP BY c.lead_id
            ) fc
            JOIN leads l ON l.id = fc.lead_id
            WHERE l.is_ignored = 0
              AND first_contact_day >= DATE('now', '-' || ? || ' days')
              ${accountFilter}
            GROUP BY first_contact_day
            ORDER BY date ASC
        `).all(daysInt, ...accountParam);

        // Replied per day: distinct leads with a user message on that day
        const repliedDaily = db.prepare(`
            SELECT
                DATE(c.sent_at) as date,
                COUNT(DISTINCT c.lead_id) as replied
            FROM conversations c
            JOIN leads l ON c.lead_id = l.id
            WHERE c.role = 'user'
              AND l.is_ignored = 0
              AND c.sent_at >= DATE('now', '-' || ? || ' days')
              ${accountFilter}
            GROUP BY DATE(c.sent_at)
            ORDER BY date ASC
        `).all(daysInt, ...accountParam);

        // Merge replied into daily
        const repliedMap = {};
        repliedDaily.forEach(r => { repliedMap[r.date] = r.replied; });
        daily.forEach(d => { d.replied = repliedMap[d.date] || 0; });

        // By source (reuse funnel source resolution logic)
        const bySource = db.prepare(`
            SELECT
                COALESCE(
                    CASE
                        WHEN p.source_type = 'hashtag' THEN '#' || p.source_name
                        WHEN p.source_type = 'profile' THEN '@' || p.source_name
                        ELSE NULL
                    END,
                    CASE
                        WHEN l.lead_source LIKE 'hashtag:%' THEN '#' || SUBSTR(l.lead_source, 9)
                        WHEN l.lead_source = 'post_like' THEN 'post_like'
                        WHEN l.lead_source = 'post_comment' THEN 'post_comment'
                        WHEN l.lead_source LIKE 'follower%' OR l.lead_source LIKE 'new_follower%' THEN 'follower'
                        WHEN l.lead_source LIKE 'https://www.instagram.com/%' THEN 'autre_post'
                        ELSE COALESCE(l.lead_source, 'unknown')
                    END
                ) as source_group,
                COUNT(*) as contacted,
                SUM(CASE WHEN l.total_messages_received > 0 THEN 1 ELSE 0 END) as replied,
                SUM(CASE WHEN l.booking_status = 'completed' THEN 1 ELSE 0 END) as booked
            FROM leads l
            LEFT JOIN posts p ON l.lead_source = p.post_url
            WHERE l.total_messages_sent > 0 AND l.is_ignored = 0
              AND l.created_at >= DATE('now', '-' || ? || ' days')
              ${accountFilter.replace(/l\.account_id/g, 'l.account_id')}
            GROUP BY source_group
            ORDER BY contacted DESC
            LIMIT 20
        `).all(daysInt, ...accountParam);

        // By step
        const byStep = db.prepare(`
            SELECT funnel_step as step, COUNT(*) as count
            FROM leads
            WHERE is_ignored = 0
              AND status NOT IN ('failed', 'disqualified', 'uncontactable')
              AND total_messages_sent > 0
              ${accountFilter.replace(/l\./g, '')}
            GROUP BY funnel_step
            ORDER BY step
        `).all(...accountParam);

        res.json({ daily, bySource, byStep });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/leads
app.get('/api/leads', (req, res) => {
    try {
        const { page = 1, limit = 50, status, search, account_id, funnel_step, conversation_step } = req.query;
        const offset = (page - 1) * limit;

        // Build dynamic query
        let sql = `
            SELECT id, username, full_name,
                   engagement_score,
                   status, warmth, booking_status,
                   lead_source, lead_type, bio, account_id, funnel_step,
                   is_ignored, updated_at,
                   (SELECT COUNT(*) FROM comments WHERE lead_id = leads.id) as comment_count
            FROM leads
            WHERE 1=1
        `;
        const params = [];

        // If NOT searching, exclude ignored by default
        if (!search) {
            sql += ' AND is_ignored = 0';
        }

        // Account filter
        if (account_id) {
            sql += ' AND account_id = ?';
            params.push(parseInt(account_id));
        }

        // Step filter (accept both funnel_step and conversation_step for backward compat)
        const stepFilter = funnel_step || conversation_step;
        if (stepFilter) {
            sql += ' AND funnel_step = ?';
            params.push(parseInt(stepFilter));
        }

        if (status && status !== 'all') {
            if (status === 'contacted_total') {
                sql += " AND total_messages_sent > 0";
            } else if (status === 'conversation') {
                sql += " AND status IN ('conversation', 'replied') AND (booking_status IS NULL OR booking_status NOT IN ('completed', 'confirmed'))";
            } else if (status === 'confirm_bookings') {
                sql += " AND booking_status = 'pending'";
            } else if (status === 'booked') {
                 sql += " AND booking_status IN ('completed', 'confirmed')";
            } else if (status === 'manual') {
                 sql += " AND status = 'manual'";
            } else if (status === 'not_interested') {
                 sql += " AND status = 'not_interested'";
            } else if (status === 'failed') {
                 sql += " AND status = 'failed'";
            } else {
                sql += " AND status = ?";
                params.push(status);
            }
        }
        
        if (search) {
             sql += " AND (username LIKE ? OR full_name LIKE ?)";
             params.push(`%${search}%`, `%${search}%`);
        }

        sql += ` ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(offset));

        const leads = db.prepare(sql).all(...params);
        res.json(leads);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/leads/bulk-update
app.post('/api/leads/bulk-update', (req, res) => {
    try {
        const { usernames, updates } = req.body;
        
        if (!Array.isArray(usernames) || usernames.length === 0) {
            return res.status(400).json({ error: 'usernames must be a non-empty array' });
        }

        const allowedFields = ['status', 'warmth', 'booking_status', 'is_ignored'];
        const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
        
        if (fields.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        const setClause = fields.map(field => `${field} = ?`).join(', ');
        const values = fields.map(field => updates[field]);
        const sql = `UPDATE leads SET ${setClause}, updated_at = datetime('now') WHERE username = ?`;
        
        const updateStmt = db.prepare(sql);
        
        // Use a transaction for efficiency
        const transaction = db.transaction((users) => {
            for (const user of users) {
                updateStmt.run(...values, user);
            }
        });
        
        transaction(usernames);
        
        res.json({ success: true, count: usernames.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/leads - Create new manual lead
app.post('/api/leads', (req, res) => {
    try {
        const { username, profile_url, status, account_id } = req.body;
        
        if (!username || !profile_url) {
            return res.status(400).json({ error: 'Username and Profile URL are required' });
        }

        // Check if exists
        const existing = db.prepare('SELECT id FROM leads WHERE username = ?').get(username);
        if (existing) {
            return res.status(409).json({ error: 'Lead already exists' });
        }

        const stmt = db.prepare(`
            INSERT INTO leads (username, profile_url, status, account_id, lead_source, lead_type, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'manual', 'cold', datetime('now'), datetime('now'))
        `);
        
        const info = stmt.run(username, profile_url, status || 'new', account_id || null);
        
        res.json({ success: true, id: info.lastInsertRowid, username });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/leads/:username
app.patch('/api/leads/:username', (req, res) => {
    try {
        const { username } = req.params;
        const updates = req.body;
        
        // Allowed fields to update
        const allowedFields = ['status', 'warmth', 'notes', 'email', 'booking_status', 'is_ignored', 'full_name', 'funnel_step', 'conversation_step'];
        const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
        
        if (fields.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        const setClause = fields.map(field => `${field} = ?`).join(', ');
        const values = fields.map(field => updates[field]);
        
        // Add updated_at
        const sql = `UPDATE leads SET ${setClause}, updated_at = datetime('now') WHERE username = ?`;
        
        db.prepare(sql).run(...values, username);
        
        res.json({ success: true, username, updates });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/leads/:username/details
app.get('/api/leads/:username/details', (req, res) => {
    try {
        const { username } = req.params;
        
        // 1. Get Lead Basic Info
        const lead = db.prepare(`
            SELECT * FROM leads WHERE username = ?
        `).get(username);
        
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }
        
        // 2. Get Comments (context)
        const comments = db.prepare(`
            SELECT * FROM comments WHERE lead_id = ? ORDER BY comment_date ASC
        `).all(lead.id);

        // 3. Get Conversation History
        const messages = db.prepare(`
            SELECT * FROM conversations WHERE lead_id = ? ORDER BY sent_at ASC
        `).all(lead.id);
        
        res.json({
            lead: lead,
            comments: comments,
            messages: messages
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/bookings
app.get('/api/bookings', (req, res) => {
    try {
        // Fetch leads with a non-null booking_status
        const leads = db.prepare(`
            SELECT id, username, profile_url, booking_status, updated_at
            FROM leads 
            WHERE booking_status IS NOT NULL AND is_ignored = 0
            ORDER BY updated_at DESC
        `).all();
        res.json(leads);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/bookings/:username/complete
app.patch('/api/bookings/:username/complete', (req, res) => {
    try {
        const { username } = req.params;
        const { completed } = req.body; // boolean
        
        const newStatus = completed ? 'completed' : 'pending';
        
        db.prepare("UPDATE leads SET booking_status = ?, updated_at = datetime('now') WHERE username = ?")
          .run(newStatus, username);
        
        res.json({ success: true, username, booking_status: newStatus });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/leads/:username/status (Legacy support)
app.post('/api/leads/:username/status', (req, res) => {
    try {
        const { username } = req.params;
        const { status, stage } = req.body;
        
        if (status) {
            db.prepare('UPDATE leads SET status = ?, updated_at = datetime("now") WHERE username = ?')
              .run(status, username);
        }
        if (stage) {
             const warmth = (stage === 'qualified') ? 'hot' : 'cold';
             db.prepare('UPDATE leads SET warmth = ?, updated_at = datetime("now") WHERE username = ?')
              .run(warmth, username);
        }
        res.json({ success: true, username });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/leads/:username/requeue - Force add to outreach queue
app.post('/api/leads/:username/requeue', async (req, res) => {
    try {
        const { username } = req.params;

        // 1. Get lead data
        const lead = db.prepare('SELECT * FROM leads WHERE username = ?').get(username);
        if (!lead) return res.status(404).json({ error: 'Lead not found' });

        // 2. Prepare queue item (camelCase for repository)
        const queueItem = {
            username: lead.username,
            profileUrl: lead.profile_url,
            dmUrl: lead.dm_url,
            preparedMessage: "Message manuel à rédiger...", // Default placeholder
            firstName: lead.full_name ? lead.full_name.split(' ')[0] : null,
            source: 'manual_requeue'
        };

        // 3. Add to queue via repository
        await container.repositories.outreachQueue.add(queueItem);

        // 4. Update main lead status
        db.prepare("UPDATE leads SET status = 'queued', is_ignored = 0, booking_status = NULL, updated_at = datetime('now') WHERE username = ?")
          .run(username);

        res.json({ success: true, message: `Lead @${username} re-queued successfully` });
    } catch (err) {
        console.error('Requeue error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// FUNNEL STAGES & TEMPLATES API
// ============================================

// GET /api/funnel-stages - List stages for an account
app.get('/api/funnel-stages', async (req, res) => {
    try {
        const { account_id } = req.query;

        if (!account_id) {
            return res.status(400).json({ error: 'account_id is required' });
        }

        const stages = await container.repositories.funnel.getStagesForAccount(parseInt(account_id));
        res.json(stages.map(s => s.toJSON()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/funnel-stages - Create a new stage
app.post('/api/funnel-stages', async (req, res) => {
    try {
        const { account_id, stage_order, stage_name, stage_label, description, max_followups, followup_delay_hours, auto_ignore_after_max } = req.body;

        if (!account_id || !stage_order || !stage_name || !stage_label) {
            return res.status(400).json({ error: 'account_id, stage_order, stage_name, and stage_label are required' });
        }

        const { FunnelStage } = await import('../../shared/domain/entities/FunnelStage.js');

        const stage = FunnelStage.create(
            parseInt(account_id),
            parseInt(stage_order),
            stage_name,
            stage_label,
            {
                description,
                maxFollowups: max_followups || 0,
                followupDelayHours: followup_delay_hours || 24,
                autoIgnoreAfterMax: auto_ignore_after_max || false
            }
        );

        const saved = await container.repositories.funnel.saveStage(stage);
        res.json(saved.toJSON());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/funnel-stages/:id - Update a stage
app.patch('/api/funnel-stages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Get existing stage first
        const existing = db.prepare('SELECT * FROM funnel_stages WHERE id = ?').get(parseInt(id));
        if (!existing) {
            return res.status(404).json({ error: 'Stage not found' });
        }

        // Build update query dynamically
        const allowedFields = ['stage_order', 'stage_name', 'stage_label', 'description', 'max_followups', 'followup_delay_hours', 'auto_ignore_after_max', 'is_active'];
        const fields = Object.keys(updates).filter(key => allowedFields.includes(key));

        if (fields.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        const setClause = fields.map(field => `${field} = ?`).join(', ');
        const values = fields.map(field => updates[field]);

        db.prepare(`UPDATE funnel_stages SET ${setClause}, updated_at = datetime('now') WHERE id = ?`)
          .run(...values, parseInt(id));

        // Return updated stage
        const updated = db.prepare('SELECT * FROM funnel_stages WHERE id = ?').get(parseInt(id));
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/funnel-stages/:id - Delete a stage
app.delete('/api/funnel-stages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await container.repositories.funnel.deleteStage(parseInt(id));

        if (!deleted) {
            return res.status(404).json({ error: 'Stage not found' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/funnel-stages/initialize/:accountId - Initialize default stages for an account
app.post('/api/funnel-stages/initialize/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;

        // Check if account already has stages
        const hasConfig = await container.repositories.funnel.hasFunnelConfig(parseInt(accountId));
        if (hasConfig) {
            return res.status(409).json({ error: 'Account already has funnel stages configured' });
        }

        const stages = await container.repositories.funnel.initializeDefaultStages(parseInt(accountId));
        res.json({
            success: true,
            stages: stages.map(s => s.toJSON())
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/followup-templates - List templates (by stage_id or account_id)
app.get('/api/followup-templates', async (req, res) => {
    try {
        const { stage_id, account_id } = req.query;

        if (stage_id) {
            const templates = await container.repositories.funnel.getTemplatesForStage(parseInt(stage_id));
            res.json(templates.map(t => t.toJSON()));
        } else if (account_id) {
            const templates = await container.repositories.funnel.getTemplatesForAccount(parseInt(account_id));
            res.json(templates);
        } else {
            return res.status(400).json({ error: 'stage_id or account_id is required' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/followup-templates - Create a new template
app.post('/api/followup-templates', async (req, res) => {
    try {
        const { stage_id, account_id, template_order, template_text, template_name } = req.body;

        if (!stage_id || !account_id || template_order === undefined || !template_text) {
            return res.status(400).json({ error: 'stage_id, account_id, template_order, and template_text are required' });
        }

        const { FollowupTemplate } = await import('../../shared/domain/entities/FollowupTemplate.js');

        const template = FollowupTemplate.create(
            parseInt(stage_id),
            parseInt(account_id),
            parseInt(template_order),
            template_text,
            template_name || `Template ${template_order + 1}`
        );

        const saved = await container.repositories.funnel.saveTemplate(template);
        res.json(saved.toJSON());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/followup-templates/:id - Update a template
app.patch('/api/followup-templates/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Get existing template first
        const existing = db.prepare('SELECT * FROM followup_templates WHERE id = ?').get(parseInt(id));
        if (!existing) {
            return res.status(404).json({ error: 'Template not found' });
        }

        // Build update query dynamically
        const allowedFields = ['template_order', 'template_text', 'template_name', 'is_active'];
        const fields = Object.keys(updates).filter(key => allowedFields.includes(key));

        if (fields.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        const setClause = fields.map(field => `${field} = ?`).join(', ');
        const values = fields.map(field => updates[field]);

        db.prepare(`UPDATE followup_templates SET ${setClause}, updated_at = datetime('now') WHERE id = ?`)
          .run(...values, parseInt(id));

        // Return updated template
        const updated = db.prepare('SELECT * FROM followup_templates WHERE id = ?').get(parseInt(id));
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/followup-templates/:id - Delete a template
app.delete('/api/followup-templates/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await container.repositories.funnel.deleteTemplate(parseInt(id));

        if (!deleted) {
            return res.status(404).json({ error: 'Template not found' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/funnel-config/:accountId - Get full funnel config (stages + templates)
app.get('/api/funnel-config/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const config = await container.repositories.funnel.getFullFunnelConfig(parseInt(accountId));
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/funnel-stats/:accountId - Get template effectiveness statistics
app.get('/api/funnel-stats/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;

        // Get all templates with stats
        const templates = db.prepare(`
            SELECT ft.*, fs.stage_name, fs.stage_order,
                   CASE WHEN ft.usage_count > 0
                        THEN ROUND(CAST(ft.success_count AS FLOAT) / ft.usage_count * 100, 1)
                        ELSE 0
                   END as success_rate
            FROM followup_templates ft
            JOIN funnel_stages fs ON ft.stage_id = fs.id
            WHERE ft.account_id = ?
            ORDER BY fs.stage_order, ft.template_order
        `).all(parseInt(accountId));

        // Get stage-level aggregates
        const stageStats = db.prepare(`
            SELECT fs.id, fs.stage_name, fs.stage_order,
                   COUNT(ft.id) as template_count,
                   SUM(ft.usage_count) as total_usage,
                   SUM(ft.success_count) as total_success,
                   CASE WHEN SUM(ft.usage_count) > 0
                        THEN ROUND(CAST(SUM(ft.success_count) AS FLOAT) / SUM(ft.usage_count) * 100, 1)
                        ELSE 0
                   END as avg_success_rate
            FROM funnel_stages fs
            LEFT JOIN followup_templates ft ON fs.id = ft.stage_id
            WHERE fs.account_id = ?
            GROUP BY fs.id
            ORDER BY fs.stage_order
        `).all(parseInt(accountId));

        // Get lead distribution per funnel step
        const funnelDistribution = db.prepare(`
            SELECT funnel_step, COUNT(*) as count
            FROM leads
            WHERE account_id = ? AND is_ignored = 0
            GROUP BY funnel_step
            ORDER BY funnel_step
        `).all(parseInt(accountId));

        res.json({
            templates,
            stageStats,
            funnelDistribution
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// ACCOUNT PERSONAS API
// ============================================

// GET /api/personas/:accountId - Get persona for an account
app.get('/api/personas/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const persona = await container.repositories.funnel.getPersonaForAccount(parseInt(accountId));

        if (!persona) {
            return res.status(404).json({ error: 'Persona not found' });
        }

        res.json(persona.toJSON());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/personas - Create or update persona
app.post('/api/personas', async (req, res) => {
    try {
        const { account_id, persona_name, niche, communication_rules, objections_script, knowledge_base, post_booking_message } = req.body;

        if (!account_id || !persona_name) {
            return res.status(400).json({ error: 'account_id and persona_name are required' });
        }

        const { AccountPersona } = await import('../../shared/domain/entities/AccountPersona.js');

        const persona = AccountPersona.create(
            parseInt(account_id),
            persona_name,
            {
                niche,
                communicationRules: communication_rules,
                objectionsScript: objections_script,
                knowledgeBase: knowledge_base,
                postBookingMessage: post_booking_message
            }
        );

        const saved = await container.repositories.funnel.savePersona(persona);
        res.json(saved.toJSON());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/personas/:accountId - Update persona
app.patch('/api/personas/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const updates = req.body;

        // Get existing persona
        const existing = db.prepare('SELECT * FROM account_personas WHERE account_id = ?').get(parseInt(accountId));
        if (!existing) {
            return res.status(404).json({ error: 'Persona not found' });
        }

        const allowedFields = ['persona_name', 'niche', 'communication_rules', 'objections_script', 'knowledge_base', 'post_booking_message', 'qualification_prompt'];
        const fields = Object.keys(updates).filter(key => allowedFields.includes(key));

        if (fields.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        const setClause = fields.map(field => `${field} = ?`).join(', ');
        const values = fields.map(field => updates[field]);

        db.prepare(`UPDATE account_personas SET ${setClause}, updated_at = datetime('now') WHERE account_id = ?`)
          .run(...values, parseInt(accountId));

        const updated = db.prepare('SELECT * FROM account_personas WHERE account_id = ?').get(parseInt(accountId));
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/funnel-stages/:id/script - Update conversation script for a stage
app.patch('/api/funnel-stages/:id/script', async (req, res) => {
    try {
        const { id } = req.params;
        const { conversation_script } = req.body;

        if (conversation_script === undefined) {
            return res.status(400).json({ error: 'conversation_script is required' });
        }

        db.prepare(`UPDATE funnel_stages SET conversation_script = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(conversation_script, parseInt(id));

        // Clear prompt cache for this account
        const stage = db.prepare('SELECT account_id FROM funnel_stages WHERE id = ?').get(parseInt(id));
        if (stage) {
            const { clearPromptCache } = await import('../dmresponder/src/engine.js');
            clearPromptCache(stage.account_id);
        }

        const updated = db.prepare('SELECT * FROM funnel_stages WHERE id = ?').get(parseInt(id));
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/prompt-preview/:accountId - Preview the composed prompt for an account
app.get('/api/prompt-preview/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;

        const { composeSystemPrompt } = await import('../../shared/domain/services/PromptComposer.js');

        const { persona, stages } = await container.repositories.funnel.getPromptData(parseInt(accountId));

        if (!stages || stages.length === 0) {
            return res.status(404).json({ error: 'No funnel stages configured' });
        }

        const prompt = composeSystemPrompt({ persona, stages });

        res.json({
            accountId: parseInt(accountId),
            persona: persona?.toJSON() || null,
            stagesCount: stages.length,
            promptLength: prompt.length,
            prompt
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// SCENARIO TESTING API
// ============================================

// Import scenario functions
import {
    createScenario,
    getScenarios,
    getScenarioById,
    deleteScenario,
    saveScenarioResult,
    getScenarioResults,
    updateScenario
} from '../collector/src/database.js';

// Import AI engine
import { generateResponse, clearPromptCache } from '../dmresponder/src/engine.js';
import { loadProfileConfig } from '../../shared/utils/configLoader.js';

// POST /api/test-scenarios - Create/save a scenario
app.post('/api/test-scenarios', (req, res) => {
    try {
        const { name, messages } = req.body;
        
        if (!name || !messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'Invalid request: name and messages array required' });
        }
        
        const scenario = createScenario(name, messages);
        res.json(scenario);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/test-scenarios - List all scenarios
app.get('/api/test-scenarios', (req, res) => {
    try {
        const scenarios = getScenarios();
        res.json(scenarios);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/test-scenarios/:id - Get scenario details
app.get('/api/test-scenarios/:id', (req, res) => {
    try {
        const { id } = req.params;
        const scenario = getScenarioById(parseInt(id));
        
        if (!scenario) {
            return res.status(404).json({ error: 'Scenario not found' });
        }
        
        res.json(scenario);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/test-scenarios/:id - Delete a scenario
app.delete('/api/test-scenarios/:id', (req, res) => {
    try {
        const { id } = req.params;
        deleteScenario(parseInt(id));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/test-scenarios/test - Test a single message (returns AI response)
app.post('/api/test-scenarios/test', async (req, res) => {
    try {
        const { conversationHistory, profile } = req.body;
        
        if (!conversationHistory || !Array.isArray(conversationHistory)) {
            return res.status(400).json({ error: 'Invalid request: conversationHistory array required' });
        }

        if (!process.env.OPENAI_API_KEY) {
            const dmresponderEnvPath = path.join(__dirname, '..', 'dmresponder', '.env');
            dotenv.config({ path: dmresponderEnvPath });
        }
        
        // Load profile config (default to melanie)
        const profileName = profile || 'melanie';
        const profileConfig = await loadProfileConfig(profileName);
        
        // Generate AI response
        const response = await generateResponse({
            conversationHistory,
            leadContext: null,
            profileConfig
        });
        
        res.json({
            message: response.next_message || response.message,
            step_used: response.step_used
        });
    } catch (err) {
        console.error('Test error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/test-scenarios/:id/replay - Replay a saved scenario
app.post('/api/test-scenarios/:id/replay', async (req, res) => {
    try {
        const { id } = req.params;
        const { profile } = req.body;
        
        const scenario = getScenarioById(parseInt(id));
        if (!scenario) {
            return res.status(404).json({ error: 'Scenario not found' });
        }
        
        // Load profile config
        const profileName = profile || 'melanie';
        const profileConfig = await loadProfileConfig(profileName);
        
        // Replay the scenario
        const fullConversation = [];
        const originalMessages = scenario.messages;

        // 1. Handle potential first assistant message (template)
        if (originalMessages.length > 0 && originalMessages[0].role === 'assistant') {
            fullConversation.push(originalMessages[0]);
        }

        // 2. Iterate through user messages and generate fresh responses
        for (const msg of originalMessages.filter(m => m.role === 'user')) {
            fullConversation.push(msg);
            
            // Generate fresh AI response
            const response = await generateResponse({
                conversationHistory: fullConversation,
                leadContext: null,
                profileConfig
            });
            
            fullConversation.push({
                role: 'assistant',
                text: response.next_message || response.message,
                step_used: response.step_used
            });
        }
        
        // Save result and overwrite existing scenario messages
        saveScenarioResult(parseInt(id), fullConversation);
        updateScenario(parseInt(id), fullConversation);
        
        res.json({
            scenario_id: id,
            messages: fullConversation
        });
    } catch (err) {
        console.error('Replay error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/test-scenarios/replay-all - Replay all scenarios
app.post('/api/test-scenarios/replay-all', async (req, res) => {
    try {
        const { profile } = req.body;
        const scenarios = getScenarios();
        
        if (scenarios.length === 0) {
            return res.json({ results: [] });
        }
        
        // Load profile config
        const profileName = profile || 'melanie';
        const profileConfig = await loadProfileConfig(profileName);
        
        const results = [];
        
        for (const scenario of scenarios) {
            try {
                // Replay each scenario
                const fullConversation = [];
                const originalMessages = scenario.messages;

                // 1. Handle potential first assistant message (template)
                if (originalMessages.length > 0 && originalMessages[0].role === 'assistant') {
                    fullConversation.push(originalMessages[0]);
                }

                // 2. Iterate through user messages and generate fresh responses
                for (const msg of originalMessages.filter(m => m.role === 'user')) {
                    fullConversation.push(msg);
                    
                    const response = await generateResponse({
                        conversationHistory: fullConversation,
                        leadContext: null,
                        profileConfig
                    });
                    
                    fullConversation.push({
                        role: 'assistant',
                        text: response.next_message || response.message,
                        step_used: response.step_used
                    });
                }
                
                // Save result and overwrite existing scenario messages
                saveScenarioResult(scenario.id, fullConversation);
                updateScenario(scenario.id, fullConversation);
                
                results.push({
                    scenario_id: scenario.id,
                    scenario_name: scenario.name,
                    messages: fullConversation,
                    success: true
                });
            } catch (err) {
                results.push({
                    scenario_id: scenario.id,
                    scenario_name: scenario.name,
                    error: err.message,
                    success: false
                });
            }
        }
        
        res.json({ results });
    } catch (err) {
        console.error('Replay all error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// KNOWLEDGE BASE (RAG) API
// ============================================

import { getEmbedding } from '../../shared/utils/embeddings.js';

// GET /api/knowledge-base - List knowledge entries for an account
app.get('/api/knowledge-base', async (req, res) => {
    try {
        const { account_id, category } = req.query;

        if (!account_id) {
            return res.status(400).json({ error: 'account_id is required' });
        }

        const knowledgeRepo = container.repositories.knowledge;
        let entries;

        if (category) {
            entries = await knowledgeRepo.getByCategory(parseInt(account_id), category);
        } else {
            entries = await knowledgeRepo.getByAccount(parseInt(account_id));
        }

        // Don't send raw embeddings to frontend (too large)
        const sanitized = entries.map(e => ({
            id: e.id,
            category: e.category,
            situation: e.situation,
            content: e.content,
            triggerKeywords: e.triggerKeywords || [],
            applicableSteps: e.applicableSteps || [],
            usageCount: e.usage_count,
            successCount: e.success_count,
            successRate: e.success_rate,
            hasEmbedding: !!e.embedding,
            createdAt: e.created_at,
            updatedAt: e.updated_at
        }));

        res.json(sanitized);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/knowledge-base - Create a new knowledge entry
app.post('/api/knowledge-base', async (req, res) => {
    try {
        const { account_id, category, situation, content, trigger_keywords, applicable_steps } = req.body;

        if (!account_id || !category || !content) {
            return res.status(400).json({ error: 'account_id, category, and content are required' });
        }

        const knowledgeRepo = container.repositories.knowledge;

        // Generate embedding
        let embedding = null;
        try {
            const textForEmbedding = `${situation || ''} ${content}`;
            embedding = await getEmbedding(textForEmbedding);
        } catch (e) {
            console.error('Failed to generate embedding:', e.message);
        }

        const entry = await knowledgeRepo.save({
            accountId: parseInt(account_id),
            category,
            situation,
            content,
            triggerKeywords: trigger_keywords || [],
            applicableSteps: applicable_steps || [],
            embedding
        });

        res.json({
            id: entry.id,
            category: entry.category,
            situation: entry.situation,
            content: entry.content,
            triggerKeywords: entry.triggerKeywords,
            applicableSteps: entry.applicableSteps,
            hasEmbedding: !!embedding
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/knowledge-base/:id - Update a knowledge entry
app.patch('/api/knowledge-base/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { category, situation, content, trigger_keywords, applicable_steps, regenerate_embedding } = req.body;

        const knowledgeRepo = container.repositories.knowledge;

        // Get existing entry by ID directly from database
        const existing = db.prepare('SELECT * FROM knowledge_base WHERE id = ?').get(parseInt(id));

        if (!existing) {
            return res.status(404).json({ error: 'Knowledge entry not found' });
        }

        // Build update
        const existingKeywords = existing.trigger_keywords ? JSON.parse(existing.trigger_keywords) : [];
        const existingSteps = existing.applicable_steps ? JSON.parse(existing.applicable_steps) : [];
        const update = {
            id: parseInt(id),
            accountId: existing.account_id,
            category: category || existing.category,
            situation: situation !== undefined ? situation : existing.situation,
            content: content || existing.content,
            triggerKeywords: trigger_keywords !== undefined ? trigger_keywords : existingKeywords,
            applicableSteps: applicable_steps !== undefined ? applicable_steps : existingSteps,
            embedding: existing.embedding
        };

        // Regenerate embedding if content changed or explicitly requested
        if (regenerate_embedding || content) {
            try {
                const textForEmbedding = `${update.situation || ''} ${update.content}`;
                update.embedding = await getEmbedding(textForEmbedding);
            } catch (e) {
                console.error('Failed to regenerate embedding:', e.message);
            }
        }

        await knowledgeRepo.save(update);

        res.json({
            id: update.id,
            category: update.category,
            situation: update.situation,
            content: update.content,
            triggerKeywords: update.triggerKeywords,
            applicableSteps: update.applicableSteps,
            hasEmbedding: !!update.embedding
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/knowledge-base/:id - Delete a knowledge entry
app.delete('/api/knowledge-base/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const knowledgeRepo = container.repositories.knowledge;
        await knowledgeRepo.delete(parseInt(id));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/knowledge-base/pending - Get pending (inactive) entries awaiting review
app.get('/api/knowledge-base/pending', async (req, res) => {
    try {
        const { account_id } = req.query;

        if (!account_id) {
            return res.status(400).json({ error: 'account_id is required' });
        }

        const knowledgeRepo = container.repositories.knowledge;
        const entries = await knowledgeRepo.getPending(parseInt(account_id));

        const sanitized = entries.map(e => ({
            id: e.id,
            category: e.category,
            situation: e.situation,
            content: e.content,
            triggerKeywords: e.triggerKeywords || [],
            applicableSteps: e.applicableSteps || [],
            hasEmbedding: !!e.embedding,
            createdAt: e.created_at
        }));

        res.json(sanitized);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/knowledge-base/:id/activate - Activate a pending entry
app.post('/api/knowledge-base/:id/activate', async (req, res) => {
    try {
        const { id } = req.params;
        const knowledgeRepo = container.repositories.knowledge;

        // Generate embedding if not present
        const existing = db.prepare('SELECT * FROM knowledge_base WHERE id = ?').get(parseInt(id));
        if (existing && !existing.embedding) {
            try {
                const textForEmbedding = `${existing.situation || ''} ${existing.content}`;
                const embedding = await getEmbedding(textForEmbedding);
                await knowledgeRepo.updateEmbedding(parseInt(id), embedding);
            } catch (e) {
                console.warn('Could not generate embedding:', e.message);
            }
        }

        await knowledgeRepo.activate(parseInt(id));
        res.json({ success: true, message: 'Entry activated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/knowledge-base/:id/deactivate - Deactivate an entry
app.post('/api/knowledge-base/:id/deactivate', async (req, res) => {
    try {
        const { id } = req.params;
        const knowledgeRepo = container.repositories.knowledge;
        await knowledgeRepo.deactivate(parseInt(id));
        res.json({ success: true, message: 'Entry deactivated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/knowledge-base/stats - Get RAG stats for an account
app.get('/api/knowledge-base/stats', async (req, res) => {
    try {
        const { account_id } = req.query;

        if (!account_id) {
            return res.status(400).json({ error: 'account_id is required' });
        }

        const knowledgeRepo = container.repositories.knowledge;
        const stats = await knowledgeRepo.getStats(parseInt(account_id));
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/knowledge-base/test - Test RAG retrieval with a message
app.post('/api/knowledge-base/test', async (req, res) => {
    try {
        const { account_id, message, funnel_step } = req.body;

        if (!account_id || !message) {
            return res.status(400).json({ error: 'account_id and message are required' });
        }

        const ragRetriever = container.services.ragRetriever;

        // Pass funnel_step only if provided (null means no step filtering)
        const leadContext = funnel_step ? { funnel_step } : {};

        const results = await ragRetriever.retrieve({
            prospectMessage: message,
            leadContext,
            accountId: parseInt(account_id)
        });

        res.json({
            relevantKnowledge: results.relevantKnowledge.map(k => ({
                id: k.id,
                category: k.category,
                situation: k.situation,
                content: k.content,
                score: Math.round(k.score * 100),
                applicableSteps: k.applicableSteps || []
            })),
            keywordMatches: results.keywordMatches.length,
            funnelStepUsed: funnel_step || null,
            formattedPrompt: ragRetriever.formatForPrompt(results)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/knowledge-base/generate-embeddings - Generate embeddings for entries without them
app.post('/api/knowledge-base/generate-embeddings', async (req, res) => {
    try {
        const { account_id } = req.body;

        if (!account_id) {
            return res.status(400).json({ error: 'account_id is required' });
        }

        const knowledgeRepo = container.repositories.knowledge;
        const entries = await knowledgeRepo.getByAccount(parseInt(account_id));
        const withoutEmbedding = entries.filter(e => !e.embedding);

        let generated = 0;
        for (const entry of withoutEmbedding) {
            try {
                const textForEmbedding = `${entry.situation || ''} ${entry.content}`;
                const embedding = await getEmbedding(textForEmbedding);
                await knowledgeRepo.updateEmbedding(entry.id, embedding);
                generated++;
            } catch (e) {
                console.error(`Failed to generate embedding for entry ${entry.id}:`, e.message);
            }
        }

        res.json({
            success: true,
            total: entries.length,
            generated,
            alreadyHad: entries.length - withoutEmbedding.length
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// OUTREACH CONFIG API (templates, CTA, sources)
// ============================================

// GET /api/outreach-templates/:accountId - Get outreach templates from DB (fallback to config)
app.get('/api/outreach-templates/:accountId', async (req, res) => {
    try {
        const accountId = parseInt(req.params.accountId);
        const templates = db.prepare(
            'SELECT * FROM outreach_templates WHERE account_id = ? ORDER BY template_type'
        ).all(accountId);
        res.json(templates);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Legacy route for scenario testing (kept for backward compat)
app.get('/api/outreach-templates', async (req, res) => {
    try {
        const { profile, account_id } = req.query;
        if (account_id) {
            const templates = db.prepare(
                'SELECT * FROM outreach_templates WHERE account_id = ?'
            ).all(parseInt(account_id));
            const map = {};
            templates.forEach(t => { map[t.template_type] = t.template_text; });
            return res.json({ follower: map.follower || '', like: map.like || '', comment: map.comment || '' });
        }
        const profileName = profile || 'melanie';
        const profileConfig = await loadProfileConfig(profileName);
        if (!profileConfig || !profileConfig.outreach) {
            return res.status(404).json({ error: 'Profile config not found' });
        }
        res.json({
            follower: profileConfig.outreach.follower_template || '',
            like: profileConfig.outreach.like_outreach_template || '',
            comment: profileConfig.outreach.comment_outreach_template || ''
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/outreach-templates - Create or update outreach template (upsert)
app.post('/api/outreach-templates', async (req, res) => {
    try {
        const { account_id, template_type, template_text } = req.body;
        if (!account_id || !template_type || !template_text) {
            return res.status(400).json({ error: 'account_id, template_type, and template_text are required' });
        }
        db.prepare(`
            INSERT INTO outreach_templates (account_id, template_type, template_text)
            VALUES (?, ?, ?)
            ON CONFLICT(account_id, template_type) DO UPDATE SET template_text = ?, updated_at = datetime('now')
        `).run(parseInt(account_id), template_type, template_text, template_text);

        const template = db.prepare(
            'SELECT * FROM outreach_templates WHERE account_id = ? AND template_type = ?'
        ).get(parseInt(account_id), template_type);
        res.json(template);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/outreach-templates/:id
app.delete('/api/outreach-templates/:id', async (req, res) => {
    try {
        db.prepare('DELETE FROM outreach_templates WHERE id = ?').run(parseInt(req.params.id));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- CTA Resources ---

// GET /api/cta-resources?account_id=X
app.get('/api/cta-resources', async (req, res) => {
    try {
        const { account_id } = req.query;
        if (!account_id) return res.status(400).json({ error: 'account_id required' });
        const resources = db.prepare(
            'SELECT * FROM cta_resources WHERE account_id = ? ORDER BY keyword'
        ).all(parseInt(account_id));
        res.json(resources);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/cta-resources
app.post('/api/cta-resources', async (req, res) => {
    try {
        const { account_id, keyword, resource_url, message_addon, outreach_template } = req.body;
        if (!account_id || !keyword) {
            return res.status(400).json({ error: 'account_id and keyword are required' });
        }
        const result = db.prepare(`
            INSERT INTO cta_resources (account_id, keyword, resource_url, message_addon, outreach_template)
            VALUES (?, ?, ?, ?, ?)
        `).run(parseInt(account_id), keyword, resource_url || null, message_addon || null, outreach_template || null);
        const created = db.prepare('SELECT * FROM cta_resources WHERE id = ?').get(result.lastInsertRowid);
        res.json(created);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/cta-resources/:id
app.patch('/api/cta-resources/:id', async (req, res) => {
    try {
        const allowedFields = ['keyword', 'resource_url', 'message_addon', 'outreach_template', 'is_active'];
        const fields = Object.keys(req.body).filter(k => allowedFields.includes(k));
        if (fields.length === 0) return res.status(400).json({ error: 'No valid fields' });

        const setClause = fields.map(f => `${f} = ?`).join(', ');
        const values = fields.map(f => req.body[f]);
        db.prepare(`UPDATE cta_resources SET ${setClause}, updated_at = datetime('now') WHERE id = ?`)
            .run(...values, parseInt(req.params.id));

        const updated = db.prepare('SELECT * FROM cta_resources WHERE id = ?').get(parseInt(req.params.id));
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/cta-resources/:id
app.delete('/api/cta-resources/:id', async (req, res) => {
    try {
        db.prepare('DELETE FROM cta_resources WHERE id = ?').run(parseInt(req.params.id));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Prospector Sources ---

// GET /api/prospector-sources?account_id=X
app.get('/api/prospector-sources', async (req, res) => {
    try {
        const { account_id } = req.query;
        if (!account_id) return res.status(400).json({ error: 'account_id required' });
        const sources = db.prepare(
            'SELECT * FROM prospector_sources WHERE account_id = ? ORDER BY source_order'
        ).all(parseInt(account_id));
        res.json(sources);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/prospector-sources
app.post('/api/prospector-sources', async (req, res) => {
    try {
        const { account_id, source_value } = req.body;
        if (!account_id || !source_value) {
            return res.status(400).json({ error: 'account_id and source_value are required' });
        }
        // Get next order
        const maxOrder = db.prepare(
            'SELECT MAX(source_order) as max_order FROM prospector_sources WHERE account_id = ?'
        ).get(parseInt(account_id));
        const nextOrder = (maxOrder?.max_order ?? -1) + 1;

        const result = db.prepare(`
            INSERT INTO prospector_sources (account_id, source_value, source_order)
            VALUES (?, ?, ?)
        `).run(parseInt(account_id), source_value, nextOrder);
        const created = db.prepare('SELECT * FROM prospector_sources WHERE id = ?').get(result.lastInsertRowid);
        res.json(created);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/prospector-sources/:id
app.delete('/api/prospector-sources/:id', async (req, res) => {
    try {
        db.prepare('DELETE FROM prospector_sources WHERE id = ?').run(parseInt(req.params.id));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/prospector-sources/reorder
app.put('/api/prospector-sources/reorder', async (req, res) => {
    try {
        const { ordered_ids } = req.body;
        if (!Array.isArray(ordered_ids)) return res.status(400).json({ error: 'ordered_ids array required' });

        const stmt = db.prepare('UPDATE prospector_sources SET source_order = ?, updated_at = datetime(\'now\') WHERE id = ?');
        const updateAll = db.transaction((ids) => {
            ids.forEach((id, index) => stmt.run(index, id));
        });
        updateAll(ordered_ids);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// DM SYNC & FEEDBACK LOOP API
// ============================================

// GET /api/dm-sync/stats - Get correction statistics
app.get('/api/dm-sync/stats', async (req, res) => {
    try {
        const { account_id } = req.query;

        if (!account_id) {
            return res.status(400).json({ error: 'account_id is required' });
        }

        // Get correction stats
        const correctionStats = db.prepare(`
            SELECT
                COUNT(*) as total_corrections,
                SUM(CASE WHEN modification_type = 'edited' THEN 1 ELSE 0 END) as edited,
                SUM(CASE WHEN modification_type = 'rewritten' THEN 1 ELSE 0 END) as rewritten
            FROM message_corrections mc
            JOIN leads l ON mc.lead_id = l.id
            WHERE l.account_id = ?
        `).get(parseInt(account_id));

        // Get leads to sync
        const leadsToSync = db.prepare(`
            SELECT COUNT(*) as count
            FROM leads
            WHERE account_id = ?
              AND is_ignored = 0
              AND (funnel_step >= 5 OR booking_status IS NOT NULL)
        `).get(parseInt(account_id));

        // Get recent corrections
        const recentCorrections = db.prepare(`
            SELECT mc.*, l.username
            FROM message_corrections mc
            JOIN leads l ON mc.lead_id = l.id
            WHERE l.account_id = ?
            ORDER BY mc.synced_at DESC
            LIMIT 10
        `).all(parseInt(account_id));

        res.json({
            corrections: correctionStats,
            leadsToSync: leadsToSync.count,
            recentCorrections
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/dm-sync/leads - Get leads that would be synced
app.get('/api/dm-sync/leads', async (req, res) => {
    try {
        const { account_id } = req.query;

        if (!account_id) {
            return res.status(400).json({ error: 'account_id is required' });
        }

        const leads = db.prepare(`
            SELECT l.id, l.username, l.funnel_step, l.booking_status, l.last_dm_sync_at,
                   (SELECT COUNT(*) FROM conversations WHERE lead_id = l.id) as db_message_count,
                   (SELECT COUNT(*) FROM message_corrections WHERE lead_id = l.id) as correction_count
            FROM leads l
            WHERE l.account_id = ?
              AND l.is_ignored = 0
              AND (l.funnel_step >= 5 OR l.booking_status IS NOT NULL)
            ORDER BY
              CASE WHEN l.booking_status = 'completed' THEN 1
                   WHEN l.booking_status = 'pending' THEN 2
                   ELSE 3 END,
              l.funnel_step DESC
            LIMIT 50
        `).all(parseInt(account_id));

        res.json(leads);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// COMMAND LAUNCHER API
// ============================================

// Build flat allowlist for validation
const allowedCommands = new Set();
for (const cmds of Object.values(COMMAND_REGISTRY)) {
    for (const cmd of cmds) {
        allowedCommands.add(cmd.name);
    }
}

// GET /api/commands - Return the command registry
app.get('/api/commands', (req, res) => {
    res.json(COMMAND_REGISTRY);
});

// Lookup combo definition for a command name
function findCommandDef(name) {
    for (const cmds of Object.values(COMMAND_REGISTRY)) {
        const found = cmds.find(c => c.name === name);
        if (found) return found;
    }
    return null;
}

// POST /api/commands/run - Launch a command (or combo)
app.post('/api/commands/run', async (req, res) => {
    const { command, args = [] } = req.body;

    if (!command || !allowedCommands.has(command)) {
        return res.status(400).json({ error: `Unknown command: ${command}` });
    }

    // Kill all existing running processes and browsers before starting new command
    for (const [id, entry] of runningProcesses) {
        if (entry.exitCode === null && entry.process) {
            try {
                process.kill(-entry.process.pid, 'SIGKILL');
            } catch (_) { /* already dead */ }
        }
    }
    runningProcesses.clear();

    // Kill any orphan Chrome/Chromium processes tied to browser-data profiles
    try {
        // Kill Chromium (Playwright) and Chrome processes with browser-data in args
        spawn('pkill', ['-9', '-f', 'Chromium.*browser-data'], { stdio: 'ignore', detached: true }).unref();
        spawn('pkill', ['-9', '-f', 'chrome.*browser-data'], { stdio: 'ignore', detached: true }).unref();
        spawn('pkill', ['-9', '-f', 'user-data-dir.*browser-data'], { stdio: 'ignore', detached: true }).unref();
        // Small delay to let processes die
        await new Promise(r => setTimeout(r, 800));
    } catch (_) { /* ignore */ }

    // Validate args: allow --flags and their values (strings/numbers following a flag)
    const sanitizedArgs = [];
    for (let i = 0; i < args.length; i++) {
        // Fix macOS smart dashes: — (em dash) and – (en dash) → --
        const a = String(args[i]).replace(/\u2014/g, '--').replace(/\u2013/g, '--');
        if (a.startsWith('--')) {
            sanitizedArgs.push(a);
        } else if (sanitizedArgs.length > 0 && !sanitizedArgs[sanitizedArgs.length - 1].includes('=')) {
            // Value for previous flag (e.g. --limit 5, --profile melanie)
            sanitizedArgs.push(a);
        }
    }

    console.log(`[CMD] ${command} args:`, sanitizedArgs);
    const processId = randomUUID();
    const projectRoot = path.join(__dirname, '..', '..');
    const argsStr = sanitizedArgs.length > 0 ? ' -- ' + sanitizedArgs.join(' ') : '';

    // Check if this is a combo command
    const cmdDef = findCommandDef(command);
    let shellCmd;
    if (cmdDef && cmdDef.combo) {
        // Chain sub-commands with &&
        shellCmd = cmdDef.combo
            .map(sub => `npm run ${sub}${argsStr}`)
            .join(' && ');
    } else {
        shellCmd = `npm run ${command}${argsStr}`;
    }

    const child = spawn('sh', ['-c', shellCmd], {
        cwd: projectRoot,
        env: { ...process.env, FORCE_COLOR: '1', PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || '/usr/bin:/bin'}` },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
    });

    const label = cmdDef && cmdDef.combo
        ? cmdDef.combo.join(' + ') + argsStr
        : command + argsStr;

    const entry = {
        process: child,
        logs: [],
        listeners: [],
        exitCode: null,
        command: label,
        startedAt: new Date().toISOString(),
    };
    runningProcesses.set(processId, entry);

    const appendLog = (data) => {
        const text = data.toString();
        entry.logs.push(text);
        for (const listener of entry.listeners) {
            listener(text);
        }
    };

    child.stdout.on('data', appendLog);
    child.stderr.on('data', appendLog);

    child.on('close', (code) => {
        entry.exitCode = code;
        const exitMsg = `\n[Process exited with code ${code}]\n`;
        entry.logs.push(exitMsg);
        for (const listener of entry.listeners) {
            listener(exitMsg);
        }
        // Auto-cleanup after 60s
        setTimeout(() => {
            runningProcesses.delete(processId);
        }, 60_000);
    });

    res.json({ processId, command: label });
});

// GET /api/commands/stream/:processId - SSE stream
app.get('/api/commands/stream/:processId', (req, res) => {
    const { processId } = req.params;
    const entry = runningProcesses.get(processId);

    if (!entry) {
        return res.status(404).json({ error: 'Process not found' });
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });

    // Replay buffered logs
    for (const log of entry.logs) {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
    }

    // If already finished, send done and close
    if (entry.exitCode !== null) {
        res.write(`event: done\ndata: ${JSON.stringify({ exitCode: entry.exitCode })}\n\n`);
        return res.end();
    }

    // Register live listener
    const listener = (text) => {
        res.write(`data: ${JSON.stringify(text)}\n\n`);
    };
    entry.listeners.push(listener);

    // Send done event when process exits
    const onClose = entry.process;
    const checkDone = setInterval(() => {
        if (entry.exitCode !== null) {
            clearInterval(checkDone);
            res.write(`event: done\ndata: ${JSON.stringify({ exitCode: entry.exitCode })}\n\n`);
            res.end();
        }
    }, 500);

    req.on('close', () => {
        clearInterval(checkDone);
        entry.listeners = entry.listeners.filter(l => l !== listener);
    });
});

// POST /api/commands/stop/:processId - Stop a running process (kills entire process tree)
app.post('/api/commands/stop/:processId', (req, res) => {
    const { processId } = req.params;
    const entry = runningProcesses.get(processId);

    if (!entry) {
        return res.status(404).json({ error: 'Process not found' });
    }

    if (entry.exitCode !== null) {
        return res.json({ success: true, message: 'Process already exited' });
    }

    // Kill entire process group (sh + npm + node + chromium)
    try {
        process.kill(-entry.process.pid, 'SIGTERM');
    } catch (_) { /* ignore if already dead */ }

    // Force kill group after 5s, then cleanup orphan Chrome processes
    setTimeout(() => {
        try {
            if (entry.exitCode === null) {
                process.kill(-entry.process.pid, 'SIGKILL');
            }
        } catch (_) { /* already dead */ }

        // Kill any orphan Chrome/Chromium processes tied to browser-data profiles
        spawn('pkill', ['-9', '-f', 'Chromium.*browser-data'], { stdio: 'ignore', detached: true }).unref();
        spawn('pkill', ['-9', '-f', 'chrome.*browser-data'], { stdio: 'ignore', detached: true }).unref();
    }, 5000);

    res.json({ success: true, message: 'SIGTERM sent to process group' });
});

// POST /api/commands/stdin/:processId - Send input to a running process
app.post('/api/commands/stdin/:processId', (req, res) => {
    const { processId } = req.params;
    const entry = runningProcesses.get(processId);

    if (!entry) {
        return res.status(404).json({ error: 'Process not found' });
    }

    if (entry.exitCode !== null) {
        return res.status(400).json({ error: 'Process already exited' });
    }

    try {
        entry.process.stdin.write('\n');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/commands/running - List running processes
app.get('/api/commands/running', (req, res) => {
    const list = [];
    for (const [id, entry] of runningProcesses) {
        list.push({
            processId: id,
            command: entry.command,
            startedAt: entry.startedAt,
            exitCode: entry.exitCode,
        });
    }
    res.json(list);
});

// Start Server
app.listen(PORT, () => {
    console.log(`\n🚀 Dashboard running at http://localhost:${PORT}`);
    console.log('   Press Ctrl+C to stop.\n');
});
