import { adminHtml } from './admin-page.mjs';

// EMA Forge Cloudflare host: participant app, private response storage,
// researcher administration, and optional Twilio prompt delivery.
const MAX_STUDY_BYTES = 10 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_ROSTER_SIZE = 5000;
const MAX_ADMIN_LIST_OBJECTS = 50000;
const MAX_INVITE_LINKS_RETURNED = 250;
const DEFAULT_MESSAGE_TEMPLATE = '{study}: Your {window} check-in is ready: {link} Reply STOP to opt out.';
const TERMINAL_DISPATCH_STATES = new Set(['delivered', 'undelivered', 'failed', 'canceled', 'read']);
const textEncoder = new TextEncoder();

async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

function secureHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  };
}

function safeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) mismatch |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return mismatch === 0;
}

function randomToken(byteLength = 16) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function hasAdminAccess(request, env) {
  const expected = String(env.ADMIN_TOKEN || '');
  if (expected.length < 32 || expected.startsWith('replace-with-')) return false;
  const header = request.headers.get('Authorization') || '';
  return header.startsWith('Bearer ') && safeEqual(header.slice(7), expected);
}

function validRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const { submission_id: id, participant_id: pid, day, window_id: windowId, session_data: session } = record;
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{6,120}$/.test(id) &&
    typeof pid === 'string' && pid.length > 0 && pid.length <= 128 &&
    (day === null || (Number.isInteger(day) && day >= 0 && day <= 10000)) &&
    typeof windowId === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(windowId) &&
    session && typeof session === 'object' && !Array.isArray(session) &&
    session.sessionId === id && String(session.participantId) === pid && session.day === day &&
    (record.test !== true || (pid === 'ema-forge-setup-test' && windowId === 'setup-test'));
}

async function readJson(env, key, fallback = null) {
  const object = await env.STUDY_DATA.get(key);
  if (!object) return fallback;
  try { return JSON.parse(await object.text()); }
  catch (_) { return fallback; }
}

async function putJson(env, key, value, options = {}) {
  return env.STUDY_DATA.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: 'application/json' },
    ...options
  });
}

function extractStudyConfig(html) {
  const marker = 'window.__CONFIG__ = ';
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const jsonStart = start + marker.length;
  const end = html.indexOf(';</script>', jsonStart);
  if (end === -1) return null;
  try { return JSON.parse(html.slice(jsonStart, end)); }
  catch (_) { return null; }
}

async function storeSubmission(request, env, origin) {
  if (origin !== new URL(request.url).origin) return json({ error: 'Study origin is not allowed' }, 403);
  const length = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) return json({ error: 'Submission too large' }, 413);

  let raw;
  let record;
  try {
    raw = await request.text();
    if (textEncoder.encode(raw).byteLength > MAX_RESPONSE_BYTES) return json({ error: 'Submission too large' }, 413);
    record = JSON.parse(raw);
  } catch (_) {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!validRecord(record)) return json({ error: 'Invalid submission' }, 400);

  const key = `${record.test === true ? 'setup-tests' : 'sessions'}/${record.submission_id}.json`;
  const receivedAt = new Date().toISOString();
  const storedRecord = JSON.stringify({
    ...record,
    server_receipt: {
      receiver: 'ema-forge-cloudflare-r2',
      storage_state: 'stored',
      received_at: receivedAt
    }
  });
  const metadata = {
    participant: record.participant_id,
    day: String(record.day),
    window: record.window_id,
    digest: await sha256(raw),
    receivedAt
  };

  try {
    const saved = await env.STUDY_DATA.put(key, storedRecord, {
      onlyIf: new Headers({ 'If-None-Match': '*' }),
      httpMetadata: { contentType: 'application/json' },
      customMetadata: metadata
    });
    if (saved) return json({ status: 'success', submission_id: record.submission_id, stored: true, duplicate: false, received_at: receivedAt });
    const existing = await env.STUDY_DATA.head(key);
    if (!existing) return json({ error: 'Unable to confirm storage' }, 503);
    const previous = existing.customMetadata || {};
    if (previous.participant !== metadata.participant || previous.day !== metadata.day || previous.window !== metadata.window) {
      return json({ error: 'Submission ID already used for another session' }, 409);
    }
    if (previous.digest !== metadata.digest) return json({ error: 'Submission ID already used with different data' }, 409);
    return json({ status: 'success', submission_id: record.submission_id, stored: true, duplicate: true, received_at: previous.receivedAt || null });
  } catch (_) {
    return json({ error: 'Storage unavailable; keep a local copy' }, 503);
  }
}

// The request body contains coordinates only while this request is handled.
// Neither it nor the EPA response is written to R2 or echoed to clients.
async function lookupWalkability(request, env) {
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'Study origin is not allowed' }, 403);
  const length = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > 256) return json({ error: 'Invalid location request' }, 400);
  const config = await readJson(env, 'study/current-config.json', null);
  if (!config?.ema?.questions?.some(question => question.type === 'place_context' && question.location_mode === 'epa_walkability')) {
    return json({ error: 'Online place context is not enabled for this study' }, 403);
  }
  let payload;
  try {
    const raw = await request.text();
    if (textEncoder.encode(raw).byteLength > 256) return json({ error: 'Invalid location request' }, 400);
    payload = JSON.parse(raw);
  } catch (_) { return json({ error: 'Invalid location request' }, 400); }
  const { latitude, longitude, accuracy } = payload || {};
  if (![latitude, longitude, accuracy].every(value => typeof value === 'number' && Number.isFinite(value)) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0) {
    return json({ error: 'Invalid location request' }, 400);
  }
  if (accuracy > 250) return json({ status: 'uncertain_accuracy' });
  const form = new URLSearchParams({
    f: 'json', geometry: JSON.stringify({ x: longitude, y: latitude, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    outFields: 'NatWalkInd', returnGeometry: 'false'
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('https://geodata.epa.gov/arcgis/rest/services/OA/WalkabilityIndex/MapServer/0/query', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form, signal: controller.signal
    });
    if (!response.ok) return json({ status: 'service_unavailable' });
    const data = await response.json();
    if (!Array.isArray(data.features)) return json({ status: 'service_unavailable' });
    const score = data.features[0]?.attributes?.NatWalkInd;
    if (score == null) return json({ status: 'outside_study_area' });
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 1 || score > 20) return json({ status: 'service_unavailable' });
    const band = score <= 5.75 ? 'very_low' : score <= 10.5 ? 'low' : score <= 15.25 ? 'high' : 'very_high';
    return json({ status: 'classified', indicators: { walkability: band },
      dataset: 'EPA National Walkability Index', version: '2021' });
  } catch (_) { return json({ status: 'service_unavailable' }); }
  finally { clearTimeout(timeout); }
}

async function serveStudy(env) {
  const study = await env.STUDY_DATA.get('study/current.html');
  if (!study) return new Response(notInstalledHtml, { status: 503, headers: secureHeaders('text/html; charset=utf-8') });
  return new Response(study.body, { headers: secureHeaders('text/html; charset=utf-8') });
}

async function installStudy(request, env) {
  if (!hasAdminAccess(request, env)) return json({ error: 'Unauthorized' }, 401);
  const length = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > MAX_STUDY_BYTES) return json({ error: 'Study file is too large' }, 413);
  const html = await request.text();
  if (textEncoder.encode(html).byteLength > MAX_STUDY_BYTES) return json({ error: 'Study file is too large' }, 413);
  if (!html.includes('<meta name="generator" content="EMA Forge">') || !html.includes('window.__CONFIG__')) {
    return json({ error: 'Choose the Cloudflare study HTML exported by EMA Forge' }, 400);
  }
  const config = extractStudyConfig(html);
  if (!config || typeof config !== 'object') return json({ error: 'The embedded EMA Forge configuration could not be read' }, 400);
  const previous = await readJson(env, 'study/current-config.json', null);
  const previousName = String(previous?.study?.name || '').trim();
  const nextName = String(config?.study?.name || '').trim();
  if (previousName && nextName && previousName.toLowerCase() !== nextName.toLowerCase()) {
    return json({ error: `This deployment already hosts “${previousName}”. Create a separate Cloudflare Worker and R2 bucket for “${nextName}” so their responses stay separate.` }, 409);
  }
  const now = new Date().toISOString();
  const digest = await sha256(html);
  const versionKey = `study/versions/${now.replace(/[:.]/g, '-')}-${digest.slice(0, 12)}.html`;
  const options = {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
    customMetadata: { installedAt: now, digest }
  };
  await Promise.all([
    env.STUDY_DATA.put(versionKey, html, options),
    env.STUDY_DATA.put('study/current.html', html, options),
    putJson(env, 'study/current-config.json', config),
    putJson(env, 'admin/host.json', { origin: new URL(request.url).origin, installed_at: now, digest })
  ]);
  return json({ status: 'success', installed_at: now, digest, participant_url: new URL('/', request.url).toString() });
}

async function listAll(env, prefix, maximum = MAX_ADMIN_LIST_OBJECTS) {
  let cursor;
  const objects = [];
  do {
    const page = await env.STUDY_DATA.list({ prefix, limit: Math.min(1000, maximum - objects.length), cursor, include: ['customMetadata'] });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && objects.length < maximum);
  return { objects, limited: !!cursor };
}

function twilioConfigured(env) {
  const sid = String(env.TWILIO_ACCOUNT_SID || '');
  const token = String(env.TWILIO_AUTH_TOKEN || '');
  const from = String(env.TWILIO_FROM_NUMBER || '');
  const service = String(env.TWILIO_MESSAGING_SERVICE_SID || '');
  const senderValid = /^\+[1-9]\d{7,14}$/.test(from) || /^MG[a-zA-Z0-9]{20,}$/.test(service);
  return /^AC[a-zA-Z0-9]{20,}$/.test(sid) && token.length >= 16 && senderValid;
}

const TWILIO_CREDENTIALS_KEY = 'admin/twilio-credentials.json';

async function twilioEncryptionKey(env) {
  const secret = String(env.ADMIN_TOKEN || '');
  if (secret.length < 32 || secret.startsWith('replace-with-')) throw new Error('Set a unique ADMIN_TOKEN before saving Twilio credentials');
  const source = await crypto.subtle.importKey('raw', textEncoder.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: textEncoder.encode('EMA Forge Twilio credentials v1'), info: textEncoder.encode('study admin R2') }, source, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function resolveTwilioEnv(env) {
  const record = await readJson(env, TWILIO_CREDENTIALS_KEY, null);
  if (!record) return env;
  try {
    const key = await twilioEncryptionKey(env);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Uint8Array.from(record.iv) }, key, Uint8Array.from(record.ciphertext));
    return Object.assign(Object.create(env), JSON.parse(new TextDecoder().decode(plaintext)));
  } catch (_) {
    // An admin-token change must not lock the researcher out of the setup page.
    return env;
  }
}

async function twilioCredentialsRoute(request, env) {
  if (!hasAdminAccess(request, env)) return json({ error: 'Unauthorized' }, 401);
  if (request.method === 'GET') {
    const configured = twilioConfigured(await resolveTwilioEnv(env));
    return json({ configured, source: (await env.STUDY_DATA.head(TWILIO_CREDENTIALS_KEY)) ? 'admin' : configured ? 'cloudflare' : null });
  }
  if (request.method === 'DELETE') {
    await env.STUDY_DATA.delete(TWILIO_CREDENTIALS_KEY);
    const messaging = await getMessagingSettings(env);
    await putJson(env, 'admin/messaging.json', { ...messaging, enabled: false, updated_at: new Date().toISOString() });
    return json({ configured: twilioConfigured(env), source: twilioConfigured(env) ? 'cloudflare' : null });
  }
  if (request.method !== 'PUT') return json({ error: 'GET, PUT or DELETE required' }, 405);
  try {
    const payload = await parseJsonRequest(request, 8 * 1024);
    const credentials = {
      TWILIO_ACCOUNT_SID: String(payload.account_sid || '').trim(),
      TWILIO_AUTH_TOKEN: String(payload.auth_token || '').trim(),
      TWILIO_FROM_NUMBER: String(payload.from_number || '').trim(),
      TWILIO_MESSAGING_SERVICE_SID: String(payload.messaging_service_sid || '').trim()
    };
    if (!twilioConfigured(credentials)) throw new Error('Enter a valid Account SID, Auth Token, and sending number or Messaging Service SID');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await twilioEncryptionKey(env);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, textEncoder.encode(JSON.stringify(credentials)));
    await putJson(env, TWILIO_CREDENTIALS_KEY, { iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)), updated_at: new Date().toISOString() });
    return json({ configured: true, source: 'admin' });
  } catch (error) {
    return json({ error: error.message || 'Could not save Twilio credentials' }, 400);
  }
}

async function getMessagingSettings(env) {
  const stored = await readJson(env, 'admin/messaging.json', {});
  return {
    enabled: stored.enabled === true,
    message_template: typeof stored.message_template === 'string' && stored.message_template.trim()
      ? stored.message_template.trim()
      : DEFAULT_MESSAGE_TEMPLATE,
    updated_at: stored.updated_at || null
  };
}

async function adminStatus(request, env) {
  if (!hasAdminAccess(request, env)) return json({ error: 'Unauthorized' }, 401);
  const [study, config, sessionList, setupTestList, rosterDocument, dispatchList, messaging] = await Promise.all([
    env.STUDY_DATA.head('study/current.html'),
    readJson(env, 'study/current-config.json', null),
    listAll(env, 'sessions/'),
    listAll(env, 'setup-tests/'),
    readJson(env, 'admin/roster.json', { participants: [] }),
    listAll(env, 'dispatch/'),
    getMessagingSettings(env)
  ]);
  const participants = new Set();
  const windows = {};
  let latest = null;
  for (const item of sessionList.objects) {
    const metadata = item.customMetadata || {};
    if (metadata.participant) participants.add(metadata.participant);
    if (metadata.window) windows[metadata.window] = (windows[metadata.window] || 0) + 1;
    if (metadata.receivedAt && (!latest || metadata.receivedAt > latest)) latest = metadata.receivedAt;
  }
  const roster = Array.isArray(rosterDocument.participants) ? rosterDocument.participants : [];
  const origin = new URL(request.url).origin;
  return json({
    installed: !!study,
    study_name: config?.study?.name || null,
    installed_at: study?.customMetadata?.installedAt || null,
    participant_url: `${origin}/`,
    admin_url: `${origin}/admin`,
    connection_check_url: `${origin}/check.html`,
    response_count: sessionList.objects.length,
    response_count_limited: sessionList.limited,
    connection_check_count: setupTestList.objects.length,
    observed_participants: participants.size || (sessionList.objects.length ? null : 0),
    active_roster_count: roster.filter(person => person.status === 'active').length,
    roster_count: roster.length,
    latest_response_at: latest,
    sessions_by_window: windows,
    dispatch_count: dispatchList.objects.length,
    dispatch_count_limited: dispatchList.limited,
    messaging_enabled: messaging.enabled,
    twilio_configured: twilioConfigured(await resolveTwilioEnv(env)),
    study_days: Number(config?.ema?.scheduling?.study_days) || null,
    schedule_windows: (config?.ema?.scheduling?.windows || []).map(window => ({ id: window.id, label: window.label || window.id }))
  });
}

function inviteExpiry(config, sentAtMs) {
  const timing = config?.ema?.scheduling?.timing || {};
  const expiryMinutes = Number(timing.expiry_minutes);
  if (!Number.isFinite(expiryMinutes) || expiryMinutes <= 0) return null;
  const graceMinutes = Math.max(0, Number(timing.grace_minutes) || 0);
  return new Date(sentAtMs + (expiryMinutes + graceMinutes) * 60000).toISOString();
}

async function createInviteLink(env, { origin, config, participantId, day, sessionId, sentAtMs = Date.now(), source = 'admin' }) {
  const record = {
    participant_id: participantId,
    day,
    session_id: sessionId,
    sent_at_ms: sentAtMs,
    created_at: new Date().toISOString(),
    expires_at: inviteExpiry(config, sentAtMs),
    source,
    state: 'active'
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = randomToken();
    const saved = await putJson(env, `links/${token}.json`, { ...record, token }, {
      onlyIf: new Headers({ 'If-None-Match': '*' }),
      customMetadata: { participant: participantId, state: 'active', createdAt: record.created_at }
    });
    if (saved) return { ...record, token, short_url: `${origin}/j/${token}` };
  }
  throw new Error('Could not create a unique participant link');
}

async function inviteLinksRoute(request, env) {
  if (!hasAdminAccess(request, env)) return json({ error: 'Unauthorized' }, 401);
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const listed = await listAll(env, 'links/', 1000);
    const selected = listed.objects.sort((a, b) => String(b.customMetadata?.createdAt || '').localeCompare(String(a.customMetadata?.createdAt || ''))).slice(0, MAX_INVITE_LINKS_RETURNED);
    const stored = await Promise.all(selected.map(item => env.STUDY_DATA.get(item.key)));
    const links = [];
    for (const object of stored) {
      if (!object) continue;
      const record = JSON.parse(await object.text());
      const visibleState = record.state === 'active' && record.expires_at && Date.now() > Date.parse(record.expires_at)
        ? 'expired'
        : record.state;
      links.push({ ...record, state: visibleState, short_url: `${url.origin}/j/${record.token}` });
    }
    return json({ links, limited: listed.limited || listed.objects.length > MAX_INVITE_LINKS_RETURNED });
  }
  if (request.method !== 'POST') return json({ error: 'GET or POST required' }, 405);
  try {
    const payload = await parseJsonRequest(request, 16 * 1024);
    const [config, rosterDocument] = await Promise.all([
      readJson(env, 'study/current-config.json', null),
      readJson(env, 'admin/roster.json', { participants: [] })
    ]);
    if (!config?.ema?.scheduling) throw new Error('Install the study before creating participant links');
    const participantId = String(payload.participant_id || '').trim();
    const person = (rosterDocument.participants || []).find(candidate => candidate.participant_id === participantId);
    if (!person) throw new Error('Choose a participant from the saved roster');
    if (person.status !== 'active') throw new Error('Participant links can be created only for active roster entries');
    const day = Number(payload.day);
    const studyDays = Math.max(1, Number(config.ema.scheduling.study_days) || 1);
    if (!Number.isInteger(day) || day < 1 || day > studyDays) throw new Error(`Day must be between 1 and ${studyDays}`);
    const sessionId = String(payload.session_id || '').trim();
    if (!(config.ema.scheduling.windows || []).some(window => window.id === sessionId)) throw new Error('Choose a session from the installed study');
    return json(await createInviteLink(env, {
      origin: url.origin, config, participantId, day, sessionId, source: 'admin'
    }), 201);
  } catch (error) {
    return json({ error: error.message || 'Could not create participant link' }, 400);
  }
}

async function revokeInviteLink(request, env, token) {
  if (!hasAdminAccess(request, env)) return json({ error: 'Unauthorized' }, 401);
  if (request.method !== 'DELETE') return json({ error: 'DELETE required' }, 405);
  if (!/^[a-zA-Z0-9_-]{16,64}$/.test(token)) return json({ error: 'Invalid link token' }, 400);
  const record = await readJson(env, `links/${token}.json`, null);
  if (!record) return json({ error: 'Participant link not found' }, 404);
  const updated = { ...record, state: 'revoked', revoked_at: new Date().toISOString() };
  await putJson(env, `links/${token}.json`, updated, {
    customMetadata: { participant: record.participant_id, state: 'revoked', createdAt: record.created_at }
  });
  return json(updated);
}

async function resolveInviteLink(request, env, token) {
  if (request.method !== 'GET') return json({ error: 'GET required' }, 405);
  if (!/^[a-zA-Z0-9_-]{16,64}$/.test(token)) return json({ error: 'Participant link not found' }, 404);
  const record = await readJson(env, `links/${token}.json`, null);
  if (!record) return json({ error: 'Participant link not found' }, 404);
  if (record.state !== 'active') return json({ error: 'This participant link has been revoked' }, 410);
  if (record.expires_at && Date.now() > Date.parse(record.expires_at)) return json({ error: 'This participant link has expired' }, 410);
  const destination = new URL('/', request.url);
  destination.searchParams.set('id', record.participant_id);
  destination.searchParams.set('day', String(record.day));
  destination.searchParams.set('session', record.session_id);
  destination.searchParams.set('t', String(record.sent_at_ms));
  return new Response(null, { status: 302, headers: { Location: destination.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

async function exportPrefix(request, env, prefix, filename) {
  if (!hasAdminAccess(request, env)) return json({ error: 'Unauthorized' }, 401);
  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor') || undefined;
  const listed = await env.STUDY_DATA.list({ prefix, limit: 1000, cursor });
  const lines = [];
  for (let offset = 0; offset < listed.objects.length; offset += 20) {
    const batch = listed.objects.slice(offset, offset + 20);
    const objects = await Promise.all(batch.map(item => env.STUDY_DATA.get(item.key)));
    for (const object of objects) if (object) lines.push(await object.text());
  }
  const headers = secureHeaders('application/x-ndjson; charset=utf-8');
  headers['Content-Disposition'] = `attachment; filename="${filename}"`;
  headers['X-EMA-Truncated'] = String(!!listed.truncated);
  if (listed.cursor) headers['X-EMA-Next-Cursor'] = listed.cursor;
  return new Response(lines.join('\n') + (lines.length ? '\n' : ''), { headers });
}

async function parseJsonRequest(request, maximumBytes = 2 * 1024 * 1024) {
  const length = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > maximumBytes) throw new Error('Request is too large');
  const raw = await request.text();
  if (textEncoder.encode(raw).byteLength > maximumBytes) throw new Error('Request is too large');
  return JSON.parse(raw);
}

function validTimezone(timezone) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date()); return true; }
  catch (_) { return false; }
}

function normalizeSchedulePreferences(value) {
  if (value == null || value === '') return null;
  const preferences = typeof value === 'string' ? JSON.parse(value) : value;
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) throw new Error('Schedule preferences must be a JSON object');
  return preferences;
}

function normalizeRoster(payload) {
  const incoming = Array.isArray(payload?.participants) ? payload.participants : null;
  if (!incoming) throw new Error('Roster must contain a participants array');
  if (incoming.length > MAX_ROSTER_SIZE) throw new Error(`Roster cannot exceed ${MAX_ROSTER_SIZE} participants`);
  const ids = new Set();
  const phones = new Set();
  return incoming.map((raw, index) => {
    const participantId = String(raw.participant_id || '').trim();
    const phone = String(raw.phone || '').replace(/[\s()-]/g, '');
    const timezone = String(raw.timezone || '').trim();
    const startDate = String(raw.start_date || '').trim();
    const status = String(raw.status || 'active').trim().toLowerCase();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(participantId)) throw new Error(`Row ${index + 1}: participant_id must use letters, numbers, dashes, or underscores`);
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error(`Row ${index + 1}: phone must use E.164 format`);
    if (!validTimezone(timezone)) throw new Error(`Row ${index + 1}: timezone is not a valid IANA timezone`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(Date.parse(`${startDate}T00:00:00Z`))) throw new Error(`Row ${index + 1}: start_date must be YYYY-MM-DD`);
    if (!['active', 'inactive', 'opted_out'].includes(status)) throw new Error(`Row ${index + 1}: status must be active, inactive, or opted_out`);
    if (ids.has(participantId)) throw new Error(`Duplicate participant_id: ${participantId}`);
    if (phones.has(phone)) throw new Error(`Duplicate phone number in roster: ${phone}`);
    ids.add(participantId);
    phones.add(phone);
    return {
      participant_id: participantId,
      phone,
      timezone,
      start_date: startDate,
      status,
      schedule_preferences: normalizeSchedulePreferences(raw.schedule_preferences)
    };
  });
}

async function rosterRoute(request, env) {
  if (!hasAdminAccess(request, env)) return json({ error: 'Unauthorized' }, 401);
  if (request.method === 'GET') return json(await readJson(env, 'admin/roster.json', { participants: [], updated_at: null }));
  if (request.method !== 'PUT') return json({ error: 'GET or PUT required' }, 405);
  try {
    const participants = normalizeRoster(await parseJsonRequest(request));
    const document = { participants, updated_at: new Date().toISOString() };
    await putJson(env, 'admin/roster.json', document);
    return json(document);
  } catch (error) {
    return json({ error: error.message || 'Invalid roster' }, 400);
  }
}

async function messagingRoute(request, env) {
  if (!hasAdminAccess(request, env)) return json({ error: 'Unauthorized' }, 401);
  const twilioEnv = await resolveTwilioEnv(env);
  if (request.method === 'GET') return json({ settings: await getMessagingSettings(env), configured: twilioConfigured(twilioEnv) });
  if (request.method !== 'PUT') return json({ error: 'GET or PUT required' }, 405);
  try {
    const incoming = await parseJsonRequest(request, 64 * 1024);
    const template = String(incoming.message_template || '').trim();
    if (!template || template.length > 500) throw new Error('Message template must contain 1–500 characters');
    if (!template.includes('{link}')) throw new Error('Message template must include {link}');
    if (incoming.enabled === true && !twilioConfigured(twilioEnv)) throw new Error('Connect Twilio in Study Admin before enabling messaging');
    const settings = { enabled: incoming.enabled === true, message_template: template, updated_at: new Date().toISOString() };
    await putJson(env, 'admin/messaging.json', settings);
    return json({ settings, configured: twilioConfigured(twilioEnv) });
  } catch (error) {
    return json({ error: error.message || 'Invalid messaging settings' }, 400);
  }
}

function base64(value) {
  const bytes = textEncoder.encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function sendTwilioMessage(env, { to, body, statusCallback }) {
  if (!twilioConfigured(env)) throw new Error('Twilio secrets are not configured');
  const sid = String(env.TWILIO_ACCOUNT_SID);
  const form = new URLSearchParams({ To: to, Body: body, StatusCallback: statusCallback });
  if (env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', String(env.TWILIO_MESSAGING_SERVICE_SID));
  else form.set('From', String(env.TWILIO_FROM_NUMBER));
  const transport = typeof env.__TWILIO_FETCH === 'function' ? env.__TWILIO_FETCH : fetch;
  let response;
  try {
    response = await transport(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${base64(`${sid}:${env.TWILIO_AUTH_TOKEN}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
      },
      body: form.toString()
    });
  } catch (cause) {
    const error = new Error(`Twilio request outcome is uncertain: ${cause?.message || cause}`);
    error.uncertain = true;
    throw error;
  }
  let result;
  try { result = await response.json(); }
  catch (_) { result = {}; }
  if (!response.ok || !result.sid) throw new Error(result.message || `Twilio rejected the message (${response.status})`);
  return { sid: result.sid, status: result.status || 'accepted', date_created: result.date_created || null };
}

async function testMessageRoute(request, env) {
  if (!hasAdminAccess(request, env)) return json({ error: 'Unauthorized' }, 401);
  try {
    const payload = await parseJsonRequest(request, 16 * 1024);
    const phone = String(payload.phone || '').replace(/[\s()-]/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Enter a test phone number in E.164 format');
    const host = await readJson(env, 'admin/host.json', null);
    if (!host?.origin) throw new Error('Install the study before sending a test message');
    const result = await sendTwilioMessage(await resolveTwilioEnv(env), {
      to: phone,
      body: `EMA Forge test: messaging is connected for ${host.origin}.`,
      statusCallback: `${host.origin}/twilio/status`
    });
    await putJson(env, `twilio/tests/${result.sid}.json`, { message_sid: result.sid, state: result.status, sent_at: new Date().toISOString() });
    return json({ status: 'accepted', message_sid: result.sid, twilio_status: result.status });
  } catch (error) {
    return json({ error: error.message || 'Test message failed' }, 400);
  }
}

function localParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[parts.weekday]
  };
}

function dayDiff(startYmd, currentYmd) {
  const parse = value => {
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((parse(currentYmd) - parse(startYmd)) / 86400000);
}

function hmMinutes(value) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''))) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function deterministicMinute(participantId, day, windowId, start, end) {
  let hash = 2166136261;
  const seed = `${participantId}|${day}|${windowId}`;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return start + ((hash >>> 0) % (end - start + 1));
}

function participantSchedule(config, person) {
  const scheduling = config?.ema?.scheduling || {};
  const protocolDays = Array.isArray(scheduling.days_of_week) && scheduling.days_of_week.length
    ? scheduling.days_of_week.map(Number)
    : [1, 2, 3, 4, 5, 6, 7];
  const preferences = person.schedule_preferences || {};
  const dayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const preferredDays = Array.isArray(preferences.days)
    ? preferences.days.map(day => dayMap[day] || Number(day)).filter(day => day >= 1 && day <= 7)
    : protocolDays;
  const days = protocolDays.filter(day => preferredDays.includes(day));
  const overrides = preferences.windows && typeof preferences.windows === 'object' ? preferences.windows : {};
  const windows = (scheduling.windows || []).map(window => {
    const override = overrides[window.id] || {};
    const start = hmMinutes(override.start) == null ? window.start : override.start;
    const end = hmMinutes(override.end) == null ? window.end : override.end;
    return { id: window.id, label: window.label || window.id, start, end };
  }).filter(window => hmMinutes(window.start) != null && hmMinutes(window.end) != null && hmMinutes(window.end) >= hmMinutes(window.start));
  return { days, windows };
}

function renderMessage(template, values) {
  return template.replace(/\{(study|participant_id|day|window|link)\}/g, (_, key) => String(values[key] ?? ''));
}

function dispatchMetadata(record) {
  return {
    state: String(record.state || 'unknown').slice(0, 40),
    participant: String(record.participant_id || '').slice(0, 64),
    day: String(record.day ?? ''),
    window: String(record.window_id || '').slice(0, 120),
    sentAt: String(record.sent_at || record.last_attempt_at || '').slice(0, 40)
  };
}

async function saveDispatch(env, key, record, options = {}) {
  return putJson(env, key, record, { ...options, customMetadata: dispatchMetadata(record) });
}

export async function dispatchDueMessages(env, now = new Date()) {
  env = await resolveTwilioEnv(env);
  const settings = await getMessagingSettings(env);
  if (!settings.enabled) return { sent: 0, skipped: 'disabled' };
  if (!twilioConfigured(env)) return { sent: 0, skipped: 'twilio_not_configured' };
  const [config, rosterDocument, host] = await Promise.all([
    readJson(env, 'study/current-config.json', null),
    readJson(env, 'admin/roster.json', { participants: [] }),
    readJson(env, 'admin/host.json', null)
  ]);
  if (!config?.ema?.scheduling || !host?.origin) return { sent: 0, skipped: 'study_not_installed' };
  const studyDays = Math.max(1, Number(config.ema.scheduling.study_days) || 1);
  let sent = 0;
  let failed = 0;
  for (const person of rosterDocument.participants || []) {
    if (person.status !== 'active') continue;
    const local = localParts(now, person.timezone);
    const day = dayDiff(person.start_date, local.ymd) + 1;
    if (day < 1 || day > studyDays) continue;
    const schedule = participantSchedule(config, person);
    if (!schedule.days.includes(local.weekday)) continue;
    for (const window of schedule.windows) {
      const start = hmMinutes(window.start);
      const end = hmMinutes(window.end);
      const target = deterministicMinute(person.participant_id, day, window.id, start, end);
      if (local.minute < target || local.minute > end) continue;
      const key = `dispatch/${person.participant_id}/${String(day).padStart(4, '0')}/${window.id}.json`;
      const existing = await readJson(env, key, null);
      if (existing && existing.state !== 'failed') continue;
      if (existing?.attempts >= 3) continue;
      if (existing?.last_attempt_at && now.getTime() - Date.parse(existing.last_attempt_at) < 15 * 60000) continue;
      const attempt = {
        dispatch_id: `${person.participant_id}-${day}-${window.id}`,
        participant_id: person.participant_id,
        day,
        window_id: window.id,
        window_label: window.label,
        scheduled_local_minute: target,
        timezone: person.timezone,
        state: 'attempting',
        attempts: (existing?.attempts || 0) + 1,
        last_attempt_at: now.toISOString(),
        sent_at: null,
        message_sid: null,
        invite_token: existing?.invite_token || null,
        short_link: existing?.short_link || null,
        status_history: existing?.status_history || []
      };
      if (!existing) {
        const claimed = await saveDispatch(env, key, attempt, { onlyIf: new Headers({ 'If-None-Match': '*' }) });
        if (!claimed) continue;
      } else {
        await saveDispatch(env, key, attempt);
      }
      try {
        if (!attempt.short_link) {
          const invite = await createInviteLink(env, {
            origin: host.origin,
            config,
            participantId: person.participant_id,
            day,
            sessionId: window.id,
            sentAtMs: now.getTime(),
            source: 'twilio'
          });
          attempt.invite_token = invite.token;
          attempt.short_link = invite.short_url;
          await saveDispatch(env, key, attempt);
        }
        const body = renderMessage(settings.message_template, {
          study: config.study?.name || 'Study', participant_id: person.participant_id,
          day, window: window.label, link: attempt.short_link
        });
        const result = await sendTwilioMessage(env, {
          to: person.phone,
          body,
          statusCallback: `${host.origin}/twilio/status`
        });
        attempt.state = result.status;
        attempt.sent_at = now.toISOString();
        attempt.message_sid = result.sid;
        attempt.status_history.push({ state: result.status, at: now.toISOString(), source: 'api' });
        await Promise.all([
          saveDispatch(env, key, attempt),
          putJson(env, `twilio/messages/${result.sid}.json`, { message_sid: result.sid, dispatch_key: key, created_at: now.toISOString() })
        ]);
        sent++;
      } catch (error) {
        attempt.state = error.uncertain ? 'uncertain' : 'failed';
        attempt.error = String(error.message || error).slice(0, 500);
        attempt.status_history.push({ state: attempt.state, at: now.toISOString(), source: 'api', error: attempt.error });
        await saveDispatch(env, key, attempt);
        failed++;
      }
    }
  }
  return { sent, failed };
}

async function twilioSignature(url, params, authToken) {
  let payload = url;
  const names = [...new Set([...params.keys()])].sort();
  for (const name of names) {
    const values = params.getAll(name).sort();
    for (const value of values) payload += name + value;
  }
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, textEncoder.encode(payload)));
  let binary = '';
  for (const byte of signed) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function validateTwilioRequest(requestUrl, rawBody, signature, authToken) {
  if (!signature || !authToken) return false;
  const expected = await twilioSignature(requestUrl, new URLSearchParams(rawBody), authToken);
  return safeEqual(signature, expected);
}

async function twilioStatusRoute(request, env) {
  env = await resolveTwilioEnv(env);
  const raw = await request.text();
  const valid = await validateTwilioRequest(request.url, raw, request.headers.get('X-Twilio-Signature'), env.TWILIO_AUTH_TOKEN);
  if (!valid) return json({ error: 'Invalid Twilio signature' }, 403);
  const params = new URLSearchParams(raw);
  const sid = params.get('MessageSid') || params.get('SmsSid');
  const state = String(params.get('MessageStatus') || params.get('SmsStatus') || 'unknown').toLowerCase();
  if (!sid) return new Response(null, { status: 204 });
  const mapping = await readJson(env, `twilio/messages/${sid}.json`, null);
  if (!mapping?.dispatch_key) return new Response(null, { status: 204 });
  const dispatch = await readJson(env, mapping.dispatch_key, null);
  if (!dispatch) return new Response(null, { status: 204 });
  const now = new Date().toISOString();
  dispatch.state = state;
  dispatch.status_history = Array.isArray(dispatch.status_history) ? dispatch.status_history.slice(-19) : [];
  dispatch.status_history.push({
    state, at: now, source: 'callback',
    error_code: params.get('ErrorCode') || null,
    error_message: params.get('ErrorMessage') || null
  });
  if (state === 'delivered') dispatch.delivered_at = now;
  if (TERMINAL_DISPATCH_STATES.has(state)) dispatch.final_at = now;
  await saveDispatch(env, mapping.dispatch_key, dispatch);
  return new Response(null, { status: 204 });
}

async function twilioIncomingRoute(request, env) {
  env = await resolveTwilioEnv(env);
  const raw = await request.text();
  const valid = await validateTwilioRequest(request.url, raw, request.headers.get('X-Twilio-Signature'), env.TWILIO_AUTH_TOKEN);
  if (!valid) return json({ error: 'Invalid Twilio signature' }, 403);
  const params = new URLSearchParams(raw);
  const from = String(params.get('From') || '').replace(/[\s()-]/g, '');
  const body = String(params.get('Body') || '').trim().toUpperCase();
  const optOutType = String(params.get('OptOutType') || '').toUpperCase();
  const stopWords = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
  if (optOutType === 'STOP' || stopWords.has(body)) {
    const rosterDocument = await readJson(env, 'admin/roster.json', { participants: [] });
    let changed = false;
    rosterDocument.participants = (rosterDocument.participants || []).map(person => {
      if (person.phone !== from) return person;
      changed = true;
      return { ...person, status: 'opted_out', opted_out_at: new Date().toISOString() };
    });
    if (changed) {
      rosterDocument.updated_at = new Date().toISOString();
      await putJson(env, 'admin/roster.json', rosterDocument);
    }
  }
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    headers: secureHeaders('application/xml; charset=utf-8')
  });
}

const notInstalledHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EMA Forge setup required</title></head><body style="font-family:system-ui;max-width:620px;margin:12vh auto;padding:24px;color:#18202a"><h1>Study setup required</h1><p>This EMA Forge host is running, but no study has been installed.</p><p><a href="/admin">Open protected study setup</a></p></body></html>`;

const checkHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EMA Forge connection check</title><style>:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171b20;background:#f6f7f8}*{box-sizing:border-box}body{margin:0;padding:24px}.card{max-width:560px;margin:min(12vh,90px) auto;background:#fff;border:1px solid #c9ced3;border-top:3px solid #b44337;padding:28px}h1{font-size:1.65rem;letter-spacing:-.025em;margin:0 0 9px}p{color:#59636d;line-height:1.55}button{min-height:42px;padding:10px 16px;border:1px solid #b44337;border-radius:3px;background:#b44337;color:#fff;font:inherit;font-weight:700;cursor:pointer}button:disabled{opacity:.55;cursor:wait}.result{display:none;margin-top:18px;padding:14px;border:1px solid #c9ced3;line-height:1.5}.result.show{display:block}.result.good{border-color:#82ad98;background:#f0f8f4;color:#195c3f}.result.bad{border-color:#d3a09a;background:#fff4f2;color:#8d2f27}.detail{display:block;margin-top:4px;font-size:.82rem;color:inherit}</style></head><body><main class="card"><p style="margin:0 0 7px;color:#b44337;font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase">EMA Forge setup</p><h1>Check response storage</h1><p>This sends one synthetic setup record to private storage. It is kept separately and never counted as a participant response.</p><button id="send" type="button">Run connection check</button><div id="result" class="result" role="status" aria-live="polite"></div><p style="margin-top:18px;font-size:.82rem">After this passes, complete one full participant session and confirm it appears in Study Admin.</p></main><script>const button=document.getElementById('send');const result=document.getElementById('result');button.onclick=async()=>{button.disabled=true;button.textContent='Checking…';result.className='result';try{const id='setup_'+Date.now();const payload={test:true,submission_id:id,participant_id:'ema-forge-setup-test',day:null,window_id:'setup-test',session_data:{sessionId:id,participantId:'ema-forge-setup-test',day:null,data:[],test:true}};const response=await fetch('/submit',{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});const receipt=await response.json();if(!response.ok||receipt.status!=='success'||receipt.stored!==true)throw new Error(receipt.error||'Storage did not confirm the test');result.className='result show good';result.innerHTML='<strong>Success — storage is connected.</strong><span class="detail">Synthetic check '+id+' was stored separately from participant responses.</span>';button.textContent='Run again'}catch(error){result.className='result show bad';result.innerHTML='<strong>Connection check failed.</strong><span class="detail"></span>';result.querySelector('.detail').textContent=error.message+' Check the R2 binding and try again.';button.textContent='Try again'}finally{button.disabled=false}};<\/script></body></html>`;

export default {
  async fetch(request, env) {
    if (!env.STUDY_DATA) return json({ error: 'R2 binding is missing' }, 503);
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/admin') return new Response(adminHtml, { headers: secureHeaders('text/html; charset=utf-8') });
    if (path === '/admin/install' && request.method === 'POST') return installStudy(request, env);
    if (path === '/admin/status' && request.method === 'GET') return adminStatus(request, env);
    if (path === '/admin/export' && request.method === 'GET') return exportPrefix(request, env, 'sessions/', 'ema-forge-responses.ndjson');
    if (path === '/admin/dispatch-export' && request.method === 'GET') return exportPrefix(request, env, 'dispatch/', 'ema-forge-dispatch.ndjson');
    if (path === '/admin/roster') return rosterRoute(request, env);
    if (path === '/admin/messaging') return messagingRoute(request, env);
    if (path === '/admin/twilio-credentials') return twilioCredentialsRoute(request, env);
    if (path === '/admin/test-message' && request.method === 'POST') return testMessageRoute(request, env);
    if (path === '/admin/invite-links') return inviteLinksRoute(request, env);
    if (path.startsWith('/admin/invite-links/')) return revokeInviteLink(request, env, path.slice('/admin/invite-links/'.length));
    if (path.startsWith('/admin/')) return json({ error: 'Not found' }, 404);
    if (path === '/twilio/status' && request.method === 'POST') return twilioStatusRoute(request, env);
    if (path === '/twilio/incoming' && request.method === 'POST') return twilioIncomingRoute(request, env);
    if (path.startsWith('/twilio/')) return json({ error: 'POST required' }, 405);
    if (path.startsWith('/j/')) return resolveInviteLink(request, env, path.slice('/j/'.length));
    if (path === '/health') return json({ status: 'ok', study_installed: !!(await env.STUDY_DATA.head('study/current.html')), twilio_configured: twilioConfigured(await resolveTwilioEnv(env)) });
    if (path === '/check.html') return new Response(checkHtml, { headers: secureHeaders('text/html; charset=utf-8') });
    if (path === '/submit' && request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin');
      if (origin !== url.origin) return json({ error: 'Study origin is not allowed' }, 403);
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' } });
    }
    if (path === '/submit' && request.method === 'POST') return storeSubmission(request, env, request.headers.get('Origin'));
    if (path === '/submit') return json({ error: 'POST required' }, 405);
    if (path === '/place/lookup' && request.method === 'POST') return lookupWalkability(request, env);
    if (path === '/place/lookup') return json({ error: 'POST required' }, 405);
    if ((path === '/' || path === '/index.html') && request.method === 'GET') return serveStudy(env);
    return json({ error: 'Not found' }, 404);
  },

  async scheduled(_event, env, context) {
    context.waitUntil(dispatchDueMessages(env));
  }
};
