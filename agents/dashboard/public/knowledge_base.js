/**
 * Knowledge Base (RAG) Management Page
 */

// State
let currentAccountId = null;
let currentCategory = '';
let entries = [];
let deleteTargetId = null;

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    loadAccounts();
    setupEventListeners();
});

// Setup
function setupEventListeners() {
    // Account selector
    document.getElementById('accountSelect').addEventListener('change', (e) => {
        currentAccountId = e.target.value ? parseInt(e.target.value) : null;
        loadData();
    });

    // Category filters
    document.querySelectorAll('.category-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.category-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            currentCategory = item.dataset.category;
            renderEntries();
        });
    });

    // Test on Enter
    document.getElementById('testMessage').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') testRag();
    });

    // Close modal on overlay click
    document.getElementById('entryModal').addEventListener('click', (e) => {
        if (e.target.id === 'entryModal') closeModal();
    });
    document.getElementById('deleteModal').addEventListener('click', (e) => {
        if (e.target.id === 'deleteModal') closeDeleteModal();
    });
}

// Load accounts
async function loadAccounts() {
    try {
        const res = await fetch('/api/accounts');
        const accounts = await res.json();

        const select = document.getElementById('accountSelect');
        select.innerHTML = '<option value="">Selectionner un compte</option>';

        accounts.forEach(acc => {
            const option = document.createElement('option');
            option.value = acc.id;
            option.textContent = acc.name;
            if (acc.is_default) option.selected = true;
            select.appendChild(option);
        });

        // Load default account
        const defaultRes = await fetch('/api/accounts/default');
        const defaultAcc = await defaultRes.json();
        if (defaultAcc) {
            currentAccountId = defaultAcc.id;
            select.value = defaultAcc.id;
            loadData();
        }
    } catch (err) {
        console.error('Failed to load accounts:', err);
    }
}

// Load all data
async function loadData() {
    if (!currentAccountId) return;

    await Promise.all([
        loadEntries(),
        loadStats()
    ]);
}

// Load entries
async function loadEntries() {
    if (!currentAccountId) return;

    try {
        const url = `/api/knowledge-base?account_id=${currentAccountId}`;
        const res = await fetch(url);
        entries = await res.json();

        updateCategoryCounts();
        renderEntries();
    } catch (err) {
        console.error('Failed to load entries:', err);
    }
}

// Load stats
async function loadStats() {
    if (!currentAccountId) return;

    try {
        const res = await fetch(`/api/knowledge-base/stats?account_id=${currentAccountId}`);
        const stats = await res.json();

        document.getElementById('statTotal').textContent = stats.knowledgeBase?.total_entries || 0;
        document.getElementById('statWithEmbedding').textContent = stats.knowledgeBase?.with_embeddings || 0;
        document.getElementById('statUsage').textContent = stats.knowledgeBase?.total_usage || 0;
        document.getElementById('statCategories').textContent = stats.knowledgeBase?.categories || 0;
    } catch (err) {
        console.error('Failed to load stats:', err);
    }
}

// Update category counts
function updateCategoryCounts() {
    const counts = {
        all: entries.length,
        objection: 0,
        faq: 0,
        technique: 0,
        success_story: 0,
        product: 0
    };

    entries.forEach(e => {
        if (counts[e.category] !== undefined) {
            counts[e.category]++;
        }
    });

    document.getElementById('countAll').textContent = counts.all;
    document.getElementById('countObjection').textContent = counts.objection;
    document.getElementById('countFaq').textContent = counts.faq;
    document.getElementById('countTechnique').textContent = counts.technique;
    document.getElementById('countSuccessStory').textContent = counts.success_story;
    document.getElementById('countProduct').textContent = counts.product;
}

// Render entries
function renderEntries() {
    const container = document.getElementById('entryList');
    const filtered = currentCategory
        ? entries.filter(e => e.category === currentCategory)
        : entries;

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">&#128218;</div>
                <p>Aucune entree ${currentCategory ? 'dans cette categorie' : 'dans la knowledge base'}</p>
                <button class="btn btn-primary" onclick="openCreateModal()">Creer une entree</button>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(entry => `
        <div class="entry-card">
            <div class="entry-header">
                <span class="entry-category ${entry.category}">${formatCategory(entry.category)}</span>
                <div class="entry-actions">
                    <button class="btn btn-sm btn-secondary" onclick="openEditModal(${entry.id})">Modifier</button>
                    <button class="btn btn-sm btn-danger" onclick="openDeleteModal(${entry.id})">Supprimer</button>
                </div>
            </div>
            ${entry.situation ? `<div class="entry-situation">${escapeHtml(entry.situation)}</div>` : ''}
            <div class="entry-content">${escapeHtml(entry.content)}</div>
            ${entry.triggerKeywords && entry.triggerKeywords.length > 0 ? `
                <div class="entry-keywords">
                    ${entry.triggerKeywords.map(kw => `<span class="keyword-tag">${escapeHtml(kw)}</span>`).join('')}
                </div>
            ` : ''}
            <div class="entry-meta">
                <span>${entry.hasEmbedding ? '&#10003; Embedding' : '&#10007; Pas d\'embedding'}</span>
                <span>Utilisations: ${entry.usageCount || 0}</span>
                ${entry.successRate ? `<span>Succes: ${Math.round(entry.successRate * 100)}%</span>` : ''}
            </div>
        </div>
    `).join('');
}

// Format category name
function formatCategory(category) {
    const names = {
        objection: 'Objection',
        faq: 'FAQ',
        technique: 'Technique',
        success_story: 'Success Story',
        product: 'Produit'
    };
    return names[category] || category;
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Modal functions
function openCreateModal() {
    document.getElementById('modalTitle').textContent = 'Nouvelle entree';
    document.getElementById('entryId').value = '';
    document.getElementById('entryCategory').value = 'objection';
    document.getElementById('entrySituation').value = '';
    document.getElementById('entryContent').value = '';
    document.getElementById('entryKeywords').value = '';
    document.getElementById('entryModal').classList.add('active');
}

function openEditModal(id) {
    const entry = entries.find(e => e.id === id);
    if (!entry) return;

    document.getElementById('modalTitle').textContent = 'Modifier l\'entree';
    document.getElementById('entryId').value = entry.id;
    document.getElementById('entryCategory').value = entry.category;
    document.getElementById('entrySituation').value = entry.situation || '';
    document.getElementById('entryContent').value = entry.content;
    document.getElementById('entryKeywords').value = (entry.triggerKeywords || []).join(', ');
    document.getElementById('entryModal').classList.add('active');
}

function closeModal() {
    document.getElementById('entryModal').classList.remove('active');
}

async function saveEntry() {
    const id = document.getElementById('entryId').value;
    const category = document.getElementById('entryCategory').value;
    const situation = document.getElementById('entrySituation').value.trim();
    const content = document.getElementById('entryContent').value.trim();
    const keywords = document.getElementById('entryKeywords').value
        .split(',')
        .map(k => k.trim())
        .filter(k => k);

    if (!content) {
        alert('Le contenu est obligatoire');
        return;
    }

    try {
        const url = id ? `/api/knowledge-base/${id}` : '/api/knowledge-base';
        const method = id ? 'PATCH' : 'POST';

        const body = {
            account_id: currentAccountId,
            category,
            situation,
            content,
            trigger_keywords: keywords
        };

        if (id) {
            body.regenerate_embedding = true;
        }

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error);
        }

        closeModal();
        await loadData();
    } catch (err) {
        alert('Erreur: ' + err.message);
    }
}

// Delete functions
function openDeleteModal(id) {
    deleteTargetId = id;
    document.getElementById('deleteModal').classList.add('active');
}

function closeDeleteModal() {
    deleteTargetId = null;
    document.getElementById('deleteModal').classList.remove('active');
}

async function confirmDelete() {
    if (!deleteTargetId) return;

    try {
        const res = await fetch(`/api/knowledge-base/${deleteTargetId}`, {
            method: 'DELETE'
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error);
        }

        closeDeleteModal();
        await loadData();
    } catch (err) {
        alert('Erreur: ' + err.message);
    }
}

// Test RAG
async function testRag() {
    const message = document.getElementById('testMessage').value.trim();
    if (!message) return;

    const resultsDiv = document.getElementById('testResults');
    resultsDiv.textContent = 'Recherche en cours...';

    try {
        const res = await fetch('/api/knowledge-base/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                account_id: currentAccountId,
                message
            })
        });

        const data = await res.json();

        if (data.relevantKnowledge.length === 0) {
            resultsDiv.textContent = 'Aucun resultat pertinent trouve.';
            return;
        }

        let output = `Resultats pour: "${message}"\n`;
        output += '='.repeat(50) + '\n\n';

        data.relevantKnowledge.forEach((k, i) => {
            output += `[${k.score}%] [${k.category.toUpperCase()}]\n`;
            if (k.situation) output += `Situation: ${k.situation}\n`;
            output += `${k.content}\n`;
            output += '\n' + '-'.repeat(30) + '\n\n';
        });

        output += '\n--- PROMPT FORMATE ---\n\n';
        output += data.formattedPrompt;

        resultsDiv.textContent = output;
    } catch (err) {
        resultsDiv.textContent = 'Erreur: ' + err.message;
    }
}

// Generate embeddings
async function generateEmbeddings() {
    if (!currentAccountId) return;

    try {
        const res = await fetch('/api/knowledge-base/generate-embeddings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account_id: currentAccountId })
        });

        const data = await res.json();
        alert(`Embeddings generes: ${data.generated} nouveaux (${data.alreadyHad} existants)`);
        await loadData();
    } catch (err) {
        alert('Erreur: ' + err.message);
    }
}
