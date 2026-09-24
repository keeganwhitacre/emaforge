// EMA Forge Cloudflare host: participant app + private R2 response storage.
const MAX_STUDY_BYTES = 10 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
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
    'Permissions-Policy': 'camera=(self), microphone=()'
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

async function serveStudy(env) {
  const study = await env.STUDY_DATA.get('study/current.html');
  if (!study) {
    return new Response(notInstalledHtml, { status: 503, headers: secureHeaders('text/html; charset=utf-8') });
  }
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
  const now = new Date().toISOString();
  const digest = await sha256(html);
  const versionKey = `study/versions/${now.replace(/[:.]/g, '-')}-${digest.slice(0, 12)}.html`;
  const options = {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
    customMetadata: { installedAt: now, digest }
  };
  await env.STUDY_DATA.put(versionKey, html, options);
  await env.STUDY_DATA.put('study/current.html', html, options);
  return json({ status: 'success', installed_at: now, digest, participant_url: new URL('/', request.url).toString() });
}

async function adminStatus(request, env) {
  if (!hasAdminAccess(request, env)) return json({ error: 'Unauthorized' }, 401);
  const [study, sessions] = await Promise.all([
    env.STUDY_DATA.head('study/current.html'),
    env.STUDY_DATA.list({ prefix: 'sessions/', limit: 1 })
  ]);
  return json({ installed: !!study, response_count_minimum: sessions.objects.length, has_more_responses: !!sessions.truncated });
}

async function exportResponses(request, env) {
  if (!hasAdminAccess(request, env)) return json({ error: 'Unauthorized' }, 401);
  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor') || undefined;
  const listed = await env.STUDY_DATA.list({ prefix: 'sessions/', limit: 1000, cursor });
  const lines = [];
  for (let offset = 0; offset < listed.objects.length; offset += 20) {
    const batch = listed.objects.slice(offset, offset + 20);
    const objects = await Promise.all(batch.map(item => env.STUDY_DATA.get(item.key)));
    for (const object of objects) if (object) lines.push(await object.text());
  }
  const headers = secureHeaders('application/x-ndjson; charset=utf-8');
  headers['Content-Disposition'] = 'attachment; filename="ema-forge-responses.ndjson"';
  headers['X-EMA-Truncated'] = String(!!listed.truncated);
  if (listed.cursor) headers['X-EMA-Next-Cursor'] = listed.cursor;
  return new Response(lines.join('\n') + (lines.length ? '\n' : ''), { headers });
}

const adminHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EMA Forge study setup</title><style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#18202a;background:#f7f7f4}*{box-sizing:border-box}body{margin:0;padding:40px 20px}main{max-width:680px;margin:auto}h1{font-family:Georgia,serif;font-size:2rem;margin:0 0 8px}p{color:#59626c;line-height:1.55}.panel{background:#fff;border:1px solid #cfd4d8;border-top:3px solid #a53c30;padding:22px;margin:22px 0}.field{display:grid;gap:7px;margin:16px 0}label{font-weight:650;font-size:.86rem}input{width:100%;padding:12px;border:1px solid #aeb5bb;border-radius:3px;font:inherit}button,a.button{display:inline-flex;align-items:center;justify-content:center;padding:11px 15px;border-radius:3px;border:1px solid #92352b;background:#a53c30;color:white;font-weight:650;text-decoration:none;cursor:pointer}button.secondary{background:white;color:#29323b;border-color:#aeb5bb}.actions{display:flex;gap:10px;flex-wrap:wrap}.status{min-height:1.5em;margin-top:12px;font-size:.9rem;color:#59626c}.quiet{font-size:.82rem;border-top:1px solid #e0e3e5;padding-top:14px}.ok{color:#22734f}.error{color:#a02f25}</style></head>
<body><main><h1>EMA Forge study setup</h1><p>Install the study file generated in EMA Forge. Your token and study go directly to this Worker in your Cloudflare account.</p>
<section class="panel"><div class="field"><label for="token">Admin token</label><input id="token" type="password" autocomplete="current-password" placeholder="Token set during deployment"></div>
<div class="field"><label for="study">Prepared study HTML</label><input id="study" type="file" accept=".html,text/html"></div>
<div class="actions"><button id="install">Install study</button><button class="secondary" id="status">Check status</button><button class="secondary" id="export">Download responses</button></div><div id="message" class="status" role="status"></div>
<p class="quiet">The token is kept only in this browser tab. Response downloads are NDJSON, one complete submission per line. Larger studies may require multiple export parts.</p></section></main>
<script>
const token=document.getElementById('token');const file=document.getElementById('study');const message=document.getElementById('message');let cursor='';let part=1;
function auth(){return {'Authorization':'Bearer '+token.value}}function say(text,ok){message.textContent=text;message.className='status '+(ok?'ok':'error')}
document.getElementById('install').onclick=async()=>{if(!token.value||!file.files[0]){say('Enter the deployment token and choose the prepared study file.',false);return}say('Installing…',true);const response=await fetch('/admin/install',{method:'POST',headers:{...auth(),'Content-Type':'text/html'},body:await file.files[0].text()});const result=await response.json();if(!response.ok){say(result.error||'Installation failed.',false);return}say('Installed. Participant URL: '+result.participant_url,true)};
document.getElementById('status').onclick=async()=>{const response=await fetch('/admin/status',{headers:auth()});const result=await response.json();if(!response.ok){say(result.error||'Status check failed.',false);return}say(result.installed?'Study installed; storage is reachable.':'No study installed yet.',result.installed)};
document.getElementById('export').onclick=async()=>{const path='/admin/export'+(cursor?'?cursor='+encodeURIComponent(cursor):'');const response=await fetch(path,{headers:auth()});if(!response.ok){const result=await response.json();say(result.error||'Export failed.',false);return}const blob=await response.blob();const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='ema-forge-responses-part-'+part+'.ndjson';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);cursor=response.headers.get('X-EMA-Next-Cursor')||'';part++;say(cursor?'Export part downloaded. Click again for the next part.':'Response export downloaded.',true)};
</script></body></html>`;

const notInstalledHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EMA Forge setup required</title></head><body style="font-family:system-ui;max-width:620px;margin:12vh auto;padding:24px;color:#18202a"><h1>Study setup required</h1><p>This EMA Forge host is running, but no study has been installed.</p><p><a href="/admin">Open protected study setup</a></p></body></html>`;

const checkHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EMA Forge connection check</title></head><body style="font-family:system-ui;max-width:620px;margin:10vh auto;padding:24px;color:#18202a"><h1>Connection check</h1><p>This sends a clearly labeled synthetic record to the private study bucket.</p><button id="send" style="padding:12px 16px">Send test submission</button><pre id="result" style="white-space:pre-wrap"></pre><script>document.getElementById('send').onclick=async()=>{const id='setup_'+Date.now();const payload={test:true,submission_id:id,participant_id:'ema-forge-setup-test',day:null,window_id:'setup-test',session_data:{sessionId:id,participantId:'ema-forge-setup-test',day:null,data:[]}};const response=await fetch('/submit',{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});document.getElementById('result').textContent=JSON.stringify(await response.json(),null,2)};<\/script></body></html>`;

export default {
  async fetch(request, env) {
    if (!env.STUDY_DATA) return json({ error: 'R2 binding is missing' }, 503);
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/admin') return new Response(adminHtml, { headers: secureHeaders('text/html; charset=utf-8') });
    if (path === '/admin/install' && request.method === 'POST') return installStudy(request, env);
    if (path === '/admin/status' && request.method === 'GET') return adminStatus(request, env);
    if (path === '/admin/export' && request.method === 'GET') return exportResponses(request, env);
    if (path.startsWith('/admin/')) return json({ error: 'Not found' }, 404);
    if (path === '/health') return json({ status: 'ok', study_installed: !!(await env.STUDY_DATA.head('study/current.html')) });
    if (path === '/check.html') return new Response(checkHtml, { headers: secureHeaders('text/html; charset=utf-8') });
    if (path === '/submit' && request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin');
      if (origin !== url.origin) return json({ error: 'Study origin is not allowed' }, 403);
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' } });
    }
    if (path === '/submit' && request.method === 'POST') return storeSubmission(request, env, request.headers.get('Origin'));
    if (path === '/submit') return json({ error: 'POST required' }, 405);
    if ((path === '/' || path === '/index.html') && request.method === 'GET') return serveStudy(env);
    return json({ error: 'Not found' }, 404);
  }
};
