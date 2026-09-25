"use strict";

// ==========================================================
// EMA Forge — study-base.js (runtime)
// v1.4.0
// ==========================================================
//
// Changes from v1.3:
//
// SESSION FLOW:
//   - Router consumes config.ema.scheduling.windows[i].phase_sequence.
//   - phase_sequence is an ordered array of:
//       { kind: "ema", id: "s_...", question_ids: ["q_..."] }
//       { kind: "task", id: "epat" | "stroop" | ... }
//   - Multiple tasks per session are now a pure schema concern — the router
//     just walks the array.
//
// RESUME (study.resume_enabled):
//   - After every phase transition (advancePhase) and at finalizeSession,
//     we write sessionData to localStorage under a resume key built from
//     (pid, day, sessionId-in-url). On load, if there's a saved state and
//     status is "in_progress", we show a resume dialog: continue or restart.
//   - Resume skips completed phases and picks up at sessionData.currentPhase.
//     In-progress phase state (mid-EMA page, mid-trial) is NOT persisted —
//     participants restart the current phase. This is the defensible boundary:
//     resuming mid-trial for ePAT would require serialising PPG state which
//     is too fragile. The phase restarts; the already-completed phases
//     (and their data) survive.
//
// COMPLETION LOCK (study.completion_lock):
//   - On finalizeSession, we stamp a completion record keyed on
//     (pid, day, urlSession). On load, if a completion already exists,
//     the start button is disabled and the screen explains why. Can be
//     bypassed by adding ?force=1 to the URL (for researcher testing).
//
// THEME HOT-LOAD (static bundle fix):
//   - Runtime reads config.study.theme + accent_color and injects CSS
//     variables into :root. This means the static-hosting bundle can
//     change theme by editing config.json without re-exporting. For the
//     single-file export, the CSS is already baked in, so this is a no-op.
//
// KNOWN-GOOD FROM v1.3 (preserved):
//   - Per-question response latency (emaResponses.responses[qid].respondedAt)
//   - CSV as default output
//   - Explicit module dispatch switch
//   - Session output JSON/CSV contract
// ==========================================================

// {{CONFIG_LOADER}}

const isPreview = window.__PREVIEW_MODE__ === true;

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function evalCond(cond, responses) {
  return EMAForgeRuntimeUtils.evaluateCondition(cond, responses);
}

// Dial tick generation for ePAT visual aesthetics
(function generateTicks() {
  const containers = ['rotary-dial-ticks', 'training-dial-ticks'];
  containers.forEach(cid => {
    const c = document.getElementById(cid);
    if (!c) return;
    const isTrain = cid.includes('training');
    const total = isTrain ? 60 : 72;
    for (let i = 0; i < total; i++) {
      const t = document.createElement('div');
      t.className = isTrain ? 'training-tick' : 'dial-tick';
      t.style.transform = `rotate(${i * (360 / total)}deg)`;
      if (i % 2 === 0) t.style.height = isTrain ? '8px' : '10px';
      if (i % (total / 4) === 0) { t.style.height = isTrain ? '12px' : '14px'; t.style.background = 'var(--fg-muted)'; }
      c.appendChild(t);
    }
  });
})();

// ==========================================================
// RESUME MANAGER
// ----------------------------------------------------------
// Keyed on a string built from pid + day + the session param from the URL.
// Not the runtime-generated sessionData.sessionId, because that changes on
// every reload — we want a stable key so reloads after a crash actually
// find the saved state.
// ==========================================================
const ResumeManager = {
  _prefix: 'ema_studio_resume_v1__',

  _key(pid, day, urlSession) {
    return this._prefix + [pid || 'anon', day || '0', urlSession || 'default'].join('|');
  },

  save(pid, day, urlSession, sessionData) {
    if (isPreview) return;
    try {
      localStorage.setItem(this._key(pid, day, urlSession), JSON.stringify(sessionData));
    } catch (e) {
      // Quota exceeded — most likely ePAT signal data from prior sessions.
      // Fail silently; losing resume capability is better than crashing.
      console.warn('ResumeManager.save failed:', e);
    }
  },

  load(pid, day, urlSession) {
    if (isPreview) return null;
    try {
      const raw = localStorage.getItem(this._key(pid, day, urlSession));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  clear(pid, day, urlSession) {
    try { localStorage.removeItem(this._key(pid, day, urlSession)); } catch (e) { }
  }
};

// ==========================================================
// COMPLETION LOCK
// ----------------------------------------------------------
// One completed session per (pid, day, urlSession). Client-side only —
// a participant switching phones or clearing browser data bypasses this,
// which is the best you can do without a server. For most EMA use cases
// that's fine: the scenario you actually care about is the participant
// accidentally opening the same link twice in a row.
// ==========================================================
const CompletionLock = {
  _prefix: 'ema_studio_done_v1__',

  _key(pid, day, urlSession) {
    return this._prefix + [pid || 'anon', day || '0', urlSession || 'default'].join('|');
  },

  isLocked(pid, day, urlSession) {
    if (isPreview) return false;
    try {
      return !!localStorage.getItem(this._key(pid, day, urlSession));
    } catch (e) { return false; }
  },

  stamp(pid, day, urlSession) {
    if (isPreview) return;
    try {
      localStorage.setItem(this._key(pid, day, urlSession), new Date().toISOString());
    } catch (e) { }
  }
};

// Completed sessions remain recoverable until either the webhook acknowledges
// storage or the participant explicitly saves the canonical local record.
const SubmissionManager = {
  _prefix: 'ema_forge_pending_submission_v1__',

  _key(pid, day, urlSession) {
    return this._prefix + [pid || 'anon', day || '0', urlSession || 'default'].join('|');
  },

  save(pid, day, urlSession, sessionData) {
    if (isPreview) return false;
    try {
      localStorage.setItem(this._key(pid, day, urlSession), JSON.stringify(sessionData));
      return true;
    } catch (error) {
      console.warn('SubmissionManager.save failed:', error);
      return false;
    }
  },

  load(pid, day, urlSession) {
    if (isPreview) return null;
    try {
      const raw = localStorage.getItem(this._key(pid, day, urlSession));
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  },

  clear(pid, day, urlSession) {
    try { localStorage.removeItem(this._key(pid, day, urlSession)); } catch (error) { }
  }
};

// ==========================================================
// THEME HOT-LOAD (for static bundle re-themeing via config.json edits)
// ==========================================================
function applyThemeFromConfig(cfg) {
  // Only needed for the static bundle case where CSS is a separate file
  // with baked theme vars. The single-file export already has the right
  // vars inlined, so this is a no-op overwrite with the same values.
  // Runs before any screen renders so there's no flash.
  const study = cfg.study || {};
  const accent = study.accent_color || '#e8716a';
  const theme = study.theme || 'oled';

  const root = document.documentElement.style;
  root.setProperty('--accent', accent);

  // These color sets duplicate export.js getThemeCSS — kept in sync by hand.
  // If you change one, change the other.
  if (theme === 'light') {
    root.setProperty('--bg', '#f9f9fb');
    root.setProperty('--bg-surface', '#ffffff');
    root.setProperty('--bg-elevated', '#f0f0f4');
    root.setProperty('--border', '#e0e0e5');
    root.setProperty('--fg', '#1c1c1e');
    root.setProperty('--fg-muted', '#8e8e93');
  } else if (theme === 'dark') {
    root.setProperty('--bg', '#121212');
    root.setProperty('--bg-surface', '#1e1e1e');
    root.setProperty('--bg-elevated', '#2d2d2d');
    root.setProperty('--border', '#3d3d3d');
    root.setProperty('--fg', '#e0e0e0');
    root.setProperty('--fg-muted', '#9e9e9e');
  } else {
    root.setProperty('--bg', '#000000');
    root.setProperty('--bg-surface', '#111111');
    root.setProperty('--bg-elevated', '#1c1c1e');
    root.setProperty('--border', '#2c2c2e');
    root.setProperty('--fg', '#ffffff');
    root.setProperty('--fg-muted', '#8e8e93');
  }
}

// ==========================================================
// UPLOAD (unchanged from v1.3 apart from the filename date fix)
// ==========================================================
const Upload = {

  _slugify(str) {
    return (str || 'study').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  },

  _downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  _toNumeric(val) {
    if (val === null || val === undefined || val === '') return '';
    if (Array.isArray(val)) return '';
    const n = Number(val);
    return Number.isFinite(n) ? n : '';
  },

  _serializeValue(val) {
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) return val.join(';');
    // Affect-grid values are {valence, arousal} objects — serialize as "v;a"
    if (val && typeof val === 'object' && 'valence' in val && 'arousal' in val) {
      return `${val.valence};${val.arousal}`;
    }
    if (val && typeof val === 'object' && 'status' in val &&
        ['classified', 'declined', 'permission_denied', 'unavailable', 'outside_study_area', 'uncertain_boundary', 'uncertain_accuracy', 'service_unavailable'].includes(val.status)) {
      return JSON.stringify(val);
    }
    return String(val);
  },

  _csvEscape(val) {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  },

  _buildQuestionIndex(cfg) {
    const idx = {};
    (cfg.ema?.questions || []).forEach(q => {
      if (q.type !== 'page_break' && q.type !== 'instruction') idx[q.id] = q;
    });
    return idx;
  },

  _buildEmaCsv(sessionData, cfg) {
    const qIdx = this._buildQuestionIndex(cfg);
    const windows = cfg.ema?.scheduling?.windows || [];
    const header = [
      'schema_version', 'study_name', 'participant_id', 'session_id',
      'session_type', 'day', 'window_id', 'window_label', 'block',
      'session_started_at', 'session_submitted_at',
      'phase_started_at', 'phase_submitted_at',
      'question_id', 'question_text', 'question_type',
      'presentation_order', 'response_status', 'skip_reason',
      'response_value', 'response_numeric', 'response_latency_ms'
    ];

    const rows = [];
    const emaEntries = (sessionData.data || []).filter(e => e && e.type === 'ema_response');

    emaEntries.forEach(entry => {
      const wId = entry.windowId || '';
      const wCfg = windows.find(w => w.id === wId);
      const wLabel = wCfg ? wCfg.label : '';
      const phaseStart = entry.startedAt || '';
      const phaseSubmit = entry.submittedAt || '';
      const phaseStartMs = phaseStart ? Date.parse(phaseStart) : null;

      const presented = entry.presentationOrder ? entry.presentationOrder.flat() : [];
      const eligible = Array.isArray(entry.eligibleQuestionIds) && entry.eligibleQuestionIds.length
        ? entry.eligibleQuestionIds
        : Array.from(new Set([...presented, ...Object.keys(entry.responses || {})]));

      eligible.forEach(qid => {
        const rec = (entry.responses || {})[qid];
        const q = qIdx[qid] || {};
        const rawVal = (rec && typeof rec === 'object' && 'value' in rec) ? rec.value : rec;
        const respAt = (rec && typeof rec === 'object') ? rec.respondedAt : null;
        const latency = (phaseStartMs && respAt) ? (Date.parse(respAt) - phaseStartMs) : '';

        // Flatten the 2D layout and find exactly where this question appeared
        let presOrder = '';
        if (entry.presentationOrder) {
          const idx = presented.indexOf(qid);
          if (idx !== -1) presOrder = idx + 1; // 1-indexed for easy reading
        }
        const skip = (entry.skippedQuestions || []).find(item => item.questionId === qid);
        const answered = rec !== undefined && rawVal !== undefined && rawVal !== null && rawVal !== '';
        const responseStatus = skip && !presented.includes(qid)
          ? 'skipped_condition'
          : (answered ? 'answered' : 'unanswered');

        rows.push([
          sessionData.schemaVersion || '',
          sessionData.studyName || '',
          sessionData.participantId,
          sessionData.sessionId,
          sessionData.type,
          sessionData.day ?? '',
          wId,
          wLabel,
          entry.block || '',
          sessionData.startedAt || '',
          sessionData.completedAt || '',
          phaseStart,
          phaseSubmit,
          qid,
          q.text || '',
          q.type || '',
          presOrder,
          responseStatus,
          skip?.reason || '',
          Upload._serializeValue(rawVal),
          Upload._toNumeric(rawVal),
          latency
        ]);
      });
    });

    return { header, rows };
  },

  _csvString({ header, rows }) {
    const esc = this._csvEscape.bind(this);
    const lines = [header.map(esc).join(',')];
    rows.forEach(r => lines.push(r.map(esc).join(',')));
    return lines.join('\n');
  },

  send(sessionData, cb) {
    if (isPreview) { if (cb) cb(); return; }

    const cfg = (typeof config !== 'undefined') ? config : {};
    const format = cfg.study?.output_format || 'csv';
    const slug = this._slugify(cfg.study?.name);
    const pid = sessionData.participantId || 'unknown';
    const sid = sessionData.sessionId;
    const date = new Date().toISOString().slice(0, 10);
    const base = `${slug}_${pid}_${date}_${sid}`;

    const shouldEmitCsv = format === 'csv';

    if (shouldEmitCsv) {
      const csv = this._csvString(this._buildEmaCsv(sessionData, cfg));
      this._downloadBlob(
        new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
        `${base}_ema.csv`
      );
    }

    // JSON is the canonical, lossless research record. CSV is an optional
    // analysis-friendly companion and must never be the only copy of a
    // completed physiological or experimental session.
    this._downloadBlob(
      new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' }),
      `${base}.json`
    );

    if (cb) cb();
  }
};

function collectDeviceMetadata() {
  const ua = navigator.userAgent;
  const parsed = EMAForgeRuntimeUtils.parseUserAgentMetadata(ua);

  return {
    userAgent: ua, ...parsed,
    screenWidth: screen.width, screenHeight: screen.height,
    devicePixelRatio: window.devicePixelRatio || 1, platform: navigator.platform || ''
  };
}

// ==========================================================
// MAIN RUNTIME EXECUTOR
// ==========================================================
(async function () {
  const config = await loadConfig();

  // Apply theme first so there's no flash of wrong-themed screen
  applyThemeFromConfig(config);

  const params = new URLSearchParams(window.location.search);

  document.getElementById('study-title').textContent = config.study.name || 'Study';
  document.getElementById('task-subtitle').textContent = config.study.institution || '';

  // {{EXPIRY_CHECK}}
  // {{PREVIEW_SESSION_FORCE}}

  const pidInput = document.getElementById('pid-input');
  const startBtn = document.getElementById('start-btn');

  // Stable URL-derived identifiers for resume + completion lock.
  // These are set before any session starts so we can check locks upfront.
  const urlPid = (params.get('id') || '').trim();
  const urlDay = params.get('day') || '';
  const urlSession = sessionId;
  const forceOverride = params.get('force') === '1';

  if (urlPid) {
    pidInput.value = urlPid;
    document.getElementById('participant-input-group').style.display = 'none';
  }
  if (urlDay) {
    const dl = document.getElementById('day-label');
    dl.textContent = `Day ${urlDay}`;
    dl.style.display = 'block';
  }
  pidInput.addEventListener('input', () => { startBtn.disabled = !pidInput.value.trim(); });

  // Enable the start button whenever there's a usable PID, covering all cases:
  //   1. URL supplied ?id=  (real participant link)
  //   2. Preview mode       (no URL params, no one typing)
  //   3. ?session=onboarding (PID collected later during consent)
  if (pidInput.value.trim() || isPreview || sessionId === 'onboarding') {
    if (isPreview) pidInput.value = pidInput.value.trim() || 'preview';
    document.getElementById('participant-input-group').style.display = 'none';
    startBtn.disabled = false;
  }

  // ---------------------------------------------------------------
  // COMPLETION LOCK CHECK (before anything else)
  // ---------------------------------------------------------------
  if (config.study?.completion_lock && !forceOverride && urlPid) {
    if (CompletionLock.isLocked(urlPid, urlDay, urlSession)) {
      document.getElementById('task-subtitle').textContent = 'Already Completed';
      const dayLabel = document.getElementById('day-label');
      if (dayLabel) { dayLabel.textContent = 'Thank you'; dayLabel.style.display = 'block'; }
      startBtn.disabled = true;
      startBtn.textContent = 'Session already submitted';
      document.getElementById('participant-input-group').style.display = 'none';
      return;
    }
  }

  // ---------------------------------------------------------------
  // Build a fresh sessionData template. The router below populates
  // .type, .phases, and .counterbalance.
  // ---------------------------------------------------------------
  let sessionData = {
    schemaVersion: config.schema_version || '',
    studyName: config.study?.name || '',
    sessionId: "ses_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    participantId: urlPid,
    day: parseInt(urlDay) || null,
    type: "",
    phases: [],
    phasePlan: [],
    currentPhase: 0,
    counterbalance: null,
    startedAt: null,
    completedAt: null,
    device: null,
    data: [],
    status: "in_progress"
  };
  const activeResponseWindowPolicy = typeof responseWindowPolicy !== 'undefined'
    ? responseWindowPolicy
    : { enforced: false, sentAtMs: null, expiresAtMs: null, graceUntilMs: null };
  const pendingSubmission = SubmissionManager.load(urlPid, urlDay, urlSession);

  const cbParam = params.get('cb');
  const dynamicWindows = config.ema?.scheduling?.windows || [];
  const enabledModules = config.modules || {};

  // ---------------------------------------------------------------
  // Run the ordered session flow authored in the builder.
  // ---------------------------------------------------------------
  let runtimePhasePlan = [];

  if (sessionId === 'onboarding') {
    sessionData.type = "onboarding";
    document.getElementById('task-subtitle').textContent = "Study Setup";
  } else {
    const w = dynamicWindows.find(win => win.id === sessionId);

    if (!w) {
      sessionData.type = "error";
      document.getElementById('task-subtitle').textContent = "Invalid Session";
      startBtn.disabled = true;
      startBtn.textContent = 'Session not found';
      return;
    } else {
      runtimePhasePlan = EMAForgeRuntimeUtils.buildPhasePlan(w, enabledModules);

      // Counterbalancing: swap first pair if the window has both a survey
      // and a task, and cb=task_first was requested. Kept narrow-scope — if you
      // need arbitrary permutations you'd edit phase_sequence directly in config.
      if (cbParam && runtimePhasePlan.length >= 2) {
        const firstIsPre = runtimePhasePlan[0].kind === 'ema';
        const secondIsTask = runtimePhasePlan[1].kind === 'task';
        if (firstIsPre && secondIsTask) {
          const wantTaskFirst = (cbParam === 'task_first') ||
            (cbParam === 'pat_first' && runtimePhasePlan[1].moduleId === 'epat');
          if (wantTaskFirst) {
            [runtimePhasePlan[0], runtimePhasePlan[1]] = [runtimePhasePlan[1], runtimePhasePlan[0]];
            sessionData.counterbalance = 'task_first';
          } else {
            sessionData.counterbalance = 'pre_first';
          }
        }
      }

      // Categorize session type for downstream analyses.
      const hasTask = runtimePhasePlan.some(phase => phase.kind === 'task');
      const hasSurvey = runtimePhasePlan.some(phase => phase.kind === 'ema');
      sessionData.type = hasTask ? (hasSurvey ? "ema_with_task" : "task_only") : "ema_only";
      sessionData.phases = runtimePhasePlan.map(phase => phase.token);
      sessionData.phasePlan = runtimePhasePlan;

      document.getElementById('task-subtitle').textContent = w.label || 'Check-In';
    }
  }

  // Dynamic greeting based on window id
  const greetings = config.study?.greetings || {};
  const matchedWindow = dynamicWindows.find(w => w.id === sessionId);
  const greetingText = greetings[sessionId]
    || (matchedWindow ? matchedWindow.label : 'Check-In');
  const greetingEl = document.getElementById('ema-greeting');
  if (greetingEl) greetingEl.textContent = greetingText;

  // ---------------------------------------------------------------
  // RESUME CHECK (offer to continue if a prior in-progress session exists)
  // ---------------------------------------------------------------
  let resumeOffer = null;
  if (config.study?.resume_enabled && !isPreview && urlPid) {
    const saved = ResumeManager.load(urlPid, urlDay, urlSession);
    if (saved && saved.status === 'in_progress' && Array.isArray(saved.phases) && saved.phases.length) {
      // Validate that the saved phase list is still consistent with the current
      // config. If phases array differs (config was re-exported with different
      // structure), we refuse to resume — start over is safer.
      const sameShape = JSON.stringify(saved.phases) === JSON.stringify(sessionData.phases);
      if (sameShape && typeof saved.currentPhase === 'number' && saved.currentPhase < saved.phases.length) {
        resumeOffer = saved;
      } else {
        ResumeManager.clear(urlPid, urlDay, urlSession);
      }
    }
  }

  // {{MODULES_INJECT}}
  let deliveryInFlight = false;

  // A prior attempt completed but was never acknowledged. Restore the exact
  // immutable record and retry delivery instead of asking the participant to
  // repeat an assessment or silently locking them out.
  if (pendingSubmission && pendingSubmission.sessionId) {
    sessionData = pendingSubmission;
    runtimePhasePlan = Array.isArray(sessionData.phasePlan) ? sessionData.phasePlan : [];
    deliverCompletedSession();
    return;
  }

  // ---------------------------------------------------------------
  // START handler — either fresh start or resume
  // ---------------------------------------------------------------
  function doStart(resuming) {
    if (!resuming && !EMAForgeRuntimeUtils.canStartResponseWindow(activeResponseWindowPolicy, Date.now())) {
      document.getElementById('task-subtitle').textContent = 'Link Expired';
      startBtn.disabled = true;
      startBtn.textContent = 'Session no longer active';
      return;
    }
    if (!resuming) {
      sessionData.participantId = pidInput.value.trim();
      sessionData.startedAt = new Date().toISOString();
      sessionData.device = collectDeviceMetadata();
      if (activeResponseWindowPolicy.enforced) {
        sessionData.responseWindow = {
          sentAt: new Date(activeResponseWindowPolicy.sentAtMs).toISOString(),
          expiresAt: new Date(activeResponseWindowPolicy.expiresAtMs).toISOString(),
          graceUntil: new Date(activeResponseWindowPolicy.graceUntilMs).toISOString(),
          startedBeforeExpiry: true
        };
      }
    } else {
      // Adopt the resumed state, but stamp a new device record in case
      // they switched devices (keep the original too).
      Object.assign(sessionData, resumeOffer);
      sessionData.resumedAt = new Date().toISOString();
      const freshDevice = collectDeviceMetadata();
      if (sessionData.device && sessionData.device.userAgent !== freshDevice.userAgent) {
        sessionData.deviceOnResume = freshDevice;
      }
    }

    if (window.ePATCore) window.ePATCore.AudioEngine.init();

    // Persist immediately so a crash between start and first advancePhase
    // still has something to resume from.
    persistResumeState();

    if (sessionData.type === 'onboarding' && config.onboarding?.enabled) {
      OnboardingSession.start();
    } else {
      runNextPhase();
    }
  }

  function persistResumeState() {
    if (!config.study?.resume_enabled) return;
    ResumeManager.save(urlPid, urlDay, urlSession, sessionData);
  }

  // If we have a resume offer, surface it by repurposing the start button
  // and adding a "start over" link under it.
  if (resumeOffer) {
    startBtn.textContent = 'Resume Session';
    startBtn.disabled = false;
    // Add a small "start over" option next to/under the button.
    const inputGroup = document.getElementById('participant-input-group');
    const hint = document.createElement('button');
    hint.textContent = 'Start over';
    hint.style.cssText = 'margin-top:12px;background:none;border:none;color:var(--fg-muted);font-size:0.85rem;text-decoration:underline;cursor:pointer;';
    hint.addEventListener('click', () => {
      ResumeManager.clear(urlPid, urlDay, urlSession);
      resumeOffer = null;
      startBtn.textContent = 'Begin Session';
      hint.remove();
    });
    if (startBtn.parentNode) startBtn.parentNode.appendChild(hint);
  }

  startBtn.addEventListener('click', () => {
    doStart(!!resumeOffer);
  });

  // ---------------------------------------------------------------
  // PHASE DISPATCH — v1.4: token shape determines handler.
  //   "survey_<wid>" / "survey2_<wid>" → EMA.start(token, phasePlan)
  //   "<moduleId>"                → dispatch via explicit module switch
  // ---------------------------------------------------------------
  function runNextPhase() {
    if (isResponseWindowExpired()) { expireResponseWindow(); return; }
    const phase = sessionData.phases[sessionData.currentPhase];
    if (!phase) { finalizeSession(); return; }

    const phasePlan = runtimePhasePlan[sessionData.currentPhase] || { token: phase };
    if (phasePlan.kind === 'task' && phasePlan.condition) {
      const responses = EMAForgeRuntimeUtils.collectResponses(sessionData.data);
      if (!evalCond(phasePlan.condition, responses)) {
        sessionData.data.push({
          type: 'phase_event',
          phase: phase,
          stepIndex: phasePlan.stepIndex,
          status: 'skipped',
          reason: 'condition_false',
          condition: phasePlan.condition,
          evaluatedAt: new Date().toISOString()
        });
        advancePhase();
        return;
      }
    }

    if (EMAForgeRuntimeUtils.parseEmaPhaseToken(phase)) {
      EMA.start(phase, phasePlan);
      return;
    }

    switch (phase) {
      case 'epat':
        if (config.modules?.epat && window.ePATCore && typeof ePAT !== 'undefined') {
          ePAT.startBaseline();
        } else {
          console.warn('ePAT phase requested but module/core not available; skipping.');
          advancePhase();
        }
        break;

      case 'hct':
        if (config.modules?.hct && window.ePATCore && typeof HCT !== 'undefined') {
          HCT.startBaseline();
        } else {
          console.warn('HCT phase requested but module/core not available; skipping.');
          advancePhase();
        }
        break;
 
      case 'iat':
        if (config.modules?.iat && typeof IAT !== 'undefined') {
          IAT.start();
        } else {
          console.warn('IAT phase requested but module not available; skipping.');
          advancePhase();
        }
        break;
 
      // Future modules register here. Example:
      // case 'stroop':
      //   if (config.modules?.stroop && typeof Stroop !== 'undefined') Stroop.start();
      //   else advancePhase();
      //   break;

      default:
        if (phase.startsWith('hr:')) {
          const [, storeAs, durStr] = phase.split(':');
          const durationSec = parseInt(durStr) || 30;
          if (typeof HRCapture !== 'undefined') {
            HRCapture.start(storeAs, durationSec);
          } else {
            console.warn('HR capture requested but HRCapture module not available; skipping.');
            advancePhase();
          }
          break;
        }
        console.warn(`Unknown phase token: ${phase}. Skipping.`);
        advancePhase();
    }
  }

  function advancePhase() {
    sessionData.currentPhase++;
    persistResumeState();  // snapshot after each phase completes
    if (isResponseWindowExpired()) { expireResponseWindow(); return; }
    runNextPhase();
  }

  function isResponseWindowExpired() {
    if (!activeResponseWindowPolicy.enforced) return false;
    const graceUntil = sessionData.responseWindow?.graceUntil
      ? Date.parse(sessionData.responseWindow.graceUntil)
      : activeResponseWindowPolicy.graceUntilMs;
    return EMAForgeRuntimeUtils.isResponseWindowHardExpired(
      { ...activeResponseWindowPolicy, graceUntilMs: graceUntil },
      Date.now()
    );
  }

  function expireResponseWindow() {
    if (sessionData.status !== 'in_progress') return;
    sessionData.endedReason = 'response_window_elapsed';
    finalizeSession('expired_in_progress');
  }

  function finalizeSession(finalStatus = 'complete') {
    sessionData.status = finalStatus;
    sessionData.completedAt = new Date().toISOString();
    sessionData.submission = {
      id: sessionData.sessionId,
      state: 'pending',
      attempts: 0,
      lastAttemptAt: null,
      acknowledgedAt: null,
      method: null
    };

    if (isPreview) {
      document.getElementById('screen-end').querySelector('p').textContent = '✓ Preview complete.';
      show('screen-end');
      return;
    }

    SubmissionManager.save(urlPid, urlDay, urlSession, sessionData);
    deliverCompletedSession();
  }

  function acknowledgeSubmission(method) {
    sessionData.submission = {
      ...(sessionData.submission || {}),
      state: 'acknowledged',
      method,
      acknowledgedAt: new Date().toISOString()
    };
    SubmissionManager.clear(urlPid, urlDay, urlSession);
    ResumeManager.clear(urlPid, urlDay, urlSession);
    if (config.study?.completion_lock && urlPid) {
      CompletionLock.stamp(urlPid, urlDay, urlSession);
    }
  }

  function deliverCompletedSession() {
    if (deliveryInFlight) return;

    const totalBeats = sessionData.data.reduce((sum, entry) => {
      if (entry.type === "baseline") return sum + (entry.recordedHR ? entry.recordedHR.length : 0);
      if (entry.type === "trial") return sum + (entry.qualitySummary ? entry.qualitySummary.totalBeats : 0);
      if (entry.type === "hct_response") {
        // Sum baseline beats + all interval (and practice) beat counts. The
        // hct_response envelope already consolidates these — recordedHR length
        // is the source of truth for beats contributed.
        let n = entry.baseline?.totalBeats || (entry.baseline?.recordedHR?.length || 0);
        (entry.intervals || []).forEach(i => { n += (i.recordedHR?.length || 0); });
        (entry.practices || []).forEach(i => { n += (i.recordedHR?.length || 0); });
        return sum + n;
      }
      return sum;
    }, 0);

    const statusText = document.getElementById("end-beat-count");
    if (totalBeats > 0 && statusText) {
      statusText.textContent = `${totalBeats.toLocaleString()} beats contributed to science.`;
      statusText.style.display = "block";
    }

    const downloadBtn = document.getElementById("download-btn");
    downloadBtn.style.display = 'block';
    downloadBtn.onclick = () => {
      acknowledgeSubmission('local_download');
      Upload.send(sessionData);
      if (statusText) {
        statusText.style.color = "var(--accent-green)";
        statusText.textContent = "✓ Local research record saved. You can close this page.";
      }
      downloadBtn.style.display = 'none';
    };
    show('screen-end');

    if (config.study?.webhook_url && config.study.webhook_url.trim() !== "") {

      downloadBtn.style.display = 'none'; // Hide manual download button

      if (!statusText) return;
      statusText.textContent = "Uploading data securely...";
      statusText.style.display = "block";
      statusText.style.color = "var(--fg-muted)";

      // Prepare payload
      const payload = {
        submission_id: sessionData.sessionId,
        participant_id: sessionData.participantId,
        day: sessionData.day,
        window_id: urlSession,
        session_data: sessionData
      };

      sessionData.submission = {
        ...(sessionData.submission || {}),
        state: 'pending',
        attempts: (sessionData.submission?.attempts || 0) + 1,
        lastAttemptAt: new Date().toISOString()
      };
      SubmissionManager.save(urlPid, urlDay, urlSession, sessionData);
      deliveryInFlight = true;

      fetch(config.study.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // Avoid a preflight; readable responses still need CORS.
        body: JSON.stringify(payload)
      })
        .then(async response => {
          if (!response.ok) throw new Error('Receiver rejected the upload');
          const receipt = await response.json();
          if (!EMAForgeRuntimeUtils.isWebhookAcknowledgement(receipt, payload.submission_id)) {
            throw new Error('Receiver did not acknowledge the submission');
          }
          acknowledgeSubmission('webhook');
          statusText.style.color = "var(--accent-green)";
          statusText.textContent = "✓ Data uploaded successfully. You can close this page.";
        })
        .catch(error => {
          // Fallback: Network error. Show the manual download button so data isn't lost.
          statusText.style.color = "var(--accent-red)";
          statusText.textContent = "Upload not confirmed. Please save a local copy.";
          downloadBtn.style.display = 'block';
        })
        .finally(() => { deliveryInFlight = false; });
    }
  }

  // Expose advancePhase + sessionData to injected modules. They were implicit
  // globals under the old structure; making them explicit here removes a whole
  // class of "works in this order but not that order" bugs.
  window.advancePhase = advancePhase;
  window.__sessionData = sessionData;
  window.__persistResumeState = persistResumeState;
  window.isResponseWindowExpired = isResponseWindowExpired;
  window.expireResponseWindow = expireResponseWindow;

})();
