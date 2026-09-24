// EMA Forge reference receiver for a private Cloudflare R2 bucket.
// Deploy one Worker and bucket per study. The public upload URL is not a secret.
const MAX_BYTES = 5 * 1024 * 1024;
const textEncoder = new TextEncoder();

async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function reply(body, status, origin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function validRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const { submission_id: id, participant_id: pid, day, window_id: windowId, session_data: session } = record;
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{6,120}$/.test(id) &&
    typeof pid === 'string' && pid.length > 0 && pid.length <= 128 &&
    (day === null || (Number.isInteger(day) && day >= 0 && day <= 10000)) &&
    typeof windowId === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(windowId) &&
    session && typeof session === 'object' && !Array.isArray(session) &&
    session.sessionId === id && String(session.participantId) === pid &&
    session.day === day &&
    (record.test !== true || (pid === 'ema-forge-setup-test' && windowId === 'setup-test'));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
    if (!env.STUDY_DATA || !allowed.length) return reply({ error: 'Receiver setup incomplete' }, 503);
    if (!origin || !allowed.includes(origin)) return reply({ error: 'Study origin is not allowed' }, 403);

    const path = new URL(request.url).pathname;
    if (path !== '/submit') return reply({ error: 'Not found' }, 404, origin);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin'
      } });
    }
    if (request.method !== 'POST') return reply({ error: 'POST required' }, 405, origin);

    const length = Number(request.headers.get('Content-Length'));
    if (Number.isFinite(length) && length > MAX_BYTES) return reply({ error: 'Submission too large' }, 413, origin);
    let raw, record;
    try {
      raw = await request.text();
      if (textEncoder.encode(raw).byteLength > MAX_BYTES) return reply({ error: 'Submission too large' }, 413, origin);
      record = JSON.parse(raw);
    } catch (_) {
      return reply({ error: 'Invalid JSON' }, 400, origin);
    }
    if (!validRecord(record)) return reply({ error: 'Invalid submission' }, 400, origin);

    const test = record.test === true;
    const key = `${test ? 'setup-tests' : 'sessions'}/${record.submission_id}.json`;
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
      // R2 evaluates this precondition atomically; retrying cannot overwrite an earlier response.
      const saved = await env.STUDY_DATA.put(key, storedRecord, {
        onlyIf: new Headers({ 'If-None-Match': '*' }),
        httpMetadata: { contentType: 'application/json' },
        customMetadata: metadata
      });
      if (saved) return reply({ status: 'success', submission_id: record.submission_id, stored: true, duplicate: false, received_at: receivedAt }, 200, origin);
      const existing = await env.STUDY_DATA.head(key);
      if (!existing) return reply({ error: 'Unable to confirm storage' }, 503, origin);
      const previous = existing.customMetadata || {};
      if (previous.participant !== metadata.participant || previous.day !== metadata.day || previous.window !== metadata.window) {
        return reply({ error: 'Submission ID already used for another session' }, 409, origin);
      }
      if (previous.digest !== metadata.digest) return reply({ error: 'Submission ID already used with different data' }, 409, origin);
      return reply({ status: 'success', submission_id: record.submission_id, stored: true, duplicate: true, received_at: previous.receivedAt || null }, 200, origin);
    } catch (_) {
      // Never claim success when the storage provider throws or cannot confirm a write.
      return reply({ error: 'Storage unavailable; keep a local copy' }, 503, origin);
    }
  }
};
