"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { createHmac } = require("node:crypto");
const vm = require("node:vm");
const path = require("node:path");
const fs = require("node:fs");

const modulePromise = import(pathToFileURL(path.join(__dirname, "../cloudflare-deploy/worker.mjs")).href);
const workerPromise = modulePromise.then(module => module.default);

test("Cloudflare deploy keeps optional Twilio setup out of required secrets", () => {
  const example = fs.readFileSync(path.join(__dirname, "../cloudflare-deploy/.dev.vars.example"), "utf8");
  for (const name of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TWILIO_MESSAGING_SERVICE_SID"]) {
    assert.doesNotMatch(example, new RegExp(`^${name}=`, "m"));
  }
});

test("new Cloudflare study hosts provision their own R2 bucket", () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../cloudflare-deploy/wrangler.jsonc"), "utf8"));
  assert.deepEqual(config.r2_buckets, [{ binding: "STUDY_DATA" }]);
});

test("deployed admin serves the same branded icon as the builder", async () => {
  const worker = await workerPromise;
  const icon = await worker.fetch(new Request('https://study.example/favicon.svg'), env(new MemoryBucket()));
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get('Content-Type'), /image\/svg\+xml/);
  const served = await icon.text();
  assert.equal(served.trim(), fs.readFileSync(path.join(__dirname, '../favicon.svg'), 'utf8').trim());
  const admin = await worker.fetch(new Request('https://study.example/admin'), env(new MemoryBucket()));
  assert.match(await admin.text(), /rel="icon" type="image\/svg\+xml" href="\/favicon.svg"/);
});

test("analysis configuration is available only to the study admin", async () => {
  const worker = await workerPromise;
  const bucket = new MemoryBucket();
  const config = { schema_version: "1", study: { name: "Study A" }, ema: { scheduling: { windows: [] } } };
  await bucket.put("study/current-config.json", JSON.stringify(config));
  const url = "https://study.example/admin/study-config";
  assert.equal((await worker.fetch(new Request(url), env(bucket))).status, 401);
  const response = await worker.fetch(adminRequest(url), env(bucket));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), config);
});

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
  async delete(key) { this.objects.delete(key); }
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

test("a second named study cannot replace an occupied study host", async () => {
  const worker = await workerPromise;
  const bucket = new MemoryBucket();
  const environment = env(bucket);
  const studyHtml = name => `<!doctype html><meta name="generator" content="EMA Forge"><script>window.__CONFIG__ = ${JSON.stringify({ study: { name } })};</script>`;
  const install = name => worker.fetch(adminRequest("https://study.example/admin/install", {
    method: "POST", headers: { "Content-Type": "text/html" }, body: studyHtml(name)
  }), environment);
  assert.equal((await install("Daily Rhythm")).status, 200);
  assert.equal((await install("Daily Rhythm")).status, 200, "updates of the same study remain possible");
  const other = await install("Stress Study");
  assert.equal(other.status, 409);
  assert.match((await other.json()).error, /separate Cloudflare Worker and R2 bucket/);
  assert.match(await (await worker.fetch(new Request("https://study.example/"), environment)).text(), /Daily Rhythm/);
});

test("a Worker bound to another deployment's bucket cannot treat its study as installed or expose data", async () => {
  const worker = await workerPromise;
  const bucket = new MemoryBucket();
  const studyHtml = '<!doctype html><meta name="generator" content="EMA Forge"><script>window.__CONFIG__ = {"study":{"name":"Study A"}};</script>';
  const install = origin => worker.fetch(adminRequest(origin + '/admin/install', {
    method: 'POST', headers: { 'Content-Type': 'text/html' }, body: studyHtml
  }), env(bucket));
  assert.equal((await install('https://first.example')).status, 200);
  assert.equal((await (await worker.fetch(adminRequest('https://first.example/admin/status'), env(bucket))).json()).installed, true);

  const second = 'https://second.example';
  const status = await worker.fetch(adminRequest(second + '/admin/status'), env(bucket));
  assert.equal(status.status, 200);
  const state = await status.json();
  assert.equal(state.installed, false);
  assert.equal(state.storage_conflict, true);
  assert.equal(state.study_name, undefined);
  assert.match(state.storage_message, /separate R2 bucket/);
  assert.equal((await worker.fetch(new Request(second + '/admin/status'), env(bucket))).status, 401);
  assert.equal((await worker.fetch(adminRequest(second + '/admin/export'), env(bucket))).status, 409);
  assert.equal((await worker.fetch(new Request(second + '/'), env(bucket))).status, 409);
  assert.equal((await install(second)).status, 409, 'same-name installs cannot overwrite another deployment');
  assert.equal((await worker.fetch(new Request('https://first.example/'), env(bucket))).status, 200);

  const clean = await worker.fetch(adminRequest(second + '/admin/status'), env(new MemoryBucket()));
  assert.equal((await clean.json()).installed, false);

  const orphaned = new MemoryBucket();
  await orphaned.put('study/current.html', studyHtml);
  const orphanedStatus = await worker.fetch(adminRequest(second + '/admin/status'), env(orphaned));
  assert.equal((await orphanedStatus.json()).storage_conflict, true);
});

test("optional EPA lookup returns only a category and does not store coordinates", async () => {
  const worker = await workerPromise;
  const bucket = new MemoryBucket();
  const environment = env(bucket);
  const config = { study: { name: 'Walkability pilot' }, ema: { questions: [
    { id: 'place', type: 'place_context', location_mode: 'epa_walkability' }
  ] } };
  const studyHtml = `<!doctype html><meta name="generator" content="EMA Forge"><script>window.__CONFIG__ = ${JSON.stringify(config)};</script>`;
  assert.equal((await worker.fetch(adminRequest('https://study.example/admin/install', {
    method: 'POST', headers: { 'Content-Type': 'text/html' }, body: studyHtml
  }), environment)).status, 200);
  const lookup = (accuracy = 20, origin = 'https://study.example') => worker.fetch(new Request('https://study.example/place/lookup', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' },
    body: JSON.stringify({ latitude: 39.96, longitude: -83, accuracy })
  }), environment);
  assert.equal((await lookup(20, 'https://other.example')).status, 403);
  assert.equal((await (await lookup(1000)).json()).status, 'uncertain_accuracy');
  const originalFetch = global.fetch;
  try {
    global.fetch = async (url, options) => {
      assert.match(url, /^https:\/\/geodata\.epa\.gov\//);
      assert.equal(options.method, 'POST');
      assert.equal(JSON.parse(options.body.get('geometry')).y, 39.96);
      return new Response(JSON.stringify({ features: [{ attributes: { NatWalkInd: 12.3 } }] }), {
        headers: { 'Content-Type': 'application/json' }
      });
    };
    const result = await (await lookup()).json();
    assert.deepEqual(result, { status: 'classified', indicators: { walkability: 'high' },
      dataset: 'EPA National Walkability Index', version: '2021' });
    assert.doesNotMatch(JSON.stringify(result), /39\.96|-83|lat|lon|GEOID/);
    assert.equal([...bucket.objects.keys()].filter(key => key.startsWith('sessions/')).length, 0);
  } finally { global.fetch = originalFetch; }
});

test("Census urbanicity returns only an explicit urban/rural flag and keeps missing distinct", async () => {
  const worker = await workerPromise;
  const bucket = new MemoryBucket();
  const environment = env(bucket);
  const config = { study: { name: 'Urbanicity pilot' }, ema: { questions: [
    { id: 'place', type: 'place_context', location_mode: 'census_urbanicity' }
  ] } };
  const studyHtml = `<!doctype html><meta name="generator" content="EMA Forge"><script>window.__CONFIG__ = ${JSON.stringify(config)};</script>`;
  assert.equal((await worker.fetch(adminRequest('https://study.example/admin/install', {
    method: 'POST', headers: { 'Content-Type': 'text/html' }, body: studyHtml
  }), environment)).status, 200);
  const lookup = (mode = 'census_urbanicity') => worker.fetch(new Request('https://study.example/place/lookup', {
    method: 'POST', headers: { Origin: 'https://study.example', 'Content-Type': 'text/plain' },
    body: JSON.stringify({ latitude: 39.96, longitude: -83, accuracy: 20, mode })
  }), environment);
  assert.equal((await lookup('epa_walkability')).status, 403);
  const originalFetch = global.fetch;
  try {
    let flag = 'U';
    global.fetch = async (url, options) => {
      assert.match(url, /^https:\/\/tigerweb\.geo\.census\.gov\//);
      assert.equal(options.body.get('outFields'), 'UR');
      assert.equal(JSON.parse(options.body.get('geometry')).y, 39.96);
      return new Response(JSON.stringify({ features: flag === null ? [] : [{ attributes: { UR: flag } }] }), {
        headers: { 'Content-Type': 'application/json' }
      });
    };
    const urban = await (await lookup()).json();
    assert.deepEqual(urban, { status: 'classified', indicators: { urbanicity: 'urban' },
      dataset: 'U.S. Census Bureau 2020 Census Blocks', version: '2020' });
    assert.doesNotMatch(JSON.stringify(urban), /39\.96|-83|lat|lon|GEOID/);
    flag = 'R';
    assert.equal((await (await lookup()).json()).indicators.urbanicity, 'rural');
    flag = null;
    assert.equal((await (await lookup()).json()).status, 'outside_study_area');
    flag = 'x';
    assert.equal((await (await lookup()).json()).status, 'uncertain_boundary');
    assert.equal([...bucket.objects.keys()].filter(key => key.startsWith('sessions/')).length, 0);
  } finally { global.fetch = originalFetch; }
});

test("one location request returns both configured indicators with explicit partial status", async () => {
  const worker = await workerPromise;
  const bucket = new MemoryBucket();
  const environment = env(bucket);
  const config = { study: { name: 'Combined context pilot' }, ema: { questions: [
    { id: 'place', type: 'place_context', location_mode: 'online_indicators',
      location_indicators: ['walkability', 'urbanicity'] }
  ] } };
  const html = `<!doctype html><meta name="generator" content="EMA Forge"><script>window.__CONFIG__ = ${JSON.stringify(config)};</script>`;
  assert.equal((await worker.fetch(adminRequest('https://study.example/admin/install', {
    method: 'POST', headers: { 'Content-Type': 'text/html' }, body: html
  }), environment)).status, 200);
  const lookup = indicators => worker.fetch(new Request('https://study.example/place/lookup', {
    method: 'POST', headers: { Origin: 'https://study.example', 'Content-Type': 'text/plain' },
    body: JSON.stringify({ latitude: 39.96, longitude: -83, accuracy: 20,
      mode: 'online_indicators', indicators })
  }), environment);
  assert.equal((await lookup(['walkability'])).status, 403);
  assert.equal((await lookup(['walkability', 'walkability'])).status, 403);
  const originalFetch = global.fetch;
  try {
    let censusAvailable = true;
    global.fetch = async url => new Response(JSON.stringify(url.includes('epa.gov')
      ? { features: [{ attributes: { NatWalkInd: 12.3 } }] }
      : censusAvailable ? { features: [{ attributes: { UR: 'U' } }] } : { error: 'down' }),
      { headers: { 'Content-Type': 'application/json' } });
    const complete = await (await lookup(['urbanicity', 'walkability'])).json();
    assert.equal(complete.status, 'classified');
    assert.deepEqual(complete.indicators, { urbanicity: 'urban', walkability: 'high' });
    assert.deepEqual(complete.indicator_statuses, { urbanicity: 'classified', walkability: 'classified' });
    assert.doesNotMatch(JSON.stringify(complete), /39\.96|-83|lat|lon|GEOID/);
    censusAvailable = false;
    const partial = await (await lookup(['walkability', 'urbanicity'])).json();
    assert.equal(partial.status, 'partial');
    assert.deepEqual(partial.indicators, { walkability: 'high' });
    assert.equal(partial.indicator_statuses.urbanicity, 'service_unavailable');
    assert.equal([...bucket.objects.keys()].filter(key => key.startsWith('sessions/')).length, 0);
  } finally { global.fetch = originalFetch; }
});

test("EPA area indicators use one query, preserve missing values, and return only bands", async () => {
  const worker = await workerPromise;
  const bucket = new MemoryBucket();
  const indicators = ['population_density', 'transit_distance', 'car_free_households'];
  const config = { study: { name: 'Community context' }, ema: { questions: [
    { id: 'place', type: 'place_context', location_mode: 'online_indicators', location_indicators: indicators }
  ] } };
  await bucket.put('study/current-config.json', JSON.stringify(config));
  const lookup = selected => worker.fetch(new Request('https://study.example/place/lookup', {
    method: 'POST', headers: { Origin: 'https://study.example', 'Content-Type': 'text/plain' },
    body: JSON.stringify({ latitude: 39.96, longitude: -83, accuracy: 20,
      mode: 'online_indicators', indicators: selected })
  }), env(bucket));
  assert.equal((await lookup(['population_density'])).status, 403);
  const originalFetch = global.fetch;
  try {
    let attributes = { D1B: 0.8, D4A: 1200, Pct_AO0: 0.28, GEOID20: 'secret' };
    let calls = 0;
    global.fetch = async (url, options) => {
      calls++;
      assert.match(url, /SmartLocationDatabase\/MapServer\/2\/query$/);
      assert.equal(options.body.get('outFields'), 'D1B,D4A,Pct_AO0');
      return Response.json({ features: [{ attributes }] });
    };
    const result = await (await lookup(indicators)).json();
    assert.equal(calls, 1);
    assert.deepEqual(result.indicators, { population_density: 'low', transit_distance: 'intermediate', car_free_households: 'high' });
    assert.deepEqual(result.indicator_statuses, Object.fromEntries(indicators.map(key => [key, 'classified'])));
    assert.doesNotMatch(JSON.stringify(result), /GEOID|secret|39\.96|-83|D1B|D4A|Pct_AO0/);
    attributes = { D1B: 12, D4A: -99999, Pct_AO0: null };
    const partial = await (await lookup(indicators)).json();
    assert.equal(partial.status, 'partial');
    assert.deepEqual(partial.indicators, { population_density: 'high' });
    assert.equal(partial.indicator_statuses.transit_distance, 'data_unavailable');
    assert.equal(partial.indicator_statuses.car_free_households, 'data_unavailable');
    assert.equal([...bucket.objects.keys()].filter(key => key.startsWith('sessions/')).length, 0);
  } finally { global.fetch = originalFetch; }
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

test("Twilio can be connected from admin without exposing credentials", async () => {
  const worker = await workerPromise;
  const bucket = new MemoryBucket();
  const environment = env(bucket);
  const url = "https://study.example/admin/twilio-credentials";
  const credentials = {
    account_sid: "AC" + "12345678901234567890123456789012",
    auth_token: "private-test-auth-token-with-length",
    from_number: "+15557654321"
  };
  assert.equal((await worker.fetch(new Request(url), environment)).status, 401);
  assert.equal((await worker.fetch(adminRequest(url, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials)
  }), environment)).status, 200);
  const stored = await bucket.get("admin/twilio-credentials.json");
  assert.doesNotMatch(await stored.text(), /private-test-auth-token|AC123456/);
  const status = await worker.fetch(adminRequest(url), environment);
  assert.deepEqual(await status.json(), { configured: true, source: "admin" });
  const messaging = await worker.fetch(adminRequest("https://study.example/admin/messaging"), environment);
  assert.equal((await messaging.json()).configured, true);
  const html = '<!doctype html><meta name="generator" content="EMA Forge"><script>window.__CONFIG__ = {};</script>';
  assert.equal((await worker.fetch(adminRequest("https://study.example/admin/install", {
    method: "POST", headers: { "Content-Type": "text/html" }, body: html
  }), environment)).status, 200);
  let sent = false;
  const withTransport = { ...environment, __TWILIO_FETCH: async (_, options) => {
    sent = true;
    assert.match(options.headers.Authorization, /^Basic /);
    return new Response(JSON.stringify({ sid: "SM1234567890", status: "queued" }), { status: 201 });
  } };
  const testMessage = await worker.fetch(adminRequest("https://study.example/admin/test-message", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: "+15557654321" })
  }), withTransport);
  assert.equal(testMessage.status, 200);
  assert.equal(sent, true);
  const newToken = "this-is-a-new-unique-test-token-with-32-chars";
  const rotated = await worker.fetch(new Request(url, { headers: { Authorization: `Bearer ${newToken}` } }), { ...environment, ADMIN_TOKEN: newToken });
  assert.deepEqual(await rotated.json(), { configured: false, source: "admin" });
  const removed = await worker.fetch(adminRequest(url, { method: "DELETE" }), environment);
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { configured: false, source: null });
});

test("Cloudflare creates opaque and revocable participant invite links", async () => {
  const worker = await workerPromise;
  const bucket = new MemoryBucket();
  const environment = env(bucket);
  const config = {
    study: { name: "Invite Study" },
    ema: { scheduling: {
      study_days: 7,
      timing: { expiry_minutes: 60, grace_minutes: 15 },
      windows: [{ id: "morning", label: "Morning", start: "08:00", end: "10:00" }]
    } }
  };
  const html = `<!doctype html><meta name="generator" content="EMA Forge"><script>window.__CONFIG__ = ${JSON.stringify(config)};</script>`;
  assert.equal((await worker.fetch(adminRequest("https://study.example/admin/install", {
    method: "POST", headers: { "Content-Type": "text/html" }, body: html
  }), environment)).status, 200);
  assert.equal((await worker.fetch(adminRequest("https://study.example/admin/roster", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participants: [{
      participant_id: "P001", phone: "+15551234567", timezone: "Etc/UTC",
      start_date: "2026-01-05", status: "active"
    }] })
  }), environment)).status, 200);

  const created = await worker.fetch(adminRequest("https://study.example/admin/invite-links", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant_id: "P001", day: 2, session_id: "morning" })
  }), environment);
  assert.equal(created.status, 201);
  const invite = await created.json();
  assert.match(invite.short_url, /^https:\/\/study\.example\/j\/[A-Za-z0-9_-]{16,64}$/);
  assert.doesNotMatch(invite.short_url, /P001|morning|day=/);

  const opened = await worker.fetch(new Request(invite.short_url), environment);
  assert.equal(opened.status, 302);
  const destination = new URL(opened.headers.get("Location"));
  assert.equal(destination.searchParams.get("id"), "P001");
  assert.equal(destination.searchParams.get("day"), "2");
  assert.equal(destination.searchParams.get("session"), "morning");
  assert.ok(destination.searchParams.get("t"));

  const revoked = await worker.fetch(adminRequest(`https://study.example/admin/invite-links/${invite.token}`, {
    method: "DELETE"
  }), environment);
  assert.equal(revoked.status, 200);
  assert.equal((await worker.fetch(new Request(invite.short_url), environment)).status, 410);
});

test("Cloudflare scheduled delivery creates one auditable Twilio dispatch", async () => {
  const module = await modulePromise;
  const worker = module.default;
  const bucket = new MemoryBucket();
  const sentRequests = [];
  const environment = {
    ...env(bucket),
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
  assert.equal((await worker.fetch(adminRequest("https://study.example/admin/twilio-credentials", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account_sid: "AC" + "12345678901234567890123456789012", auth_token: "test-auth-token-with-sufficient-length", from_number: "+15557654321" })
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
  assert.match(form.get("Body"), /https:\/\/study\.example\/j\/[A-Za-z0-9_-]{16,64}/);
  assert.doesNotMatch(form.get("Body"), /id=P001|session=morning/);
  assert.equal(form.get("StatusCallback"), "https://study.example/twilio/status");
  const dispatch = JSON.parse(await bucket.objects.get("dispatch/P001/0001/morning.json").text());
  assert.equal(dispatch.state, "queued");
  assert.equal(dispatch.message_sid, "SM1234567890");
  assert.match(dispatch.short_link, /^https:\/\/study\.example\/j\//);
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

test("connection checks report clearly and never count as participant responses", async () => {
  const worker = await workerPromise;
  const bucket = new MemoryBucket();
  const environment = env(bucket);
  const checkPage = await worker.fetch(new Request("https://study.example/check.html"), environment);
  const checkSource = await checkPage.text();
  assert.match(checkSource, /Success — storage is connected/);
  assert.match(checkSource, /Failure — storage could not be confirmed/);
  assert.match(checkSource, /href="\/admin">Back to Study Admin<\/a>/);
  assert.doesNotMatch(checkSource, /JSON\.stringify\(await response\.json/);

  const payload = {
    test: true,
    submission_id: "setup_123456",
    participant_id: "ema-forge-setup-test",
    day: null,
    window_id: "setup-test",
    session_data: { sessionId: "setup_123456", participantId: "ema-forge-setup-test", day: null, data: [], test: true }
  };
  const saved = await worker.fetch(new Request("https://study.example/submit", {
    method: "POST",
    headers: { Origin: "https://study.example", "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  }), environment);
  assert.equal(saved.status, 200);
  assert.ok(bucket.objects.has("setup-tests/setup_123456.json"));

  const status = await worker.fetch(adminRequest("https://study.example/admin/status"), environment);
  const summary = await status.json();
  assert.equal(summary.response_count, 0);
  assert.equal(summary.connection_check_count, 1);

  const exported = await worker.fetch(adminRequest("https://study.example/admin/export"), environment);
  assert.equal((await exported.text()).trim(), "");
});
