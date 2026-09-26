"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.localStorage = {
  values: new Map(),
  getItem(key) { return this.values.get(key) || null; },
  setItem(key, value) { this.values.set(key, value); }
};

const DataParser = require("../js/dashboard/parser.js");

test("a one-file analysis import uses its own config and response envelopes", async () => {
  const oldConfig = { schema_version: "1", study: { name: "Other study" }, ema: { scheduling: { windows: [] } } };
  localStorage.setItem("ema_forge_config", JSON.stringify(oldConfig));
  const config = { schema_version: "1", study: { name: "Study A" }, ema: { scheduling: { windows: [] } } };
  const bundle = {
    format: "ema_forge_analysis_bundle", version: 1, config,
    sessions: [{
      submission_id: "ses_1", participant_id: "P001", day: 1, window_id: "morning",
      session_data: { participantId: "P001", sessionId: "ses_1", day: 1, type: "ema_only", status: "complete", data: [] }
    }]
  };
  const OriginalFileReader = global.FileReader;
  global.FileReader = class {
    readAsText(file) { this.onload({ target: { result: file.content } }); }
  };
  try {
    const state = await DataParser.ingestFiles([{ name: "ema-forge-analysis.json", content: JSON.stringify(bundle) }]);
    assert.equal(state.studyConfig.study.name, "Study A");
    assert.equal(state.allSessions.length, 1);
    assert.equal(state.allSessions[0].participantId, "P001");
    const raw = await DataParser.ingestFiles([{ name: "responses.ndjson", content: JSON.stringify(bundle.sessions[0]) }]);
    assert.equal(raw.studyConfig, null);
    assert.match(raw.warnings.join(" "), /No config.json/);
  } finally {
    global.FileReader = OriginalFileReader;
  }
});

test("dashboard does not invent compliance or notification latency", () => {
  DataParser.resetState();
  DataParser.state.allSessions = [DataParser.normalizeSession({
    participantId: "P001",
    sessionId: "S001",
    day: 1,
    status: "complete",
    startedAt: "2026-01-01T12:00:00.000Z",
    completedAt: "2026-01-01T12:02:00.000Z",
    data: []
  })];

  DataParser.calculateMetrics({ day: "all", participant: "all", excludeRapid: false });
  assert.equal(DataParser.state.metrics.totalCompleted, 1);
  assert.equal(DataParser.state.metrics.totalExpectedPings, null);
  assert.equal(DataParser.state.metrics.totalMissed, null);
  assert.equal(DataParser.state.metrics.avgLatencyMs, null);
  assert.equal(DataParser.state.metrics.complianceAvailable, false);
});

test("long-format CSV preserves presented, unanswered, and condition-skipped states", () => {
  DataParser.resetState();
  const base = {
    participant_id: "P001",
    session_id: "S001",
    day: "1",
    session_type: "ema_only",
    window_id: "w1",
    block: "pre",
    session_started_at: "2026-01-01T12:00:00.000Z",
    session_submitted_at: "2026-01-01T12:02:00.000Z",
    phase_started_at: "2026-01-01T12:00:05.000Z",
    phase_submitted_at: "2026-01-01T12:01:55.000Z",
    question_type: "choice",
    response_numeric: "",
    response_latency_ms: ""
  };

  DataParser._ingestLongFormat([
    { ...base, question_id: "q1", presentation_order: "1", response_status: "answered", response_value: "Yes" },
    { ...base, question_id: "q2", presentation_order: "2", response_status: "unanswered", response_value: "" },
    { ...base, question_id: "q3", presentation_order: "", response_status: "skipped_condition", skip_reason: "condition_false", response_value: "" }
  ]);

  const phase = DataParser.state.allSessions[0].data[0];
  assert.deepEqual(phase.presentationOrder, [["q1", "q2"]]);
  assert.deepEqual(phase.eligibleQuestionIds, ["q1", "q2", "q3"]);
  assert.equal(phase.responses.q1.value, "Yes");
  assert.equal(phase.responses.q2, undefined);
  assert.equal(phase.skippedQuestions[0].questionId, "q3");
});

test("synthetic manifests make scheduled completion metrics available", () => {
  const config = { study: { name: "Simulation" }, ema: { scheduling: { study_days: 1, windows: [{ id: "w1" }] }, questions: [] } };
  const sessions = [{
    participantId: "SIM-001", sessionId: "S1", day: 1, type: "w1", status: "complete",
    startedAt: "2026-01-01T12:00:00.000Z", completedAt: "2026-01-01T12:02:00.000Z", synthetic: true, data: []
  }];
  const expectedEvents = [
    { participantId: "SIM-001", sessionId: "S1", day: 1, delivered: true, completed: true },
    { participantId: "SIM-001", sessionId: "S2", day: 1, delivered: true, completed: false }
  ];

  DataParser.loadSynthetic({ config, sessions, manifest: { synthetic: true, expectedEvents } });

  assert.equal(DataParser.state.source, "synthetic");
  assert.equal(DataParser.state.metrics.complianceAvailable, true);
  assert.equal(DataParser.state.metrics.totalExpectedPings, 2);
  assert.equal(DataParser.state.metrics.totalMissed, 1);
  assert.equal(DataParser.state.metrics.complianceRate, 0.5);
});

test("Cloudflare NDJSON exports unwrap complete session records", () => {
  DataParser.resetState();
  const envelope = {
    submission_id: "ses_123456",
    participant_id: "P001",
    day: 1,
    window_id: "morning",
    server_receipt: {
      receiver: "ema-forge-cloudflare-r2",
      storage_state: "stored",
      received_at: "2026-09-24T13:28:18.000Z"
    },
    session_data: {
      participantId: "P001",
      sessionId: "ses_123456",
      day: 1,
      type: "ema_only",
      status: "complete",
      startedAt: "2026-09-24T13:28:00.000Z",
      completedAt: "2026-09-24T13:28:17.000Z",
      data: []
    }
  };

  DataParser._ingestNdjson(`${JSON.stringify(envelope)}\nnot-json\n`, "responses.ndjson");

  assert.equal(DataParser.state.allSessions.length, 1);
  const session = DataParser.state.allSessions[0];
  assert.equal(session.sessionId, "ses_123456");
  assert.equal(session.deliveryEnvelope.windowId, "morning");
  assert.equal(session.receiverReceipt.storage_state, "stored");
  assert.match(DataParser.state.warnings[0], /line 2/);
});
