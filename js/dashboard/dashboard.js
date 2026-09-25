/**
 * EMA Forge - Dashboard Controller
 * Handles UI interactions, file binding, and rendering Chart.js graphs.
 */

Chart.defaults.color = '#68716f';
Chart.defaults.font.family = '"TX-02", "Instrument Sans", system-ui, sans-serif';
Chart.defaults.font.size = 11;
Chart.defaults.borderColor = '#d9d5cc';
const gridConfig = { color: '#ded9d0', drawBorder: false };

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
    const simulateButtons = [document.getElementById('btn-simulate-study'), document.getElementById('empty-simulate-study')].filter(Boolean);
    const simulationModal = document.getElementById('simulation-modal');
    
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
        this.populateCohortDropdown();
        this.refreshData(); 
        document.getElementById('empty-state').style.display = 'none';
        this.updateProvenance();
        this.setStatus(data.warnings.length ? `Imported with ${data.warnings.length} warning(s)` : "Imported locally", data.warnings.length ? "badge-warn" : "badge-good");
      } catch (err) {
        console.error(err);
        alert("Could not import these files. Choose EMA Forge JSON, Cloudflare NDJSON, or long-format CSV exports.");
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
            e.currentTarget.classList.add('active');
            
            const mode = e.currentTarget.textContent.trim();
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
        e.currentTarget.classList.add('active');
        
        // Hide all views
        document.querySelectorAll('.dashboard-view').forEach(view => {
            view.classList.remove('active');
        });

        // Show targeted view
        const targetId = e.currentTarget.getAttribute('data-target');
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

    // 6. Reproducible local study simulation
    simulateButtons.forEach(button => button.addEventListener('click', () => this.openSimulationModal()));
    document.getElementById('simulation-close')?.addEventListener('click', () => this.closeSimulationModal());
    document.getElementById('simulation-cancel')?.addEventListener('click', () => this.closeSimulationModal());
    document.getElementById('simulation-run')?.addEventListener('click', () => this.runSimulation());
    simulationModal?.addEventListener('click', event => {
      if (event.target === simulationModal) this.closeSimulationModal();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && simulationModal?.classList.contains('open')) this.closeSimulationModal();
    });
  },

  openSimulationModal() {
    const modal = document.getElementById('simulation-modal');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('simulation-protocol').focus();
  },

  closeSimulationModal() {
    const modal = document.getElementById('simulation-modal');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  },

  async runSimulation() {
    const runButton = document.getElementById('simulation-run');
    const protocolId = document.getElementById('simulation-protocol').value;
    runButton.disabled = true;
    runButton.textContent = 'Generating…';
    this.setStatus('Generating simulation…', 'badge-warn');
    try {
      const response = await fetch(`library/protocols/${protocolId}.json`);
      if (!response.ok) throw new Error(`Could not load protocol (${response.status}).`);
      const libraryEntry = await response.json();
      const result = EMAForgeSimulator.simulate(libraryEntry.protocol, {
        participants: Number(document.getElementById('simulation-participants').value),
        days: Number(document.getElementById('simulation-days').value),
        completionRate: Number(document.getElementById('simulation-completion').value) / 100,
        missingnessRate: Number(document.getElementById('simulation-missingness').value) / 100,
        seed: document.getElementById('simulation-seed').value
      });
      const data = DataParser.loadSynthetic(result);
      this.populateDateDropdown(data.allSessions);
      this.populateCohortDropdown();
      this.refreshData();
      this.updateProvenance();
      document.getElementById('empty-state').style.display = 'none';
      this.setStatus('Synthetic data', 'badge-warn');
      this.closeSimulationModal();
    } catch (error) {
      console.error(error);
      alert(`Simulation could not be generated: ${error.message}`);
      this.setStatus('Simulation error', 'badge-danger');
    } finally {
      runButton.disabled = false;
      runButton.textContent = 'Generate study';
    }
  },

  setStatus(text, badgeClass) {
    const badge = document.getElementById('status-badge');
    badge.textContent = text;
    badge.className = `badge ${badgeClass}`;
  },

  refreshData() {
    if (DataParser.state.allSessions.length === 0 && !DataParser.state.simulationManifest) return;
    
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
    const maxDay = DataParser.state.studyConfig?.ema?.scheduling?.study_days || Math.max(...sessions.map(s => s.day), 1);
    
    select.innerHTML = '<option value="all">All available data</option>';
    for(let i = 1; i <= maxDay; i++) {
        const opt = document.createElement('option');
        opt.value = i.toString();
        opt.textContent = `Day ${i}`;
        select.appendChild(opt);
    }
  },

  populateCohortDropdown() {
    const select = document.getElementById('filter-cohort');
    select.replaceChildren();
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = `All Participants (n=${DataParser.state.participants.size})`;
    select.appendChild(all);
  },

  updateProvenance() {
    const note = document.getElementById('data-provenance-note');
    const missedLabel = document.getElementById('toggle-exclude-missed')?.closest('.toggle-row')?.querySelector('.toggle-label');
    if (DataParser.state.source === 'synthetic') {
      const manifest = DataParser.state.simulationManifest;
      note.innerHTML = `<strong>Synthetic study.</strong> Generated locally from a curated protocol with seed <code>${this._escapeHtml(manifest.seed)}</code>. These records demonstrate workflow behavior and must not be interpreted as research findings.`;
      if (missedLabel) missedLabel.textContent = 'Missed prompts are derived from the synthetic schedule manifest';
    } else {
      note.innerHTML = '<strong>Imported observations.</strong> Files remain in this browser. Completion and missed-prompt rates remain unavailable unless a roster and scheduled delivery-event log are supplied.';
      if (missedLabel) missedLabel.textContent = 'Missed-prompt filtering unavailable without a roster/event log';
    }
  },

  _escapeHtml(value) {
    return String(value ?? '').replace(/[&<>\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
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
    if (val && typeof val === 'object' && 'status' in val &&
        ['classified', 'declined', 'permission_denied', 'unavailable', 'outside_study_area', 'uncertain_boundary', 'uncertain_accuracy', 'service_unavailable'].includes(val.status)) {
      return JSON.stringify(val);
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
      if (q.type !== 'page_break' && q.type !== 'instruction') qIdx[q.id] = q;
    });
    const windows = cfg.ema?.scheduling?.windows || [];

    const header = [
      'data_source', 'participant_id', 'day', 'session_id', 'window_id', 'window_label', 'block',
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
            DataParser.state.source === 'synthetic' ? 'synthetic' : 'observed',
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
    const prefix = DataParser.state.source === 'synthetic' ? 'ema_synthetic_dataset' : 'ema_master_dataset';
    a.download = `${prefix}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
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
    const sourceLabel = data.source === 'synthetic' ? 'Synthetic protocol run' : 'Local file analysis';
    document.getElementById('dash-subtitle').textContent = cohortFilter === 'all' 
        ? `${sourceLabel} — ${data.participants.size} participants`
        : `${sourceLabel} — participant ${cohortFilter}`;
    
    const studyDays = data.studyConfig?.ema?.scheduling?.study_days || Object.keys(data.metrics.observedByDay).length || 1;
    
    const currentDay = Math.max(...data.allSessions.map(s => s.day), 1);
    const pct = Math.min(100, Math.round((currentDay / studyDays) * 100));
    
    document.getElementById('study-progress-text').textContent = `Day ${currentDay} of ${studyDays}`;
    document.getElementById('study-progress-pct').textContent = `${pct}%`;
    document.getElementById('study-progress-bar').style.width = `${pct}%`;
    document.getElementById('study-progress-hint').textContent = data.source === 'synthetic'
      ? 'Protocol schedule represented in the generated dataset.'
      : 'Progress reflects the latest observed session day.';
  },

  updateKPIs(m) {
    const fmtMsToMinSec = (ms) => {
        if(!Number.isFinite(ms)) return "Unavailable";
        const mins = Math.floor(ms / 60000);
        const secs = Math.floor((ms % 60000) / 1000);
        return `${mins}m ${secs}s`;
    };

    if (m.complianceAvailable) {
      document.getElementById('kpi-compliance').textContent = `${Math.round(m.complianceRate * 100)}%`;
      document.getElementById('trend-compliance').textContent = `${m.totalCompleted} records observed · ${m.totalMissed} scheduled misses`;
      this.setCardStatus('card-compliance', m.complianceRate >= 0.8 ? 'good' : 'warn');
      document.getElementById('kpi-pings').textContent = `${m.totalDelivered}/${m.totalExpectedPings}`;
      document.getElementById('trend-pings').textContent = 'From synthetic schedule manifest';
    } else {
      document.getElementById('kpi-compliance').textContent = "Unavailable";
      document.getElementById('trend-compliance').textContent = "Requires roster + prompt events";
      this.setCardStatus('card-compliance', '');
      document.getElementById('kpi-pings').textContent = "Unavailable";
      document.getElementById('trend-pings').textContent = "Requires delivery events";
    }

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
    const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const accent = css('--accent') || '#9d4037';
    const green = css('--green') || '#36705b';
    const yellow = css('--yellow') || '#9a6a26';
    const panel = css('--bg-1') || '#fbfaf7';
    const days = Array.from(new Set([...Object.keys(m.observedByDay), ...Object.keys(m.expectedByDay || {})])).sort((a,b)=>a-b);
    const labels = days.map(d => `Day ${d}`);
    const completedData = days.map(d => m.observedByDay[d]?.completed || 0);
    const completionDatasets = [{
      label: 'Completed sessions',
      data: days.map(d => m.expectedByDay?.[d]?.completed ?? m.observedByDay[d]?.completed ?? 0),
      backgroundColor: green,
      borderRadius: 2,
      barPercentage: 0.62
    }];
    if (m.complianceAvailable) completionDatasets.push({
      label: 'Scheduled misses',
      data: days.map(d => m.expectedByDay?.[d]?.missed || 0),
      backgroundColor: yellow,
      borderRadius: 2,
      barPercentage: 0.62
    });

    this.charts.compliance.data = {
      labels: labels,
      datasets: completionDatasets
    };
    this.charts.compliance.update();

    // Populate Overview Line Chart
    this.charts.overview.data = {
      labels: labels,
      datasets: [{
        label: 'Observed completed sessions',
        data: completedData,
        borderColor: accent,
        backgroundColor: `${accent}18`,
        borderWidth: 2, tension: 0.4, fill: true,
        pointBackgroundColor: panel, pointBorderColor: accent, pointRadius: 4
      }]
    };
    this.charts.overview.update();

    const valid = Math.max(0, m.totalCompleted - m.totalRapid);
    
    this.charts.disposition.data = {
      labels: ['Not rapid-flagged', 'Rapid review flag'],
      datasets: [{
        data: [valid, m.totalRapid],
        backgroundColor: [green, accent],
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
        borderColor: accent,
        backgroundColor: `${accent}14`,
        borderWidth: 2, tension: 0.4, fill: true,
        pointBackgroundColor: panel, pointBorderColor: accent, pointRadius: 4
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

    const expectedStats = {};
    if (data.source === 'synthetic') {
      const dayFilter = document.getElementById('filter-date').value;
      const participantFilter = document.getElementById('filter-cohort').value;
      (data.simulationManifest?.expectedEvents || []).forEach(event => {
        if (dayFilter !== 'all' && event.day !== Number(dayFilter)) return;
        if (participantFilter !== 'all' && event.participantId !== participantFilter) return;
        if (!expectedStats[event.participantId]) expectedStats[event.participantId] = { expected: 0, completed: 0 };
        expectedStats[event.participantId].expected++;
        if (event.completed) expectedStats[event.participantId].completed++;
      });
    }

    const participantIds = data.source === 'synthetic' ? Object.keys(expectedStats) : Object.keys(pStats);
    const rows = participantIds.map(pId => ({
      id: pId,
      completed: pStats[pId]?.completed || 0,
      expected: expectedStats[pId]?.expected || null,
      protocolCompleted: expectedStats[pId]?.completed || 0
    }));

    rows.sort((a,b) => a.id.localeCompare(b.id));

    rows.forEach(r => {
      const tr = document.createElement('tr');
      
      const idCell = document.createElement('td');
      idCell.textContent = r.id;
      const countCell = document.createElement('td');
      countCell.textContent = String(r.completed);
      const statusCell = document.createElement('td');
      const badge = document.createElement('span');
      const rate = r.expected ? r.protocolCompleted / r.expected : null;
      badge.className = `badge ${rate === null ? 'badge-neutral' : rate >= 0.8 ? 'badge-good' : 'badge-warn'}`;
      badge.textContent = rate === null ? 'Observed only' : `${Math.round(rate * 100)}% of ${r.expected} scheduled`;
      statusCell.appendChild(badge);
      tr.append(idCell, countCell, statusCell);
      tbody.appendChild(tr);
    });

    // Populate Overview Mini-Watchlist (Top 5 lowest compliance < 60%)
    const overviewTbody = document.getElementById('overview-watchlist-body');
    overviewTbody.innerHTML = '';
    
    if (data.source === 'synthetic') {
      const watchlist = rows
        .filter(item => item.expected && item.protocolCompleted / item.expected < 0.6)
        .sort((a, b) => (a.protocolCompleted / a.expected) - (b.protocolCompleted / b.expected))
        .slice(0, 5);
      document.getElementById('overview-critical-count').textContent = String(watchlist.length);
      if (!watchlist.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 2;
        cell.textContent = 'No participants below 60% protocol completion.';
        row.appendChild(cell);
        overviewTbody.appendChild(row);
      } else {
        watchlist.forEach(item => {
          const row = document.createElement('tr');
          const id = document.createElement('td');
          id.textContent = item.id;
          const count = document.createElement('td');
          count.textContent = `${item.protocolCompleted} of ${item.expected}`;
          row.append(id, count);
          overviewTbody.appendChild(row);
        });
      }
    } else {
      document.getElementById('overview-critical-count').textContent = 'N/A';
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 2;
      cell.style.cssText = 'text-align:center;color:var(--fg-3);padding-top:24px;';
      cell.textContent = 'A roster and prompt-event log are required to identify missed sessions.';
      row.appendChild(cell);
      overviewTbody.appendChild(row);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => AppUI.init());
