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
      { kind: "ema", block: "pre" },
      { kind: "task", id: "epat", condition },
      { kind: "ema", block: "post" }
    ]
  }, { epat: {} });

  assert.deepEqual(plan.map(step => step.token), ["pre_evening", "epat", "post_evening"]);
  assert.deepEqual(plan[1].condition, condition);
  assert.equal(utils.evaluateCondition(plan[1].condition, {}), false);
  assert.equal(utils.evaluateCondition(plan[1].condition, { distress: { value: 9 } }), true);
});

test("repeated EMA blocks receive parseable, stable tokens", () => {
  const plan = utils.buildPhasePlan({
    id: "w1",
    phase_sequence: [
      { kind: "ema", block: "pre" },
      { kind: "ema", block: "pre" },
      { kind: "ema", block: "post" },
      { kind: "ema", block: "post" }
    ]
  }, {});

  assert.deepEqual(plan.map(step => step.token), ["pre_w1", "pre2_w1", "post_w1", "post2_w1"]);
  assert.deepEqual(utils.parseEmaPhaseToken("pre2_w1"), { block: "pre", ordinal: 2, windowId: "w1" });
  assert.deepEqual(utils.parseEmaPhaseToken("post2_evening_check"), { block: "post", ordinal: 2, windowId: "evening_check" });
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

test("zero expiry explicitly disables response-window enforcement", () => {
  const policy = utils.buildResponseWindowPolicy("1767268800000", {
    expiry_minutes: 0,
    grace_minutes: 10
  });
  assert.equal(policy.enforced, false);
  assert.equal(utils.canStartResponseWindow(policy, Number.MAX_SAFE_INTEGER), true);
  assert.equal(utils.isResponseWindowHardExpired(policy, Number.MAX_SAFE_INTEGER), false);
});
