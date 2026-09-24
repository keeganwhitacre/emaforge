"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const workerPromise = import(pathToFileURL(path.join(__dirname, "../cloudflare-deploy/worker.mjs")).href)
  .then(module => module.default);

class MemoryBucket {
  constructor() { this.objects = new Map(); }
  async put(key, body, options = {}) {
    if (this.objects.has(key) && options.onlyIf instanceof Headers) return null;
    const object = {
      body,
      customMetadata: options.customMetadata || {},
      async text() { return typeof body === "string" ? body : String(body); }
    };
    this.objects.set(key, object);
    return object;
  }
  async get(key) { return this.objects.get(key) || null; }
  async head(key) { return this.objects.get(key) || null; }
  async list({ prefix = "", limit = 1000, cursor } = {}) {
    const keys = [...this.objects.keys()].filter(key => key.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const slice = keys.slice(start, start + limit);
    const next = start + slice.length;
    return {
      objects: slice.map(key => ({ key })),
      truncated: next < keys.length,
      cursor: next < keys.length ? String(next) : undefined
    };
  }
}

const adminToken = "this-is-a-unique-test-token-with-32-chars";

function env(bucket) {
  return { STUDY_DATA: bucket, ADMIN_TOKEN: adminToken };
}

function participantPayload() {
  return {
    submission_id: "ses_123456",
    participant_id: "P001",
    day: 1,
    window_id: "morning",
    session_data: { sessionId: "ses_123456", participantId: "P001", day: 1, data: [] }
  };
}

test("Cloudflare template requires its admin secret to install an EMA Forge study", async () => {
  const worker = await workerPromise;
  const bucket = new MemoryBucket();
  const html = '<!doctype html><meta name="generator" content="EMA Forge"><script>window.__CONFIG__={};</script>';
  const unauthorized = await worker.fetch(new Request("https://study.example/admin/install", {
    method: "POST", body: html
  }), env(bucket));
  assert.equal(unauthorized.status, 401);

  const installed = await worker.fetch(new Request("https://study.example/admin/install", {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "text/html" },
    body: html
  }), env(bucket));
  assert.equal(installed.status, 200);
  assert.equal((await installed.json()).participant_url, "https://study.example/");

  const served = await worker.fetch(new Request("https://study.example/"), env(bucket));
  assert.equal(served.status, 200);
  assert.match(await served.text(), /window\.__CONFIG__/);
  assert.ok([...bucket.objects.keys()].some(key => key.startsWith("study/versions/")));
});

test("Cloudflare template stores same-origin responses once and protects exports", async () => {
  const worker = await workerPromise;
  const bucket = new MemoryBucket();
  const send = origin => worker.fetch(new Request("https://study.example/submit", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(participantPayload())
  }), env(bucket));

  assert.equal((await send("https://other.example")).status, 403);
  const first = await send("https://study.example");
  assert.equal(first.status, 200);
  const firstReceipt = await first.json();
  assert.equal(firstReceipt.duplicate, false);
  assert.ok(firstReceipt.received_at);
  const stored = JSON.parse(await bucket.objects.get("sessions/ses_123456.json").text());
  assert.equal(stored.server_receipt.storage_state, "stored");
  assert.equal(stored.server_receipt.receiver, "ema-forge-cloudflare-r2");
  assert.equal(stored.server_receipt.received_at, firstReceipt.received_at);
  const retry = await send("https://study.example");
  const retryReceipt = await retry.json();
  assert.equal(retryReceipt.duplicate, true);
  assert.equal(retryReceipt.received_at, firstReceipt.received_at);

  const unauthorized = await worker.fetch(new Request("https://study.example/admin/export"), env(bucket));
  assert.equal(unauthorized.status, 401);
  const exported = await worker.fetch(new Request("https://study.example/admin/export", {
    headers: { Authorization: `Bearer ${adminToken}` }
  }), env(bucket));
  assert.equal(exported.status, 200);
  assert.match(await exported.text(), /"submission_id":"ses_123456"/);
});
