let selectedLeads = new Set();
let currentLeads = []; // Track currently visible leads for "Select All"
let currentAccountId = null; // Selected account filter
let currentFilter = 'new';
let currentStepFilter = null; // New: track active step filter
let searchTimeout = null;

// Init
document.addEventListener('DOMContentLoaded', async () => {
    await loadAccounts();
    await loadDefaultAccount();
    loadFunnelAnalytics(); // New: Load funnel analytics
    loadStats(); // Keep for backward compat
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
    loadFunnelAnalytics();
    loadLeads(currentFilter);
}




// Load Stats (legacy - kept for compatibility)
async function loadStats() {
    // Stats are now loaded via loadFunnelAnalytics()
}

// Load Funnel Analytics (New)
async function loadFunnelAnalytics() {
    try {
        const params = currentAccountId ? `?account_id=${currentAccountId}` : '';
        const res = await fetch('/api/analytics/funnel' + params);
        const data = await res.json();

        // Update summary stats
        document.getElementById('stat-total_contacted').textContent = data.summary.totalContacted;
        document.getElementById('stat-replied').textContent = data.summary.totalReplied;
        document.getElementById('stat-reply_rate').textContent = `${data.summary.replyRate}% taux`;
        document.getElementById('stat-booked').textContent = data.summary.booked;
        document.getElementById('stat-booking_rate').textContent = `${data.summary.bookingRate}% taux`;

        // Calculate contacts per booking ratio
        const contactsPerBooking = data.summary.booked > 0
            ? Math.ceil(data.summary.totalContacted / data.summary.booked)
            : '-';
        document.getElementById('stat-booking_ratio').textContent =
            contactsPerBooking !== '-' ? `1 RDV / ${contactsPerBooking} contacts` : '-';

        document.getElementById('stat-not_interested').textContent = data.summary.notInterested;

        // Render funnel bars
        renderFunnelAnalysis(data.funnel, data.summary.totalContacted);

        // Render source performance
        renderSourcePerformance(data.sourceStats);

        // Render step counts from distribution
        renderStepCounts(data.stepDistribution);

        // Show insight if any
        const insightAlert = document.getElementById('insightAlert');
        const insightText = document.getElementById('insightText');
        if (data.insights.recommendation) {
            insightText.textContent = data.insights.recommendation;
            insightAlert.style.display = 'block';
        } else {
            insightAlert.style.display = 'none';
        }

    } catch (e) {
        console.error('Funnel analytics load error', e);
    }
}

// Render funnel analysis bars
function renderFunnelAnalysis(funnel, maxCount) {
    const container = document.getElementById('funnelAnalysis');
    if (!container) return;

    const colors = [
        'linear-gradient(90deg, #d29922 0%, #e3b341 100%)',  // Contactés
        'linear-gradient(90deg, #1f6feb 0%, #58a6ff 100%)',  // Ont répondu
        'linear-gradient(90deg, #8b5cf6 0%, #a78bfa 100%)',  // Connexion
        'linear-gradient(90deg, #db61a2 0%, #f778ba 100%)',  // Exploration
        'linear-gradient(90deg, #f97316 0%, #fb923c 100%)',  // Objectif
        'linear-gradient(90deg, #06b6d4 0%, #22d3ee 100%)',  // Appel
        'linear-gradient(90deg, #22c55e 0%, #4ade80 100%)'   // RDV Confirmé
    ];

    let html = '';
    funnel.forEach((step, idx) => {
        // Use 'reached' for bar width (flow through funnel)
        const reached = step.reached || step.count;
        const pct = maxCount > 0 ? (reached / maxCount * 100) : 0;
        const barWidth = Math.max(pct, 2); // Minimum 2% for visibility

        // Determine dropoff badge class
        let dropoffClass = 'dropoff-low';
        const dropoffVal = parseFloat(step.dropoff) || 0;
        if (dropoffVal > 50) dropoffClass = 'dropoff-high';
        else if (dropoffVal > 25) dropoffClass = 'dropoff-medium';

        html += `
            <div class="funnel-row">
                <div class="funnel-label">${step.label}</div>
                <div class="funnel-bar-container">
                    <div class="funnel-bar" style="width: ${barWidth}%; background: ${colors[idx] || colors[0]};">
                        <span class="funnel-bar-text">${reached}</span>
                    </div>
                </div>
                <div class="funnel-dropoff">
                    ${step.dropoff !== null
                        ? `<span class="dropoff-badge ${dropoffClass}">-${step.dropoff}%</span>`
                        : '<span style="color: var(--text-secondary);">—</span>'}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// Render source performance table
function renderSourcePerformance(sourceStats) {
    const container = document.getElementById('sourcePerformance');
    if (!container) return;

    if (!sourceStats || sourceStats.length === 0) {
        container.innerHTML = '<div style="color: var(--text-secondary); font-size: 13px;">Aucune donnée</div>';
        return;
    }

    let html = `
        <table class="source-table">
            <thead>
                <tr>
                    <th>Source</th>
                    <th>Total</th>
                    <th>Réponses</th>
                    <th>RDV</th>
                </tr>
            </thead>
            <tbody>
    `;

    sourceStats.forEach(src => {
        html += `
            <tr>
                <td style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${src.source}">${src.source}</td>
                <td>${src.total}</td>
                <td>${src.replied} <span style="color: var(--text-secondary);">(${src.replyRate}%)</span></td>
                <td>${src.booked} <span style="color: var(--text-secondary);">(${src.bookingRate}%)</span></td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

// Render step counts mini cards from stepDistribution
function renderStepCounts(stepDistribution) {
    const container = document.getElementById('stepCounts');
    if (!container) return;

    // Create a map of step -> count
    const stepMap = {};
    (stepDistribution || []).forEach(s => {
        stepMap[s.step] = (stepMap[s.step] || 0) + s.count;
    });

    let html = '';
    for (let stepNum = 2; stepNum <= 5; stepNum++) {
        const count = stepMap[stepNum] || 0;
        const isActive = currentStepFilter === stepNum;
        html += `
            <div class="step-mini ${isActive ? 'active' : ''}" onclick="filterByStep(${stepNum})">
                <div class="step-mini-num">Step ${stepNum}</div>
                <div class="step-mini-val">${count}</div>
            </div>
        `;
    }

    container.innerHTML = html;
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
             url += `&funnel_step=5`;
        } else if (currentStepFilter) {
            url += `&funnel_step=${currentStepFilter}`;
        }

        if (search) {
            url += `&search=${encodeURIComponent(search)}`;
        }
        
        const res = await fetch(url);
        let leads = await res.json();

        // Apply Client-Side Filtering for Step 5 logic (New vs Old)
        if (isStep5Filter) {
            if (filter === 'step5_new' || filter === 'step5_old') {
                const now = Date.now();
                const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

                leads = leads.filter(l => {
                    // Keep only step 5 and active conversations
                    const step = parseInt(l.funnel_step);
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
            }

            // ALWAYS re-sort Step 5 tabs explicitly by updated_at DESC
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
                        ${lead.funnel_step || 0}
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

    // Update step-mini cards highlighting
    document.querySelectorAll('.step-mini').forEach(el => {
        el.classList.remove('active');
    });

    if (currentStepFilter) {
        const allMinis = document.querySelectorAll('.step-mini');
        if (allMinis[currentStepFilter - 1]) {
            allMinis[currentStepFilter - 1].classList.add('active');
        }
    }

    loadLeads(currentFilter);
}
