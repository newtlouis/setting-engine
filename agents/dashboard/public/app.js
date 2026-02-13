let currentAccountId = null;
let velocityChart = null;
let sourceChart = null;

// Init
document.addEventListener('DOMContentLoaded', async () => {
    await loadAccounts();
    await loadDefaultAccount();
    loadFunnelAnalytics();
    loadVelocity(30);
});

// Load Accounts
async function loadAccounts() {
    const select = document.getElementById('accountSelect');
    try {
        const res = await fetch('/api/accounts');
        const accounts = await res.json();
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
            alert('Ce compte sera maintenant affiche par defaut au demarrage.');
        }
    } catch (e) {
        console.error(e);
    }
}

// Account change handler
function onAccountChange(accountId) {
    currentAccountId = accountId || null;
    loadFunnelAnalytics();
    loadVelocity(getCurrentPeriod());
}

function getCurrentPeriod() {
    const active = document.querySelector('.velocity-period.active');
    return active ? parseInt(active.dataset.days) : 30;
}

// Load Funnel Analytics
async function loadFunnelAnalytics() {
    try {
        const params = currentAccountId ? `?account_id=${currentAccountId}` : '';
        const res = await fetch('/api/analytics/funnel' + params);
        const data = await res.json();

        document.getElementById('stat-total_contacted').textContent = data.summary.totalContacted;
        document.getElementById('stat-replied').textContent = data.summary.totalReplied;
        document.getElementById('stat-reply_rate').textContent = `${data.summary.replyRate}% taux`;
        document.getElementById('stat-booked').textContent = data.summary.booked;
        document.getElementById('stat-booking_rate').textContent = `${data.summary.bookingRate}% taux`;

        const contactsPerBooking = data.summary.booked > 0
            ? Math.ceil(data.summary.totalContacted / data.summary.booked)
            : '-';
        document.getElementById('stat-booking_ratio').textContent =
            contactsPerBooking !== '-' ? `1 RDV / ${contactsPerBooking} contacts` : '-';

        document.getElementById('stat-not_interested').textContent = data.summary.notInterested;

        renderFunnelAnalysis(data.funnel, data.summary.totalContacted);
        renderSourcePerformance(data.sourceStats);
        renderStepCounts(data.stepDistribution);

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
        'linear-gradient(90deg, #d29922 0%, #e3b341 100%)',
        'linear-gradient(90deg, #1f6feb 0%, #58a6ff 100%)',
        'linear-gradient(90deg, #8b5cf6 0%, #a78bfa 100%)',
        'linear-gradient(90deg, #db61a2 0%, #f778ba 100%)',
        'linear-gradient(90deg, #f97316 0%, #fb923c 100%)',
        'linear-gradient(90deg, #06b6d4 0%, #22d3ee 100%)',
        'linear-gradient(90deg, #22c55e 0%, #4ade80 100%)'
    ];

    let html = '';
    funnel.forEach((step, idx) => {
        const reached = step.reached || step.count;
        const pct = maxCount > 0 ? (reached / maxCount * 100) : 0;
        const barWidth = Math.max(pct, 2);

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
        container.innerHTML = '<div style="color: var(--text-secondary); font-size: 13px;">Aucune donnee</div>';
        return;
    }

    let html = `
        <table class="source-table">
            <thead><tr><th>Source</th><th>Total</th><th>Reponses</th><th>RDV</th></tr></thead>
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

// Render step counts
function renderStepCounts(stepDistribution) {
    const container = document.getElementById('stepCounts');
    if (!container) return;

    const stepMap = {};
    (stepDistribution || []).forEach(s => {
        stepMap[s.step] = (stepMap[s.step] || 0) + s.count;
    });

    let html = '';
    for (let stepNum = 2; stepNum <= 5; stepNum++) {
        const count = stepMap[stepNum] || 0;
        html += `
            <div class="step-mini">
                <div class="step-mini-num">Step ${stepNum}</div>
                <div class="step-mini-val">${count}</div>
            </div>
        `;
    }
    container.innerHTML = html;
}

// ============================================
// VELOCITY
// ============================================

async function loadVelocity(days) {
    // Update period buttons
    document.querySelectorAll('.velocity-period').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.days) === days);
    });

    try {
        let url = `/api/analytics/velocity?days=${days}`;
        if (currentAccountId) url += `&account_id=${currentAccountId}`;

        const res = await fetch(url);
        const data = await res.json();

        renderVelocityChart(data.daily);
        renderSourceChart(data.bySource);
        renderVelocitySourceTable(data.bySource);
    } catch (e) {
        console.error('Velocity load error', e);
    }
}

function renderVelocityChart(daily) {
    const ctx = document.getElementById('velocityChart');
    if (!ctx) return;

    if (velocityChart) velocityChart.destroy();

    const labels = daily.map(d => {
        const date = new Date(d.date + 'T00:00:00');
        return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    });

    velocityChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Contactes',
                    data: daily.map(d => d.contacted),
                    borderColor: '#d29922',
                    backgroundColor: 'rgba(210, 153, 34, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2,
                },
                {
                    label: 'Repondu',
                    data: daily.map(d => d.replied),
                    borderColor: '#58a6ff',
                    backgroundColor: 'rgba(88, 166, 255, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2,
                },
                {
                    label: 'RDV',
                    data: daily.map(d => d.booked),
                    borderColor: '#3fb950',
                    backgroundColor: 'rgba(63, 185, 80, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2,
                }
            ]
        },
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    labels: { color: '#8b949e', usePointStyle: true, pointStyle: 'circle' }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#8b949e', maxTicksLimit: 15 },
                    grid: { color: 'rgba(48, 54, 61, 0.5)' }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: '#8b949e' },
                    grid: { color: 'rgba(48, 54, 61, 0.5)' }
                }
            }
        }
    });
}

function renderSourceChart(bySource) {
    const ctx = document.getElementById('sourceChart');
    if (!ctx) return;

    if (sourceChart) sourceChart.destroy();

    const top = bySource.slice(0, 10);
    const labels = top.map(s => s.source_group || s.source || 'unknown');

    sourceChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Contactes',
                    data: top.map(s => s.contacted),
                    backgroundColor: 'rgba(210, 153, 34, 0.7)',
                },
                {
                    label: 'Repondu',
                    data: top.map(s => s.replied),
                    backgroundColor: 'rgba(88, 166, 255, 0.7)',
                },
                {
                    label: 'RDV',
                    data: top.map(s => s.booked),
                    backgroundColor: 'rgba(63, 185, 80, 0.7)',
                }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: {
                legend: {
                    labels: { color: '#8b949e', usePointStyle: true, pointStyle: 'circle' }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: { color: '#8b949e' },
                    grid: { color: 'rgba(48, 54, 61, 0.5)' }
                },
                y: {
                    ticks: { color: '#8b949e' },
                    grid: { display: false }
                }
            }
        }
    });
}

let sourceTableData = [];
let sourceTableSort = { col: 'rate', asc: false };

function renderVelocitySourceTable(bySource) {
    const container = document.getElementById('velocitySourceTable');
    if (!container) return;

    if (bySource) sourceTableData = bySource;

    if (!sourceTableData || sourceTableData.length === 0) {
        container.innerHTML = '<div style="color: var(--text-secondary); font-size: 13px;">Aucune donnee</div>';
        return;
    }

    // Compute sortable values
    const rows = sourceTableData.map(src => ({
        source: src.source_group || src.source || 'unknown',
        contacted: src.contacted,
        replied: src.replied,
        rate: src.contacted > 0 ? src.replied / src.contacted * 100 : 0,
        booked: src.booked,
        bookingRate: src.contacted > 0 ? src.booked / src.contacted * 100 : 0
    }));

    // Sort
    const { col, asc } = sourceTableSort;
    rows.sort((a, b) => {
        const va = typeof a[col] === 'string' ? a[col].toLowerCase() : a[col];
        const vb = typeof b[col] === 'string' ? b[col].toLowerCase() : b[col];
        if (va < vb) return asc ? -1 : 1;
        if (va > vb) return asc ? 1 : -1;
        return 0;
    });

    const arrow = (c) => sourceTableSort.col === c ? (sourceTableSort.asc ? ' ▲' : ' ▼') : '';
    const thStyle = 'cursor: pointer; user-select: none;';

    let html = `
        <table class="source-table">
            <thead><tr>
                <th style="${thStyle}" onclick="sortSourceTable('source')">Source${arrow('source')}</th>
                <th style="${thStyle}" onclick="sortSourceTable('contacted')">Contactes${arrow('contacted')}</th>
                <th style="${thStyle}" onclick="sortSourceTable('replied')">Repondu${arrow('replied')}</th>
                <th style="${thStyle}" onclick="sortSourceTable('rate')">Taux de reponse${arrow('rate')}</th>
                <th style="${thStyle}" onclick="sortSourceTable('booked')">RDV${arrow('booked')}</th>
                <th style="${thStyle}" onclick="sortSourceTable('bookingRate')">Taux RDV${arrow('bookingRate')}</th>
            </tr></thead>
            <tbody>
    `;
    rows.forEach(r => {
        html += `
            <tr>
                <td style="max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.source}">${r.source}</td>
                <td>${r.contacted}</td>
                <td>${r.replied}</td>
                <td><span style="color: ${r.rate > 10 ? 'var(--success)' : 'var(--text-secondary)'};">${r.rate.toFixed(1)}%</span></td>
                <td>${r.booked}</td>
                <td><span style="color: ${r.bookingRate > 3 ? 'var(--success)' : 'var(--text-secondary)'};">${r.bookingRate.toFixed(1)}%</span></td>
            </tr>
        `;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

function sortSourceTable(col) {
    if (sourceTableSort.col === col) {
        sourceTableSort.asc = !sourceTableSort.asc;
    } else {
        sourceTableSort.col = col;
        sourceTableSort.asc = false;
    }
    renderVelocitySourceTable(null);
}
