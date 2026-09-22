"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const deploymentSource = fs.readFileSync(
  require.resolve("../js/tabs/deployment.js"),
  "utf8"
);

function builderContext(overrides = {}) {
  const state = {
    study: { name: "Scheduling Study" },
    onboarding: { enabled: true },
    modules: [{ id: "epat", label: "ePAT" }],
    ema: {
      scheduling: {
        study_days: 7,
        days_of_week: [1, 3, 5],
        timing: { expiry_minutes: 45, grace_minutes: 12 },
        windows: [{
          id: "morning",
          label: "Morning",
          start: "08:00",
          end: "10:00",
          phase_sequence: [{ kind: "ema", block: "pre" }]
        }]
      }
    },
    ...overrides
  };
  const context = { state, console, URL };
  vm.createContext(context);
  vm.runInContext(deploymentSource, context);
  return context;
}

function dispatcherContext(generated) {
  const utilities = {
    formatDate(date, timezone, pattern) {
      assert.equal(timezone, "Etc/UTC");
      const iso = new Date(date).toISOString();
      if (pattern === "yyyy-MM-dd") return iso.slice(0, 10);
      if (pattern === "HH:mm") return iso.slice(11, 16);
      if (pattern === "yyyy-MM-dd'T'HH:mm:ss") return iso.slice(0, 19);
      throw new Error(`Unexpected date pattern: ${pattern}`);
    }
  };
  const math = Object.create(Math);
  math.random = () => 0;
  const context = { console, Utilities: utilities, Math: math, Date };
  vm.createContext(context);
  vm.runInContext(generated, context);
  return context;
}

function emptyLog() {
  return { getLastRow: () => 1 };
}

test("dispatcher emits nested timing settings and auditable opt-out support", () => {
  const context = builderContext();
  const generated = context.generateTwilioScript("https://example.org/study/");

  assert.doesNotThrow(() => new vm.Script(generated));
  assert.match(generated, /const EXPIRY_MIN\s+= 45;/);
  assert.match(generated, /const GRACE_MIN\s+= 12;/);
  assert.match(generated, /const ACTIVE_DAYS = \[1,3,5\]/);
  assert.match(generated, /function doPost\(e\)/);
  assert.match(generated, /OptOutType/);
  assert.match(generated, /Schedule_Preferences_JSON/);
});

test("weekday exclusions preserve calendar study-day numbering", () => {
  const builder = builderContext();
  const dispatcher = dispatcherContext(builder.generateTwilioScript("https://example.org/study/"));
  const schedule = dispatcher.participantSchedule_("");

  // Study starts Monday 2026-01-05. At Tuesday noon, Tuesday is excluded,
  // so the next prompt is Wednesday, which remains calendar study day 3.
  const next = dispatcher.computeNextPing_(
    "Etc/UTC",
    "2026-01-05",
    new Date("2026-01-06T12:00:00.000Z"),
    schedule,
    "P001",
    emptyLog()
  );

  assert.equal(next.forDay, 3);
  assert.equal(next.windowId, "morning");
  assert.equal(next.pingDate.toISOString(), "2026-01-07T08:00:00.000Z");
});

test("participant availability is intersected with protocol weekdays", () => {
  const builder = builderContext();
  const dispatcher = dispatcherContext(builder.generateTwilioScript("https://example.org/study/"));
  const schedule = dispatcher.participantSchedule_(JSON.stringify({
    days: ["Tue", "Fri"],
    windows: { morning: { start: "09:15", end: "09:15" } }
  }));

  assert.deepEqual(Array.from(schedule.days), [5]);
  const next = dispatcher.computeNextPing_(
    "Etc/UTC",
    "2026-01-05",
    new Date("2026-01-05T07:00:00.000Z"),
    schedule,
    "P002",
    emptyLog()
  );
  assert.equal(next.forDay, 5);
  assert.equal(next.pingDate.toISOString(), "2026-01-09T09:15:00.000Z");
});

test("phase labels use the full ordered phase sequence", () => {
  const context = builderContext();
  const label = context.phaseLabel({
    phase_sequence: [
      { kind: "ema", block: "pre" },
      { kind: "task", id: "epat" },
      { kind: "ema", block: "pre" },
      { kind: "ema", block: "post" }
    ]
  });
  assert.equal(label, "Survey questions → ePAT → Survey questions → Follow-up questions");
});

test("deployment URLs must be real HTTPS hosts", () => {
  const context = builderContext();
  assert.equal(context.isDeployableBaseUrl("https://community.example.org/study/"), true);
  assert.equal(context.isDeployableBaseUrl("https://example.com/study/"), false);
  assert.equal(context.isDeployableBaseUrl("http://localhost:8080/study/"), false);
  assert.equal(context.isDeployableBaseUrl("not a url"), false);
});

test("dispatcher serializes study names and URLs as safe JavaScript", () => {
  const context = builderContext();
  context.state.study.name = "Researcher's */ Study";
  const generated = context.generateTwilioScript("https://example.org/study/it's-ready/");
  assert.doesNotThrow(() => new vm.Script(generated));
  const dispatcher = dispatcherContext(generated);
  assert.equal(vm.runInContext("STUDY_NAME", dispatcher), "Researcher's */ Study");
});
