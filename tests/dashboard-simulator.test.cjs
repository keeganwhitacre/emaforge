"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Simulator = require("../js/dashboard/simulator.js");

function loadProtocol(id) {
  const file = path.join(__dirname, "..", "library", "protocols", `${id}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8")).protocol;
}

test("study simulation is deterministic and explicitly labeled", () => {
  const config = loadProtocol("daily-rhythm-sleep");
  const options = { participants: 3, days: 2, completionRate: 0.75, missingnessRate: 0.1, seed: "fixed-seed" };
  const first = Simulator.simulate(config, options);
  const second = Simulator.simulate(config, options);

  assert.deepEqual(first, second);
  assert.equal(first.config.synthetic, true);
  assert.equal(first.manifest.synthetic, true);
  assert.equal(first.manifest.expectedEvents.length, 12);
  assert.ok(first.sessions.length > 0);
  assert.ok(first.sessions.every(session => session.synthetic === true));
  assert.ok(first.sessions.every(session => session.simulation.seed === "fixed-seed"));
});

test("simulation follows question branching and preserves presented versus skipped states", () => {
  const config = {
    study: { name: "Branch test" },
    modules: [],
    ema: {
      questions: [
        { id: "q1", type: "choice", text: "Trigger", options: ["Yes"], required: true },
        { id: "q2", type: "text", text: "Shown", condition: { question_id: "q1", operator: "eq", value: "Yes" } },
        { id: "q3", type: "text", text: "Skipped", condition: { question_id: "q1", operator: "eq", value: "No" } }
      ],
      scheduling: {
        study_days: 1,
        windows: [{ id: "w1", start: "12:00", phase_sequence: [{ kind: "ema", id: "survey", question_ids: ["q1", "q2", "q3"] }] }]
      }
    }
  };
  const result = Simulator.simulate(config, { participants: 1, days: 1, completionRate: 1, missingnessRate: 0, seed: "branch" });
  const survey = result.sessions[0].data[0];

  assert.deepEqual(survey.presentationOrder[0], ["q1", "q2"]);
  assert.deepEqual(survey.eligibleQuestionIds, ["q1", "q2", "q3"]);
  assert.equal(survey.skippedQuestions[0].questionId, "q3");
});

test("interoception protocol simulation generates ePAT trial envelopes", () => {
  const config = loadProtocol("interoception-daily-life");
  const result = Simulator.simulate(config, { participants: 2, days: 1, completionRate: 1, missingnessRate: 0, seed: "physiology" });
  const epatEntries = result.sessions.flatMap(session => session.data).filter(entry => entry.type === "epat_response");

  assert.ok(epatEntries.length >= 1);
  assert.ok(epatEntries.every(entry => entry.trials.length === 8));
  assert.ok(epatEntries.every(entry => entry.trials.every(trial => Number.isFinite(trial.phase_ms) && Number.isFinite(trial.rr_ms))));
});
