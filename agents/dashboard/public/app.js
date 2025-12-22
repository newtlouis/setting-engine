
// State
let currentFilter = 'all';

// Init
document.addEventListener('DOMContentLoaded', () => {
    loadBookings();
    loadStats();
    loadLeads('all');
});

// Load Bookings
async function loadBookings() {
    const section = document.getElementById('bookingsSection');
    const tbody = document.getElementById('bookingsTableBody');
    const badge = document.getElementById('bookingsCount');
    
    try {
        const res = await fetch('/api/bookings');
        const bookings = await res.json();
        
        if (bookings.length > 0) {
            section.style.display = 'block';
            section.classList.remove('hidden');
            badge.textContent = bookings.length;
            
            tbody.innerHTML = '';
            bookings.forEach(lead => {
                const tr = document.createElement('tr');
                const isCompleted = lead.booking_status === 'completed';
                
                tr.innerHTML = `
                    <td style="text-align: center;">
                        <input type="checkbox" ${isCompleted ? 'checked' : ''} 
                               onchange="toggleBooking('${lead.username}', this.checked)"
                               style="transform: scale(1.2); cursor: pointer;">
                    </td>
                    <td>
                        <div style="font-weight: 600;">@${lead.username}</div>
                        <a href="${lead.profile_url}" target="_blank" style="font-size: 12px; color: var(--text-secondary);">View Profile</a>
                    </td>
                    <td>${new Date(lead.updated_at).toLocaleDateString()}</td>
                    <td>
                        <span class="badge ${isCompleted ? 'badge-success' : 'badge-warning'}">
                            ${isCompleted ? 'DONE' : 'PENDING'}
                        </span>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        } else {
            section.style.display = 'none';
        }
    } catch (e) {
        console.error('Bookings load error', e);
    }
}

async function toggleBooking(username, completed) {
    try {
        await fetch(`/api/bookings/${username}/complete`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ completed })
        });
        // Reload to update UI
        loadBookings();
    } catch (e) {
        alert('Error updating booking');
    }
}

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
            
            if (lead.warmth === 'hot') {
                badgeClass = 'badge-success';
                statusText = 'Qualified';
            } else if (['message_sent', 'message_ready'].includes(lead.status)) {
                badgeClass = 'badge-warning';
                statusText = 'Contacted';
            } else if (lead.status === 'new') {
                badgeClass = 'badge-neutral';
                statusText = 'New';
            } else if (lead.status === 'failed_outreach') {
                badgeClass = 'badge-danger'; 
                statusText = 'Failed';
            }
            
            tr.innerHTML = `
                <td>
                    <div class="lead-info">
                        <div class="avatar" style="background: #30363d; display: flex; align-items: center; justify-content: center;">👤</div>
                        <div>
                            <div style="font-weight: 600;">@${lead.username}</div>
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
                            
                        ${lead.warmth !== 'hot' ? 
                            `<button onclick="updateLead('${lead.username}', {warmth: 'hot'})" style="padding: 4px 8px; background: rgba(56,139,253,0.15); border: 1px solid rgba(56,139,253,0.4); border-radius: 4px; color: #58a6ff; cursor: pointer; font-size: 11px;">Qualify</button>` 
                            : ''}

                        ${!lead.booking_status ? 
                            `<button onclick="updateLead('${lead.username}', {booking_status: 'pending', status: 'scheduling'})" style="padding: 4px 8px; background: rgba(63,185,80,0.15); border: 1px solid rgba(63,185,80,0.4); border-radius: 4px; color: #3fb950; cursor: pointer; font-size: 11px;">📅 Booked</button>` 
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
