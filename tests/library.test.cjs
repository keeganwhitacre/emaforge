"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const library = require("../js/library-utils.js");
const protocolValidator = require("../js/protocol-validator.js");

const root = path.resolve(__dirname, "..");
const readJson = relativePath => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));

test("catalog entries point to valid, matching library items", () => {
  const catalog = readJson("library/catalog.json");
  assert.equal(library.validateCatalog(catalog).valid, true);

  for (const entry of catalog.items) {
    const item = readJson(entry.path);
    const result = library.validateItem(item);
    assert.equal(result.valid, true, `${entry.path}: ${result.errors.join("; ")}`);
    assert.equal(item.id, entry.id);
    assert.equal(item.kind, entry.kind);
  }
});

test("curated protocols have no blocking errors beyond required consent replacement", () => {
  const catalog = readJson("library/catalog.json");
  for (const entry of catalog.items.filter(item => item.kind === "protocol")) {
    const item = readJson(entry.path);
    const report = protocolValidator.validate(library.protocolForValidation(item.protocol));
    const unexpected = report.errors.filter(issue => issue.code !== "consent_placeholder");
    assert.deepEqual(unexpected, [], `${entry.path}: ${JSON.stringify(unexpected)}`);
    assert.ok(report.errors.some(issue => issue.code === "consent_placeholder"), `${entry.path} must require approved consent text`);
  }
});

test("question packs remap IDs, conditions, and response piping without collisions", () => {
  const item = readJson("library/packs/context-stress-support.json");
  const target = {
    ema: {
      questions: [{ id: "q_existing", type: "text", text: "Existing" }],
      scheduling: { windows: [{ id: "w1", phase_sequence: [] }] }
    }
  };
  let questionCounter = 0;
  const installed = library.installQuestionPack(target, item, {
    genQId: () => `q_new_${++questionCounter}`,
    genSId: () => "s_new_pack"
  });

  assert.equal(new Set(installed).size, item.questions.length);
  assert.ok(!installed.includes("q_existing"));
  const stress = target.ema.questions.find(question => question.text.includes("How stressed"));
  const context = target.ema.questions.find(question => question.text === "Where are you right now?");
  assert.ok(stress.text.includes(`{{${context.id}|your current location}}`));
  const followup = target.ema.questions.find(question => question.text.includes("contributing most"));
  assert.ok(followup.condition.rules.every(rule => installed.includes(rule.question_id)));
  assert.deepEqual(target.ema.scheduling.windows[0].phase_sequence[0], {
    kind: "ema", id: "s_new_pack", label: item.name, question_ids: installed
  });
});

test("curated measure packs disclose version, timeframe, scoring, and permissions", () => {
  const cases = [
    ["library/packs/k6-distress.json", /K6/, "Past 30 days", 6],
    ["library/packs/phq-4.json", /PHQ-4/, "Past two weeks", 4],
    ["library/packs/who-5-wellbeing.json", /WHO-5/, "Past two weeks", 5]
  ];
  cases.forEach(([path, instrument, timeframe, itemCount]) => {
    const item = readJson(path);
    assert.equal(library.validateItem(item).valid, true, path);
    assert.match(item.measure.instrument, instrument);
    assert.equal(item.measure.timeframe, timeframe);
    assert.ok(item.measure.scoring.length > 40);
    assert.ok(item.license.length > 20);
    assert.equal(item.questions.length, itemCount);
  });
});

test("task presets configure a built-in task and never duplicate its step", () => {
  const item = readJson("library/packs/brief-epat.json");
  const target = {
    modules: [{ id: "epat", enabled: false, settings: { trials: 20 } }],
    ema: { scheduling: { windows: [{ id: "w1", phase_sequence: [] }] } }
  };
  library.installTaskPreset(target, item);
  library.installTaskPreset(target, item);
  assert.equal(target.modules[0].enabled, true);
  assert.equal(target.modules[0].settings.trials, 8);
  assert.equal(target.ema.scheduling.windows[0].phase_sequence.length, 1);
  assert.deepEqual(target.ema.scheduling.windows[0].phase_sequence[0], { kind: "task", id: "epat", condition: null });
});

test("library JSON cannot introduce executable or unknown task engines", () => {
  const unknownTask = {
    library_schema: "1.0.0",
    id: "remote-code",
    name: "Remote code",
    kind: "task_preset",
    module_id: "remote-script",
    settings: { src: "https://example.org/task.js" }
  };
  assert.equal(library.validateItem(unknownTask).valid, false);

  const unknownSetting = {
    library_schema: "1.0.0",
    id: "bad-epat",
    name: "Bad ePAT",
    kind: "task_preset",
    module_id: "epat",
    settings: { trials: 8, script: "alert(1)" }
  };
  assert.equal(library.validateItem(unknownSetting).valid, false);
});

test("a saved study can become a validated personal protocol and round-trip through browser storage", () => {
  const draft = readJson("library/protocols/daily-rhythm-sleep.json").protocol;
  const item = library.createContribution(draft, {
    kind: "protocol",
    name: "My Daily Rhythm Study",
    description: "A local reusable copy of the current study.",
    source: "Researcher-created draft",
    license: "CC0-1.0",
    validation_status: "Contributor supplied; not independently reviewed.",
    instrument: "Researcher-created diary",
    timeframe: "Right now",
    scoring: "No validated total score."
  });
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  library.savePersonalItem(item, storage);
  const restored = library.loadPersonalLibrary(storage);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, "personal-my-daily-rhythm-study");
  assert.equal(restored[0].protocol.study.name, "Daily Rhythm & Sleep");
  assert.equal(restored[0].measure.timeframe, "Right now");
});

test("personal survey packs copy questions but cannot include executable content", () => {
  const draft = readJson("library/protocols/daily-rhythm-sleep.json").protocol;
  const item = library.createContribution(draft, {
    kind: "question_pack",
    name: "Rhythm Questions",
    description: "Reusable questions from the current draft.",
    source: "Researcher-created draft",
    license: "CC0-1.0",
    validation_status: "Not independently reviewed."
  });
  assert.equal(item.questions.length, draft.ema.questions.length);
  assert.equal(library.validateItem(item).valid, true);
  assert.equal(Object.hasOwn(item, "protocol"), false);
});
