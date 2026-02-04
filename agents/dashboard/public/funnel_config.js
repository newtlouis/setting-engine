/**
 * Funnel Configuration Page JavaScript
 * Manages funnel stages, follow-up templates, and account persona configuration
 */

let currentAccountId = null;
let stages = [];
let templates = [];
let persona = null;

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    await loadAccounts();
});

async function loadAccounts() {
    const select = document.getElementById('accountSelect');
    try {
        const res = await fetch('/api/accounts');
        const accounts = await res.json();

        select.innerHTML = '<option value="">Choisir un compte</option>';
        accounts.forEach(acc => {
            if (acc.id) {
                const opt = document.createElement('option');
                opt.value = acc.id;
                opt.textContent = acc.name;
                select.appendChild(opt);
            }
        });

        // Try to load default account
        const defaultRes = await fetch('/api/accounts/default');
        const defaultAcc = await defaultRes.json();
        if (defaultAcc && defaultAcc.id) {
            currentAccountId = defaultAcc.id;
            select.value = defaultAcc.id;
            loadAllData();
        }
    } catch (e) {
        console.error('Error loading accounts:', e);
    }
}

function onAccountChange(accountId) {
    if (!accountId) {
        currentAccountId = null;
        showEmptyState();
        return;
    }
    currentAccountId = parseInt(accountId);
    loadAllData();
}

function showEmptyState() {
    document.getElementById('stagesContainer').innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">📊</div>
            <h3>Selectionnez un compte</h3>
            <p>Choisissez un compte dans le menu deroulant pour configurer son funnel.</p>
        </div>
    `;
    document.getElementById('templatesContainer').innerHTML = document.getElementById('stagesContainer').innerHTML;
    document.getElementById('personaContainer').innerHTML = document.getElementById('stagesContainer').innerHTML;
    document.getElementById('promptContainer').innerHTML = document.getElementById('stagesContainer').innerHTML;
    document.getElementById('statsContainer').innerHTML = document.getElementById('stagesContainer').innerHTML;
}

async function loadAllData() {
    if (!currentAccountId) return;

    // Load stages and templates first (they depend on each other for rendering)
    await Promise.all([
        loadStagesData(),
        loadTemplatesData()
    ]);

    // Now render both sections with all data available
    renderStages();
    renderTemplatesSection();

    // Load other data in parallel
    await Promise.all([
        loadPersona(),
        loadStats()
    ]);
}

// ============================================
// NAVIGATION
// ============================================

function showSection(sectionName) {
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    event.currentTarget.classList.add('active');

    // Update sections
    document.querySelectorAll('.config-section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(`section-${sectionName}`).classList.add('active');

    // Load data if needed
    if (sectionName === 'prompt' && currentAccountId) {
        refreshPromptPreview();
    }
}

// ============================================
// FUNNEL STAGES
// ============================================

// Load stages data only (no rendering)
async function loadStagesData() {
    if (!currentAccountId) return;

    try {
        const res = await fetch(`/api/funnel-stages?account_id=${currentAccountId}`);
        stages = await res.json();
    } catch (e) {
        console.error('Error loading stages:', e);
        stages = [];
    }
}

// Load stages and render
async function loadStages() {
    if (!currentAccountId) return;

    const container = document.getElementById('stagesContainer');
    container.innerHTML = '<div class="loading" style="padding: 40px;">Chargement...</div>';

    await loadStagesData();

    if (stages.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📊</div>
                <h3>Aucune etape configuree</h3>
                <p>Ce compte n'a pas encore de configuration de funnel.</p>
                <button class="btn-primary" onclick="initializeDefaultStages()">Initialiser les etapes par defaut</button>
            </div>
        `;
        return;
    }

    renderStages();
}

function renderStages() {
    const container = document.getElementById('stagesContainer');

    if (stages.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📊</div>
                <h3>Aucune etape configuree</h3>
                <p>Ce compte n'a pas encore de configuration de funnel.</p>
                <button class="btn-primary" onclick="initializeDefaultStages()">Initialiser les etapes par defaut</button>
            </div>
        `;
        return;
    }

    // API returns camelCase, so we use stageOrder, stageName, stageLabel, etc.
    container.innerHTML = stages.map(stage => `
        <div class="stage-card" id="stage-${stage.id}">
            <div class="stage-header" onclick="toggleStage(${stage.id})">
                <div class="stage-info">
                    <div class="stage-number">${stage.stageOrder || stage.stage_order}</div>
                    <div class="stage-title">
                        <h3>${stage.stageLabel || stage.stage_label}</h3>
                        <span>${stage.stageName || stage.stage_name} - ${stage.description || 'Pas de description'}</span>
                    </div>
                </div>
                <div class="stage-actions">
                    <span style="color: var(--text-secondary); font-size: 12px;">
                        ${stage.maxFollowups || stage.max_followups || 0} relances max
                    </span>
                    <button class="btn-icon" onclick="event.stopPropagation();">
                        ${(stage.isActive !== undefined ? stage.isActive : stage.is_active) ? '✅' : '⏸️'}
                    </button>
                </div>
            </div>
            <div class="stage-body" id="stage-body-${stage.id}">
                <div class="form-group">
                    <label>Nom de l'etape (interne)</label>
                    <input type="text" class="form-input" value="${stage.stageName || stage.stage_name || ''}"
                           onchange="updateStageField(${stage.id}, 'stage_name', this.value)">
                </div>
                <div class="form-group">
                    <label>Label (affiche)</label>
                    <input type="text" class="form-input" value="${stage.stageLabel || stage.stage_label || ''}"
                           onchange="updateStageField(${stage.id}, 'stage_label', this.value)">
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <input type="text" class="form-input" value="${stage.description || ''}"
                           onchange="updateStageField(${stage.id}, 'description', this.value)">
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;">
                    <div class="form-group">
                        <label>Max Relances</label>
                        <input type="number" class="form-input" value="${stage.maxFollowups || stage.max_followups || 0}" min="0"
                               onchange="updateStageField(${stage.id}, 'max_followups', parseInt(this.value))">
                    </div>
                    <div class="form-group">
                        <label>Delai (heures)</label>
                        <input type="number" class="form-input" value="${stage.followupDelayHours || stage.followup_delay_hours || 24}" min="1"
                               onchange="updateStageField(${stage.id}, 'followup_delay_hours', parseInt(this.value))">
                    </div>
                    <div class="form-group">
                        <label>Auto-ignorer apres max?</label>
                        <select class="form-input" onchange="updateStageField(${stage.id}, 'auto_ignore_after_max', this.value === 'true')">
                            <option value="false" ${!(stage.autoIgnoreAfterMax || stage.auto_ignore_after_max) ? 'selected' : ''}>Non</option>
                            <option value="true" ${(stage.autoIgnoreAfterMax || stage.auto_ignore_after_max) ? 'selected' : ''}>Oui</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label>Script de Conversation (Instructions pour l'IA)</label>
                    <textarea class="form-textarea" style="min-height: 200px;"
                              onchange="updateConversationScript(${stage.id}, this.value)"
                              placeholder="Instructions pour l'IA a cette etape...">${stage.conversationScript || stage.conversation_script || ''}</textarea>
                    <p class="form-hint">Ce script sera utilise par l'IA pour guider la conversation a cette etape du funnel.</p>
                </div>

                <!-- Templates for this stage -->
                <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <label style="margin: 0;">Templates de Relance pour cette etape</label>
                        <button class="btn-secondary btn-small" onclick="addTemplateToStage(${stage.id})">+ Ajouter</button>
                    </div>
                    <div id="stage-templates-${stage.id}" class="templates-list">
                        ${renderTemplatesForStage(stage.id)}
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

function toggleStage(stageId) {
    const body = document.getElementById(`stage-body-${stageId}`);
    body.classList.toggle('expanded');
}

async function updateStageField(stageId, field, value) {
    try {
        const res = await fetch(`/api/funnel-stages/${stageId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [field]: value })
        });

        if (!res.ok) throw new Error('Update failed');

        // Update local data
        const stage = stages.find(s => s.id === stageId);
        if (stage) stage[field] = value;

        showToast('Stage mis a jour', 'success');
    } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
    }
}

async function updateConversationScript(stageId, script) {
    try {
        const res = await fetch(`/api/funnel-stages/${stageId}/script`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversation_script: script })
        });

        if (!res.ok) throw new Error('Update failed');

        // Update local data
        const stage = stages.find(s => s.id === stageId);
        if (stage) stage.conversation_script = script;

        showToast('Script de conversation mis a jour', 'success');
    } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
    }
}

async function initializeDefaultStages() {
    if (!currentAccountId) return;

    try {
        const res = await fetch(`/api/funnel-stages/initialize/${currentAccountId}`, {
            method: 'POST'
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error);
        }

        showToast('Etapes initialisees avec succes', 'success');
        await loadStages();
        await loadTemplates();
    } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
    }
}

async function addNewStage() {
    if (!currentAccountId) return;

    const nextOrder = stages.length > 0 ? Math.max(...stages.map(s => s.stage_order)) + 1 : 1;

    try {
        const res = await fetch('/api/funnel-stages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                account_id: currentAccountId,
                stage_order: nextOrder,
                stage_name: `step${nextOrder}`,
                stage_label: `Nouvelle Etape ${nextOrder}`,
                description: '',
                max_followups: 2,
                followup_delay_hours: 24
            })
        });

        if (!res.ok) throw new Error('Creation failed');

        showToast('Etape ajoutee', 'success');
        await loadStages();
    } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
    }
}

// ============================================
// FOLLOW-UP TEMPLATES
// ============================================

// Load templates data only (no rendering)
async function loadTemplatesData() {
    if (!currentAccountId) return;

    try {
        const res = await fetch(`/api/followup-templates?account_id=${currentAccountId}`);
        templates = await res.json();
    } catch (e) {
        console.error('Error loading templates:', e);
        templates = [];
    }
}

// Load templates and render
async function loadTemplates() {
    if (!currentAccountId) return;

    await loadTemplatesData();
    renderTemplatesSection();
}

function renderTemplatesSection() {
    const container = document.getElementById('templatesContainer');

    if (templates.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📝</div>
                <h3>Aucun template de relance</h3>
                <p>Ajoutez des templates depuis les etapes du funnel ou utilisez le bouton ci-dessous.</p>
                <button class="btn-primary" onclick="showAddTemplateModal()">+ Ajouter un template</button>
            </div>
        `;
        return;
    }

    // Group templates by stage for display
    const templatesByStage = {};
    templates.forEach(t => {
        const stageId = t.stageId || t.stage_id;
        if (!templatesByStage[stageId]) {
            templatesByStage[stageId] = [];
        }
        templatesByStage[stageId].push(t);
    });

    // Build a simple table view of all templates
    container.innerHTML = `
        <div style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
            <p style="color: var(--text-secondary); margin: 0;">${templates.length} template(s) au total</p>
            <button class="btn-secondary btn-small" onclick="showAddTemplateModal()">+ Ajouter un template</button>
        </div>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th style="width: 100px;">Etape</th>
                        <th style="width: 50px;">Ordre</th>
                        <th>Nom</th>
                        <th>Message</th>
                        <th style="width: 120px;">Stats</th>
                        <th style="width: 80px;">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${templates.map(t => {
                        const stageId = t.stageId || t.stage_id;
                        const stage = stages.find(s => s.id === stageId);
                        const stageLabel = stage ? (stage.stageLabel || stage.stage_label) : 'N/A';
                        const stageOrder = stage ? (stage.stageOrder || stage.stage_order) : '?';
                        const order = (t.templateOrder !== undefined ? t.templateOrder : t.template_order) + 1;
                        const name = t.templateName || t.template_name || 'Sans nom';
                        const text = t.templateText || t.template_text || '';
                        const usage = t.usageCount || t.usage_count || 0;
                        const success = t.successCount || t.success_count || 0;
                        const rate = usage > 0 ? Math.round((success / usage) * 100) : 0;

                        return `
                            <tr>
                                <td>
                                    <span class="badge badge-neutral">Etape ${stageOrder}</span>
                                </td>
                                <td style="text-align: center; font-weight: 600;">${order}</td>
                                <td><strong>${escapeHtml(name)}</strong></td>
                                <td>
                                    <div style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text-secondary);" title="${escapeHtml(text)}">
                                        ${escapeHtml(text.substring(0, 80))}${text.length > 80 ? '...' : ''}
                                    </div>
                                </td>
                                <td>
                                    <span style="font-size: 11px; color: var(--text-secondary);">
                                        ${usage} envois${usage > 0 ? ` (${rate}%)` : ''}
                                    </span>
                                </td>
                                <td>
                                    <div style="display: flex; gap: 4px;">
                                        <button class="btn-icon" onclick="editTemplateModal(${t.id})" title="Modifier">✏️</button>
                                        <button class="btn-icon danger" onclick="deleteTemplate(${t.id})" title="Supprimer">🗑️</button>
                                    </div>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderTemplatesForStage(stageId) {
    // API returns camelCase: stageId
    const stageTemplates = templates.filter(t => (t.stageId || t.stage_id) === stageId);

    if (stageTemplates.length === 0) {
        return '<p style="color: var(--text-secondary); font-size: 12px;">Aucun template de relance</p>';
    }

    return stageTemplates.map(t => renderTemplateItem(t)).join('');
}

function renderTemplateItem(template) {
    // API returns camelCase: templateOrder, templateName, templateText, usageCount, successCount
    const order = template.templateOrder !== undefined ? template.templateOrder : template.template_order;
    const name = template.templateName || template.template_name || 'Template';
    const text = template.templateText || template.template_text || '';
    const usage = template.usageCount || template.usage_count || 0;
    const success = template.successCount || template.success_count || 0;

    return `
        <div class="template-item" id="template-${template.id}">
            <div class="template-order">${order + 1}</div>
            <div class="template-content">
                <div style="margin-bottom: 8px;">
                    <strong style="font-size: 12px; color: var(--accent);">${name}</strong>
                    ${usage > 0 ? `
                        <span style="margin-left: 8px; font-size: 11px; color: var(--text-secondary);">
                            ${usage} envois | ${success} succes
                        </span>
                    ` : ''}
                </div>
                <div style="white-space: pre-wrap; font-size: 13px;">${text}</div>
            </div>
            <div class="template-actions">
                <button class="btn-icon" onclick="editTemplate(${template.id})" title="Modifier">✏️</button>
                <button class="btn-icon danger" onclick="deleteTemplate(${template.id})" title="Supprimer">🗑️</button>
            </div>
        </div>
    `;
}

async function addTemplateToStage(stageId) {
    const stageTemplates = templates.filter(t => (t.stageId || t.stage_id) === stageId);
    const nextOrder = stageTemplates.length;

    const text = prompt('Texte du template de relance:');
    if (!text) return;

    const name = prompt('Nom du template (optionnel):', `Relance ${nextOrder + 1}`);

    try {
        const res = await fetch('/api/followup-templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                stage_id: stageId,
                account_id: currentAccountId,
                template_order: nextOrder,
                template_text: text,
                template_name: name || `Relance ${nextOrder + 1}`
            })
        });

        if (!res.ok) throw new Error('Creation failed');

        showToast('Template ajoute', 'success');
        await loadTemplatesData();
        renderStages();
        renderTemplatesSection();
    } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
    }
}

function showAddTemplateModal() {
    // Build stage options
    const stageOptions = stages.map(s => {
        const order = s.stageOrder || s.stage_order;
        const label = s.stageLabel || s.stage_label;
        return `<option value="${s.id}">Etape ${order}: ${label}</option>`;
    }).join('');

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'addTemplateModal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px; text-align: left;">
            <div class="modal-title">Ajouter un template de relance</div>
            <div class="form-group">
                <label>Etape du funnel</label>
                <select class="form-input" id="newTemplateStage">
                    ${stageOptions}
                </select>
            </div>
            <div class="form-group">
                <label>Nom du template</label>
                <input type="text" class="form-input" id="newTemplateName" placeholder="Ex: Relance douce">
            </div>
            <div class="form-group">
                <label>Message</label>
                <textarea class="form-textarea" id="newTemplateText" placeholder="Coucou {{firstName}} 🌸..." style="min-height: 120px;"></textarea>
                <p class="form-hint">Utilisez {{firstName}} pour inserer le prenom du prospect.</p>
            </div>
            <div class="modal-actions" style="justify-content: flex-end;">
                <button class="btn-modal btn-cancel" onclick="closeAddTemplateModal()">Annuler</button>
                <button class="btn-modal btn-primary" onclick="submitNewTemplate()">Ajouter</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Close on background click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeAddTemplateModal();
    });
}

function closeAddTemplateModal() {
    const modal = document.getElementById('addTemplateModal');
    if (modal) modal.remove();
}

async function submitNewTemplate() {
    const stageId = parseInt(document.getElementById('newTemplateStage').value);
    const name = document.getElementById('newTemplateName').value;
    const text = document.getElementById('newTemplateText').value;

    if (!text.trim()) {
        showToast('Le message est requis', 'error');
        return;
    }

    const stageTemplates = templates.filter(t => (t.stageId || t.stage_id) === stageId);
    const nextOrder = stageTemplates.length;

    try {
        const res = await fetch('/api/followup-templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                stage_id: stageId,
                account_id: currentAccountId,
                template_order: nextOrder,
                template_text: text,
                template_name: name || `Relance ${nextOrder + 1}`
            })
        });

        if (!res.ok) throw new Error('Creation failed');

        closeAddTemplateModal();
        showToast('Template ajoute', 'success');
        await loadTemplatesData();
        renderStages();
        renderTemplatesSection();
    } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
    }
}

function editTemplateModal(templateId) {
    const template = templates.find(t => t.id === templateId);
    if (!template) return;

    const currentName = template.templateName || template.template_name || '';
    const currentText = template.templateText || template.template_text || '';

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'editTemplateModal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px; text-align: left;">
            <div class="modal-title">Modifier le template</div>
            <div class="form-group">
                <label>Nom du template</label>
                <input type="text" class="form-input" id="editTemplateName" value="${escapeHtml(currentName)}">
            </div>
            <div class="form-group">
                <label>Message</label>
                <textarea class="form-textarea" id="editTemplateText" style="min-height: 120px;">${escapeHtml(currentText)}</textarea>
                <p class="form-hint">Utilisez {{firstName}} pour inserer le prenom du prospect.</p>
            </div>
            <div class="modal-actions" style="justify-content: flex-end;">
                <button class="btn-modal btn-cancel" onclick="closeEditTemplateModal()">Annuler</button>
                <button class="btn-modal btn-primary" onclick="submitEditTemplate(${templateId})">Sauvegarder</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeEditTemplateModal();
    });
}

function closeEditTemplateModal() {
    const modal = document.getElementById('editTemplateModal');
    if (modal) modal.remove();
}

async function submitEditTemplate(templateId) {
    const name = document.getElementById('editTemplateName').value;
    const text = document.getElementById('editTemplateText').value;

    if (!text.trim()) {
        showToast('Le message est requis', 'error');
        return;
    }

    try {
        const res = await fetch(`/api/followup-templates/${templateId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                template_name: name,
                template_text: text
            })
        });

        if (!res.ok) throw new Error('Update failed');

        closeEditTemplateModal();
        showToast('Template mis a jour', 'success');
        await loadTemplatesData();
        renderStages();
        renderTemplatesSection();
    } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
    }
}

async function editTemplate(templateId) {
    // Use the modal version instead
    editTemplateModal(templateId);
}

async function deleteTemplate(templateId) {
    if (!confirm('Supprimer ce template?')) return;

    try {
        const res = await fetch(`/api/followup-templates/${templateId}`, {
            method: 'DELETE'
        });

        if (!res.ok) throw new Error('Delete failed');

        showToast('Template supprime', 'success');
        await loadTemplatesData();
        renderStages();
        renderTemplatesSection();
    } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
    }
}

// ============================================
// PERSONA
// ============================================

async function loadPersona() {
    if (!currentAccountId) return;

    const container = document.getElementById('personaContainer');

    try {
        const res = await fetch(`/api/personas/${currentAccountId}`);

        if (res.status === 404) {
            persona = null;
            renderPersonaForm(null);
            return;
        }

        if (!res.ok) throw new Error('Load failed');

        persona = await res.json();
        renderPersonaForm(persona);
    } catch (e) {
        console.error('Error loading persona:', e);
        renderPersonaForm(null);
    }
}

function renderPersonaForm(data) {
    const container = document.getElementById('personaContainer');

    // API returns camelCase: personaName, communicationRules, objectionsScript, knowledgeBase, postBookingMessage
    const name = data?.personaName || data?.persona_name || '';
    const niche = data?.niche || '';
    const communication = data?.communicationRules || data?.communication_rules || '';
    const objections = data?.objectionsScript || data?.objections_script || '';
    const knowledge = data?.knowledgeBase || data?.knowledge_base || '';
    const postBooking = data?.postBookingMessage || data?.post_booking_message || '';

    container.innerHTML = `
        <div class="persona-section">
            <div class="form-group">
                <label>Nom du Persona</label>
                <input type="text" class="form-input" id="persona-name"
                       value="${escapeHtml(name)}"
                       placeholder="Ex: Melanie - Coach Dependance Affective">
            </div>
            <div class="form-group">
                <label>Niche</label>
                <input type="text" class="form-input" id="persona-niche"
                       value="${escapeHtml(niche)}"
                       placeholder="Ex: Dependance affective, hypersensibilite">
            </div>
            <div class="form-group full-width">
                <label>Regles de Communication</label>
                <textarea class="form-textarea" id="persona-communication"
                          placeholder="Regles specifiques pour le ton, le style, les emojis...">${escapeHtml(communication)}</textarea>
                <p class="form-hint">Ces regles seront ajoutees au prompt pour guider le style de communication de l'IA.</p>
            </div>
            <div class="form-group full-width">
                <label>Script de Gestion des Objections</label>
                <textarea class="form-textarea" id="persona-objections" style="min-height: 200px;"
                          placeholder="Comment repondre aux objections courantes (prix, temps, etc.)...">${escapeHtml(objections)}</textarea>
            </div>
            <div class="form-group full-width">
                <label>Knowledge Base</label>
                <textarea class="form-textarea" id="persona-knowledge" style="min-height: 150px;"
                          placeholder="Informations sur l'offre, les prix, le processus...">${escapeHtml(knowledge)}</textarea>
                <p class="form-hint">Informations factuelles que l'IA peut utiliser pour repondre aux questions.</p>
            </div>
            <div class="form-group full-width">
                <label>Message Post-Booking</label>
                <textarea class="form-textarea" id="persona-postbooking"
                          placeholder="Message envoye apres confirmation d'un RDV...">${escapeHtml(postBooking)}</textarea>
            </div>
        </div>
    `;
}

async function savePersona() {
    if (!currentAccountId) return;

    const data = {
        account_id: currentAccountId,
        persona_name: document.getElementById('persona-name').value,
        niche: document.getElementById('persona-niche').value,
        communication_rules: document.getElementById('persona-communication').value,
        objections_script: document.getElementById('persona-objections').value,
        knowledge_base: document.getElementById('persona-knowledge').value,
        post_booking_message: document.getElementById('persona-postbooking').value
    };

    if (!data.persona_name) {
        showToast('Le nom du persona est requis', 'error');
        return;
    }

    try {
        const method = persona ? 'PATCH' : 'POST';
        const url = persona ? `/api/personas/${currentAccountId}` : '/api/personas';

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!res.ok) throw new Error('Save failed');

        persona = await res.json();
        showToast('Persona sauvegarde', 'success');
    } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
    }
}

// ============================================
// PROMPT PREVIEW
// ============================================

async function refreshPromptPreview() {
    if (!currentAccountId) return;

    const container = document.getElementById('promptContainer');
    container.innerHTML = '<div class="loading" style="padding: 40px;"><div class="loading-spinner"></div> Generation du prompt...</div>';

    try {
        const res = await fetch(`/api/prompt-preview/${currentAccountId}`);

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error);
        }

        const data = await res.json();

        container.innerHTML = `
            <div class="prompt-stats">
                <div class="prompt-stat">
                    <div class="prompt-stat-value">${data.stagesCount}</div>
                    <div class="prompt-stat-label">Etapes</div>
                </div>
                <div class="prompt-stat">
                    <div class="prompt-stat-value">${data.promptLength.toLocaleString()}</div>
                    <div class="prompt-stat-label">Caracteres</div>
                </div>
                <div class="prompt-stat">
                    <div class="prompt-stat-value">${data.persona ? 'Oui' : 'Non'}</div>
                    <div class="prompt-stat-label">Persona</div>
                </div>
            </div>
            <div class="prompt-preview">
                <pre>${escapeHtml(data.prompt)}</pre>
            </div>
        `;
    } catch (e) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">⚠️</div>
                <h3>Impossible de generer le prompt</h3>
                <p>${e.message}</p>
            </div>
        `;
    }
}

// ============================================
// STATS
// ============================================

async function loadStats() {
    if (!currentAccountId) return;

    const container = document.getElementById('statsContainer');

    try {
        const res = await fetch(`/api/funnel-stats/${currentAccountId}`);
        if (!res.ok) throw new Error('Load failed');

        const data = await res.json();
        renderStats(data);
    } catch (e) {
        container.innerHTML = `<div class="error-scenarios">Erreur: ${e.message}</div>`;
    }
}

function renderStats(data) {
    const container = document.getElementById('statsContainer');

    if (!data.stageStats || data.stageStats.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📈</div>
                <h3>Pas encore de donnees</h3>
                <p>Les statistiques apparaitront une fois que des templates auront ete utilises.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <h3 style="font-size: 16px; margin-bottom: 16px;">Performance par Etape</h3>
        <div class="table-container" style="margin-bottom: 24px;">
            <table>
                <thead>
                    <tr>
                        <th>Etape</th>
                        <th>Templates</th>
                        <th>Envois Total</th>
                        <th>Succes</th>
                        <th>Taux</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.stageStats.map(s => `
                        <tr>
                            <td><strong>${s.stage_name}</strong></td>
                            <td>${s.template_count || 0}</td>
                            <td>${s.total_usage || 0}</td>
                            <td>${s.total_success || 0}</td>
                            <td>
                                <span class="badge ${s.avg_success_rate > 30 ? 'badge-success' : s.avg_success_rate > 10 ? 'badge-warning' : 'badge-neutral'}">
                                    ${s.avg_success_rate || 0}%
                                </span>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <h3 style="font-size: 16px; margin-bottom: 16px;">Performance par Template</h3>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Template</th>
                        <th>Etape</th>
                        <th>Envois</th>
                        <th>Succes</th>
                        <th>Taux</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.templates.map(t => `
                        <tr>
                            <td>
                                <div style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                    ${t.template_name || t.template_text.substring(0, 50)}...
                                </div>
                            </td>
                            <td>${t.stage_name}</td>
                            <td>${t.usage_count || 0}</td>
                            <td>${t.success_count || 0}</td>
                            <td>
                                <span class="badge ${t.success_rate > 30 ? 'badge-success' : t.success_rate > 10 ? 'badge-warning' : 'badge-neutral'}">
                                    ${t.success_rate || 0}%
                                </span>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ============================================
// UTILITIES
// ============================================

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const icon = document.getElementById('toastIcon');
    const msg = document.getElementById('toastMessage');

    icon.textContent = type === 'success' ? '✅' : '❌';
    msg.textContent = message;

    toast.className = `toast ${type}`;
    toast.classList.add('visible');

    setTimeout(() => {
        toast.classList.remove('visible');
    }, 3000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
