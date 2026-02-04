import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
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
                step1: db.prepare(`SELECT COUNT(*) as c FROM leads WHERE conversation_step = 1 AND is_ignored = 0 ${accountFilter}`).get(...accountParam).c,
                step2: db.prepare(`SELECT COUNT(*) as c FROM leads WHERE conversation_step = 2 AND is_ignored = 0 ${accountFilter}`).get(...accountParam).c,
                step3: db.prepare(`SELECT COUNT(*) as c FROM leads WHERE conversation_step = 3 AND is_ignored = 0 ${accountFilter}`).get(...accountParam).c,
                step4: db.prepare(`SELECT COUNT(*) as c FROM leads WHERE conversation_step = 4 AND is_ignored = 0 ${accountFilter}`).get(...accountParam).c,
                step5: db.prepare(`SELECT COUNT(*) as c FROM leads WHERE conversation_step = 5 AND is_ignored = 0 ${accountFilter}`).get(...accountParam).c
            }
        };
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/leads
app.get('/api/leads', (req, res) => {
    try {
        const { page = 1, limit = 50, status, search, account_id, conversation_step } = req.query;
        const offset = (page - 1) * limit;
        
        // Build dynamic query
        let sql = `
            SELECT id, username, full_name,
                   engagement_score, 
                   status, warmth, booking_status,
                   lead_source, lead_type, bio, account_id, conversation_step,
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
        
        // Step filter
        if (conversation_step) {
            sql += ' AND conversation_step = ?';
            params.push(parseInt(conversation_step));
        }

        if (status && status !== 'all') {
            if (status === 'contacted_total') {
                sql += " AND total_messages_sent > 0";
            } else if (status === 'conversation') {
                sql += " AND status IN ('conversation', 'replied') AND (booking_status IS NULL OR booking_status = '')";
            } else if (status === 'confirm_bookings') {
                sql += " AND booking_status = 'pending'";
            } else if (status === 'booked') {
                 sql += " AND booking_status = 'completed'";
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
        const allowedFields = ['status', 'warmth', 'notes', 'email', 'booking_status', 'is_ignored', 'full_name', 'conversation_step'];
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
import { generateResponse } from '../dmresponder/src/engine.js';
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

// GET /api/outreach-templates - Get outreach templates for scenario testing
app.get('/api/outreach-templates', async (req, res) => {
    try {
        const { profile } = req.query;
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
        console.error('Template error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`\n🚀 Dashboard running at http://localhost:${PORT}`);
    console.log('   Press Ctrl+C to stop.\n');
});
