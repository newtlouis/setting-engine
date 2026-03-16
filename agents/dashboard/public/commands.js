// ============================================
// Command Launcher Client
// ============================================

let currentProcessId = null;
let currentEventSource = null;
let cachedRegistry = null;

// ANSI escape code to HTML converter (8 standard colors + bold)
function ansiToHtml(text) {
    const colorMap = {
        '30': 'ansi-black',
        '31': 'ansi-red',
        '32': 'ansi-green',
        '33': 'ansi-yellow',
        '34': 'ansi-blue',
        '35': 'ansi-magenta',
        '36': 'ansi-cyan',
        '37': 'ansi-white',
        '90': 'ansi-black',
        '91': 'ansi-red',
        '92': 'ansi-green',
        '93': 'ansi-yellow',
        '94': 'ansi-blue',
        '95': 'ansi-magenta',
        '96': 'ansi-cyan',
        '97': 'ansi-white',
    };

    let result = '';
    let openTags = [];
    let i = 0;

    while (i < text.length) {
        // Match ESC[ ... m
        if (text[i] === '\x1b' && text[i + 1] === '[') {
            const end = text.indexOf('m', i + 2);
            if (end === -1) { i++; continue; }

            const codes = text.substring(i + 2, end).split(';');
            i = end + 1;

            for (const code of codes) {
                if (code === '0' || code === '') {
                    // Reset - close all open tags
                    result += openTags.map(() => '</span>').join('');
                    openTags = [];
                } else if (code === '1') {
                    result += '<span class="ansi-bold">';
                    openTags.push('bold');
                } else if (colorMap[code]) {
                    result += `<span class="${colorMap[code]}">`;
                    openTags.push(code);
                }
            }
        } else {
            // Escape HTML special chars
            const ch = text[i];
            if (ch === '<') result += '&lt;';
            else if (ch === '>') result += '&gt;';
            else if (ch === '&') result += '&amp;';
            else result += ch;
            i++;
        }
    }

    // Close remaining open tags
    result += openTags.map(() => '</span>').join('');
    return result;
}

// Load and render command registry
async function loadCommands() {
    try {
        const res = await fetch('/api/commands');
        cachedRegistry = await res.json();
        renderCommands(cachedRegistry);
    } catch (err) {
        document.getElementById('commandPanel').innerHTML =
            `<div style="color: var(--error); padding: 20px;">Erreur: ${err.message}</div>`;
    }
}

function renderCommands(registry) {
    const panel = document.getElementById('commandPanel');
    let html = '';

    for (const [category, commands] of Object.entries(registry)) {
        const isFav = category.toLowerCase() === 'favoris';
        html += `<div class="cmd-category">`;
        html += `<div class="cmd-category-title">${isFav ? '⭐ ' : ''}${escapeHtml(category)}</div>`;

        for (const cmd of commands) {
            // Hide --profile from displayed options (injected automatically)
            const visibleOptions = cmd.options.filter(o => o !== '--profile');
            const optionsHtml = visibleOptions.length > 0
                ? `<div class="cmd-options">${visibleOptions.map(o =>
                    `<span class="cmd-option-tag" onclick="addOptionToInput('${escapeAttr(cmd.name)}', '${escapeAttr(o)}')" style="cursor: pointer;" title="Cliquez pour ajouter">${escapeHtml(o)}</span>`
                  ).join('')}</div>`
                : '';

            const profile = getSelectedProfile();
            const defaultValue = (profile && cmd.profileDefaults && cmd.profileDefaults[profile]) || cmd.defaults || '';
            const placeholder = visibleOptions.length > 0
                ? visibleOptions.join(' ')
                : '';

            html += `
                <div class="cmd-card${isFav ? ' cmd-fav' : ''}">
                    <div class="cmd-card-header">
                        <span class="cmd-name">${escapeHtml(cmd.name)}</span>
                    </div>
                    <div class="cmd-desc">${escapeHtml(cmd.description)}</div>
                    ${optionsHtml}
                    <div class="cmd-actions">
                        <input type="text" class="cmd-args-input"
                               id="args-${cmd.name}"
                               value="${escapeAttr(defaultValue)}"
                               placeholder="${escapeAttr(placeholder)}"
                               onkeydown="if(event.key==='Enter') runCommand('${escapeAttr(cmd.name)}')">
                        <button class="btn-run" onclick="runCommand('${escapeAttr(cmd.name)}')">Run</button>
                    </div>
                </div>`;
        }

        html += `</div>`;
    }

    panel.innerHTML = html;
}

// Add option to input field when tag is clicked
function addOptionToInput(cmdName, option) {
    const input = document.getElementById(`args-${cmdName}`);
    if (!input) return;

    const currentValue = input.value.trim();

    // Check if option is already present
    if (currentValue.includes(option)) {
        // Remove it (toggle off)
        input.value = currentValue
            .split(/\s+/)
            .filter(part => part !== option)
            .join(' ')
            .trim();
    } else {
        // Add it
        input.value = currentValue ? `${currentValue} ${option}` : option;
    }

    input.focus();
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

// Get selected profile name from account selector
function getSelectedProfile() {
    const select = document.getElementById('accountSelect');
    if (!select || !select.value) return null;
    return select.options[select.selectedIndex].textContent.trim();
}

// Run a command
async function runCommand(name) {
    // Parse args from input field
    const input = document.getElementById(`args-${name}`);
    const argsStr = input ? input.value.trim().replace(/\u2014/g, '--').replace(/\u2013/g, '--') : '';
    const args = argsStr ? argsStr.split(/\s+/) : [];

    // Auto-inject --profile from account selector
    const profile = getSelectedProfile();
    if (profile && !args.includes('--profile')) {
        args.push('--profile', profile);
    }

    // Clear terminal
    const output = document.getElementById('terminalOutput');
    output.innerHTML = '';

    // Disconnect existing SSE
    if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
    }

    try {
        const res = await fetch('/api/commands/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: name, args }),
        });

        const data = await res.json();
        if (!res.ok) {
            output.innerHTML = `<span class="ansi-red">Error: ${escapeHtml(data.error)}</span>`;
            return;
        }

        currentProcessId = data.processId;
        updateToolbar(data.command, true);
        connectSSE(data.processId);
    } catch (err) {
        output.innerHTML = `<span class="ansi-red">Fetch error: ${escapeHtml(err.message)}</span>`;
    }
}

// Connect to SSE stream
function connectSSE(processId) {
    const output = document.getElementById('terminalOutput');
    const es = new EventSource(`/api/commands/stream/${processId}`);
    currentEventSource = es;

    es.onmessage = (event) => {
        const text = JSON.parse(event.data);
        output.innerHTML += ansiToHtml(text);
        output.scrollTop = output.scrollHeight;
    };

    es.addEventListener('done', (event) => {
        const data = JSON.parse(event.data);
        updateToolbar(null, false);
        es.close();
        currentEventSource = null;
        currentProcessId = null;
    });

    es.onerror = () => {
        es.close();
        currentEventSource = null;
    };
}

// Send Enter to stdin of current process
async function sendEnter() {
    if (!currentProcessId) return;
    try {
        await fetch(`/api/commands/stdin/${currentProcessId}`, { method: 'POST' });
    } catch (err) {
        console.error('Stdin error:', err);
    }
}

// Stop current process
async function stopProcess() {
    if (!currentProcessId) return;

    try {
        await fetch(`/api/commands/stop/${currentProcessId}`, { method: 'POST' });
    } catch (err) {
        console.error('Stop error:', err);
    }
}

// Clear terminal
function clearTerminal() {
    document.getElementById('terminalOutput').innerHTML = '';
}

// Update toolbar UI
function updateToolbar(command, running) {
    const title = document.getElementById('terminalTitle');
    const btnStop = document.getElementById('btnStop');
    const btnEnter = document.getElementById('btnEnter');

    if (running && command) {
        title.textContent = `Running: ${command}`;
        title.className = 'terminal-title active';
        btnStop.disabled = false;
        btnEnter.style.display = 'inline-block';
    } else {
        title.textContent = 'Terminal';
        title.className = 'terminal-title';
        btnStop.disabled = true;
        btnEnter.style.display = 'none';
    }
}

// On load: check for running processes and reconnect
async function checkRunningProcesses() {
    try {
        const res = await fetch('/api/commands/running');
        const processes = await res.json();

        // Find the most recent running process
        const running = processes.find(p => p.exitCode === null);
        if (running) {
            currentProcessId = running.processId;
            updateToolbar(running.command, true);
            connectSSE(running.processId);
        }
    } catch (err) {
        console.error('Check running error:', err);
    }
}

// Load accounts into selector
async function loadAccounts() {
    const select = document.getElementById('accountSelect');
    try {
        const res = await fetch('/api/accounts');
        const accounts = await res.json();
        select.innerHTML = '';
        accounts.forEach(acc => {
            if (acc.id) {
                const opt = document.createElement('option');
                opt.value = acc.id;
                opt.textContent = acc.name;
                select.appendChild(opt);
            }
        });
        // Set default account
        const defRes = await fetch('/api/accounts/default');
        const defAcc = await defRes.json();
        if (defAcc && defAcc.id) {
            select.value = defAcc.id;
        }
    } catch (e) {
        select.innerHTML = '<option value="">Erreur</option>';
    }
}

// Init
loadAccounts().then(() => {
    // Re-render commands when profile changes (for profileDefaults)
    const select = document.getElementById('accountSelect');
    if (select) {
        select.addEventListener('change', () => {
            if (cachedRegistry) renderCommands(cachedRegistry);
        });
    }
});
loadCommands();
checkRunningProcesses();
