
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Path to shared database
const DB_PATH = path.join(__dirname, '..', 'collector', 'permanent-data', 'leads.db');

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Initialize DB safely
let db;
try {
    console.log(`🔌 Connecting to database at: ${DB_PATH}`);
    db = new Database(DB_PATH, { fileMustExist: true });
    console.log('✅ Connected to SQLite.');
} catch (err) {
    console.error('❌ Database connection failed:', err.message);
    if (!DB_PATH.includes('leads.db')) {
        console.error('   Hint: Ensure "agents/collector/permanent-data/leads.db" exists.');
    }
}

// API Routes

// GET /api/stats
app.get('/api/stats', (req, res) => {
    try {
        const stats = {
            total: db.prepare('SELECT COUNT(*) as c FROM leads').get().c,
            new: db.prepare("SELECT COUNT(*) as c FROM leads WHERE status = 'new'").get().c,
            qualified: db.prepare("SELECT COUNT(*) as c FROM leads WHERE warmth = 'hot'").get().c,
            contacted: db.prepare("SELECT COUNT(*) as c FROM leads WHERE status IN ('message_sent', 'message_ready')").get().c,
            failed: db.prepare("SELECT COUNT(*) as c FROM leads WHERE status = 'failed_outreach'").get().c
        };
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/leads
app.get('/api/leads', (req, res) => {
    try {
        const { page = 1, limit = 50, status, search } = req.query;
        const offset = (page - 1) * limit;
        
        // Build dynamic query
        let sql = `
            SELECT id, username,
                   engagement_score, 
                   status, warmth,
                   (SELECT COUNT(*) FROM comments WHERE lead_id = leads.id) as comment_count
            FROM leads
            WHERE 1=1
        `;
        const params = [];

        if (status && status !== 'all') {
            if (status === 'qualified') {
                sql += " AND warmth = 'hot'";
            } else if (status === 'contacted') {
                sql += " AND status IN ('message_sent', 'message_ready')";
            } else if (status === 'failed') {
                 sql += " AND status = 'failed_outreach'";
            } else {
                sql += " AND status = ?";
                params.push(status);
            }
        }
        
        if (search) {
             sql += " AND username LIKE ?";
             params.push(`%${search}%`);
        }

        sql += ` ORDER BY engagement_score DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(offset));

        const leads = db.prepare(sql).all(...params);
        res.json(leads);
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
        const allowedFields = ['status', 'warmth', 'notes', 'email', 'booking_status'];
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

// GET /api/bookings
app.get('/api/bookings', (req, res) => {
    try {
        // Fetch leads with a non-null booking_status
        const leads = db.prepare(`
            SELECT id, username, profile_url, booking_status, updated_at
            FROM leads 
            WHERE booking_status IS NOT NULL 
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
