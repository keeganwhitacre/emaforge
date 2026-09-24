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
        { id: "mood", type: "slider", text: "How is your mood?", min: 0, max: 100, step: 1 }
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
          phase_sequence: [{ kind: "ema", id: "s_morning", question_ids: ["mood"] }]
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

test("independent survey steps support reuse without leaking other questions", () => {
  const config = validConfig();
  config.modules.epat = { trials: 20, trial_duration_sec: 30, retry_budget: 30, sqi_threshold: 0.008 };
  config.ema.questions.push({ id: "reflection", type: "text", text: "How did it feel?" });
  config.ema.scheduling.windows[0].phase_sequence = [
    { kind: "ema", id: "baseline", question_ids: ["mood"] },
    { kind: "task", id: "epat", condition: { question_id: "mood", operator: "gte", value: 7 } },
    { kind: "ema", id: "reflection_step", question_ids: ["reflection"] },
    { kind: "ema", id: "recheck", question_ids: ["mood"] }
  ];
  assert.equal(validator.validate(config).valid, true);
  config.ema.scheduling.windows[0].phase_sequence[2].question_ids = ["missing"];
  const report = validator.validate(config);
  assert.ok(report.errors.some(item => item.code === "survey_question_ids_invalid"));
  assert.ok(report.errors.some(item => item.code === "question_unassigned"));
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
    id: "mood", type: "choice", text: "Context?", options: ["Home", "Work"]
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
    phase_sequence: [{ kind: "ema", id: "s_evening", question_ids: ["source"] }]
  });
  config.ema.questions = [
    { id: "source", type: "numeric", text: "Source" },
    {
      id: "target",
      type: "text",
      text: "Target",
      condition: { question_id: "source", operator: "gte", value: 1 }
    }
  ];
  config.ema.scheduling.windows[0].phase_sequence[0].question_ids = ["target"];
  const report = validator.validate(config);
  assert.ok(report.errors.some(item => item.code === "condition_question_unavailable_in_session"));
});

test("empty EMA steps and unsafe delivery settings are surfaced", () => {
  const config = validConfig();
  config.study.webhook_url = "";
  config.ema.scheduling.timing.expiry_minutes = 0;
  config.ema.scheduling.windows[0].phase_sequence[0].question_ids = [];
  const report = validator.validate(config);
  assert.ok(report.errors.some(item => item.code === "ema_step_empty"));
  assert.ok(report.warnings.some(item => item.code === "webhook_missing"));
  assert.ok(report.warnings.some(item => item.code === "expiry_disabled"));
});

test("response piping requires a real answer presented earlier in each session", () => {
  const config = validConfig();
  config.ema.questions.push({ id: "followup", type: "text", text: "You said {{mood|something else}}. What contributed?" });
  config.ema.scheduling.windows[0].phase_sequence[0].question_ids = ["mood", "followup"];
  assert.equal(validator.validate(config).valid, true);

  config.ema.scheduling.windows[0].phase_sequence[0].question_ids = ["followup", "mood"];
  let report = validator.validate(config);
  assert.ok(report.errors.some(item => item.code === "piping_source_unavailable_in_session"));

  config.ema.questions[1].text = "Unknown {{deleted_question|earlier response}}";
  report = validator.validate(config);
  assert.ok(report.errors.some(item => item.code === "piping_source_unknown"));
});

test("conditional piping sources recommend fallback wording", () => {
  const config = validConfig();
  config.ema.questions[0].condition = { question_id: "context", operator: "eq", value: "home" };
  config.ema.questions.unshift({ id: "context", type: "choice", text: "Where are you?", options: ["home", "away"] });
  config.ema.questions.push({ id: "followup", type: "text", text: "Your mood was {{mood}}." });
  config.ema.scheduling.windows[0].phase_sequence[0].question_ids = ["context", "mood", "followup"];
  const report = validator.validate(config);
  assert.ok(report.warnings.some(item => item.code === "piping_fallback_missing"));
});
