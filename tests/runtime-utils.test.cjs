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
  assert.deepEqual(utils.questionsForStep(questions, ["reflection", "mood"]).map(q => q.id), ["reflection", "mood"]);
});

test("response piping reads naturally and never exposes raw placeholders", () => {
  const responses = {
    mood: { value: 72.349 },
    contexts: { value: ["school", "with friends", "outside"] },
    grid: { value: { valence: 0.5, arousal: -0.2 } }
  };
  assert.equal(
    utils.interpolateText("You rated your mood {{mood}} and were {{contexts}}.", responses),
    "You rated your mood 72.3 and were school, with friends, and outside."
  );
  assert.equal(
    utils.interpolateText("Thinking about {{missing|what you shared earlier}}, what happened?", responses),
    "Thinking about what you shared earlier, what happened?"
  );
  assert.equal(utils.interpolateText("Value: {{grid|your earlier response}}", responses), "Value: your earlier response");
  assert.equal(utils.interpolateText("Value: {{missing}}.", responses), "Value:.");
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

test("a named page gate skips its questions and their answers cannot trigger later branches", () => {
  const questions = [
    { id: "stress", type: "slider" },
    { id: "page", type: "page_break", page_condition: { question_id: "stress", operator: "gte", value: 7 } },
    { id: "coping", type: "choice" },
    { id: "details", type: "text", condition: { question_id: "coping", operator: "eq", value: "Yes" } },
    { id: "end", type: "page_break" },
    { id: "feedback", type: "text", condition: { question_id: "coping", operator: "eq", value: "Yes" } }
  ];
  const sequence = [{ kind: "ema", question_ids: questions.map(question => question.id) }];
  const pages = utils.surveyPages(questions, sequence[0].question_ids);
  assert.deepEqual(pages.map(page => [page.marker?.id, page.questions.map(q => q.id)]), [
    [undefined, ["stress"]], ["page", ["coping", "details"]], ["end", ["feedback"]]
  ]);
  const hidden = utils.traceBranches(questions, sequence, { stress: 4, coping: "Yes" });
  assert.deepEqual(hidden.sources, ["stress", "coping"]);
  assert.equal(hidden.trace.find(item => item.id === "page").shown, false);
  assert.equal(hidden.trace.find(item => item.id === "details").pageSkipped, true);
  assert.deepEqual(hidden.trace.find(item => item.id === "feedback").missing, ["coping"]);
  const shown = utils.traceBranches(questions, sequence, { stress: 8, coping: "Yes" });
  assert.ok(shown.trace.every(item => item.shown));
});

test("multi-select branch operators distinguish matching only some options and missing answers", () => {
  const rule = { question_id: "context", operator: "includes_all", value: ["work", "alone"] };
  assert.equal(utils.evaluateCondition(rule, { context: ["work"] }), false);
  assert.equal(utils.evaluateCondition(rule, { context: ["work", "alone"] }), true);
  assert.equal(utils.evaluateCondition({ ...rule, operator: "includes_none" }, { context: ["home"] }), true);
  assert.equal(utils.evaluateCondition({ ...rule, operator: "includes_none" }, {}), false);
});

test("a page rule still covers measures after an instruction at the top of the page", () => {
  const questions = [
    { id: "stress", type: "slider" },
    { id: "gate", type: "page_break", page_condition: { question_id: "stress", operator: "gte", value: 7 } },
    { id: "intro", type: "instruction", text: "You said today was stressful." },
    { id: "coping", type: "choice" },
    { id: "details", type: "text" },
    { id: "end", type: "page_break" },
    { id: "after", type: "text" }
  ];
  const ids = questions.map(question => question.id);
  assert.deepEqual(utils.surveyPages(questions, ids).map(page => [page.marker?.id, page.questions.map(q => q.id)]), [
    [undefined, ["stress"]], ["gate", ["intro"]], ["gate", ["coping", "details"]], ["end", ["after"]]
  ]);
  const { trace } = utils.traceBranches(questions, [{ kind: "ema", question_ids: ids }], { stress: 2 });
  assert.equal(trace.filter(item => item.kind === "page").length, 1);
  for (const id of ["intro", "coping", "details"]) {
    assert.equal(trace.find(item => item.id === id).shown, false, id);
  }
  assert.equal(trace.some(item => item.id === "after"), false);
});

test("the branch tester distinguishes unfinished OR rules from failed AND rules", () => {
  const rules = [
    { question_id: "stress", operator: "gte", value: 7 },
    { question_id: "energy", operator: "gte", value: 7 }
  ];
  const questions = [
    { id: "stress", type: "slider" },
    { id: "energy", type: "slider" },
    { id: "both", type: "text", condition: { logical_op: "AND", rules } },
    { id: "either", type: "text", condition: { logical_op: "OR", rules } },
    { id: "after", type: "text", condition: { question_id: "both", operator: "eq", value: "Yes" } }
  ];
  const sequence = [{ kind: "ema", question_ids: questions.map(question => question.id) }];
  const { trace } = utils.traceBranches(questions, sequence, { stress: 2 });
  assert.equal(trace.find(row => row.id === "both").waiting, false);
  assert.equal(trace.find(row => row.id === "either").waiting, true);
  assert.deepEqual(trace.find(row => row.id === "either").pending, ["energy"]);
  assert.equal(trace.find(row => row.id === "after").waiting, false);
  assert.deepEqual(trace.find(row => row.id === "after").skippedSources, ["both"]);
  const pending = utils.traceBranches(questions, sequence, { stress: 8 }).trace;
  assert.equal(pending.find(row => row.id === "after").waiting, true);
});
