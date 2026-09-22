"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const workerPromise = import(pathToFileURL(path.join(__dirname, "../receiver/worker.mjs")).href)
  .then(module => module.default);

class MemoryBucket {
  constructor() { this.objects = new Map(); }
  async put(key, body, options) {
    if (this.objects.has(key) && options.onlyIf instanceof Headers) return null;
    const object = { body, customMetadata: options.customMetadata };
    this.objects.set(key, object);
    return object;
  }
  async head(key) { return this.objects.get(key) || null; }
}

function payload(overrides = {}) {
  const base = {
    submission_id: "ses_123456",
    participant_id: "P001",
    day: 1,
    window_id: "morning",
    session_data: { sessionId: "ses_123456", participantId: "P001", day: 1, data: [] }
  };
  return { ...base, ...overrides };
}

async function send(bucket, body, origin = "https://study.example.org") {
  const worker = await workerPromise;
  return worker.fetch(new Request("https://receiver.example/submit", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body)
  }), { STUDY_DATA: bucket, ALLOWED_ORIGINS: "https://study.example.org" });
}

test("receiver saves once and returns a verifiable receipt", async () => {
  const bucket = new MemoryBucket();
  const first = await send(bucket, payload());
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {
    status: "success", submission_id: "ses_123456", stored: true, duplicate: false
  });
  assert.equal(bucket.objects.size, 1);

  const retry = await send(bucket, payload());
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).duplicate, true);
  assert.equal(bucket.objects.size, 1);
});

test("receiver refuses a changed payload that reuses a submission ID", async () => {
  const bucket = new MemoryBucket();
  await send(bucket, payload());
  const changed = payload({ session_data: {
    sessionId: "ses_123456", participantId: "P001", day: 1, data: [{ type: "changed" }]
  } });
  const response = await send(bucket, changed);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /different data/);
});

test("receiver enforces its study origin and validates envelope identity", async () => {
  const bucket = new MemoryBucket();
  assert.equal((await send(bucket, payload(), "https://other.example.org")).status, 403);
  const mismatched = payload({ session_data: {
    sessionId: "different", participantId: "P001", day: 1, data: []
  } });
  assert.equal((await send(bucket, mismatched)).status, 400);
  assert.equal(bucket.objects.size, 0);
});

test("receiver accepts onboarding records with a null day", async () => {
  const bucket = new MemoryBucket();
  const record = payload({
    day: null,
    window_id: "onboarding",
    session_data: { sessionId: "ses_123456", participantId: "P001", day: null, data: [] }
  });
  assert.equal((await send(bucket, record)).status, 200);
});
