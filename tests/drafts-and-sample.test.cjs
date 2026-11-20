"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const run = (context, file) => vm.runInContext(read(file), context, { filename: file });

test("a legacy browser draft survives opening a library protocol and switching back", () => {
  const legacyKey = "ema_studio_project_v1";
  const values = new Map();
  const localStorage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index]; },
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); }
  };
  const browser = () => {
    const context = vm.createContext({
      document: { getElementById: () => null, querySelectorAll: () => [] },
      localStorage, window: { addEventListener() {} }, console, clearTimeout, setTimeout
    });
    run(context, "js/state.js");
    vm.runInContext("sanitizeConsentHtml = value => value", context);
    return context;
  };
  const fresh = browser();
  run(fresh, "js/storage.js");
  assert.equal(vm.runInContext("StorageManager.hasDraft", fresh), false);
  vm.runInContext("StorageManager.saveLocalState()", fresh);
  assert.equal(values.size, 0, "visiting the setup screen must not create a saved draft");
  vm.runInContext("StorageManager.createDraft({ name: 'First study', theme: 'light', blank: true })", fresh);
  const created = JSON.parse(values.get("ema_forge_draft_v2:" + values.get("ema_forge_active_draft_v2")));
  assert.equal(created.study.name, "First study");
  assert.equal(created.study.theme, "light");
  assert.deepEqual(created.ema.questions, []);
  assert.deepEqual(created.ema.scheduling.windows[0].phase_sequence, []);
  vm.runInContext("StorageManager.createDraft()", fresh);
  assert.equal(vm.runInContext("state.ema.scheduling.days_of_week.length", fresh), 7);
  values.clear();

  const original = browser();
  const legacy = JSON.parse(vm.runInContext("JSON.stringify({ ...state, schema_version: SCHEMA_VERSION })", original));
  legacy.study.name = "Existing lab study";
  legacy.deployment.hosted_url = "https://example.workers.dev";
  localStorage.setItem(legacyKey, JSON.stringify(legacy));
  run(original, "js/storage.js");
  const firstId = vm.runInContext("StorageManager._draftId", original);
  const studyId = vm.runInContext("state.study.id", original);

  original.protocol = JSON.parse(read("library/protocols/daily-rhythm-sleep.json")).protocol;
  vm.runInContext("StorageManager.loadTemplate(protocol)", original);
  assert.equal(vm.runInContext("state.study.name", original), original.protocol.study.name);
  assert.equal(vm.runInContext("state.deployment.hosted_url", original), "");
  assert.notEqual(vm.runInContext("state.study.id", original), studyId);

  const reopened = browser();
  reopened.firstId = firstId;
  run(reopened, "js/storage.js");
  vm.runInContext("StorageManager.openDraft(firstId)", reopened);
  assert.equal(vm.runInContext("state.study.name", reopened), legacy.study.name);
  assert.equal(vm.runInContext("state.study.id", reopened), studyId);
  assert.equal(vm.runInContext("state.deployment.hosted_url", reopened), legacy.deployment.hosted_url);
  vm.runInContext("StorageManager.createDraft()", reopened);
  assert.equal(vm.runInContext("state.study.name", reopened), "");
});

test("both public sample modes use the real participant renderer with preview-only controls", async () => {
  const elements = new Map();
  for (const id of ["sample-survey", "sample-physiology", "sample-frame", "sample-status"]) {
    elements.set(id, { setAttribute() {} });
  }
  const context = vm.createContext({
    document: {
      getElementById: id => elements.get(id),
      createElement: () => ({ content: { querySelectorAll: () => [] } })
    },
    fetch: async path => ({ ok: true, text: async () => read(path.split("?")[0]) })
  });
  run(context, "js/state.js");
  run(context, "js/export.js");
  run(context, "js/sample.js");
  await vm.runInContext("showSample(false)", context);
  const survey = elements.get("sample-frame").srcdoc;
  assert.match(survey, /window\.__PREVIEW_MODE__ = true/);
  assert.match(survey, /How are you feeling right now\?/);
  assert.match(survey, /inert aria-hidden="true" class="screen" id="screen-ob-consent"/);
  assert.doesNotMatch(survey, /sample_heart_rate|id="download-btn"/);
  assert.match(survey, /"question_id":"sample_company","operator":"eq","value":"With other people"/);
  assert.match(survey, /"question_ids":\["q_daily_mood","sample_company_page","sample_company","sample_connection_page","sample_connection","sample_reflection_page","sample_reflection"\]/);

  await vm.runInContext("showSample(true)", context);
  const physiology = elements.get("sample-frame").srcdoc;
  assert.match(physiology, /"sample_pulse_page","sample_heart_rate","sample_reflection_page"/);
  assert.match(physiology, /"hr_capture":\{"enabled":true\}/);
  for (const [, script] of physiology.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    assert.doesNotThrow(() => new vm.Script(script));
  }
});
