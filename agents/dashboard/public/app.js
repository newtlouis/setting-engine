
// State
let currentFilter = 'all';

// Init
document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    loadLeads('all');
});

// Load Stats
async function loadStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        
        document.getElementById('stat-total').textContent = data.total;
        document.getElementById('stat-new').textContent = data.new;
        document.getElementById('stat-contacted').textContent = data.contacted;
        document.getElementById('stat-qualified').textContent = data.qualified;
        document.getElementById('stat-failed').textContent = data.failed;
    } catch (e) {
        console.error('Stats load error', e);
    }
}

// Load Leads
async function loadLeads(filter) {
    currentFilter = filter;
    
    // Update active button
    document.querySelectorAll('.btn-filter').forEach(btn => btn.classList.remove('active'));
    event?.target?.classList.add('active');
    
    const tbody = document.getElementById('leadsTableBody');
    tbody.innerHTML = '<tr><td colspan="5" class="loading">Loading...</td></tr>';

    try {
        const res = await fetch(`/api/leads?status=${filter}&limit=100`);
        const leads = await res.json();
        
        if (!Array.isArray(leads)) {
            console.error('API Error:', leads);
            tbody.innerHTML = `<tr><td colspan="5" class="loading" style="color: var(--error)">Error: ${leads.error || 'Invalid API response'}</td></tr>`;
            return;
        }

        if (leads.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="loading">No leads found.</td></tr>';
            return;
        }

        leads.forEach(lead => {
            const tr = document.createElement('tr');
            
            // Status Badge Logic
            let badgeClass = 'badge-neutral';
            let statusText = lead.status;
            
            if (lead.conversation_stage === 'qualified') {
                badgeClass = 'badge-success';
                statusText = 'Qualified';
            } else if (['message_sent', 'message_ready'].includes(lead.status)) {
                badgeClass = 'badge-warning';
                statusText = 'Contacted';
            } else if (lead.status === 'new') {
                badgeClass = 'badge-neutral';
                statusText = 'New';
            } else if (lead.status === 'failed_outreach' || lead.is_private) {
                badgeClass = 'badge-danger'; 
                statusText = lead.is_private ? 'Private' : 'Failed';
            }
            
            tr.innerHTML = `
                <td>
                    <div class="lead-info">
                        <div class="avatar" style="background: #30363d; display: flex; align-items: center; justify-content: center;">👤</div>
                        <div>
                            <div style="font-weight: 600;">@${lead.username}</div>
                            <div style="font-size: 11px; color: #8b949e;">${lead.followers_count?.toLocaleString() || 0} followers</div>
                        </div>
                    </div>
                </td>
                <td><span class="badge ${badgeClass}">${statusText}</span></td>
                <td>
                    <div style="font-weight: 500;">${lead.engagement_score || 0}</div>
                </td>
                <td>${lead.comment_count}</td>
                 <td>
                     <div style="display: flex; gap: 8px; align-items: center;">
                        <a href="https://instagram.com/${lead.username}" target="_blank" style="color: var(--accent); text-decoration: none; font-size: 13px;">Profile ↗</a>
                        
                        <!-- Quick Actions -->
                        ${lead.status === 'new' ? 
                            `<button onclick="updateLead('${lead.username}', {status: 'message_ready'})" style="padding: 4px 8px; background: #238636; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 11px;">Add to Queue</button>` 
                            : ''}
                            
                        ${lead.conversation_stage !== 'qualified' ? 
                            `<button onclick="updateLead('${lead.username}', {conversation_stage: 'qualified'})" style="padding: 4px 8px; background: rgba(56,139,253,0.15); border: 1px solid rgba(56,139,253,0.4); border-radius: 4px; color: #58a6ff; cursor: pointer; font-size: 11px;">Qualify</button>` 
                            : ''}
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
        
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" class="loading" style="color: var(--error)">Error loading data: ${e.message}</td></tr>`;
    }
}

async function updateLead(username, updates) {
    if (!confirm(`Update ${username}?`)) return;
    
    try {
        const res = await fetch(`/api/leads/${username}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        
        if (res.ok) {
            // Refresh logic - simplified recharge
            loadStats();
            loadLeads(currentFilter);
        } else {
            alert('Update failed');
        }
    } catch (e) {
        console.error(e);
        alert('Error updating lead');
    }
}
