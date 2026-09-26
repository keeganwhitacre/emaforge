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
    deployment: { hosted_url: "" },
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

test("phase labels use the full ordered phase sequence", () => {
  const context = builderContext();
  const label = context.phaseLabel({
    phase_sequence: [
      { kind: "ema", id: "s1" },
      { kind: "task", id: "epat" },
      { kind: "ema", id: "s2" },
      { kind: "ema", id: "s3", label: "Follow-up questions" }
    ]
  });
  assert.equal(label, "Survey questions → ePAT → Survey questions → Follow-up questions");
});

test("deployment URLs must be real HTTPS hosts", () => {
  const context = builderContext();
  assert.equal(context.isDeployableBaseUrl("https://community.example.org/study/"), true);
  assert.equal(context.isDeployableBaseUrl("my-study.example.workers.dev"), true);
  assert.equal(context.normalizeHostedStudyUrl("my-study.example.workers.dev"), "https://my-study.example.workers.dev/");
  assert.equal(context.isDeployableBaseUrl("https://example.com/study/"), false);
  assert.equal(context.isDeployableBaseUrl("http://localhost:8080/study/"), false);
  assert.equal(context.isDeployableBaseUrl("not a url"), false);
});

test("participant and connection URLs stay beside the hosted app", () => {
  const context = builderContext();
  assert.equal(
    context.connectionCheckUrl("https://lab.example.org/studies/sleep/index.html"),
    "https://lab.example.org/studies/sleep/check.html"
  );
  assert.equal(
    context.participantStudyUrl("https://lab.example.org/studies/sleep/index.html"),
    "https://lab.example.org/"
  );
  assert.equal(context.connectionCheckUrl("http://localhost/study"), null);
});

test("Cloudflare admin URL is derived without requiring log inspection", () => {
  const context = builderContext();
  assert.equal(
    context.cloudflareAdminUrl("https://ema-forge-test.example.workers.dev/"),
    "https://ema-forge-test.example.workers.dev/admin"
  );
  assert.equal(
    context.cloudflareAdminUrl("https://study.community.org/old/path"),
    "https://study.community.org/admin"
  );
  assert.equal(
    context.cloudflareAdminUrl("ema-forge-study.example.workers.dev"),
    "https://ema-forge-study.example.workers.dev/admin"
  );
  assert.equal(context.cloudflareAdminUrl("http://localhost:8787"), null);
});

test("hosted study URL is retained as researcher workspace metadata", () => {
  const context = builderContext();
  assert.equal(context.rememberHostedStudyUrl("  https://study.community.org/  "), "https://study.community.org/");
  assert.equal(context.state.deployment.hosted_url, "https://study.community.org/");
});

test("suggested Worker names retain EMA Forge identity and Cloudflare limits", () => {
  const context = builderContext();
  assert.equal(context.suggestedWorkerName(), "ema-forge-scheduling-study");
  context.state.study.name = "A Very Long Community Study Name With More Words Than Cloudflare Can Accept In One Worker Name";
  const name = context.suggestedWorkerName();
  assert.ok(name.startsWith("ema-forge-"));
  assert.ok(name.length <= 63);
  assert.doesNotMatch(name, /-$/);
});

test("single-file update serves the admin icon without source imports", async () => {
  const context = builderContext();
  const root = require('node:path').join(__dirname, '..');
  const worker = fs.readFileSync(require('node:path').join(root, 'cloudflare-deploy/worker.mjs'), 'utf8');
  const admin = fs.readFileSync(require('node:path').join(root, 'cloudflare-deploy/admin-page.mjs'), 'utf8');
  const source = context.bundleWorkerUpdate(worker, admin);
  assert.doesNotMatch(source, /import \{ adminHtml, faviconSvg \}/);
  const bundled = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const response = await bundled.default.fetch(new Request('https://study.example/favicon.svg'), {
    STUDY_DATA: { async get() { return null; }, async head() { return null; } }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.text()).trim(), fs.readFileSync(require('node:path').join(root, 'favicon.svg'), 'utf8').trim());
});
