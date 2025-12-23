
// Init
document.addEventListener('DOMContentLoaded', () => {
    loadBookings();
    loadStats();
    loadLeads('new');
});

// Load Bookings (Dedicated Section)
async function loadBookings() {
    const section = document.getElementById('bookingsSection');
    const tbody = document.getElementById('bookingsTableBody');
    const badge = document.getElementById('bookingsCount');
    
    try {
        const res = await fetch('/api/bookings');
        const bookings = await res.json();
        
        // Filter to show only pending bookings
        const pendingBookings = bookings.filter(lead => lead.booking_status === 'pending');
        
        if (pendingBookings.length > 0) {
            section.style.display = 'block';
            badge.textContent = pendingBookings.length;
            
            tbody.innerHTML = '';
            pendingBookings.forEach(lead => {
                const tr = document.createElement('tr');
                
                tr.innerHTML = `
                    <td style="text-align: center;">
                        <input type="checkbox" 
                               onchange="toggleBooking('${lead.username}', this.checked)"
                               style="transform: scale(1.2); cursor: pointer;">
                    </td>
                    <td>
                        <div style="font-weight: 600;">@${lead.username}</div>
                        <a href="${lead.profile_url || 'https://instagram.com/' + lead.username}" target="_blank" style="font-size: 12px; color: var(--text-secondary);">View Profile</a>
                    </td>
                    <td>${new Date(lead.updated_at).toLocaleDateString()}</td>
                    <td>
                        <span class="badge badge-warning">PENDING</span>
                    </td>
                    <td style="text-align: right;">
                        <button onclick="showIgnoreConfirm('${lead.username}')" 
                                class="btn-action-icon" 
                                title="Ignore Lead">🗑️</button>
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
        loadStats();
    } catch (e) {
        alert('Error updating booking');
    }
}


// Load Stats
async function loadStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        
        document.getElementById('stat-new').textContent = data.new;
        document.getElementById('stat-contacted').textContent = data.contacted;
        document.getElementById('stat-conversation').textContent = data.conversation;
        document.getElementById('stat-confirm_bookings').textContent = data.confirm_bookings;
        document.getElementById('stat-booked').textContent = data.booked;
    } catch (e) {
        console.error('Stats load error', e);
    }
}

// Load Leads
async function loadLeads(filter) {
    currentFilter = filter;
    
    // Update active button
    document.querySelectorAll('.btn-filter').forEach(btn => {
        btn.classList.remove('active');
        // Set active based on filter match
        if (btn.textContent.toLowerCase().includes(filter.replace('_', ' ')) || 
            (filter === 'new' && btn.textContent === 'New') ||
            (filter === 'all' && btn.textContent === 'All') ||
            (filter === 'contacted' && btn.textContent === 'Contacted') ||
            (filter === 'conversation' && btn.textContent === 'Conversation') ||
            (filter === 'confirm_bookings' && btn.textContent === 'Confirm Bookings') ||
            (filter === 'booked' && btn.textContent === 'Booked') ||
            (filter === 'failed' && btn.textContent === 'Failed')) {
            btn.classList.add('active');
        }
    });
    
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

        tbody.innerHTML = ''; // Clear "Loading..." message
        leads.forEach(lead => {
            const tr = document.createElement('tr');
            
            // Status Badge Logic
            let badgeClass = 'badge-neutral';
            let statusText = lead.status;
            
            if (lead.booking_status === 'completed') {
                 badgeClass = 'badge-success';
                 statusText = 'Booked';
            } else if (lead.booking_status === 'pending') {
                 badgeClass = 'badge-success';
                 statusText = 'Confirm Booking';
            } else if (lead.status === 'conversation') {
                 badgeClass = 'badge-neutral';
                 statusText = 'Conversation';
            } else if (lead.warmth === 'hot') {
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
            
            // Action Button Logic
            let actionButtons = '';
            
            if (filter === 'confirm_bookings') {
                 actionButtons = `<button onclick="updateLead('${lead.username}', {booking_status: 'completed'})" style="padding: 4px 8px; background: rgba(63,185,80,0.15); border: 1px solid rgba(63,185,80,0.4); border-radius: 4px; color: #3fb950; cursor: pointer; font-size: 11px;">✅ Done</button>`;
            } else if (filter === 'booked') {
                 actionButtons = `<button onclick="updateLead('${lead.username}', {booking_status: 'pending'})" style="padding: 4px 8px; background: rgba(210,153,34,0.15); border: 1px solid rgba(210,153,34,0.4); border-radius: 4px; color: #e3b341; cursor: pointer; font-size: 11px;">↩️ Undo</button>`;
            } else if (filter !== 'booked' && !lead.booking_status) {
                 actionButtons = `<button onclick="updateLead('${lead.username}', {booking_status: 'pending', status: 'scheduling'})" style="padding: 4px 8px; background: rgba(56,139,253,0.15); border: 1px solid rgba(56,139,253,0.4); border-radius: 4px; color: #58a6ff; cursor: pointer; font-size: 11px;">📅 Booked</button>`;
            }

            // Type Badge Logic
            let typeBadgeClass = 'badge-neutral';
            if (lead.lead_type === 'hot') typeBadgeClass = 'badge-danger';
            if (lead.lead_type === 'warm') typeBadgeClass = 'badge-warning';

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
                <td><span class="badge ${typeBadgeClass}">${(lead.lead_type || 'cold').toUpperCase()}</span></td>
                <td>
                    <div style="font-size: 12px; color: var(--text-secondary); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${lead.lead_source || 'Unknown'}">
                        ${lead.lead_source || 'Unknown'}
                    </div>
                </td>
                 <td>
                     <div style="display: flex; gap: 8px; align-items: center;">
                        <a href="https://instagram.com/${lead.username}" target="_blank" style="color: var(--accent); text-decoration: none; font-size: 13px;">Profile ↗</a>
                        ${actionButtons}
                        <button onclick="showIgnoreConfirm('${lead.username}')" 
                                class="btn-action-icon" 
                                title="Ignore Lead">🗑️</button>
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
    try {
        const res = await fetch(`/api/leads/${username}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        
        if (res.ok) {
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

// Modal Logic
function showIgnoreConfirm(username) {
    const modal = document.getElementById('confirmModal');
    const confirmBtn = document.getElementById('modalConfirmBtn');
    
    modal.style.display = 'flex';
    
    confirmBtn.onclick = async () => {
        await updateLead(username, { is_ignored: 1 });
        closeModal();
    };
}

function closeModal() {
    document.getElementById('confirmModal').style.display = 'none';
}

// Close modal on background click
window.onclick = (event) => {
    const modal = document.getElementById('confirmModal');
    if (event.target == modal) {
        closeModal();
    }
};
