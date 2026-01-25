// Scenario Tester JavaScript

let currentConversation = [];
let scenarios = [];
let outreachTemplates = {};

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    loadScenarios();
    loadOutreachTemplates();
});

async function loadOutreachTemplates() {
    try {
        const response = await fetch('/api/outreach-templates?profile=melanie');
        const data = await response.json();
        outreachTemplates = data;
        
        // Initialize with default selected type if templates loaded successfully
        onConversationTypeChange();
    } catch (err) {
        console.error('Failed to load templates:', err);
    }
}

// ============================================
// CONVERSATION TYPE
// ============================================

async function onConversationTypeChange() {
    const type = document.getElementById('conversationType').value;
    
    if (!type) return;
    
    // Clear current conversation
    currentConversation = [];
    const chatContainer = document.getElementById('chatContainer');
    chatContainer.innerHTML = '';
    
    // Get initial message based on type
    let initialMessage = '';
    
    switch(type) {
        case 'cold':
            initialMessage = 'Hello 🙂';
            break;
        case 'follower':
            initialMessage = outreachTemplates.follower || 'Hello 🌷';
            break;
        case 'like':
            initialMessage = outreachTemplates.like || 'Hello 🌺';
            break;
        case 'comment':
            initialMessage = outreachTemplates.comment || 'Coucou 🌸';
            break;
    }
    
    // Replace placeholder with generic name
    initialMessage = initialMessage.replace(/\{\{firstName\}\}/g, 'Sophie');
    
    // Add agent's first message
    const agentMessage = { role: 'assistant', text: initialMessage };
    currentConversation.push(agentMessage);
    displayMessage(agentMessage);
    
    // Enable save button
    document.getElementById('saveBtn').disabled = false;
}

// ============================================
// CHAT INTERFACE
// ============================================

function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    // Add user message to conversation
    const userMessage = { role: 'user', text: message };
    currentConversation.push(userMessage);
    
    // Display user message
    displayMessage(userMessage);
    
    // Clear input
    input.value = '';
    
    // Show loading
    showTyping();
    
    try {
        // Call API to get AI response
        const response = await fetch('/api/test-scenarios/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversationHistory: currentConversation,
                profile: 'melanie'
            })
        });
        
        const data = await response.json();
        
        // Remove typing indicator
        removeTyping();
        
        if (data.error) {
            showError(data.error);
            return;
        }
        
        // Add AI message to conversation
        const aiMessage = { 
            role: 'assistant', 
            text: data.message,
            step_used: data.step_used
        };
        currentConversation.push(aiMessage);
        
        // Display AI message
        displayMessage(aiMessage);
        
        // Enable save button
        document.getElementById('saveBtn').disabled = false;
        
    } catch (err) {
        removeTyping();
        showError('Failed to get AI response: ' + err.message);
    }
}

function displayMessage(message) {
    const chatContainer = document.getElementById('chatContainer');
    
    // Remove welcome message if it exists
    const welcome = chatContainer.querySelector('.chat-welcome');
    if (welcome) {
        welcome.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${message.role}`;
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    
    const roleLabel = message.role === 'user' ? '👤 Prospect' : '🤖 Assistant';
    
    bubble.innerHTML = `
        <div style="font-weight: 700; margin-bottom: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.9;">${roleLabel}</div>
        <div style="white-space: pre-wrap;">${escapeHtml(message.text)}</div>
    `;
    
    // Add step indicator for AI messages
    if (message.role === 'assistant' && message.step_used) {
        const stepBadge = document.createElement('span');
        stepBadge.className = 'step-badge';
        stepBadge.style.marginTop = '8px';
        stepBadge.style.display = 'inline-block';
        stepBadge.textContent = `Step ${message.step_used}`;
        bubble.appendChild(stepBadge);
    }
    
    messageDiv.appendChild(bubble);
    chatContainer.appendChild(messageDiv);
    
    // Scroll to bottom
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function showTyping() {
    const chatContainer = document.getElementById('chatContainer');
    const typingDiv = document.createElement('div');
    typingDiv.className = 'chat-message assistant';
    typingDiv.id = 'typingIndicator';
    typingDiv.innerHTML = '<div class="message-bubble typing"><span>•</span><span>•</span><span>•</span></div>';
    chatContainer.appendChild(typingDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function removeTyping() {
    const typing = document.getElementById('typingIndicator');
    if (typing) typing.remove();
}

function showError(message) {
    const chatContainer = document.getElementById('chatContainer');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'chat-message system';
    errorDiv.innerHTML = `<div class="message-bubble error">❌ ${message}</div>`;
    chatContainer.appendChild(errorDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function clearConversation() {
    if (currentConversation.length === 0) return;
    
    if (!confirm('Effacer la conversation en cours ?')) return;
    
    currentConversation = [];
    const chatContainer = document.getElementById('chatContainer');
    chatContainer.innerHTML = '<div class="chat-welcome"><p>🤖 Testez vos scénarios de conversation avec l\'IA</p><p style="font-size: 12px; color: var(--text-secondary); margin-top: 8px;">Sélectionnez un type de conversation ci-dessus pour commencer</p></div>';
    
    // Reset type selector
    document.getElementById('conversationType').value = '';
    
    document.getElementById('saveBtn').disabled = true;
}

// ============================================
// SAVE SCENARIO
// ============================================

function showSaveDialog() {
    if (currentConversation.length === 0) return;
    document.getElementById('saveDialog').style.display = 'flex';
    document.getElementById('scenarioName').focus();
}

function closeSaveDialog() {
    document.getElementById('saveDialog').style.display = 'none';
    document.getElementById('scenarioName').value = '';
}

async function saveScenario() {
    const name = document.getElementById('scenarioName').value.trim();
    
    if (!name) {
        alert('Veuillez entrer un nom pour le scénario');
        return;
    }
    
    try {
        const response = await fetch('/api/test-scenarios', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                messages: currentConversation
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            alert('Erreur: ' + data.error);
            return;
        }
        
        // Close dialog
        closeSaveDialog();
        
        // Reload scenarios list
        await loadScenarios();
        
        // Show success message
        showSuccessMessage('Scénario sauvegardé avec succès!');
        
        // Clear conversation
        clearConversation();
        
    } catch (err) {
        alert('Failed to save scenario: ' + err.message);
    }
}

function showSuccessMessage(message) {
    const chatContainer = document.getElementById('chatContainer');
    const successDiv = document.createElement('div');
    successDiv.className = 'chat-message system';
    successDiv.innerHTML = `<div class="message-bubble success">✅ ${message}</div>`;
    chatContainer.appendChild(successDiv);
    
    setTimeout(() => {
        successDiv.remove();
    }, 3000);
}

// ============================================
// SCENARIOS LIST
// ============================================

async function loadScenarios() {
    const listContainer = document.getElementById('scenariosList');
    listContainer.innerHTML = '<div class="loading-scenarios">Chargement...</div>';
    
    try {
        const response = await fetch('/api/test-scenarios');
        const data = await response.json();
        
        scenarios = data;
        
        if (scenarios.length === 0) {
            listContainer.innerHTML = '<div class="empty-scenarios">Aucun scénario sauvegardé</div>';
            document.getElementById('replayAllBtn').disabled = true;
            return;
        }
        
        document.getElementById('replayAllBtn').disabled = false;
        
        listContainer.innerHTML = '';
        
        scenarios.forEach(scenario => {
            const card = createScenarioCard(scenario);
            listContainer.appendChild(card);
        });
        
    } catch (err) {
        listContainer.innerHTML = '<div class="error-scenarios">Erreur de chargement</div>';
    }
}

function createScenarioCard(scenario) {
    const card = document.createElement('div');
    card.className = 'scenario-card';
    card.innerHTML = `
        <div class="scenario-header">
            <h3>${escapeHtml(scenario.name)}</h3>
            <button onclick="deleteScenario(${scenario.id})" class="btn-delete" title="Supprimer">🗑️</button>
        </div>
        <div class="scenario-meta">
            <span>📝 ${scenario.messages.length} messages</span>
            <span>📅 ${formatDate(scenario.created_at)}</span>
        </div>
        <div class="scenario-actions">
            <button onclick="viewScenario(${scenario.id})" class="btn-view">👁️ Voir</button>
            <button onclick="replayScenario(${scenario.id})" class="btn-replay">▶️ Rejouer</button>
        </div>
    `;
    return card;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 60) return diffMins === 0 ? 'À l\'instant' : `Il y a ${diffMins} min`;
    if (diffHours < 24) return `Il y a ${diffHours}h`;
    if (diffDays < 7) return `Il y a ${diffDays}j`;
    return date.toLocaleDateString('fr-FR');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// SCENARIO ACTIONS
// ============================================

function viewScenario(id) {
    const scenario = scenarios.find(s => s.id === id);
    if (!scenario) return;
    
    // Load scenario into chat
    currentConversation = [...scenario.messages];
    
    const chatContainer = document.getElementById('chatContainer');
    chatContainer.innerHTML = '';
    
    scenario.messages.forEach(msg => {
        displayMessage(msg);
    });
    
    document.getElementById('saveBtn').disabled = false;
}

async function deleteScenario(id) {
    if (!confirm('Supprimer ce scénario ?')) return;
    
    try {
        const response = await fetch(`/api/test-scenarios/${id}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.error) {
            alert('Erreur: ' + data.error);
            return;
        }
        
        await loadScenarios();
        
    } catch (err) {
        alert('Failed to delete scenario: ' + err.message);
    }
}

async function replayScenario(id) {
    const scenario = scenarios.find(s => s.id === id);
    if (!scenario) return;

    // 1. Clear current chat
    currentConversation = [];
    const chatContainer = document.getElementById('chatContainer');
    chatContainer.innerHTML = '';
    
    // Show system message
    const infoDiv = document.createElement('div');
    infoDiv.className = 'chat-message system';
    infoDiv.innerHTML = `<div class="message-bubble">🔄 Rejeu du scénario : <strong>${escapeHtml(scenario.name)}</strong>...</div>`;
    chatContainer.appendChild(infoDiv);
    
    try {
        // 2. Call replay API
        const response = await fetch(`/api/test-scenarios/${id}/replay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile: 'melanie' })
        });
        
        const data = await response.json();
        
        if (data.error) {
            showError(data.error);
            return;
        }

        // 3. Clear chat again (to remove "Replaying..." message)
        chatContainer.innerHTML = '';
        currentConversation = [];

        // 4. Animate message display
        for (const msg of data.messages) {
            // Add to state
            currentConversation.push(msg);
            
            // Display message
            displayMessage(msg);
            
            // Artificial delay for realism (shorter for replay)
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Scroll
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
        
        // Update save button (even though it's already saved, user might want to edit and save as new)
        document.getElementById('saveBtn').disabled = false;
        
        // Show success in systems
        showSuccessMessage(`Scénario "${scenario.name}" rejoué avec succès !`);

    } catch (err) {
        showError('Erreur de replay : ' + err.message);
    }
}

async function replayAllScenarios() {
    if (scenarios.length === 0) return;
    
    if (!confirm(`Rejouer tous les ${scenarios.length} scénarios ?`)) return;
    
    const resultsDiv = document.getElementById('replayResults');
    const contentDiv = document.getElementById('replayResultsContent');
    
    resultsDiv.style.display = 'block';
    contentDiv.innerHTML = '<div class="loading-scenarios">Rejeu de tous les scénarios en cours...</div>';
    
    try {
        const response = await fetch('/api/test-scenarios/replay-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile: 'melanie' })
        });
        
        const data = await response.json();
        
        if (data.error) {
            contentDiv.innerHTML = `<div class="error-scenarios">❌ ${data.error}</div>`;
            return;
        }
        
        contentDiv.innerHTML = createAllReplayResultsHtml(data.results);
        
    } catch (err) {
        contentDiv.innerHTML = `<div class="error-scenarios">❌ ${err.message}</div>`;
    }
}

function createAllReplayResultsHtml(results) {
    let html = '';
    
    results.forEach((result, index) => {
        html += `
            <div class="replay-scenario-result">
                <h4 class="replay-scenario-title">
                    ${result.success ? '✅' : '❌'} ${escapeHtml(result.scenario_name)}
                </h4>
        `;
        
        if (result.success) {
            result.messages.forEach(msg => {
                if (msg.role === 'assistant') {
                    html += `
                        <div class="replay-message-compact">
                            <span class="message-preview">${escapeHtml(msg.text.substring(0, 100))}${msg.text.length > 100 ? '...' : ''}</span>
                            ${msg.step_used ? `<span class="step-badge">Step ${msg.step_used}</span>` : ''}
                        </div>
                    `;
                }
            });
        } else {
            html += `<p class="error-text">❌ ${escapeHtml(result.error)}</p>`;
        }
        
        html += '</div>';
    });
    
    return html;
}
