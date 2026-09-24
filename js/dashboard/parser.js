"use strict";

/**
 * Local dashboard ingestion and normalization.
 *
 * Compliance is intentionally unavailable unless a future import supplies a
 * participant roster plus scheduled/delivery events. Completed-session files
 * alone cannot reveal participants or prompts that produced no file.
 */
const DataParser = {
  state: {
    studyConfig: null,
    allSessions: [],
    filteredSessions: [],
    participants: new Set(),
    warnings: [],
    source: "empty",
    simulationManifest: null,
    metrics: {}
  },

  resetState() {
    this.state.studyConfig = null;
    this.state.allSessions = [];
    this.state.filteredSessions = [];
    this.state.participants = new Set();
    this.state.warnings = [];
    this.state.source = "empty";
    this.state.simulationManifest = null;
    this.state.metrics = this.emptyMetrics();
  },

  emptyMetrics() {
    return {
      complianceAvailable: false,
      latencyAvailable: false,
      totalExpectedPings: null,
      totalDelivered: null,
      totalCompleted: 0,
      totalMissed: null,
      complianceRate: null,
      totalRapid: 0,
      avgTimeMs: null,
      avgLatencyMs: null,
      observedByDay: {},
      expectedByDay: {},
      latencyByDay: {}
    };
  },

  async ingestFiles(fileList) {
    this.resetState();
    this.state.source = "imported";
    const cachedConfig = localStorage.getItem("ema_forge_config");
    if (cachedConfig) {
      try { this.state.studyConfig = JSON.parse(cachedConfig); } catch (error) { }
    }

    const files = Array.from(fileList).filter(file => /\.(?:json|ndjson|csv)$/i.test(file.name));
    if (!files.length) throw new Error("No JSON, NDJSON, or CSV files found.");

    await Promise.all(files.map(file => this._ingestFile(file)));
    this._deduplicateSessions();
    this.state.allSessions.forEach(session => this.state.participants.add(session.participantId));
    this.calculateMetrics({ excludeRapid: false, day: "all", participant: "all" });
    if (!this.state.studyConfig && this.state.allSessions.length) {
      this.state.warnings.push("No config.json was imported; question labels and study structure may be incomplete.");
    }
    return this.state;
  },

  loadSynthetic(result) {
    if (!result?.config || !Array.isArray(result.sessions) || !result.manifest?.synthetic) {
      throw new Error("Invalid synthetic study payload.");
    }
    this.resetState();
    this.state.source = "synthetic";
    this.state.studyConfig = result.config;
    this.state.simulationManifest = result.manifest;
    this.state.allSessions = result.sessions.map(session => this.normalizeSession(session));
    this._deduplicateSessions();
    for (const event of result.manifest.expectedEvents || []) this.state.participants.add(event.participantId);
    this.state.allSessions.forEach(session => this.state.participants.add(session.participantId));
    this.calculateMetrics({ excludeRapid: false, day: "all", participant: "all" });
    return this.state;
  },

  _ingestFile(file) {
    return new Promise(resolve => {
      if (/\.(?:json|ndjson)$/i.test(file.name)) {
        const reader = new FileReader();
        reader.onload = event => {
          try {
            if (/\.ndjson$/i.test(file.name)) this._ingestNdjson(event.target.result, file.name);
            else this._routeJson(JSON.parse(event.target.result), event.target.result, file.name);
          }
          catch (error) { this.state.warnings.push(`Could not parse ${file.name}.`); }
          resolve();
        };
        reader.onerror = () => { this.state.warnings.push(`Could not read ${file.name}.`); resolve(); };
        reader.readAsText(file);
        return;
      }

      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: results => { this._routeCsv(results, file.name); resolve(); },
        error: () => { this.state.warnings.push(`Could not parse ${file.name}.`); resolve(); }
      });
    });
  },

  _routeJson(json, raw, filename) {
    if (json.schema_version && json.ema?.scheduling) {
      this.state.studyConfig = json;
      localStorage.setItem("ema_forge_config", raw);
    } else if (json.session_data && json.submission_id) {
      const session = {
        ...json.session_data,
        receiverReceipt: json.server_receipt || null,
        deliveryEnvelope: {
          submissionId: json.submission_id,
          participantId: json.participant_id,
          day: json.day,
          windowId: json.window_id
        }
      };
      this.state.allSessions.push(this.normalizeSession(session));
    } else if (json.participantId || json.sessionId) {
      this.state.allSessions.push(this.normalizeSession(json));
    } else {
      this.state.warnings.push(`${filename} is not a recognized EMA Forge config or session.`);
    }
  },

  _ingestNdjson(raw, filename) {
    const lines = String(raw || "").split(/\r?\n/);
    let records = 0;
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      try {
        this._routeJson(JSON.parse(line), line, `${filename} line ${index + 1}`);
        records += 1;
      } catch (error) {
        this.state.warnings.push(`Invalid JSON on line ${index + 1} of ${filename}.`);
      }
    });
    if (!records) this.state.warnings.push(`${filename} did not contain any readable records.`);
  },

  _routeCsv(results, filename) {
    const rows = results.data || [];
    if (!rows.length) return;
    const columns = results.meta?.fields || Object.keys(rows[0] || {});

    if (columns.includes("Raw JSON")) {
      rows.forEach(row => {
        if (!row["Raw JSON"]) return;
        try { this._routeJson(JSON.parse(row["Raw JSON"]), row["Raw JSON"], filename); }
        catch (error) { this.state.warnings.push(`Invalid Raw JSON row in ${filename}.`); }
      });
      return;
    }

    if (columns.includes("question_id") && columns.includes("session_id")) {
      this._ingestLongFormat(rows);
      return;
    }
    this.state.warnings.push(`${filename} does not match a supported EMA Forge CSV schema.`);
  },

  _ingestLongFormat(rows) {
    const sessions = new Map();
    rows.forEach(row => {
      if (!row.session_id) return;
      if (!sessions.has(row.session_id)) {
        sessions.set(row.session_id, {
          participantId: row.participant_id || "Unknown",
          sessionId: row.session_id,
          day: Number.parseInt(row.day, 10) || 1,
          type: row.session_type || row.window_id || "unknown",
          status: "complete",
          startedAt: row.session_started_at || null,
          completedAt: row.session_submitted_at || null,
          phaseMap: new Map()
        });
      }

      const session = sessions.get(row.session_id);
      const phaseKey = [row.window_id, row.block, row.phase_started_at].join("::");
      if (!session.phaseMap.has(phaseKey)) {
        session.phaseMap.set(phaseKey, {
          type: "ema_response",
          block: row.block || "",
          windowId: row.window_id || "",
          startedAt: row.phase_started_at || null,
          submittedAt: row.phase_submitted_at || null,
          presentationOrder: [[]],
          eligibleQuestionIds: [],
          skippedQuestions: [],
          responses: {},
          _order: []
        });
      }

      const phase = session.phaseMap.get(phaseKey);
      const questionId = row.question_id;
      if (!questionId) return;
      phase.eligibleQuestionIds.push(questionId);
      const order = Number.parseInt(row.presentation_order, 10);
      if (Number.isFinite(order)) phase._order.push([questionId, order]);
      if (row.response_status === "skipped_condition") {
        phase.skippedQuestions.push({ questionId, reason: row.skip_reason || "condition_false" });
        return;
      }
      if (row.response_status === "unanswered" || (row.response_value === "" && row.response_numeric === "")) return;

      const value = this._parseCsvValue(row.question_type, row.response_value, row.response_numeric);
      const startMs = row.phase_started_at ? Date.parse(row.phase_started_at) : NaN;
      const latencyMs = Number(row.response_latency_ms);
      const respondedAt = Number.isFinite(startMs) && Number.isFinite(latencyMs)
        ? new Date(startMs + latencyMs).toISOString()
        : null;
      phase.responses[questionId] = { value, respondedAt };
    });

    sessions.forEach(session => {
      const data = Array.from(session.phaseMap.values()).map(phase => {
        phase.presentationOrder = [phase._order.sort((a, b) => a[1] - b[1]).map(item => item[0])];
        delete phase._order;
        phase.eligibleQuestionIds = Array.from(new Set(phase.eligibleQuestionIds));
        return phase;
      });
      const { phaseMap, ...sessionRecord } = session;
      this.state.allSessions.push(this.normalizeSession({ ...sessionRecord, data }));
    });
  },

  _parseCsvValue(type, raw, numeric) {
    if (type === "checkbox") return String(raw || "").split(";").filter(Boolean);
    if (type === "affect_grid") {
      const [valence, arousal] = String(raw || "").split(";").map(Number);
      return Number.isFinite(valence) && Number.isFinite(arousal) ? { valence, arousal } : raw;
    }
    if (type === "heart_rate") {
      const bpm = Number(numeric !== "" ? numeric : raw);
      return Number.isFinite(bpm) ? { bpm, sqi: null } : null;
    }
    if (type === "slider" || type === "numeric") {
      const value = Number(numeric !== "" ? numeric : raw);
      return Number.isFinite(value) ? value : null;
    }
    return raw;
  },

  normalizeSession(json) {
    const startMs = json.startedAt ? Date.parse(json.startedAt) : NaN;
    const endMs = json.completedAt ? Date.parse(json.completedAt) : NaN;
    const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? endMs - startMs : null;
    return {
      ...json,
      participantId: json.participantId || "Unknown",
      sessionId: json.sessionId || "",
      startedAt: json.startedAt || null,
      completedAt: json.completedAt || null,
      day: Number.parseInt(json.day, 10) || 1,
      sessionType: json.type || "unknown",
      durationMs,
      latencyMs: Number.isFinite(json.notificationLatencyMs) ? json.notificationLatencyMs : null,
      isCompleted: json.status === "complete" || json.status === "submitted",
      isRapid: durationMs !== null && durationMs < 30000,
      data: Array.isArray(json.data) ? json.data : []
    };
  },

  _deduplicateSessions() {
    const byId = new Map();
    this.state.allSessions.forEach(session => {
      const key = session.sessionId || `${session.participantId}|${session.day}|${session.startedAt}`;
      const existing = byId.get(key);
      if (!existing || Date.parse(session.completedAt || 0) >= Date.parse(existing.completedAt || 0)) byId.set(key, session);
    });
    this.state.allSessions = Array.from(byId.values());
  },

  calculateMetrics(filters = {}) {
    let sessions = this.state.allSessions;
    if (filters.day && filters.day !== "all") sessions = sessions.filter(session => session.day === Number(filters.day));
    if (filters.participant && filters.participant !== "all") sessions = sessions.filter(session => session.participantId === filters.participant);

    const totalRapid = sessions.filter(session => session.isRapid).length;
    if (filters.excludeRapid) sessions = sessions.filter(session => !session.isRapid);
    this.state.filteredSessions = sessions;

    const completed = sessions.filter(session => session.isCompleted);
    const durations = completed.map(session => session.durationMs).filter(Number.isFinite);
    const latencies = completed.map(session => session.latencyMs).filter(Number.isFinite);
    const observedByDay = {};
    completed.forEach(session => {
      if (!observedByDay[session.day]) observedByDay[session.day] = { completed: 0, latencies: [] };
      observedByDay[session.day].completed += 1;
      if (Number.isFinite(session.latencyMs)) observedByDay[session.day].latencies.push(session.latencyMs);
    });

    const latencyByDay = {};
    Object.entries(observedByDay).forEach(([day, values]) => {
      latencyByDay[day] = values.latencies.length
        ? values.latencies.reduce((sum, value) => sum + value, 0) / values.latencies.length
        : null;
    });

    let syntheticMetrics = {};
    if (this.state.source === "synthetic" && this.state.simulationManifest) {
      let expected = this.state.simulationManifest.expectedEvents || [];
      if (filters.day && filters.day !== "all") expected = expected.filter(event => event.day === Number(filters.day));
      if (filters.participant && filters.participant !== "all") expected = expected.filter(event => event.participantId === filters.participant);
      const expectedByDay = {};
      expected.forEach(event => {
        if (!expectedByDay[event.day]) expectedByDay[event.day] = { expected: 0, delivered: 0, completed: 0, missed: 0 };
        expectedByDay[event.day].expected += 1;
        if (event.delivered) expectedByDay[event.day].delivered += 1;
        if (event.completed) expectedByDay[event.day].completed += 1;
        else expectedByDay[event.day].missed += 1;
      });
      const protocolCompleted = expected.filter(event => event.completed).length;
      const totalExpectedPings = expected.length;
      syntheticMetrics = {
        complianceAvailable: true,
        totalExpectedPings,
        totalDelivered: expected.filter(event => event.delivered).length,
        totalMissed: Math.max(0, totalExpectedPings - protocolCompleted),
        complianceRate: totalExpectedPings ? protocolCompleted / totalExpectedPings : null,
        expectedByDay
      };
    }

    this.state.metrics = {
      ...this.emptyMetrics(),
      latencyAvailable: latencies.length > 0,
      totalCompleted: completed.length,
      totalRapid,
      avgTimeMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
      avgLatencyMs: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null,
      observedByDay,
      latencyByDay,
      ...syntheticMetrics
    };
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = DataParser;
