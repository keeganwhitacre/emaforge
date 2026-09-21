"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.localStorage = {
  values: new Map(),
  getItem(key) { return this.values.get(key) || null; },
  setItem(key, value) { this.values.set(key, value); }
};

const DataParser = require("../js/dashboard/parser.js");

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
