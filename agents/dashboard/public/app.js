let selectedLeads = new Set();
let currentLeads = []; // Track currently visible leads for "Select All"
let currentAccountId = null; // Selected account filter
let currentFilter = 'new';
let currentStepFilter = null; // New: track active step filter
let searchTimeout = null;

// Init
document.addEventListener('DOMContentLoaded', async () => {
    await loadAccounts();
    await loadDefaultAccount(); // New: Load default account filter
    loadBookings();
    loadStats();
    loadLeads(currentFilter);
});

// Load Accounts
async function loadAccounts() {
    const select = document.getElementById('accountSelect');
    try {
        const res = await fetch('/api/accounts');
        const accounts = await res.json();
        
        // Clear and repopulate
        select.innerHTML = '<option value="">Tous les comptes</option>';
        accounts.forEach(acc => {
            if (acc.id) {
                const opt = document.createElement('option');
                opt.value = acc.id;
                opt.textContent = acc.name;
                select.appendChild(opt);
            }
        });
    } catch (e) {
        console.error('Accounts load error', e);
    }
}

// Load Default Account
async function loadDefaultAccount() {
    try {
        const res = await fetch('/api/accounts/default');
        const defaultAcc = await res.json();
        
        if (defaultAcc && defaultAcc.id) {
            currentAccountId = defaultAcc.id;
            document.getElementById('accountSelect').value = defaultAcc.id;
            console.log(`📌 Default account set to: ${defaultAcc.name}`);
        }
    } catch (e) {
        console.error('Default account load error', e);
    }
}

// Set Current as Default
async function setDefaultAccount() {
    try {
        const res = await fetch('/api/accounts/set-default', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account_id: currentAccountId })
        });
        
        if (res.ok) {
            alert('📌 Ce compte sera maintenant affiché par défaut au démarrage.');
        } else {
            alert('Erreur lors de la définition du compte par défaut');
        }
    } catch (e) {
        console.error(e);
        alert('Erreur réseau');
    }
}

// Account change handler
function onAccountChange(accountId) {
    currentAccountId = accountId || null;
    loadStats();
    loadLeads(currentFilter);
}

// Load Bookings (Dedicated Section)

// Load Bookings - DEPRECATED / REMOVED BY USER REQUEST
async function loadBookings() {
   // Function kept empty to prevent errors if called, but UI section is gone.
   return;
}



// Load Stats
async function loadStats() {
    try {
        const params = currentAccountId ? `?account_id=${currentAccountId}` : '';
        const res = await fetch('/api/stats' + params);
        const data = await res.json();
        
        document.getElementById('stat-total_contacted').textContent = data.total_contacted;
        document.getElementById('stat-reply_rate').textContent = data.reply_rate + '%';
        document.getElementById('stat-conversation').textContent = data.conversation;
        document.getElementById('stat-manual').textContent = data.manual;
        document.getElementById('stat-booking_rate').textContent = data.booking_rate + '%';
        document.getElementById('stat-booked').textContent = data.booked;

        // Step Breakdown (Funnel)
        // Update funnel steps 1-5
        for (let i = 1; i <= 5; i++) {
            const count = data.step_breakdown[`step${i}`] || 0;
            const el = document.getElementById(`funnel-step-${i}`);
            if (el) el.textContent = count;
        }
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
            (filter === 'new' && (btn.textContent === 'New' || btn.textContent === 'To contact')) ||
            (filter === 'all' && btn.textContent === 'All') ||
            (filter === 'contacted' && (btn.textContent === 'Contacted' || btn.textContent === 'Contact')) ||
            (filter === 'conversation' && btn.textContent === 'Conversation') ||
            (filter === 'step5_new' && btn.textContent === 'Etape 5: New') ||
            (filter === 'step5_confirmed' && btn.textContent === 'Etape 5: Confirmed') ||
            (filter === 'step5_old' && btn.textContent === 'Etape 5: Old') ||
            (filter === 'booked' && btn.textContent === 'Booked') ||
            (filter === 'manual' && btn.textContent === 'Manual') ||
            (filter === 'not_interested' && btn.textContent === 'Not Interested') ||
            (filter === 'failed' && btn.textContent === 'Failed')) {
            btn.classList.add('active');
        }
    });
    
    const tbody = document.getElementById('leadsTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading...</td></tr>';
    
    // Clear selection on filter change
    clearSelection();

    try {
        const search = document.getElementById('searchInput').value;
        let apiFilter = filter;
        let isStep5Filter = filter.startsWith('step5_');

        if (isStep5Filter) {
            if (filter === 'step5_confirmed') {
                apiFilter = 'confirm_bookings';
            } else {
                // Fetch ALL leads at step 5 to filter them client-side by date/booking_status
                apiFilter = 'all';
            }
        }

        let url = `/api/leads?status=${apiFilter}&limit=500`; 
        
        if (currentAccountId) {
            url += `&account_id=${currentAccountId}`;
        }
        
        if (isStep5Filter && filter !== 'step5_confirmed') {
             url += `&conversation_step=5`;
        } else if (currentStepFilter) {
            url += `&conversation_step=${currentStepFilter}`;
        }

        if (search) {
            url += `&search=${encodeURIComponent(search)}`;
        }
        
        const res = await fetch(url);
        let leads = await res.json();

        // Apply Client-Side Filtering for Step 5 logic (New vs Old)
        if (filter === 'step5_new' || filter === 'step5_old') {
            const now = Date.now();
            const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

            leads = leads.filter(l => {
                // Keep only step 5 and active conversations
                const step = parseInt(l.conversation_step);
                if (step !== 5) return false;
                
                // Exclude booked/ignored/not interested
                if (l.booking_status === 'completed' || l.is_ignored) return false;
                if (['not_interested', 'failed', 'failed_outreach'].includes(l.status)) return false;

                // Parse date - SQLite gives 'YYYY-MM-DD HH:MM:SS'
                const dateStr = l.updated_at ? l.updated_at.replace(' ', 'T') + 'Z' : null;
                const lastUpdateTime = dateStr ? new Date(dateStr).getTime() : 0;
                
                const diff = now - (lastUpdateTime || 0);
                const isOld = diff > SEVEN_DAYS_MS;

                if (filter === 'step5_old') {
                    // Old contains anyone stale for > 7 days (including confirmed ones)
                    return isOld;
                }

                if (filter === 'step5_new') {
                    // New contains only NON-confirmed leads that are fresh
                    return !isOld && l.booking_status !== 'pending';
                }
                
                return true;
            });

            // Re-sort just in case to ensure most recent is always on top
            leads.sort((a, b) => {
                const dateA = a.updated_at ? new Date(a.updated_at.replace(' ', 'T') + 'Z').getTime() : 0;
                const dateB = b.updated_at ? new Date(b.updated_at.replace(' ', 'T') + 'Z').getTime() : 0;
                return dateB - dateA;
            });
        }

        currentLeads = leads; // Store for Select All
        
        if (!Array.isArray(leads)) {
            console.error('API Error:', leads);
            tbody.innerHTML = `<tr><td colspan="5" class="loading" style="color: var(--error)">Error: ${leads.error || 'Invalid API response'}</td></tr>`;
            return;
        }

        if (leads.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="loading">No leads found.</td></tr>';
            return;
        }

        tbody.innerHTML = ''; // Clear "Loading..." message
        leads.forEach(lead => {
            const tr = document.createElement('tr');
            
            // Type Badge Logic
            let typeBadgeClass = 'badge-neutral';
            if (lead.lead_type === 'hot') typeBadgeClass = 'badge-danger';
            if (lead.lead_type === 'warm') typeBadgeClass = 'badge-warning';

            // Define possible statuses for dropdown
            const statuses = [
                { val: 'new', label: 'New' },
                { val: 'image_analyzed', label: 'Analyzed' },
                { val: 'message_ready', label: 'Msg Ready' },
                { val: 'message_sent', label: 'Contacted' },
                { val: 'conversation', label: 'Conversation' },
                { val: 'manual', label: 'Manual/Vocal' },
                { val: 'scheduling', label: 'Confirm Booking' },
                // Special handling for Booked: it relies on booking_status='completed' usually, 
                // but setting status='conversation' and booking_status='completed' is how we did it.
                // However, let's just use 'booked' as a visual alias for convenience here.
                // We'll handle the update logic carefully below.
                { val: 'booked_completed', label: 'Booked (Done)' },
                { val: 'not_interested', label: 'Not Interested' },
                { val: 'failed_outreach', label: 'Failed' }
            ];

            // Determine current select value
            let currentSelectVal = lead.status;
            if (lead.booking_status === 'pending') currentSelectVal = 'scheduling';
            if (lead.booking_status === 'completed') currentSelectVal = 'booked_completed';

            // Generate options
            const optionsHtml = statuses.map(s => 
                `<option value="${s.val}" ${currentSelectVal === s.val ? 'selected' : ''}>${s.label}</option>`
            ).join('');

            // Dropdown HTML
            const statusDropdown = `
                <select onchange="onStatusDropdownChange('${lead.username}', this.value)" 
                        style="padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); font-size: 11px; cursor: pointer;">
                    ${optionsHtml}
                </select>
            `;

            tr.innerHTML = `
                <td>
                    <input type="checkbox" 
                           class="lead-checkbox" 
                           data-username="${lead.username}"
                           ${selectedLeads.has(lead.username) ? 'checked' : ''}
                           onchange="toggleLeadSelection('${lead.username}', this.checked)"
                           style="cursor: pointer;">
                </td>
                <td>
                    <div class="lead-info">
                        <div class="avatar" style="background: #30363d; display: flex; align-items: center; justify-content: center;">👤</div>
                        <div>
                            <div style="font-weight: 600;">@${lead.username}</div>
                            <div class="lead-bio-snippet" title="${lead.bio || ''}">${lead.bio ? (lead.bio.length > 60 ? lead.bio.substring(0, 57) + '...' : lead.bio) : '<span style="color: #484f58; font-style: italic;">No bio</span>'}</div>
                        </div>
                    </div>
                </td>
                <td>${statusDropdown}</td>
                <td>
                    <div style="font-weight: 700; color: var(--accent); text-align: center;">
                        ${lead.conversation_step || 0}
                    </div>
                </td>
                <td><span class="badge ${typeBadgeClass}">${(lead.lead_type || 'cold').toUpperCase()}</span></td>
                <td>
                    <div style="font-size: 12px; color: var(--text-secondary); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${lead.lead_source || 'Unknown'}">
                        ${lead.lead_source || 'Unknown'}
                    </div>
                </td>
                 <td>
                     <div style="display: flex; gap: 8px; align-items: center;">
                        <a href="https://instagram.com/${lead.username}" target="_blank" style="color: var(--accent); text-decoration: none; font-size: 13px;">Profile ↗</a>
                        <a href="/lead_details.html?username=${lead.username}" 
                           class="btn-action-icon" 
                           title="Lead Details" 
                           style="background: rgba(88, 166, 255, 0.1); border-radius: 4px; padding: 4px; text-decoration: none; display: flex; align-items: center; justify-content: center;">🔍</a>
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

// Search Logic with Debounce
function onSearchInput() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        loadLeads(currentFilter);
    }, 300); // 300ms debounce
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

// New Dropdown Change Handler
async function onStatusDropdownChange(username, newVal) {
    let updates = {};
    if (newVal === 'booked_completed') {
        updates = { booking_status: 'completed', status: 'conversation' }; // Or whatever status implies done
    } else if (newVal === 'scheduling') {
        updates = { booking_status: 'pending', status: 'scheduling' };
    } else {
        // Standard status change, reset booking
        updates = { status: newVal, booking_status: null };
    }
    
    await updateLead(username, updates);
}

// Selection Logic
function toggleSelectAll(checked) {
    const checkboxes = document.querySelectorAll('.lead-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = checked;
        const username = cb.getAttribute('data-username');
        if (checked) selectedLeads.add(username);
        else selectedLeads.delete(username);
    });
    updateBulkActionBar();
}

function toggleLeadSelection(username, checked) {
    if (checked) {
        selectedLeads.add(username);
    } else {
        selectedLeads.delete(username);
        // Deselect Select All if any lead is unchecked
        document.getElementById('selectAllLeads').checked = false;
    }
    updateBulkActionBar();
}

function updateBulkActionBar() {
    const bar = document.getElementById('bulkActionBar');
    const countSpan = document.getElementById('selectedCount');
    
    if (selectedLeads.size > 0) {
        bar.style.display = 'flex';
        countSpan.textContent = selectedLeads.size;
    } else {
        bar.style.display = 'none';
    }
}

function clearSelection() {
    selectedLeads.clear();
    const selectAll = document.getElementById('selectAllLeads');
    if (selectAll) selectAll.checked = false;
    updateBulkActionBar();
}

// Bulk Actions
async function bulkUpdateLeads(updates) {
    if (selectedLeads.size === 0) return;
    
    try {
        const usernames = Array.from(selectedLeads);
        const res = await fetch('/api/leads/bulk-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames, updates })
        });
        
        if (res.ok) {
            clearSelection();
            loadStats();
            loadLeads(currentFilter);
        } else {
            alert('Bulk update failed');
        }
    } catch (e) {
        console.error(e);
        alert('Error performing bulk update');
    }
}

function showBulkIgnoreConfirm() {
    const modal = document.getElementById('confirmModal');
    const title = document.getElementById('modalTitle');
    const text = document.getElementById('modalText');
    const confirmBtn = document.getElementById('modalConfirmBtn');
    
    title.textContent = `Ignore ${selectedLeads.size} leads?`;
    text.textContent = `All selected leads will be hidden from the dashboard and ignored by all agents.`;
    
    modal.style.display = 'flex';
    
    confirmBtn.onclick = async () => {
        await bulkUpdateLeads({ is_ignored: 1 });
        closeModal();
    };
}

// Modal Logic
function showIgnoreConfirm(username) {
    const modal = document.getElementById('confirmModal');
    const title = document.getElementById('modalTitle');
    const text = document.getElementById('modalText');
    const confirmBtn = document.getElementById('modalConfirmBtn');
    
    title.textContent = 'Ignore Lead?';
    text.textContent = 'This lead will be hidden from the dashboard and ignored by all agents.';
    
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

// Funnel Filtering
function filterByStep(step) {
    if (currentStepFilter === step) {
        currentStepFilter = null; // Toggle off if clicked again
    } else {
        currentStepFilter = step;
        currentFilter = 'all'; // Default to 'all' status when filtering by step
    }
    
    // Update UI highlights
    document.querySelectorAll('.funnel-step').forEach(el => {
        el.classList.remove('active');
        if (currentStepFilter) {
            el.classList.add('inactive');
        } else {
            el.classList.remove('inactive');
        }
    });
    
    if (currentStepFilter) {
        const activeCard = document.getElementById(`step-${currentStepFilter}-card`);
        if (activeCard) {
            activeCard.classList.remove('inactive');
            activeCard.classList.add('active');
        }
    }
    
    loadLeads(currentFilter);
}
