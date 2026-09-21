/**
 * EMA Forge - Dashboard Controller
 * Handles UI interactions, file binding, and rendering Chart.js graphs.
 */

Chart.defaults.color = '#768390';
Chart.defaults.font.family = '"TX-02", "Instrument Sans", system-ui, sans-serif';
Chart.defaults.font.size = 11;
Chart.defaults.borderColor = '#30363d';
const gridConfig = { color: '#30363d', drawBorder: false };

const AppUI = {
  charts: {
    overview: null,
    compliance: null,
    disposition: null,
    latency: null
  },

  init() {
    this.bindEvents();
    this.initEmptyCharts();
  },

  bindEvents() {
    const importBtn = document.getElementById('btn-import-data');
    const fileInput = document.getElementById('file-import-input');
    const exportBtn = document.getElementById('export-csv-btn');
    
    // Filters & Toggles
    const filterRapid = document.getElementById('toggle-filter-rapid');
    const filterMissed = document.getElementById('toggle-exclude-missed');
    const filterDate = document.getElementById('filter-date');
    const filterCohort = document.getElementById('filter-cohort');
    
    // Navigation
    const navTabs = document.querySelectorAll('.topbar-tabs .tab-btn');
    const segBtns = document.querySelectorAll('.seg-ctrl .seg-btn');

    // 1. File Import
    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      if (e.target.files.length === 0) return;
      
      this.setStatus("Processing...", "badge-warn");
      try {
        const data = await DataParser.ingestFiles(e.target.files);
        this.populateDateDropdown(data.allSessions);
        this.refreshData(); 
        document.getElementById('empty-state').style.display = 'none';
        this.setStatus(data.warnings.length ? `Imported with ${data.warnings.length} warning(s)` : "Imported locally", data.warnings.length ? "badge-warn" : "badge-good");
      } catch (err) {
        console.error(err);
        alert("Error parsing folder. Make sure it contains EMA JSON exports.");
        this.setStatus("Error", "badge-danger");
      }
      fileInput.value = "";
    });

    // 2. Interactive Filters
    [filterRapid, filterMissed, filterDate, filterCohort].forEach(el => {
        el.addEventListener('change', () => this.refreshData());
    });

    // 3. Segmented Control
    segBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelector('.seg-ctrl .seg-btn.active')?.classList.remove('active');
            e.target.classList.add('active');
            
            const mode = e.target.textContent.trim();
            if (mode === 'Per Participant') {
                const pList = Array.from(DataParser.state.participants).sort();
                filterCohort.replaceChildren();
                pList.forEach(participantId => {
                  const option = document.createElement('option');
                  option.value = participantId;
                  option.textContent = participantId;
                  filterCohort.appendChild(option);
                });
            } else {
                filterCohort.innerHTML = `<option value="all">All Participants (n=${DataParser.state.participants.size})</option>`;
            }
            this.refreshData();
        });
    });

    // 4. Tab Navigation (Dedicated Views)
    navTabs.forEach((tab) => {
      tab.addEventListener('click', (e) => {
        // Update active tab button
        document.querySelector('.topbar-tabs .tab-btn.active')?.classList.remove('active');
        e.target.classList.add('active');
        
        // Hide all views
        document.querySelectorAll('.dashboard-view').forEach(view => {
            view.classList.remove('active');
        });

        // Show targeted view
        const targetId = e.target.getAttribute('data-target');
        const viewEl = document.getElementById(targetId);
        if (viewEl) {
            viewEl.classList.add('active');
            
            // Force charts to resize in case the window size changed while they were hidden
            if (this.charts.overview) this.charts.overview.resize();
            if (this.charts.compliance) this.charts.compliance.resize();
            if (this.charts.disposition) this.charts.disposition.resize();
            if (this.charts.latency) this.charts.latency.resize();
        }
      });
    });

    // 5. Export CSV
    exportBtn.addEventListener('click', () => this.exportToCSV());
  },

  setStatus(text, badgeClass) {
    const badge = document.getElementById('status-badge');
    badge.textContent = text;
    badge.className = `badge ${badgeClass}`;
  },

  refreshData() {
    if (DataParser.state.allSessions.length === 0) return;
    
    const filters = {
        excludeRapid: document.getElementById('toggle-filter-rapid').checked,
        day: document.getElementById('filter-date').value,
        participant: document.getElementById('filter-cohort').value || 'all'
    };

    DataParser.calculateMetrics(filters);
    this.updateDashboard(DataParser.state);
    if (typeof ContentView !== 'undefined') ContentView.render();
  },

  populateDateDropdown(sessions) {
    const select = document.getElementById('filter-date');
    const maxDay = Math.max(...sessions.map(s => s.day), 1);
    
    select.innerHTML = '<option value="all">All available data</option>';
    for(let i = 1; i <= maxDay; i++) {
        const opt = document.createElement('option');
        opt.value = i.toString();
        opt.textContent = `Day ${i}`;
        select.appendChild(opt);
    }
  },

  _toNumeric(val) {
    if (val === null || val === undefined || val === '') return '';
    if (Array.isArray(val)) return '';
    const n = Number(val);
    return Number.isFinite(n) ? n : '';
  },

  _serializeValue(val) {
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) return val.join(';');
    if (val && typeof val === 'object' && 'valence' in val && 'arousal' in val) {
      return `${val.valence};${val.arousal}`;
    }
    return String(val);
  },

  _csvEscape(val) {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  },

  exportToCSV() {
    const sessions = DataParser.state.filteredSessions;
    if (sessions.length === 0) return alert("No data available to export.");

    const cfg = DataParser.state.studyConfig || {};
    
    // Build question lookup index
    const qIdx = {};
    (cfg.ema?.questions || []).forEach(q => {
      if (q.type !== 'page_break') qIdx[q.id] = q;
    });
    const windows = cfg.ema?.scheduling?.windows || [];

    const header = [
      'participant_id', 'day', 'session_id', 'window_id', 'window_label', 'block',
      'session_started_at', 'session_submitted_at',
      'phase_started_at', 'phase_submitted_at',
      'question_id', 'question_text', 'question_type', 'presentation_order',
      'response_status', 'skip_reason',
      'response_value', 'response_numeric', 'response_latency_ms'
    ];

    const rows = [];
    rows.push(header.map(this._csvEscape.bind(this)).join(','));

    // Flatten all nested EMA responses across all JSON files into a long-format array
    sessions.forEach(sessionData => {
      const emaEntries = (sessionData.data || []).filter(e => e && e.type === 'ema_response');

      emaEntries.forEach(entry => {
        const wId  = entry.windowId || '';
        const wCfg = windows.find(w => w.id === wId);
        const wLabel = wCfg ? wCfg.label : '';
        const phaseStart = entry.startedAt || '';
        const phaseSubmit = entry.submittedAt || '';
        const phaseStartMs = phaseStart ? Date.parse(phaseStart) : null;

        const presented = entry.presentationOrder ? entry.presentationOrder.flat() : [];
        const eligible = Array.isArray(entry.eligibleQuestionIds) && entry.eligibleQuestionIds.length
          ? entry.eligibleQuestionIds
          : Array.from(new Set([...presented, ...Object.keys(entry.responses || {})]));

        eligible.forEach(qid => {
          const rec = (entry.responses || {})[qid];
          const q = qIdx[qid] || {};
          const rawVal = (rec && typeof rec === 'object' && 'value' in rec) ? rec.value : rec;
          const respAt = (rec && typeof rec === 'object') ? rec.respondedAt : null;
          const latency = (phaseStartMs && respAt) ? (Date.parse(respAt) - phaseStartMs) : '';

          let presOrder = '';
          if (entry.presentationOrder) {
            const idx = presented.indexOf(qid);
            if (idx !== -1) presOrder = idx + 1;
          }
          const skip = (entry.skippedQuestions || []).find(item => item.questionId === qid);
          const answered = rec !== undefined && rawVal !== undefined && rawVal !== null && rawVal !== '';
          const responseStatus = skip && !presented.includes(qid)
            ? 'skipped_condition'
            : (answered ? 'answered' : 'unanswered');

          const rowData = [
            sessionData.participantId,
            sessionData.day,
            sessionData.sessionId || '',
            wId,
            wLabel,
            entry.block || '',
            sessionData.startedAt || sessionData.startTime || '',
            sessionData.completedAt || sessionData.endTime || '',
            phaseStart,
            phaseSubmit,
            qid,
            q.text || '',
            q.type || '',
            presOrder,
            responseStatus,
            skip?.reason || '',
            this._serializeValue(rawVal),
            this._toNumeric(rawVal),
            latency
          ];
          rows.push(rowData.map(this._csvEscape.bind(this)).join(','));
        });
      });
    });

    const csvString = rows.join('\r\n') + '\r\n';
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `ema_master_dataset_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  },

  initEmptyCharts() {
    const ctxOver = document.getElementById('overviewChart').getContext('2d');
    this.charts.overview = new Chart(ctxOver, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: gridConfig, ticks: { precision: 0 } }
        }
      }
    });

    const ctxComp = document.getElementById('complianceChart').getContext('2d');
    this.charts.compliance = new Chart(ctxComp, {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, grid: gridConfig, ticks: { precision: 0 } }
        }
      }
    });

    const ctxDisp = document.getElementById('dispositionChart').getContext('2d');
    this.charts.disposition = new Chart(ctxDisp, {
      type: 'doughnut',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '75%',
        plugins: { legend: { position: 'right', labels: { usePointStyle: true, boxWidth: 8, padding: 15 } } }
      }
    });

    const ctxLat = document.getElementById('latencyChart').getContext('2d');
    this.charts.latency = new Chart(ctxLat, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: gridConfig, ticks: { callback: v => v + 'm' } }
        }
      }
    });
  },

  updateDashboard(data) {
    this.updateHeader(data);
    this.updateKPIs(data.metrics);
    this.updateCharts(data.metrics);
    this.updateTable(data);
  },

  updateHeader(data) {
    const studyName = data.studyConfig?.study?.name || "Imported Study Data";
    const cohortFilter = document.getElementById('filter-cohort').value;
    
    document.getElementById('dash-study-name').textContent = studyName;
    document.getElementById('dash-subtitle').textContent = cohortFilter === 'all' 
        ? `Local File Analysis — ${data.participants.size} Active Participants`
        : `Local File Analysis — Isolating Participant ${cohortFilter}`;
    
    const studyDays = data.studyConfig?.ema?.scheduling?.study_days || Object.keys(data.metrics.observedByDay).length || 1;
    
    const currentDay = Math.max(...data.allSessions.map(s => s.day), 1);
    const pct = Math.round((currentDay / studyDays) * 100);
    
    document.getElementById('study-progress-text').textContent = `Day ${currentDay} of ${studyDays}`;
    document.getElementById('study-progress-pct').textContent = `${pct}%`;
    document.getElementById('study-progress-bar').style.width = `${pct}%`;
  },

  updateKPIs(m) {
    const fmtMsToMinSec = (ms) => {
        if(!Number.isFinite(ms)) return "Unavailable";
        const mins = Math.floor(ms / 60000);
        const secs = Math.floor((ms % 60000) / 1000);
        return `${mins}m ${secs}s`;
    };

    document.getElementById('kpi-compliance').textContent = "Unavailable";
    document.getElementById('trend-compliance').textContent = "Requires roster + prompt events";
    this.setCardStatus('card-compliance', '');

    document.getElementById('kpi-pings').textContent = "Unavailable";
    document.getElementById('trend-pings').textContent = "Requires delivery events";

    document.getElementById('kpi-noise').textContent = String(m.totalRapid);
    document.getElementById('trend-noise').textContent = "Review flag; not automatic exclusion";
    this.setCardStatus('card-noise', m.totalRapid === 0 ? 'good' : 'warn');

    document.getElementById('kpi-time').textContent = fmtMsToMinSec(m.avgTimeMs);
  },

  setCardStatus(cardId, statusClass) {
    const el = document.getElementById(cardId);
    if(el) el.className = "kpi-card " + statusClass;
  },

  updateCharts(m) {
    const days = Object.keys(m.observedByDay).sort((a,b)=>a-b);
    const labels = days.map(d => `Day ${d}`);
    const completedData = days.map(d => m.observedByDay[d].completed);

    this.charts.compliance.data = {
      labels: labels,
      datasets: [
        { label: 'Observed completed sessions', data: completedData, backgroundColor: '#3fb950', borderRadius: 4, barPercentage: 0.6 }
      ]
    };
    this.charts.compliance.update();

    // Populate Overview Line Chart
    this.charts.overview.data = {
      labels: labels,
      datasets: [{
        label: 'Observed completed sessions',
        data: completedData,
        borderColor: '#3fb950',
        backgroundColor: 'rgba(63,185,80,0.1)',
        borderWidth: 2, tension: 0.4, fill: true,
        pointBackgroundColor: '#161b22', pointBorderColor: '#3fb950', pointRadius: 4
      }]
    };
    this.charts.overview.update();

    const valid = Math.max(0, m.totalCompleted - m.totalRapid);
    
    this.charts.disposition.data = {
      labels: ['Not rapid-flagged', 'Rapid review flag'],
      datasets: [{
        data: [valid, m.totalRapid],
        backgroundColor: ['#3fb950', '#e8716a'],
        borderWidth: 0, hoverOffset: 4
      }]
    };
    this.charts.disposition.update();

    const latencyDataMins = days.map(d => Number.isFinite(m.latencyByDay[d]) ? Math.round(m.latencyByDay[d] / 60000) : null);
    this.charts.latency.data = {
      labels: labels,
      datasets: [{
        label: 'Avg Latency (mins)',
        data: latencyDataMins,
        borderColor: '#388bfd',
        backgroundColor: 'rgba(56,139,253,0.1)',
        borderWidth: 2, tension: 0.4, fill: true,
        pointBackgroundColor: '#161b22', pointBorderColor: '#388bfd', pointRadius: 4
      }]
    };
    this.charts.latency.update();

    document.getElementById('latency-median-badge').textContent = Number.isFinite(m.avgLatencyMs)
      ? `Avg: ${Math.round(m.avgLatencyMs / 60000)}m`
      : 'Unavailable — no delivery timestamps';
  },

  updateTable(data) {
    const tbody = document.getElementById('participant-table-body');
    tbody.innerHTML = '';

    const pStats = {};
    data.filteredSessions.forEach(s => {
      if(!pStats[s.participantId]) pStats[s.participantId] = { completed: 0 };
      pStats[s.participantId].completed++;
    });

    const rows = Object.keys(pStats).map(pId => {
      return { id: pId, completed: pStats[pId].completed };
    });

    rows.sort((a,b) => a.id.localeCompare(b.id));

    rows.forEach(r => {
      const tr = document.createElement('tr');
      
      const idCell = document.createElement('td');
      idCell.textContent = r.id;
      const countCell = document.createElement('td');
      countCell.textContent = String(r.completed);
      const statusCell = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'badge badge-neutral';
      badge.textContent = 'Observed only';
      statusCell.appendChild(badge);
      tr.append(idCell, countCell, statusCell);
      tbody.appendChild(tr);
    });

    // Populate Overview Mini-Watchlist (Top 5 lowest compliance < 60%)
    const overviewTbody = document.getElementById('overview-watchlist-body');
    overviewTbody.innerHTML = '';
    
    document.getElementById('overview-critical-count').textContent = 'N/A';
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 2;
    cell.style.cssText = 'text-align:center;color:var(--fg-3);padding-top:24px;';
    cell.textContent = 'A roster and prompt-event log are required to identify missed sessions.';
    row.appendChild(cell);
    overviewTbody.appendChild(row);
  }
};

document.addEventListener('DOMContentLoaded', () => AppUI.init());
