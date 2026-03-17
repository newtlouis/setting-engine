// ============================================
// Pipeline View Client
// ============================================

let currentAccountId = null;
let currentGroupBy = 'day';

// ==========================================
// INIT
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    await loadAccounts();
    setupToggle();
    await loadPipeline();
});

// ==========================================
// ACCOUNTS
// ==========================================

async function loadAccounts() {
    const select = document.getElementById('accountSelect');
    try {
        const res = await fetch('/api/accounts');
        const accounts = await res.json();
        select.innerHTML = '';
        accounts.forEach(acc => {
            if (acc.id) {
                const opt = document.createElement('option');
                opt.value = acc.id;
                opt.textContent = acc.name;
                select.appendChild(opt);
            }
        });

        const defRes = await fetch('/api/accounts/default');
        const defAcc = await defRes.json();
        if (defAcc && defAcc.id) {
            select.value = defAcc.id;
            currentAccountId = defAcc.id;
        } else if (select.options.length > 0) {
            currentAccountId = select.options[0].value;
        }

        select.addEventListener('change', () => {
            currentAccountId = select.value;
            loadPipeline();
        });
    } catch (e) {
        select.innerHTML = '<option value="">Erreur</option>';
    }
}

// ==========================================
// TOGGLE (step / day)
// ==========================================

function setupToggle() {
    const buttons = document.querySelectorAll('.toggle-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentGroupBy = btn.dataset.group;
            loadPipeline();
        });
    });
}

// ==========================================
// LOAD & RENDER
// ==========================================

async function loadPipeline() {
    if (!currentAccountId) return;

    const container = document.getElementById('pipelineContent');
    container.innerHTML = '<div class="empty-state">Chargement...</div>';

    try {
        const res = await fetch(`/api/leads/pipeline?account_id=${currentAccountId}&group_by=${currentGroupBy}`);
        const data = await res.json();

        if (!data.groups || data.groups.length === 0) {
            container.innerHTML = '<div class="empty-state">Aucun lead dans le pipeline pour ce compte.</div>';
            document.getElementById('pipelineStats').textContent = '';
            return;
        }

        const totalLeads = data.groups.reduce((sum, g) => sum + g.count, 0);
        document.getElementById('pipelineStats').textContent = `${totalLeads} leads · ${data.groups.length} groupes`;

        container.innerHTML = data.groups.map(group => renderGroup(group)).join('');

        // Attach collapse handlers
        container.querySelectorAll('.group-header').forEach(header => {
            header.addEventListener('click', () => {
                header.classList.toggle('collapsed');
                header.nextElementSibling.classList.toggle('hidden');
            });
        });

        // Attach lead click handlers
        container.querySelectorAll('.lead-row').forEach(row => {
            row.addEventListener('click', () => {
                const username = row.dataset.username;
                if (username) openInstagramProfile(username);
            });
        });
    } catch (err) {
        container.innerHTML = `<div class="empty-state" style="color: var(--error);">Erreur: ${err.message}</div>`;
    }
}

function renderGroup(group) {
    const leadsHtml = group.leads.map(lead => renderLead(lead)).join('');

    return `
        <div class="pipeline-group">
            <div class="group-header">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span class="group-title">${escapeHtml(group.label)}</span>
                    <span class="group-count">${group.count}</span>
                </div>
                <span class="group-chevron">&#9660;</span>
            </div>
            <div class="group-body">
                ${leadsHtml}
            </div>
        </div>`;
}

function renderLead(lead) {
    const name = lead.first_name || lead.full_name || '-';
    const statusClass = 'status-' + (lead.status || '').replace(/\s+/g, '_');
    const statusLabel = formatStatus(lead.status);
    const date = formatDate(lead.last_contact_at || lead.updated_at);
    const variant = lead.variant || '-';

    return `
        <div class="lead-row" data-username="${escapeAttr(lead.username)}">
            <span class="lead-username">@${escapeHtml(lead.username)}</span>
            <span class="lead-name">${escapeHtml(name)}</span>
            <span class="lead-status ${statusClass}">${statusLabel}</span>
            <span class="lead-variant">${escapeHtml(variant)}</span>
            <span>Step ${lead.funnel_step || 0}</span>
            <span class="lead-date">${date}</span>
        </div>`;
}

// ==========================================
// NAVIGATION
// ==========================================

function openInstagramProfile(username) {
    const select = document.getElementById('accountSelect');
    const profile = select.options[select.selectedIndex].textContent.trim();

    fetch('/api/open-instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, profile })
    }).catch(err => console.error('Failed to open Instagram:', err));
}

// ==========================================
// HELPERS
// ==========================================

function formatStatus(status) {
    const labels = {
        contacted: 'Contacted',
        conversation: 'Conversation',
        scheduling: 'Scheduling',
        converted: 'Converted',
        not_interested: 'Not Interested',
    };
    return labels[status] || status || '-';
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
        + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}
