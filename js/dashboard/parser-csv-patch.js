"use strict";

/**
 * EMA Forge - Parser Patch
 *
 * Extends DataParser so the dashboard can re-import its own exported
 * long-format CSV (one row per question-answer pair). The existing CSV
 * path only understood the Google-Sheets webhook format, which has a
 * single 'Raw JSON' column containing the whole session.
 *
 * This patch adds auto-detection:
 *   - Webhook CSV: has a 'Raw JSON' column → existing behaviour.
 *   - Dashboard master CSV: has 'question_id' + 'response_value' columns →
 *     reconstruct sessions into the same shape that the JSON path produces,
 *     so downstream code (metrics, content stats, watchlist) treats them
 *     identically.
 *
 * The reconstruction is lossy in the way any round-trip through long-format
 * is: we get back scalar responses and session timestamps, but checkbox
 * arrays are re-split from 'a;b;c' form, and affect_grid objects are
 * re-assembled from 'valence;arousal'. Heart-rate gets only its BPM back;
 * SQI and IBI series don't survive the round-trip (they're not in the CSV
 * schema). For operational dashboards this is fine — for signal analysis
 * of HR quality you need the original JSONs.
 *
 * To apply: include this file *after* parser.js in dashboard.html:
 *   <script src="js/dashboard/parser.js"></script>
 *   <script src="js/dashboard/parser-csv-patch.js"></script>
 */

(function () {
  if (typeof DataParser === 'undefined') {
    console.warn('parser-csv-patch.js loaded before parser.js — aborting.');
    return;
  }

  // Save reference to the original ingest; we're going to swap the CSV
  // handling but leave JSON paths untouched.
  const originalIngest = DataParser.ingestFiles.bind(DataParser);

  DataParser.ingestFiles = async function (fileList) {
    this.resetState();

    // Reuse the cached config if one has been loaded in a prior session.
    const cachedConfig = localStorage.getItem('ema_forge_config');
    if (cachedConfig) {
      try { this.state.studyConfig = JSON.parse(cachedConfig); } catch (e) {}
    }

    const files = Array.from(fileList).filter(f =>
      f.name.endsWith('.json') || f.name.endsWith('.csv')
    );
    if (files.length === 0) throw new Error('No JSON or CSV files found.');

    const readPromises = files.map(file => new Promise(resolve => {
      if (file.name.endsWith('.json')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const json = JSON.parse(e.target.result);
            if (json.schema_version && json.ema && json.ema.scheduling) {
              this.state.studyConfig = json;
              localStorage.setItem('ema_forge_config', e.target.result);
            } else if (json.participantId || json.sessionId) {
              this.state.allSessions.push(this.normalizeSession(json));
            }
          } catch (err) {
            console.warn(`Could not parse ${file.name}`);
          }
          resolve();
        };
        reader.readAsText(file);
      } else if (file.name.endsWith('.csv')) {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            this._routeCsv(results, file.name);
            resolve();
          },
          error: (err) => {
            console.error('CSV Parse Error:', err);
            resolve();
          }
        });
      }
    }));

    await Promise.all(readPromises);

    if (!this.state.studyConfig && this.state.allSessions.length > 0) {
      console.warn('No config loaded. Study layout might be incomplete.');
    }

    this.state.allSessions.forEach(s => this.state.participants.add(s.participantId));
    this.calculateMetrics({ excludeNoise: true, excludeMissed: false, day: 'all', participant: 'all' });
    return this.state;
  };

  // Decide which schema this CSV is in and route accordingly.
  DataParser._routeCsv = function (results, filename) {
    const rows = results.data || [];
    if (rows.length === 0) return;
    const cols = results.meta?.fields || Object.keys(rows[0] || {});

    const isWebhook = cols.includes('Raw JSON');
    const isLongFormat =
      cols.includes('question_id') &&
      cols.includes('response_value') &&
      cols.includes('session_id');

    if (isWebhook) {
      rows.forEach(row => {
        const rawJsonStr = row['Raw JSON'];
        if (!rawJsonStr) return;
        try {
          const json = JSON.parse(rawJsonStr);
          if (json.schema_version && json.ema && json.ema.scheduling) {
            this.state.studyConfig = json;
            localStorage.setItem('ema_forge_config', rawJsonStr);
          } else if (json.participantId || json.sessionId) {
            this.state.allSessions.push(this.normalizeSession(json));
          }
        } catch (err) {
          console.warn('Invalid JSON in webhook CSV row', row);
        }
      });
      return;
    }

    if (isLongFormat) {
      this._ingestLongFormat(rows);
      return;
    }

    console.warn(`CSV ${filename} does not match any known schema. ` +
      `Expected either a "Raw JSON" column (webhook export) or ` +
      `"question_id" + "response_value" + "session_id" columns ` +
      `(dashboard master CSV).`);
  };

  // Reconstruct sessions from long-format rows. Group by session_id, then
  // within a session group rows by (windowId, block, phase_started_at) —
  // that tuple uniquely identifies an ema_response entry.
  DataParser._ingestLongFormat = function (rows) {
    const sessionBuckets = {}; // sessionId -> { meta, phases: { phaseKey: {entry, responses} } }

    rows.forEach(row => {
      const sid = row.session_id;
      if (!sid) return;

      if (!sessionBuckets[sid]) {
        sessionBuckets[sid] = {
          participantId: row.participant_id || 'Unknown',
          sessionId: sid,
          day: parseInt(row.day, 10) || 1,
          type: row.window_id || 'unknown',
          status: 'complete',
          startedAt: row.session_started_at || null,
          completedAt: row.session_submitted_at || null,
          phases: {}
        };
      }
      const bkt = sessionBuckets[sid];

      const phaseKey = `${row.window_id || ''}::${row.block || ''}::${row.phase_started_at || ''}`;
      if (!bkt.phases[phaseKey]) {
        bkt.phases[phaseKey] = {
          type: 'ema_response',
          block: row.block || '',
          windowId: row.window_id || '',
          startedAt: row.phase_started_at || null,
          submittedAt: row.phase_submitted_at || null,
          presentationOrder: [],     // we'll fill this from presentation_order per row
          _orderMap: {},             // qid -> presentation_order number
          responses: {}
        };
      }
      const ph = bkt.phases[phaseKey];

      const qid = row.question_id;
      if (!qid) return;

      // Track presentation order
      const ord = parseInt(row.presentation_order, 10);
      if (Number.isFinite(ord)) ph._orderMap[qid] = ord;

      // Reconstruct value from the type
      const type = row.question_type || '';
      const raw = row.response_value ?? '';
      const numeric = row.response_numeric ?? '';
      let value;

      if (raw === '' && numeric === '') {
        // No response — don't add to responses map, but DO include in
        // presentation order so denominators are honest.
        return;
      }

      if (type === 'checkbox') {
        value = String(raw).split(';').filter(Boolean);
      } else if (type === 'affect_grid') {
        const parts = String(raw).split(';');
        value = parts.length === 2
          ? { valence: Number(parts[0]), arousal: Number(parts[1]) }
          : raw;
      } else if (type === 'heart_rate') {
        // CSV only has BPM; reconstruct a minimal HR object. SQI is null
        // on purpose (we don't know it), and we deliberately do NOT
        // synthesise an empty ibi_series — that would masquerade as real
        // data. Downstream HR analyses that require IBI will need to
        // re-import from JSON.
        const n = Number(numeric !== '' ? numeric : raw);
        value = Number.isFinite(n) ? { bpm: n, sqi: null } : null;
      } else if (type === 'slider' || type === 'numeric') {
        const n = Number(numeric !== '' ? numeric : raw);
        value = Number.isFinite(n) ? n : null;
      } else {
        value = raw; // choice, text → keep as string
      }

      // Compute respondedAt from phase_started_at + latency if available
      let respondedAt = null;
      const phaseStartMs = row.phase_started_at ? Date.parse(row.phase_started_at) : null;
      const latency = Number(row.response_latency_ms);
      if (phaseStartMs && Number.isFinite(latency)) {
        respondedAt = new Date(phaseStartMs + latency).toISOString();
      }

      ph.responses[qid] = { value, respondedAt };
    });

    // Convert phase buckets into final session JSON and push through the
    // normal normaliser so it picks up duration, noise flag, etc.
    Object.values(sessionBuckets).forEach(bkt => {
      const data = Object.values(bkt.phases).map(ph => {
        // Rebuild presentationOrder as a flat array (we don't know the
        // original 2D page-break layout, but flat order is enough for
        // denominator math). Sort by presentation_order.
        const orderedQids = Object.entries(ph._orderMap)
          .sort((a, b) => a[1] - b[1])
          .map(x => x[0]);
        delete ph._orderMap;
        ph.presentationOrder = [orderedQids];
        return ph;
      });

      const fakeJson = {
        participantId: bkt.participantId,
        sessionId: bkt.sessionId,
        day: bkt.day,
        type: bkt.type,
        status: bkt.status,
        startedAt: bkt.startedAt,
        completedAt: bkt.completedAt,
        data
      };

      const normalised = this.normalizeSession(fakeJson);
      // normalizeSession doesn't attach sessionId, participantId in the
      // form downstream code expects — bolt them on.
      normalised.sessionId = bkt.sessionId;
      normalised.startedAt = bkt.startedAt;
      normalised.completedAt = bkt.completedAt;
      this.state.allSessions.push(normalised);
    });
  };
})();
