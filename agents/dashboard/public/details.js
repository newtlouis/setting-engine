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
            searchResults.innerHTML = '<div style="padding:10px; color:#8b949e; font-size:13px;">Aucun résultat</div>';
            searchResults.style.display = 'block';
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
             if (['new','outreach','conversation','failed'].includes(lead.status)) {
                 statusSelect.value = lead.status;
             } else {
                 statusSelect.value = 'conversation'; 
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
        
        // Comment Logic + Post URL
        if (comments && comments.length > 0) {
            const firstComment = comments[0];
            document.getElementById('fieldComment').value = firstComment.comment_text; 
            
            // Post URL Logic
            const postUrl = firstComment.post_url;
            if (postUrl) {
                document.getElementById('fieldPostUrl').value = postUrl;
                document.getElementById('linkPost').href = postUrl;
                document.getElementById('linkPost').style.opacity = '1';
                document.getElementById('linkPost').style.pointerEvents = 'auto';
            } else {
                document.getElementById('fieldPostUrl').value = 'No Post URL';
                document.getElementById('linkPost').style.opacity = '0.5';
                document.getElementById('linkPost').style.pointerEvents = 'none';
            }

        } else {
            document.getElementById('fieldComment').value = 'No comment data available.';
            document.getElementById('fieldPostUrl').value = '';
            document.getElementById('linkPost').style.opacity = '0.5';
            document.getElementById('linkPost').style.pointerEvents = 'none';
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
    document.getElementById('fieldPostUrl').value = '';
    
    document.getElementById('linkPost').style.opacity = '0.5';
    document.getElementById('linkPost').style.pointerEvents = 'none';

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
        updates.status = 'scheduling'; 
        updates.booking_status = 'completed';
    } else {
        updates.status = newStatus;
        updates.booking_status = ''; 
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
            btn.style.background = '#238636'; 
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.background = 'var(--success)';
            }, 2000);
            
            // Refresh details
            selectLead(currentLead.username);
        } else {
            alert('Failed to save changes.');
        }
    } catch (err) {
        console.error(err);
        alert('Network error while saving.');
    }
});

// ==========================================
// MANUAL LEAD CREATION
// ==========================================

function showAddLeadModal() {
    document.getElementById('addLeadModal').style.display = 'flex';
    document.getElementById('newUsername').focus();
}

function closeAddLeadModal() {
    document.getElementById('addLeadModal').style.display = 'none';
    // Clear inputs
    document.getElementById('newUsername').value = '';
    document.getElementById('newProfileUrl').value = '';
    document.getElementById('newStatus').value = 'new';
}

async function createLead() {
    const username = document.getElementById('newUsername').value.trim();
    const profileUrl = document.getElementById('newProfileUrl').value.trim();
    const status = document.getElementById('newStatus').value;
    
    if (!username || !profileUrl) {
        alert('Username et Profile URL sont requis.');
        return;
    }
    
    try {
        const res = await fetch('/api/leads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                profile_url: profileUrl,
                status,
                account_id: currentAccountId // Optional: link to currently viewed account if selected
            })
        });
        
        const data = await res.json();
        
        if (res.ok) {
            closeAddLeadModal();
            // Load the newly created lead immediately
            selectLead(username);
        } else {
            alert(data.error || 'Erreur lors de la création');
        }
    } catch (err) {
        console.error(err);
        alert('Erreur réseau');
    }
}

// Close modal on outside click
window.onclick = (event) => {
    const modal = document.getElementById('addLeadModal');
    if (event.target == modal) {
        closeAddLeadModal();
    }
};
