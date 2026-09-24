"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { createHmac } = require("node:crypto");
const vm = require("node:vm");
const path = require("node:path");

const modulePromise = import(pathToFileURL(path.join(__dirname, "../cloudflare-deploy/worker.mjs")).href);
const workerPromise = modulePromise.then(module => module.default);

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
      objects: slice.map(key => ({ key, customMetadata: this.objects.get(key).customMetadata })),
      truncated: next < keys.length,
      cursor: next < keys.length ? String(next) : undefined
    };
  }
}

const adminToken = "this-is-a-unique-test-token-with-32-chars";

function env(bucket) {
  return { STUDY_DATA: bucket, ADMIN_TOKEN: adminToken };
}

function adminRequest(url, options = {}) {
  return new Request(url, {
    ...options,
    headers: { Authorization: `Bearer ${adminToken}`, ...(options.headers || {}) }
  });
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
  const html = '<!doctype html><meta name="generator" content="EMA Forge"><script>window.__CONFIG__ = {};</script>';
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

test("Cloudflare admin exposes a protected control center and validated roster", async () => {
  const worker = await workerPromise;
  const bucket = new MemoryBucket();
  const environment = env(bucket);

  const admin = await worker.fetch(new Request("https://study.example/admin"), environment);
  const adminSource = await admin.text();
  assert.match(adminSource, /Participants &amp; delivery/);
  assert.match(adminSource, /Analyze live data/);
  assert.doesNotMatch(adminSource, /cdn\.jsdelivr|cdnjs/);
  const ids = [...adminSource.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, "admin page IDs must be unique");
  const scriptStart = adminSource.lastIndexOf("<script>") + 8;
  const scriptEnd = adminSource.lastIndexOf("</script>");
  assert.doesNotThrow(() => new vm.Script(adminSource.slice(scriptStart, scriptEnd)));

  const unauthorized = await worker.fetch(new Request("https://study.example/admin/roster"), environment);
  assert.equal(unauthorized.status, 401);

  const roster = {
    participants: [{
      participant_id: "P001",
      phone: "+15551234567",
      timezone: "America/New_York",
      start_date: "2026-01-05",
      status: "active"
    }]
  };
  const saved = await worker.fetch(adminRequest("https://study.example/admin/roster", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(roster)
  }), environment);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).participants[0].participant_id, "P001");

  const invalid = await worker.fetch(adminRequest("https://study.example/admin/roster", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participants: [{ ...roster.participants[0], phone: "555-1234" }] })
  }), environment);
  assert.equal(invalid.status, 400);
});

test("Cloudflare scheduled delivery creates one auditable Twilio dispatch", async () => {
  const module = await modulePromise;
  const worker = module.default;
  const bucket = new MemoryBucket();
  const sentRequests = [];
  const environment = {
    ...env(bucket),
    TWILIO_ACCOUNT_SID: "AC" + "12345678901234567890123456789012",
    TWILIO_AUTH_TOKEN: "test-auth-token-with-sufficient-length",
    TWILIO_FROM_NUMBER: "+15557654321",
    __TWILIO_FETCH: async (url, options) => {
      sentRequests.push({ url, options });
      return new Response(JSON.stringify({ sid: "SM1234567890", status: "queued" }), {
        status: 201,
        headers: { "Content-Type": "application/json" }
      });
    }
  };
  const config = {
    study: { name: "Scheduling Study" },
    ema: { scheduling: {
      study_days: 7,
      days_of_week: [1, 2, 3, 4, 5, 6, 7],
      windows: [{ id: "morning", label: "Morning", start: "08:00", end: "08:00" }]
    } }
  };
  const html = `<!doctype html><meta name="generator" content="EMA Forge"><script>window.__CONFIG__ = ${JSON.stringify(config)};</script>`;
  const installed = await worker.fetch(adminRequest("https://study.example/admin/install", {
    method: "POST", headers: { "Content-Type": "text/html" }, body: html
  }), environment);
  assert.equal(installed.status, 200);
  const roster = { participants: [{
    participant_id: "P001", phone: "+15551234567", timezone: "Etc/UTC",
    start_date: "2026-01-05", status: "active", schedule_preferences: null
  }] };
  assert.equal((await worker.fetch(adminRequest("https://study.example/admin/roster", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(roster)
  }), environment)).status, 200);
  assert.equal((await worker.fetch(adminRequest("https://study.example/admin/messaging", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true, message_template: "{study} {window}: {link}" })
  }), environment)).status, 200);

  const first = await module.dispatchDueMessages(environment, new Date("2026-01-05T08:00:00.000Z"));
  const second = await module.dispatchDueMessages(environment, new Date("2026-01-05T08:01:00.000Z"));
  assert.deepEqual(first, { sent: 1, failed: 0 });
  assert.deepEqual(second, { sent: 0, failed: 0 });
  assert.equal(sentRequests.length, 1);
  const form = new URLSearchParams(sentRequests[0].options.body);
  assert.match(form.get("Body"), /id=P001/);
  assert.match(form.get("Body"), /session=morning/);
  assert.equal(form.get("StatusCallback"), "https://study.example/twilio/status");
  const dispatch = JSON.parse(await bucket.objects.get("dispatch/P001/0001/morning.json").text());
  assert.equal(dispatch.state, "queued");
  assert.equal(dispatch.message_sid, "SM1234567890");
});

test("Twilio status callbacks require a valid signature and update delivery state", async () => {
  const module = await modulePromise;
  const worker = module.default;
  const bucket = new MemoryBucket();
  const authToken = "test-auth-token-with-sufficient-length";
  const environment = {
    ...env(bucket),
    TWILIO_ACCOUNT_SID: "AC" + "12345678901234567890123456789012",
    TWILIO_AUTH_TOKEN: authToken,
    TWILIO_FROM_NUMBER: "+15557654321"
  };
  const dispatchKey = "dispatch/P001/0001/morning.json";
  await bucket.put(dispatchKey, JSON.stringify({
    participant_id: "P001", day: 1, window_id: "morning", state: "sent", status_history: []
  }));
  await bucket.put("twilio/messages/SM123.json", JSON.stringify({ message_sid: "SM123", dispatch_key: dispatchKey }));
  const url = "https://study.example/twilio/status";
  const body = "MessageSid=SM123&MessageStatus=delivered";
  const params = new URLSearchParams(body);
  let payload = url;
  [...new Set(params.keys())].sort().forEach(name => {
    params.getAll(name).sort().forEach(value => { payload += name + value; });
  });
  const signature = createHmac("sha1", authToken).update(payload).digest("base64");
  const response = await worker.fetch(new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature },
    body
  }), environment);
  assert.equal(response.status, 204);
  const updated = JSON.parse(await bucket.objects.get(dispatchKey).text());
  assert.equal(updated.state, "delivered");
  assert.ok(updated.delivered_at);

  const rejected = await worker.fetch(new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": "invalid" },
    body
  }), environment);
  assert.equal(rejected.status, 403);
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
