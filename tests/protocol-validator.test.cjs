"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const validator = require("../js/protocol-validator.js");

function validConfig() {
  return {
    study: {
      name: "Community EMA Study",
      institution: "Community Research Collaborative",
      output_format: "csv",
      webhook_url: "https://example.org/ema-intake"
    },
    onboarding: {
      enabled: true,
      consent_text: `<h3>Study consent</h3><p>${"This approved study description explains collection, storage, risks, contacts, withdrawal, and participant rights. ".repeat(3)}</p>`
    },
    modules: {},
    ema: {
      questions: [
        { id: "mood", type: "slider", text: "How is your mood?", min: 0, max: 100, step: 1, block: "pre", windows: null }
      ],
      scheduling: {
        study_days: 14,
        days_of_week: [1, 2, 3, 4, 5],
        timing: { expiry_minutes: 60, grace_minutes: 10 },
        windows: [{
          id: "morning",
          label: "Morning",
          start: "08:00",
          end: "10:00",
          phase_sequence: [{ kind: "ema", block: "pre" }]
        }]
      }
    }
  };
}

test("a complete protocol passes without blocking errors", () => {
  const report = validator.validate(validConfig());
  assert.equal(report.valid, true);
  assert.deepEqual(report.errors, []);
});

test("a physiology-only session does not require survey questions", () => {
  const config = validConfig();
  config.ema.questions = [];
  config.modules.epat = { trials: 20, trial_duration_sec: 30, retry_budget: 30, sqi_threshold: 0.008 };
  config.ema.scheduling.windows[0].phase_sequence = [{ kind: "task", id: "epat", condition: null }];
  const report = validator.validate(config);
  assert.equal(report.valid, true, JSON.stringify(report.errors));
});

test("placeholder consent blocks export", () => {
  const config = validConfig();
  config.onboarding.consent_text = "<h3>Consent template — researcher action required</h3><p>Replace this placeholder.</p>";
  const report = validator.validate(config);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some(item => item.code === "consent_placeholder"));
});

test("duplicate IDs and unavailable task modules block export", () => {
  const config = validConfig();
  config.ema.questions.push({
    id: "mood", type: "choice", text: "Context?", options: ["Home", "Work"], block: "pre", windows: null
  });
  config.ema.scheduling.windows[0].phase_sequence.push({ kind: "task", id: "epat", condition: null });
  const report = validator.validate(config);
  assert.ok(report.errors.some(item => item.code === "question_id_duplicate"));
  assert.ok(report.errors.some(item => item.code === "task_module_unavailable"));
});

test("conditions cannot depend on questions absent from that session", () => {
  const config = validConfig();
  config.ema.scheduling.windows.push({
    id: "evening",
    label: "Evening",
    start: "18:00",
    end: "20:00",
    phase_sequence: [{ kind: "ema", block: "pre" }]
  });
  config.ema.questions = [
    { id: "source", type: "numeric", text: "Source", block: "pre", windows: ["evening"] },
    {
      id: "target",
      type: "text",
      text: "Target",
      block: "pre",
      windows: ["morning"],
      condition: { question_id: "source", operator: "gte", value: 1 }
    }
  ];
  const report = validator.validate(config);
  assert.ok(report.errors.some(item => item.code === "condition_question_unavailable_in_session"));
});

test("empty EMA steps and unsafe delivery settings are surfaced", () => {
  const config = validConfig();
  config.study.webhook_url = "";
  config.ema.scheduling.timing.expiry_minutes = 0;
  config.ema.questions[0].windows = [];
  const report = validator.validate(config);
  assert.ok(report.errors.some(item => item.code === "ema_step_empty"));
  assert.ok(report.warnings.some(item => item.code === "webhook_missing"));
  assert.ok(report.warnings.some(item => item.code === "expiry_disabled"));
});
