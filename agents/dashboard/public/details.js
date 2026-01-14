// DOM Elements
const searchInput = document.getElementById('leadSearch');
const searchResults = document.getElementById('searchResults');
const detailsContent = document.getElementById('detailsContent');
const messageList = document.getElementById('messageList');
const btnSaveStatus = document.getElementById('btnSaveStatus');

// State
let searchTimeout = null;
let currentLead = null;
let currentAccountId = null;

// Init
document.addEventListener('DOMContentLoaded', async () => {
    await loadAccounts();
    await loadDefaultAccount();
});

// ==========================================
// ACCOUNT LOGIC
// ==========================================

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

function onAccountChange(accountId) {
    currentAccountId = accountId || null;
    // On details page, maybe filtering search results by account?
    // For now, details logic doesn't strictly depend on account unless we filter search
}

// ==========================================
// SEARCH LOGIC
// ==========================================

searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    
    // Clear previous timeout
    if (searchTimeout) clearTimeout(searchTimeout);
    
    if (query.length < 2) {
        searchResults.style.display = 'none';
        return;
    }
    
    // Debounce search
    searchTimeout = setTimeout(() => searchLeads(query), 300);
});

async function searchLeads(query) {
    try {
        const res = await fetch(`/api/leads?search=${encodeURIComponent(query)}&limit=10`);
        const leads = await res.json();
        
        // Render results
        searchResults.innerHTML = '';
        if (leads.length > 0) {
            leads.forEach(lead => {
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.innerHTML = `
                    <div style="font-weight: 600;">@${lead.username}</div>
                    <div style="font-size: 11px; color: #8b949e;">${lead.status} • ${lead.lead_type || 'cold'}</div>
                `;
                div.onclick = () => selectLead(lead.username);
                searchResults.appendChild(div);
            });
            searchResults.style.display = 'block';
        } else {
            searchResults.style.display = 'none';
        }
    } catch (err) {
        console.error('Search error:', err);
    }
}

// Hide search results when clicking outside
document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
        searchResults.style.display = 'none';
    }
});

// ==========================================
// LOAD DETAILS
// ==========================================

async function selectLead(username) {
    // UI Cleanup
    searchInput.value = username;
    searchResults.style.display = 'none';
    detailsContent.style.display = 'block';
    
    // Reset Fields
    resetFields();
    
    try {
        const res = await fetch(`/api/leads/${username}/details`);
        if (!res.ok) throw new Error('Failed to load details');
        
        const data = await res.json();
        const { lead, comments, messages } = data;
        currentLead = lead;
        
        // 1. Populate Info Fields
        document.getElementById('fieldUsername').value = lead.username;
        
        // Name Splitting Logic
        const fullName = lead.full_name || '';
        const nameParts = fullName.split(' ');
        if (nameParts.length > 1) {
             document.getElementById('fieldFirstName').value = nameParts[0];
             document.getElementById('fieldLastName').value = nameParts.slice(1).join(' ');
        } else {
             document.getElementById('fieldFirstName').value = fullName;
             document.getElementById('fieldLastName').value = '';
        }
        
        // Status Mapping
        const statusSelect = document.getElementById('fieldStatus');
        if (lead.booking_status === 'completed') {
             statusSelect.value = 'closed_won';
        } else if (lead.booking_status === 'pending') {
             statusSelect.value = 'scheduling';
        } else {
             // Fallback for standard statuses
             if (['new','outreach','conversation','failed'].includes(lead.status)) {
                 statusSelect.value = lead.status;
             } else {
                 statusSelect.value = 'conversation'; // Default fallback
             }
        }
        
        document.getElementById('fieldProfileUrl').value = lead.profile_url || '';
        document.getElementById('linkProfile').href = lead.profile_url || `https://instagram.com/${lead.username}`;
        
        document.getElementById('fieldDmUrl').value = lead.dm_url || 'Not available';
        if (lead.dm_url) {
            document.getElementById('linkDm').href = lead.dm_url;
            document.getElementById('linkDm').style.pointerEvents = 'auto';
            document.getElementById('linkDm').style.opacity = '1';
        } else {
            document.getElementById('linkDm').href = '#';
            document.getElementById('linkDm').style.pointerEvents = 'none';
            document.getElementById('linkDm').style.opacity = '0.5';
        }
        
        document.getElementById('fieldSource').value = lead.lead_source || 'Unknown';
        
        // Comment Logic
        if (comments && comments.length > 0) {
            document.getElementById('fieldComment').value = comments[0].comment_text; // First comment is usually source
        } else {
            document.getElementById('fieldComment').value = 'No comment data available.';
        }
        
        // 2. Render Conversation
        renderMessages(messages);
        
    } catch (err) {
        console.error('Error loading details:', err);
        alert('Error loading lead details.');
    }
}

function resetFields() {
    document.getElementById('fieldUsername').value = 'Loading...';
    document.getElementById('fieldFirstName').value = '';
    document.getElementById('fieldLastName').value = '';
    document.getElementById('fieldStatus').value = 'new';
    document.getElementById('fieldProfileUrl').value = '';
    document.getElementById('fieldDmUrl').value = '';
    document.getElementById('fieldSource').value = '';
    document.getElementById('fieldComment').value = '';
    messageList.innerHTML = '<div style="text-align:center; padding: 20px;">Loading history...</div>';
}

function renderMessages(messages) {
    messageList.innerHTML = '';
    
    if (!messages || messages.length === 0) {
        messageList.innerHTML = '<div style="text-align: center; color: var(--text-secondary); margin-top: 50px;">Aucun message échangé pour le moment.</div>';
        return;
    }
    
    messages.forEach(msg => {
        const div = document.createElement('div');
        div.className = `message-bubble ${msg.role === 'user' ? 'msg-user' : 'msg-assistant'}`;
        
        const date = new Date(msg.sent_at).toLocaleString('fr-FR', { 
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
        });
        
        div.innerHTML = `
            <span class="msg-meta">${msg.role === 'user' ? '👤 Prospect' : '🤖 Assistant'} • ${date}</span>
            ${msg.message_text}
        `;
        
        messageList.appendChild(div);
    });
    
    // Scroll to bottom
    messageList.scrollTop = messageList.scrollHeight;
}

// ==========================================
// SAVE LOGIC
// ==========================================

btnSaveStatus.addEventListener('click', async () => {
    if (!currentLead) return;
    
    const newStatus = document.getElementById('fieldStatus').value;
    const firstName = document.getElementById('fieldFirstName').value.trim();
    const lastName = document.getElementById('fieldLastName').value.trim();
    
    const updates = {
       full_name: `${firstName} ${lastName}`.trim()
    };
    
    // Status Logic Mapping
    if (newStatus === 'scheduling') {
        updates.status = 'scheduling';
        updates.booking_status = 'pending';
    } else if (newStatus === 'closed_won') {
        updates.status = 'scheduling'; // Keep as scheduling or conversation
        updates.booking_status = 'completed';
    } else {
        updates.status = newStatus;
        updates.booking_status = ''; // Clear booking status if moved back
    }
    
    // API Call
    try {
        const res = await fetch(`/api/leads/${currentLead.username}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        
        if (res.ok) {
            const btn = document.getElementById('btnSaveStatus');
            const originalText = btn.textContent;
            btn.textContent = 'Saved!';
            btn.style.background = '#238636'; // darker green
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.background = 'var(--success)';
            }, 2000);
            
            // Refresh details to confirm (optional, mostly for consistency)
            selectLead(currentLead.username);
        } else {
            alert('Failed to save changes.');
        }
    } catch (err) {
        console.error(err);
        alert('Network error while saving.');
    }
});
