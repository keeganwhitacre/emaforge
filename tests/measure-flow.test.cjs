"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const flow = require("../js/measure-flow-utils.js");

test("flat question and task flow compiles to internal survey-task-survey steps", () => {
  const window = { phase_sequence: [
    { kind: "ema", id: "survey-a", label: "Check-in", question_ids: ["q1", "q2"] },
    { kind: "task", id: "epat", condition: { question_id: "q1", operator: ">", value: 5 } }
  ] };
  const entries = flow.flatten(window);
  const epat = entries.pop();
  entries.splice(1, 0, epat);
  const compiled = flow.compile(entries, () => "survey-new");
  assert.deepEqual(compiled, [
    { kind: "ema", id: "survey-a", label: "Check-in", question_ids: ["q1"] },
    { kind: "task", id: "epat", condition: { question_id: "q1", operator: ">", value: 5 } },
    { kind: "ema", id: "survey-new", label: "Check-in", question_ids: ["q2"] }
  ]);
});

test("adjacent survey items merge while task order remains intact", () => {
  const compiled = flow.compile([
    { kind: "question", questionId: "q1", sourceStepId: "a", sourceLabel: "Morning" },
    { kind: "question", questionId: "q2", sourceStepId: "b", sourceLabel: "Evening" },
    { kind: "task", taskId: "future-task", condition: null }
  ], () => "generated");
  assert.deepEqual(compiled, [
    { kind: "ema", id: "a", label: "Morning", question_ids: ["q1", "q2"] },
    { kind: "task", id: "future-task", condition: null }
  ]);
});
