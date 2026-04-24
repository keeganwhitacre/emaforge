"use strict";

/**
 * EMA Forge - Content View
 *
 * Renders the "Items" dashboard tab. Consumes ContentStats.compute()
 * output and paints a per-question card strip plus a headline KPI row.
 *
 * Deliberately uses the same chart library (Chart.js) and the same CSS
 * tokens as the rest of the dashboard so this doesn't look bolted-on.
 *
 * One design quirk worth knowing: Chart.js instances for the per-question
 * cards are created lazily and re-created on every refresh (we destroy()
 * and rebuild). That's wasteful in theory but in practice keeps things
 * simple — no stale state, no mismatch between chart internals and the
 * current config. For a 20-item study recalculating on a toggle click,
 * the cost is imperceptible.
 */

const ContentView = {

  charts: {},              // { [qid]: ChartInstance }
  composite: null,         // ChartInstance for the composite score histogram
  compositePicks: [],      // [{ qid, reverse }]
  compositeMethod: 'mean', // "mean" | "sum"

  // -----------------------------------------------------------------
  // Entry point — called from AppUI.refreshData()
  // -----------------------------------------------------------------
  render() {
    const sessions = DataParser.state.filteredSessions;
    const cfg = DataParser.state.studyConfig;
    const container = document.getElementById('content-cards');
    const kpiRow = document.getElementById('content-kpi-row');

    if (!container || !kpiRow) return; // view not present in DOM

    if (!cfg || sessions.length === 0) {
      container.innerHTML = '<div class="content-empty">No content to display yet. Import data to see per-question breakdowns.</div>';
      kpiRow.innerHTML = '';
      return;
    }

    const stats = ContentStats.compute(sessions, cfg);
    this._renderKPIs(kpiRow, stats.overall);
    this._renderCards(container, stats.questions);
    this._renderCompositeBuilder(stats.questions);
  },

  // -----------------------------------------------------------------
  // Headline KPI strip — four "at a glance" numbers
  // -----------------------------------------------------------------
  _renderKPIs(el, overall) {
    const pct = v => v === null || v === undefined ? '--' : Math.round(v * 100) + '%';
    const ms = v => v === null || v === undefined ? '--' : (v / 1000).toFixed(1) + 's';
    const bpm = v => v === null || v === undefined ? '--' : Math.round(v);

    el.innerHTML = `
      <div class="kpi-card">
        <span class="kpi-title">Sessions Analyzed</span>
        <span class="kpi-value">${overall.nSessions}</span>
        <div class="kpi-trend trend-neutral">${overall.nParticipants} participants</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-title">Avg. Item Response Rate</span>
        <span class="kpi-value">${pct(overall.avgResponseRate)}</span>
        <div class="kpi-trend trend-neutral">Across all items, adjusted for skip logic</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-title">Median Item Latency</span>
        <span class="kpi-value">${ms(overall.medianItemLatencyMs)}</span>
        <div class="kpi-trend trend-neutral">Time per question</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-title">Avg. BPM</span>
        <span class="kpi-value">${bpm(overall.headlineBpm)}</span>
        <div class="kpi-trend trend-neutral">${overall.headlineBpmN ? overall.headlineBpmN + ' captures' : 'No HR data'}</div>
      </div>
    `;
  },

  // -----------------------------------------------------------------
  // Per-question card grid
  // -----------------------------------------------------------------
  _renderCards(el, summaries) {
    // Tear down prior charts to avoid leaks (Chart.js holds onto canvases).
    Object.values(this.charts).forEach(c => { try { c.destroy(); } catch (e) {} });
    this.charts = {};

    if (summaries.length === 0) {
      el.innerHTML = '<div class="content-empty">No questions in this study\'s config.</div>';
      return;
    }

    el.innerHTML = summaries.map(s => this._cardHtml(s)).join('');

    // Now that the canvases are in the DOM, bind charts to them.
    summaries.forEach(s => this._bindCardChart(s));
  },

  _cardHtml(s) {
    const typeLabel = {
      slider: 'Slider', numeric: 'Number', choice: 'Single Choice',
      checkbox: 'Multi Select', text: 'Text',
      affect_grid: 'Affect Grid', heart_rate: 'Heart Rate'
    }[s.type] || s.type;

    const headline = this._cardHeadline(s);
    const canvasId = `qchart-${s.id}`;
    const showChart = ['slider', 'numeric', 'choice', 'checkbox', 'heart_rate', 'affect_grid'].includes(s.type);

    return `
      <div class="q-stat-card" data-qid="${s.id}">
        <div class="q-stat-head">
          <div class="q-stat-title">
            <span class="q-stat-label">${this._esc(s.text)}</span>
            <span class="q-stat-id">${s.id}</span>
          </div>
          <span class="q-stat-type">${typeLabel}</span>
        </div>
        <div class="q-stat-headline">${headline}</div>
        <div class="q-stat-meta">
          <span><strong>${s.respondedN}</strong> / ${s.presentedN} responses</span>
          <span>Response rate: <strong>${this._fmtPct(s.responseRate)}</strong></span>
          ${s.medianLatencyMs !== null ? `<span>Median latency: <strong>${(s.medianLatencyMs / 1000).toFixed(1)}s</strong></span>` : ''}
        </div>
        ${showChart ? `<div class="q-stat-chart"><canvas id="${canvasId}"></canvas></div>` : ''}
      </div>
    `;
  },

  _cardHeadline(s) {
    const fx = (v, d=2) => v === null || v === undefined ? '--' : Number(v).toFixed(d);
    const showUnit = s.type === 'slider' && s.question?.unit ? ` ${s.question.unit}` : '';

    switch (s.type) {
      case 'slider':
      case 'numeric':
        if (s.n === 0) return `<span class="q-stat-dim">no responses</span>`;
        return `
          <span class="q-stat-big">${fx(s.mean, 2)}</span>
          <span class="q-stat-unit">M</span>
          <span class="q-stat-dim">±${fx(s.sd, 2)} SD · range ${fx(s.min, 1)}–${fx(s.max, 1)} · n=${s.n}</span>
        `;
      case 'choice': {
        if (s.n === 0) return `<span class="q-stat-dim">no responses</span>`;
        const top = s.distribution[0];
        return `
          <span class="q-stat-big">${this._esc(top.option)}</span>
          <span class="q-stat-unit">modal</span>
          <span class="q-stat-dim">${this._fmtPct(top.pct)} chose · n=${s.n}</span>
        `;
      }
      case 'checkbox': {
        if (s.n === 0) return `<span class="q-stat-dim">no responses</span>`;
        const top = s.distribution[0];
        return `
          <span class="q-stat-big">${this._esc(top.option)}</span>
          <span class="q-stat-unit">top</span>
          <span class="q-stat-dim">${this._fmtPct(top.pct)} endorsed · avg ${fx(s.avgSelected, 1)} selected · n=${s.n}</span>
        `;
      }
      case 'text':
        if (s.n === 0) return `<span class="q-stat-dim">no responses</span>`;
        return `
          <span class="q-stat-big">${s.n}</span>
          <span class="q-stat-unit">answers</span>
          <span class="q-stat-dim">avg length ${fx(s.avgLength, 0)} chars</span>
        `;
      case 'affect_grid':
        if (s.n === 0) return `<span class="q-stat-dim">no responses</span>`;
        return `
          <span class="q-stat-big">V ${fx(s.meanValence, 2)} · A ${fx(s.meanArousal, 2)}</span>
          <span class="q-stat-dim">SD V ${fx(s.sdValence, 2)} · A ${fx(s.sdArousal, 2)} · n=${s.n}</span>
        `;
      case 'heart_rate':
        if (s.n === 0) return `<span class="q-stat-dim">no captures</span>`;
        return `
          <span class="q-stat-big">${fx(s.meanBpm, 0)}</span>
          <span class="q-stat-unit">bpm</span>
          <span class="q-stat-dim">±${fx(s.sdBpm, 1)} · ${s.nUsable}/${s.n} usable (SQI ≥ 0.5)</span>
        `;
      default:
        return `<span class="q-stat-dim">${s.n || 0} responses</span>`;
    }
  },

  _bindCardChart(s) {
    const canvas = document.getElementById(`qchart-${s.id}`);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Common colour tokens — read from CSS vars so light/dark mode works.
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim() || '#e8716a';
    const green = css.getPropertyValue('--green').trim() || '#3fb950';
    const fg3 = css.getPropertyValue('--fg-3').trim() || '#6e7681';
    const gridColor = css.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.08)';

    const common = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: {
        x: { grid: { display: false }, ticks: { color: fg3, font: { size: 10 } } },
        y: { grid: { color: gridColor }, ticks: { color: fg3, font: { size: 10 } } }
      }
    };

    let chart;
    if (s.type === 'slider' || s.type === 'numeric') {
      // Sparkline of per-day means
      const days = Object.keys(s.perDayMean).sort((a, b) => +a - +b);
      chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: days.map(d => `D${d}`),
          datasets: [{
            data: days.map(d => s.perDayMean[d]),
            borderColor: accent, backgroundColor: 'transparent',
            borderWidth: 2, tension: 0.35, pointRadius: 3, pointBackgroundColor: accent
          }]
        },
        options: common
      });
    } else if (s.type === 'heart_rate') {
      const days = Object.keys(s.perDayMeanBpm).sort((a, b) => +a - +b);
      chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: days.map(d => `D${d}`),
          datasets: [{
            data: days.map(d => s.perDayMeanBpm[d]),
            borderColor: accent, backgroundColor: 'transparent',
            borderWidth: 2, tension: 0.35, pointRadius: 3, pointBackgroundColor: accent
          }]
        },
        options: common
      });
    } else if (s.type === 'choice' || s.type === 'checkbox') {
      const labels = s.distribution.map(d => d.option);
      const data = s.distribution.map(d => d.n);
      chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{ data, backgroundColor: green, borderRadius: 3 }]
        },
        options: {
          ...common,
          indexAxis: 'y',
          scales: {
            x: { grid: { color: gridColor }, ticks: { color: fg3, font: { size: 10 } }, beginAtZero: true },
            y: { grid: { display: false }, ticks: { color: fg3, font: { size: 10 } } }
          }
        }
      });
    } else if (s.type === 'affect_grid') {
      chart = new Chart(ctx, {
        type: 'scatter',
        data: {
          datasets: [{
            data: s.points,
            backgroundColor: accent + 'aa',
            borderColor: accent,
            pointRadius: 3
          }]
        },
        options: {
          ...common,
          scales: {
            x: { min: -1, max: 1, grid: { color: gridColor }, ticks: { color: fg3, font: { size: 10 } }, title: { display: true, text: 'Valence', color: fg3, font: { size: 10 } } },
            y: { min: -1, max: 1, grid: { color: gridColor }, ticks: { color: fg3, font: { size: 10 } }, title: { display: true, text: 'Arousal', color: fg3, font: { size: 10 } } }
          }
        }
      });
    }

    if (chart) this.charts[s.id] = chart;
  },

  // -----------------------------------------------------------------
  // Composite score builder
  // -----------------------------------------------------------------
  _renderCompositeBuilder(summaries) {
    const picker = document.getElementById('composite-picker');
    const output = document.getElementById('composite-output');
    if (!picker || !output) return;

    const numericQs = summaries.filter(s => s.type === 'slider' || s.type === 'numeric');

    if (numericQs.length === 0) {
      picker.innerHTML = '<div class="content-empty" style="padding:12px;">No numeric items available to build a composite score.</div>';
      output.innerHTML = '';
      return;
    }

    picker.innerHTML = numericQs.map(s => {
      const isPicked = this.compositePicks.find(p => p.qid === s.id);
      const isReverse = isPicked?.reverse;
      return `
        <div class="composite-row">
          <label>
            <input type="checkbox" class="composite-pick" data-qid="${s.id}" ${isPicked ? 'checked' : ''}>
            <span class="composite-row-text">${this._esc(s.text)}</span>
            <span class="composite-row-id">${s.id}</span>
          </label>
          <label class="composite-reverse">
            <input type="checkbox" class="composite-reverse-toggle" data-qid="${s.id}" ${isReverse ? 'checked' : ''} ${isPicked ? '' : 'disabled'}>
            <span>reverse-score</span>
          </label>
        </div>
      `;
    }).join('');

    // Bind
    picker.querySelectorAll('.composite-pick').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const qid = e.target.dataset.qid;
        if (e.target.checked) {
          if (!this.compositePicks.find(p => p.qid === qid)) {
            this.compositePicks.push({ qid, reverse: false });
          }
        } else {
          this.compositePicks = this.compositePicks.filter(p => p.qid !== qid);
        }
        this._renderCompositeBuilder(summaries);
        this._renderCompositeOutput();
      });
    });
    picker.querySelectorAll('.composite-reverse-toggle').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const qid = e.target.dataset.qid;
        const pick = this.compositePicks.find(p => p.qid === qid);
        if (pick) pick.reverse = e.target.checked;
        this._renderCompositeOutput();
      });
    });

    // Method toggle (mean vs sum)
    const methodCtrl = document.getElementById('composite-method');
    if (methodCtrl && !methodCtrl.dataset.bound) {
      methodCtrl.dataset.bound = '1';
      methodCtrl.addEventListener('change', (e) => {
        this.compositeMethod = e.target.value;
        this._renderCompositeOutput();
      });
    }

    this._renderCompositeOutput();
  },

  _renderCompositeOutput() {
    const output = document.getElementById('composite-output');
    if (!output) return;

    if (this.compositePicks.length === 0) {
      output.innerHTML = '<div class="content-empty" style="padding:12px;">Select one or more items above to compute a composite score.</div>';
      if (this.composite) { try { this.composite.destroy(); } catch (e) {} this.composite = null; }
      return;
    }

    const sessions = DataParser.state.filteredSessions;
    const cfg = DataParser.state.studyConfig;
    const result = ContentStats.computeCompositeScore(sessions, cfg, this.compositePicks, this.compositeMethod);

    const fx = (v, d=2) => v === null || v === undefined ? '--' : Number(v).toFixed(d);

    output.innerHTML = `
      <div class="composite-summary">
        <div><span class="composite-label">Method</span><span class="composite-value">${this.compositeMethod === 'sum' ? 'Sum' : 'Mean'}</span></div>
        <div><span class="composite-label">N sessions scored</span><span class="composite-value">${result.n}</span></div>
        <div><span class="composite-label">M</span><span class="composite-value">${fx(result.mean)}</span></div>
        <div><span class="composite-label">SD</span><span class="composite-value">${fx(result.sd)}</span></div>
        <div><span class="composite-label">Range</span><span class="composite-value">${fx(result.min, 1)}–${fx(result.max, 1)}</span></div>
      </div>
      <div class="q-stat-chart" style="height:180px;"><canvas id="composite-chart"></canvas></div>
      <div class="composite-note">Listwise-complete scoring: sessions missing any selected item are excluded.</div>
    `;

    // Histogram
    if (this.composite) { try { this.composite.destroy(); } catch (e) {} }
    const ctx = document.getElementById('composite-chart')?.getContext('2d');
    if (!ctx || result.sessionScores.length === 0) return;

    const scores = result.sessionScores.map(s => s.score);
    const bins = this._makeHistogram(scores, 15);
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim() || '#e8716a';
    const fg3 = css.getPropertyValue('--fg-3').trim() || '#6e7681';
    const gridColor = css.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.08)';

    this.composite = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: bins.labels,
        datasets: [{ data: bins.counts, backgroundColor: accent, borderRadius: 2 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: fg3, font: { size: 10 } } },
          y: { grid: { color: gridColor }, ticks: { color: fg3, font: { size: 10 } }, beginAtZero: true }
        }
      }
    });
  },

  _makeHistogram(vals, nBins) {
    if (vals.length === 0) return { labels: [], counts: [] };
    const min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) return { labels: [min.toFixed(2)], counts: [vals.length] };
    const w = (max - min) / nBins;
    const counts = new Array(nBins).fill(0);
    const labels = [];
    for (let i = 0; i < nBins; i++) {
      labels.push((min + i * w).toFixed(1));
    }
    vals.forEach(v => {
      let i = Math.floor((v - min) / w);
      if (i >= nBins) i = nBins - 1;
      counts[i]++;
    });
    return { labels, counts };
  },

  // Utilities
  _esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
  _fmtPct(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return '--';
    return Math.round(v * 100) + '%';
  }
};
