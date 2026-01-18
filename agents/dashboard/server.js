
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { getDatabase } from '../collector/src/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Path to shared database
const DB_PATH = path.join(__dirname, '..', 'collector', 'permanent-data', 'leads.db');

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Initialize DB safely
let db;
try {
    db = await getDatabase(DB_PATH);
    console.log('✅ Connected to SQLite via shared module.');
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
        const conversation = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE status IN ('conversation') AND (booking_status IS NULL OR booking_status = '') AND is_ignored = 0 ${accountFilter}`).get(...accountParam).c;

        const stats = {
            total_contacted: totalContacted,
            reply_rate: totalContacted > 0 ? ((replied / totalContacted) * 100).toFixed(1) : 0,
            conversation: conversation,
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
                   (SELECT COUNT(*) FROM comments WHERE lead_id = leads.id) as comment_count
            FROM leads
            WHERE is_ignored = 0
        `;
        const params = [];
        
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

        sql += ` ORDER BY engagement_score DESC LIMIT ? OFFSET ?`;
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

// Start Server
app.listen(PORT, () => {
    console.log(`\n🚀 Dashboard running at http://localhost:${PORT}`);
    console.log('   Press Ctrl+C to stop.\n');
});
