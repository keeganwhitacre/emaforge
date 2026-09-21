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
