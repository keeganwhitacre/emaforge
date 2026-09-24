"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const utils = require("../templates/runtime-utils.js");

test("compound task conditions use collected response values", () => {
  const condition = {
    logical_op: "AND",
    rules: [
      { question_id: "distress", operator: "gte", value: 7 },
      { question_id: "context", operator: "includes", value: "alone" }
    ]
  };
  const responses = {
    distress: { value: 8 },
    context: { value: ["home", "alone"] }
  };

  assert.equal(utils.evaluateCondition(condition, responses), true);
  assert.equal(utils.evaluateCondition(condition, { ...responses, distress: { value: 2 } }), false);
});

test("phase planning preserves conditions until task execution", () => {
  const condition = { question_id: "distress", operator: "gte", value: 7 };
  const plan = utils.buildPhasePlan({
    id: "evening",
    phase_sequence: [
      { kind: "ema", id: "baseline", question_ids: ["distress"] },
      { kind: "task", id: "epat", condition },
      { kind: "ema", id: "followup", question_ids: ["reflection"] }
    ]
  }, { epat: {} });

  assert.deepEqual(plan.map(step => step.token), ["survey_evening", "epat", "survey2_evening"]);
  assert.deepEqual(plan[0].questionIds, ["distress"]);
  assert.deepEqual(plan[2].questionIds, ["reflection"]);
  assert.deepEqual(plan[1].condition, condition);
  assert.equal(utils.evaluateCondition(plan[1].condition, {}), false);
  assert.equal(utils.evaluateCondition(plan[1].condition, { distress: { value: 9 } }), true);
});

test("task-only sessions have one task and no implicit questionnaire", () => {
  const plan = utils.buildPhasePlan({ id: "w1", phase_sequence: [{ kind: "task", id: "epat" }] }, { epat: {} });
  assert.deepEqual(plan.map(step => step.token), ["epat"]);
  assert.deepEqual(utils.buildPhasePlan({ id: "w1" }, { epat: {} }), []);
});

test("multiple independent surveys receive parseable, stable tokens", () => {
  const plan = utils.buildPhasePlan({
    id: "w1",
    phase_sequence: [
      { kind: "ema", id: "s1", question_ids: ["mood"] },
      { kind: "ema", id: "s2", question_ids: ["stress"] },
      { kind: "ema", id: "s3", question_ids: ["social"] },
      { kind: "ema", id: "s4", question_ids: ["sleep"] }
    ]
  }, {});

  assert.deepEqual(plan.map(step => step.token), ["survey_w1", "survey2_w1", "survey3_w1", "survey4_w1"]);
  assert.deepEqual(utils.parseEmaPhaseToken("survey2_w1"), { block: "survey", ordinal: 2, windowId: "w1" });
  assert.deepEqual(utils.parseEmaPhaseToken("survey3_evening_check"), { block: "survey", ordinal: 3, windowId: "evening_check" });
});

test("step membership isolates questions while allowing deliberate reuse", () => {
  const questions = [
    { id: "mood", type: "slider" },
    { id: "stress", type: "slider" },
    { id: "break", type: "page_break" },
    { id: "reflection", type: "text" }
  ];
  assert.deepEqual(utils.questionsForStep(questions, ["mood", "stress"]).map(q => q.id), ["mood", "stress"]);
  assert.deepEqual(utils.questionsForStep(questions, ["mood", "reflection"]).map(q => q.id), ["mood", "reflection"]);
});

test("survey back navigation is opt-in and cannot cross physiology pages", () => {
  const pages = [
    [{ id: "mood", type: "slider" }],
    [{ id: "pulse", type: "heart_rate" }],
    [{ id: "context", type: "choice" }],
    [{ id: "notes", type: "text" }]
  ];

  assert.equal(utils.canNavigateBack(false, 3, pages), false);
  assert.equal(utils.canNavigateBack(true, 0, pages), false);
  assert.equal(utils.canNavigateBack(true, 1, pages), false);
  assert.equal(utils.canNavigateBack(true, 2, pages), false);
  assert.equal(utils.canNavigateBack(true, 3, pages), true);
});

test("future survey response IDs can be invalidated after revisiting an earlier page", () => {
  const pages = [
    [{ id: "mood" }],
    [{ id: "context" }, { id: "stress" }],
    [{ id: "notes" }]
  ];
  assert.deepEqual(utils.questionIdsAfterPage(pages, 0), ["context", "stress", "notes"]);
  assert.deepEqual(utils.questionIdsAfterPage(pages, 2), []);
});

test("a webhook HTTP response must acknowledge a successful submission", () => {
  assert.equal(utils.isWebhookAcknowledgement({ status: "success", submission_id: "s1" }, "s1"), true);
  assert.equal(utils.isWebhookAcknowledgement({ status: "success", submission_id: "other" }, "s1"), false);
  assert.equal(utils.isWebhookAcknowledgement({ error: "storage failed" }, "s1"), false);
  assert.equal(utils.isWebhookAcknowledgement("<html>Sign in</html>", "s1"), false);
});

test("device metadata identifies mobile Safari and Chromium browsers", () => {
  const safari = utils.parseUserAgentMetadata("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1");
  assert.deepEqual(safari, {
    deviceModel: "iPhone",
    osName: "iOS",
    osVersion: "18.7",
    browserName: "Safari",
    browserVersion: "27.0"
  });

  const chrome = utils.parseUserAgentMetadata("Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A.240905.015) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36");
  assert.equal(chrome.deviceModel, "Pixel 9");
  assert.equal(chrome.osName, "Android");
  assert.equal(chrome.browserName, "Chrome");
  assert.equal(chrome.browserVersion, "128.0.0.0");
});

test("ePAT phase uses the final participant-adjusted knob value", () => {
  assert.equal(utils.phaseMsFromKnob(0, 800), 0);
  assert.equal(utils.phaseMsFromKnob(0.5, 800), 200);
  assert.equal(utils.phaseMsFromKnob(-1, 800), -400);
  assert.equal(utils.phaseMsFromKnob(undefined, 800), null);
});

test("collected responses merge completed EMA phases in sequence", () => {
  const responses = utils.collectResponses([
    { type: "ema_response", responses: { mood: { value: 3 } } },
    { type: "ema_response", responses: { mood: { value: 8 }, place: { value: "home" } } }
  ]);
  assert.deepEqual(responses, { mood: { value: 8 }, place: { value: "home" } });
});

test("response expiry permits on-time starts only and enforces the grace deadline", () => {
  const sentAt = Date.parse("2026-01-01T12:00:00.000Z");
  const policy = utils.buildResponseWindowPolicy(String(sentAt), {
    expiry_minutes: 60,
    grace_minutes: 10
  });

  assert.equal(policy.expiresAtMs, Date.parse("2026-01-01T13:00:00.000Z"));
  assert.equal(policy.graceUntilMs, Date.parse("2026-01-01T13:10:00.000Z"));
  assert.equal(utils.canStartResponseWindow(policy, Date.parse("2026-01-01T12:59:59.000Z")), true);
  assert.equal(utils.canStartResponseWindow(policy, Date.parse("2026-01-01T13:00:01.000Z")), false);
  assert.equal(utils.isResponseWindowHardExpired(policy, Date.parse("2026-01-01T13:09:59.000Z")), false);
  assert.equal(utils.isResponseWindowHardExpired(policy, Date.parse("2026-01-01T13:10:01.000Z")), true);
});

test("response-window boundaries preserve the intended grace semantics", () => {
  const sentAt = Date.parse("2026-01-01T12:00:00.000Z");
  const policy = utils.buildResponseWindowPolicy(String(sentAt), {
    expiry_minutes: 60,
    grace_minutes: 10
  });

  // Starting at the exact expiry boundary is accepted; one millisecond later
  // is a fresh late start and is rejected.
  assert.equal(utils.canStartResponseWindow(policy, policy.expiresAtMs), true);
  assert.equal(utils.canStartResponseWindow(policy, policy.expiresAtMs + 1), false);
  // An on-time session remains valid through the exact grace boundary and is
  // hard-expired immediately afterward.
  assert.equal(utils.isResponseWindowHardExpired(policy, policy.graceUntilMs), false);
  assert.equal(utils.isResponseWindowHardExpired(policy, policy.graceUntilMs + 1), true);
});

test("missing prompt timestamps cannot accidentally expire a generic link", () => {
  const policy = utils.buildResponseWindowPolicy("not-a-timestamp", {
    expiry_minutes: 60,
    grace_minutes: 10
  });
  assert.equal(policy.enforced, false);
  assert.equal(utils.canStartResponseWindow(policy, Number.MAX_SAFE_INTEGER), true);
});

test("zero expiry explicitly disables response-window enforcement", () => {
  const policy = utils.buildResponseWindowPolicy("1767268800000", {
    expiry_minutes: 0,
    grace_minutes: 10
  });
  assert.equal(policy.enforced, false);
  assert.equal(utils.canStartResponseWindow(policy, Number.MAX_SAFE_INTEGER), true);
  assert.equal(utils.isResponseWindowHardExpired(policy, Number.MAX_SAFE_INTEGER), false);
});
