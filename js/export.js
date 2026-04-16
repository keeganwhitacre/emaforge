let templates = {
  epatCore: null,
  studyBase: null
};

async function loadTemplates() {
  if (!templates.epatCore) templates.epatCore = await fetch('templates/epat-core.js').then(r => r.text());
  if (!templates.studyBase) templates.studyBase = await fetch('templates/study-base.js').then(r => r.text());
}

async function buildStudyHtml({ configInline, previewMode = false, previewSession: _ps }) {
  await loadTemplates();
  const cfg = buildConfig();
  const accent = cfg.study.accent_color;
  const accentHover = darkenHex(accent, 20);

  const configBlock = configInline
    ? `<script>window.__CONFIG__ = ${JSON.stringify(cfg)};<\/script>`
    : '';

  const configLoader = configInline
    ? `async function loadConfig() { return Promise.resolve(window.__CONFIG__); }`
    : `async function loadConfig() { const r = await fetch('config.json'); if (!r.ok) throw new Error('Could not load config.json'); return r.json(); }`;

  const patCoreBlock = cfg.tasks.includes('pat')
    ? `<script>\n${templates.epatCore}\n<\/script>`
    : '';

  const patScreenHtml = cfg.tasks.includes('pat') ? `
  <!-- ========== PAT SCREEN ========== -->
  <div class="screen" id="screen-pat">
    <div style="text-align:center;margin-bottom:20px">
      <h1>Cardiac Sensing</h1>
      <p style="color:var(--fg-muted);font-size:0.9rem">Place your finger firmly over the rear camera lens.</p>
    </div>
    <div style="position:relative;width:100%;max-width:320px;margin:0 auto;flex:1;display:flex;flex-direction:column;align-items:center;gap:16px">
      <video id="pat-video" autoplay playsinline muted style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px"></video>
      <canvas id="pat-canvas" style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px"></canvas>
      <div id="pat-status" style="font-size:0.9rem;color:var(--fg-muted);text-align:center;margin-top:20px">Initializing…</div>
      <div id="pat-bpm" style="font-size:2.5rem;font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums;min-height:60px;display:flex;align-items:center"></div>
      <div id="pat-trial-info" style="font-size:0.8rem;color:var(--fg-muted);text-align:center"></div>
    </div>
  </div>` : '';

  const patLogic = cfg.tasks.includes('pat') ? `
    // --- PAT SESSION ---
    async function startPATSession() {
      const core = window.ePATCore;
      if (!core) { show('screen-done'); return; }
      show('screen-pat');
      core.AudioEngine.init();
      await core.WakeLockCtrl.request();
      const video = document.getElementById('pat-video');
      const canvas = document.getElementById('pat-canvas');
      const statusEl = document.getElementById('pat-status');
      const bpmEl = document.getElementById('pat-bpm');
      const trialEl = document.getElementById('pat-trial-info');
      const patCfg = config.pat || {};
      const TARGET_TRIALS = patCfg.trials || 20;
      const RETRY_BUDGET  = patCfg.retry_budget || 30;
      const SQI_THRESH    = patCfg.sqi_threshold || 0.3;
      let validTrials = 0, attempts = 0, patData = [];
      statusEl.textContent = 'Waiting for finger…';
      try {
        await core.BeatDetector.start({
          video, canvas,
          onFingerChangeCb: fp => { statusEl.textContent = fp ? 'Finger detected — sensing…' : 'Place finger over camera'; },
          onBeatCb: b => { bpmEl.textContent = Math.round(b.averageBPM) + ' BPM'; },
          onSqiUpdateCb: sqi => { if (sqi < SQI_THRESH && validTrials < TARGET_TRIALS) statusEl.textContent = 'Signal weak — press firmly'; }
        });
        setTimeout(async () => {
          const diag = core.BeatDetector.getDiagnostics();
          patData.push({ type: 'pat_session', validTrials, attempts, diagnostics: diag });
          sessionData.pat = patData;
          await core.BeatDetector.stop();
          core.WakeLockCtrl.release();
          finalizeSession();
        }, (patCfg.trial_duration_sec || 30) * 1000 * Math.min(TARGET_TRIALS, 5));
      } catch(e) {
        statusEl.textContent = 'Camera error: ' + e.message;
        setTimeout(() => finalizeSession(), 3000);
      }
    }` : '';

  const expiryCheck = previewMode ? '' : `
    // Check URL expiry
    const tParam = params.get('t');
    const expiryMs = (config.ema.scheduling.timing?.expiry_minutes || 60) * 60 * 1000;
    if (tParam && (Date.now() - parseInt(tParam)) > expiryMs) {
      document.getElementById('study-title').textContent = 'Session Expired';
      document.getElementById('inst-label').textContent = 'This check-in link is no longer active.';
      document.getElementById('pid-btn').disabled = true;
      document.getElementById('pid-btn').textContent = 'Link expired';
      return;
    }`;

  const previewSessionForce = previewMode
    ? `const sessionId = "${_ps || 'afternoon'}";`
    : `const sessionId = params.get('session') || 'afternoon';`;

  const submitAction = previewMode
    ? `// Preview mode — no download, show completion inline
      document.getElementById('screen-done').querySelector('p').textContent = '✓ Preview complete. This is the end of the check-in.';
      show('screen-done');`
    : `sessionData.end_time = new Date().toISOString();
      const fmt = config.study.output_format || 'json';
      let blob, filename;
      if (fmt === 'csv') {
        const rows = [['participantID','session','question_id','response','timestamp_ms']];
        const qs = config.ema.questions;
        qs.forEach(q => { if (sessionData.responses[q.id] !== undefined) rows.push([sessionData.participantID, sessionId, q.id, sessionData.responses[q.id], sessionData.timestamps[q.id]||'']); });
        const csv = rows.map(r => r.map(v => JSON.stringify(v)).join(',')).join('\\n');
        blob = new Blob([csv], {type:'text/csv'});
        filename = 'ema_' + sessionData.participantID + '_' + sessionId + '_' + new Date().toISOString().slice(0,10) + '.csv';
      } else {
        blob = new Blob([JSON.stringify(sessionData, null, 2)], {type:'application/json'});
        filename = 'ema_' + sessionData.participantID + '_' + sessionId + '_' + new Date().toISOString().slice(0,10) + '.json';
      }
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
      show('screen-done');`;

  // Inject logic safely using replacement functions
  let studyJs = templates.studyBase;
  studyJs = studyJs.replace('// {{CONFIG_LOADER}}', () => configLoader);
  studyJs = studyJs.replace('// {{EXPIRY_CHECK}}', () => expiryCheck);
  studyJs = studyJs.replace('// {{PREVIEW_SESSION_FORCE}}', () => previewSessionForce);
  studyJs = studyJs.replace('// {{SUBMIT_ACTION}}', () => submitAction);
  studyJs = studyJs.replace('// {{PAT_LOGIC}}', () => patLogic);

  // Return the compiled HTML
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>${escH(cfg.study.name)}</title>
${configBlock}
${patCoreBlock}
<style>
/* Generated by EMA Studio schema v${SCHEMA_VERSION} */
:root {
  --bg: #0d1117; --bg-card: #161b22; --border: #30363d;
  --fg: #e6edf3; --fg-muted: #768390;
  --accent: ${accent}; --accent-hover: ${accentHover};
  --radius: 8px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; width: 100%; font-family: var(--font); background: var(--bg); color: var(--fg); overflow: hidden; touch-action: manipulation; -webkit-user-select: none; user-select: none; }
.screen { position: absolute; inset: 0; display: flex; flex-direction: column; padding: calc(env(safe-area-inset-top,24px) + 16px) 24px calc(env(safe-area-inset-bottom,24px) + 16px); opacity: 0; pointer-events: none; transition: opacity 0.25s ease; overflow-y: auto; }
.screen.active { opacity: 1; pointer-events: all; }
h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 6px; }
p { font-size: 0.95rem; line-height: 1.6; color: var(--fg-muted); margin-bottom: 12px; }
.label { font-size: 0.75rem; font-weight: 600; color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; display: block; }
.btn { display: inline-flex; align-items: center; justify-content: center; padding: 14px 24px; border-radius: var(--radius); border: none; cursor: pointer; font-family: var(--font); font-size: 1rem; font-weight: 600; -webkit-tap-highlight-color: transparent; transition: background 0.15s; }
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:active { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.4; pointer-events: none; }
.btn-block { width: 100%; }
.spacer { flex: 1; min-height: 16px; }
#screen-pid { justify-content: center; align-items: center; gap: 16px; text-align: center; }
.input-group { width: 100%; max-width: 320px; text-align: left; margin-bottom: 16px; }
.input-group input { width: 100%; padding: 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); color: var(--fg); font-family: var(--font); font-size: 1rem; outline: none; transition: border-color 0.15s; }
.input-group input:focus { border-color: var(--accent); }
.ema-header { text-align: center; margin-bottom: 20px; }
.study-sub { font-size: 0.8rem; color: var(--fg-muted); margin-top: 4px; }
.questions-wrap { display: flex; flex-direction: column; width: 100%; max-width: 340px; margin: 0 auto; flex: 1; }
.slider-group { width: 100%; margin-bottom: 28px; }
.slider-label { font-size: 0.95rem; font-weight: 500; color: var(--fg); margin-bottom: 12px; display: block; line-height: 1.4; }
.range-slider { -webkit-appearance: none; width: 100%; height: 6px; border-radius: 3px; outline: none; background: var(--border); margin: 8px 0 10px; }
.range-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 26px; height: 26px; border-radius: 50%; background: var(--accent); cursor: pointer; border: 2px solid var(--bg); }
.slider-labels { display: flex; justify-content: space-between; font-size: 0.72rem; font-weight: 500; color: var(--fg-muted); }
.choice-group { width: 100%; margin-bottom: 24px; }
.choice-options { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.choice-opt { padding: 12px 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-card); color: var(--fg); font-size: 0.95rem; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: border-color 0.15s, background 0.15s; text-align: left; font-family: var(--font); width: 100%; }
.choice-opt.selected { border-color: var(--accent); background: rgba(255,255,255,0.04); }
#screen-done { justify-content: center; align-items: center; text-align: center; gap: 12px; }
.done-icon { font-size: 48px; }
</style>
</head>
<body>

<div class="screen active" id="screen-pid">
  <div style="text-align:center;margin-bottom:28px">
    <h1 id="study-title">Loading…</h1>
    <div class="study-sub" id="inst-label"></div>
  </div>
  <div class="input-group">
    <label class="label">Participant ID</label>
    <input type="text" id="pid-input" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Enter your ID">
  </div>
  <button class="btn btn-primary" id="pid-btn" style="max-width:320px" disabled>Begin Check-In</button>
</div>

<div class="screen" id="screen-ema">
  <div class="ema-header">
    <h1 id="ema-greeting">Check-In</h1>
    <div class="study-sub" id="ema-sublabel"></div>
  </div>
  <div class="questions-wrap" id="questions-wrap"></div>
  <div style="flex-shrink:0;padding-top:12px;max-width:340px;width:100%;margin:0 auto">
    <button class="btn btn-primary btn-block" id="submit-btn" disabled>Submit Check-In</button>
  </div>
</div>

${patScreenHtml}

<div class="screen" id="screen-done">
  <div class="done-icon">✓</div>
  <h1>Check-In Complete</h1>
  <p>Your response has been recorded. Thank you.</p>
</div>

<script>
${studyJs}
<\/script>
</body>
</html>`;
}

document.getElementById('export-btn').addEventListener('click', () => document.getElementById('export-modal').classList.add('open'));
document.getElementById('modal-close-btn').addEventListener('click', () => document.getElementById('export-modal').classList.remove('open'));

document.getElementById('export-two-file').addEventListener('click', async () => {
  document.getElementById('export-modal').classList.remove('open');
  try {
    await loadScript('[https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js](https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js)');
    const zip = new JSZip();
    const html = await buildStudyHtml({ configInline: false, previewMode: false });
    zip.file('index.html', html);
    zip.file('config.json', JSON.stringify(buildConfig(), null, 2));
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, slugify(state.study.name) + '-study.zip');
  } catch(e) {
    const html = await buildStudyHtml({ configInline: false, previewMode: false });
    downloadBlob(new Blob([html], {type:'text/html'}), 'index.html');
    await new Promise(r => setTimeout(r, 300));
    downloadBlob(new Blob([JSON.stringify(buildConfig(),null,2)], {type:'application/json'}), 'config.json');
  }
});

document.getElementById('export-single-file').addEventListener('click', async () => {
  document.getElementById('export-modal').classList.remove('open');
  const html = await buildStudyHtml({ configInline: true, previewMode: false });
  downloadBlob(
    new Blob([html], {type:'text/html'}),
    slugify(state.study.name) + '-study.html'
  );
});

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}

function slugify(str) { return (str||'study').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
