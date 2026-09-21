"use strict";

// ---------------------------------------------------------------------------
// EMA Forge — state.js
// Schema v1.6.0
//
// Changes from v1.4.0:
//
// MULTI-TASK SESSIONS:
//   Windows now store phase_sequence[] as the primary schema. The old
//   phases: {pre, task, post} triple is kept for backwards compat but
//   phasesToSequence() is the sole expansion path.
//   A phase_sequence step can now be:
//     { kind: "ema",  block: "pre"|"post" }
//     { kind: "task", id: "epat"|..., condition: {question_id, operator, value} | null }
//     { kind: "hr",   duration_sec: 30,  store_as: "q_hr_1" }
//   Multiple tasks in a single window are fully supported.
//
// HEART RATE QUESTION TYPE:
//   New EMA question type: heart_rate.
//   Captures PPG for `duration_sec` seconds via ePATCore.BeatDetector.
//   Stores { bpm, sqi, ibi_series } under the question ID.
//   Because `bpm` is a number, it participates in conditional logic normally
//   — evalCond compares against the bpm value directly.
//   Builder config: { duration_sec: 30, report_as: "bpm" }
//
// CONDITIONAL TASKS:
//   A task step in phase_sequence can carry a condition:
//     { kind: "task", id: "epat", condition: { question_id: "q_hr_1", operator: "gt", value: 80 } }
//   The participant runtime preserves this condition in its phase plan and
//   evaluates it only when execution reaches the task. False → a documented
//   phase_event is recorded and the task is skipped.
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = "1.6.0";

let state = {
  study: {
    name: "",
    institution: "",
    theme: "oled",
    accent_color: "#e8716a",
    output_format: "csv",
    completion_lock: true,
    resume_enabled: true,
    webhook_url: "",
    greetings: { w1: "Good Morning", w2: "Check-In", w3: "Good Evening" }
  },

  onboarding: {
    enabled: true,
    ask_schedule: true,
    consent_text: "<h3>Consent template — researcher action required</h3>\n<p>Replace this placeholder with the exact consent language approved for your study before deployment.</p>\n<h3>Data collection</h3>\n<p>Describe every element your configuration collects, including participant identifiers, initials, device metadata, questionnaire responses, physiological measurements, and any linkage to phone numbers or scheduling records.</p>\n<h3>Storage and access</h3>\n<p>Describe where data are transmitted and stored, who can access them, retention and deletion procedures, foreseeable risks, and the research-team contact approved by your institution.</p>"
  },

  modules: [
    {
    id: "epat",
    label: "ePAT",
    desc: "Ecological Phase Adjustment Task — objective cardiac interoceptive accuracy via PPG. Requires rear camera + torch on participant device.",
    badge: "Beta",
    enabled: false,
    settings: {
    trials: 20,
    trial_duration_sec: 30,
    retry_budget: 30,
    sqi_threshold: 0.008,
    confidence_ratings: true,
    two_phase_practice: true,
    body_map: true
    }
  },
  {   
    id: "hct",
    label: "Heartbeat Counting Task",
    desc: "Schandry-style mental heartbeat count across timed intervals. Reuses ePATCore for the objective beat count — requires rear camera + torch.",
    badge: "Beta",
    enabled: false,
    settings: {
    // Comma-separated list of interval durations in seconds. Schandry's
    // classic set is [25, 35, 45, 50, 55, 100]; the reduced default below
    // keeps within-session burden ~2 min for EMA contexts.
    intervals: [25, 35, 45],
    randomize_order: true,
    include_practice: true,
    practice_duration_sec: 15,
    // 'count' = strict Schandry wording; 'estimate' = Brener/Ring variant
    // where participants estimate without trying to perceive each beat.
    // The methodological literature treats these as non-equivalent, hence
    // the explicit toggle.
    instruction_variant: "count",
    // Free-form override of the default instruction text. Empty string
    // means "use the variant default".
    instructions: "",
    // What the participant sees during counting:
    //   show_timer        — elapsed numeric timer
    //   show_progress_ring — subtle progress ring without numbers
    // Both off = blank/minimal screen (purist).
    show_timer: false,
    show_progress_ring: true,
    confidence_ratings: true,
    body_map: true,
    body_map_every: 4,
    // Hard cap on retries for noise-failed intervals across the whole
    // session. Same defensive purpose as ePAT's retry_budget.
    retry_budget: 10
    }
},
{
    id: "iat",
    label: "Implicit Association Task",
    desc: "Development module pending independent procedure, scoring, counterbalancing, and device-timing validation. Do not use for confirmatory research yet.",
    badge: "Experimental",
    enabled: false,
    settings: {
      target_a_label:  "Flowers",
      target_b_label:  "Insects",
      attr_pos_label:  "Pleasant",
      attr_neg_label:  "Unpleasant",
      target_a_words:  ["Orchid","Tulip","Rose","Daisy","Lily"],
      target_b_words:  ["Wasp","Flea","Roach","Centipede","Maggot"],
      attr_pos_words:  ["Happy","Love","Joy","Peace","Wonderful"],
      attr_neg_words:  ["Agony","Terrible","Horrible","Evil","Awful"],
      // [block1, block2, block3, block4, block5, block6, block7]
      // Standard Greenwald et al. (2003): 20/20/20/40/40/20/40
      // D-score uses blocks 3+4 (pairing 1) and 6+7 (pairing 2).
      block_trials:    [20, 20, 20, 40, 40, 20, 40],
      iti_ms:          400,
      show_practice:   true
    }
  }
],

  ema: {
    randomize_questions: false,
    questions: [
      { id: "q1", type: "slider",  text: "Right now, my mood is…",          min: 0, max: 100, step: 1, unit: null, anchors: ["Unpleasant", "Pleasant"],        required: true, condition: null, block: "both", windows: null },
      { id: "q2", type: "slider",  text: "Right now, my energy level is…",  min: 0, max: 100, step: 1, unit: null, anchors: ["Low / Calm", "High / Activated"], required: true, condition: null, block: "both", windows: null },
      { id: "q3", type: "choice",  text: "What are you doing right now?",   options: ["Resting", "Working / Studying", "Socializing", "Exercising", "Eating", "Commuting", "Other"], required: true, condition: null, block: "both", windows: null }
    ],
    scheduling: {
      study_days: 14,
      daily_prompts: 3,
      days_of_week: [1,2,3,4,5],
      windows: [
        {
          id: "w1", label: "Morning",   start: "08:00", end: "10:00",
          phases: { pre: true, task: null, post: false },
          phase_sequence: [{ kind: "ema", block: "pre" }]
        },
        {
          id: "w2", label: "Afternoon", start: "13:00", end: "15:00",
          phases: { pre: true, task: null, post: false },
          phase_sequence: [{ kind: "ema", block: "pre" }]
        },
        {
          id: "w3", label: "Evening",   start: "19:00", end: "21:00",
          phases: { pre: true, task: null, post: false },
          phase_sequence: [{ kind: "ema", block: "pre" }]
        }
      ],
      timing: { expiry_minutes: 60, grace_minutes: 10 }
    }
  }
};

// ---------------------------------------------------------------------------
// Ephemeral UI state
// ---------------------------------------------------------------------------
let previewSession = "onboarding";
let previewDebounceTimer = null;

// Use a random string to guarantee IDs never collide even after page reloads
function genQId() { return 'q_' + Math.random().toString(36).substr(2, 6); }
function genWId() { return 'w_' + Math.random().toString(36).substr(2, 6); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function darkenHex(hex, amount) {
  let r = parseInt(hex.slice(1,3),16);
  let g = parseInt(hex.slice(3,5),16);
  let b = parseInt(hex.slice(5,7),16);
  r = Math.max(0, r - amount);
  g = Math.max(0, g - amount);
  b = Math.max(0, b - amount);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

function escH(str) {
  return (str||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function sanitizeConsentHtml(html) {
  const allowedTags = new Set(['H1', 'H2', 'H3', 'H4', 'P', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'A', 'BR']);
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  Array.from(template.content.querySelectorAll('*')).forEach(element => {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(document.createTextNode(element.textContent || ''));
      return;
    }
    Array.from(element.attributes).forEach(attribute => {
      if (element.tagName !== 'A' || attribute.name !== 'href') element.removeAttribute(attribute.name);
    });
    if (element.tagName === 'A') {
      const href = element.getAttribute('href') || '';
      if (!/^(?:https?:|mailto:)/i.test(href)) element.removeAttribute('href');
      element.setAttribute('rel', 'noopener noreferrer');
      element.setAttribute('target', '_blank');
    }
  });
  return template.innerHTML;
}

// ---------------------------------------------------------------------------
// phasesToSequence(w) — canonical expansion from legacy triple or explicit array.
// phase_sequence on the window is always used verbatim if present and non-empty.
// ---------------------------------------------------------------------------
function phasesToSequence(w) {
  if (Array.isArray(w.phase_sequence) && w.phase_sequence.length > 0) {
    return w.phase_sequence.map(p => ({ ...p }));
  }
  const ph = w.phases || { pre: true, task: null, post: false };
  const seq = [];
  if (ph.pre)             seq.push({ kind: "ema",  block: "pre" });
  if (ph.task)            seq.push({ kind: "task", id: ph.task, condition: null });
  if (ph.post && ph.task) seq.push({ kind: "ema",  block: "post" });
  return seq;
}

// ---------------------------------------------------------------------------
// buildConfig — serialises state into config.json consumed by study-base.js
// ---------------------------------------------------------------------------
function buildConfig() {
  const cfg = {
    schema_version: SCHEMA_VERSION,
    study:      JSON.parse(JSON.stringify(state.study)),
    onboarding: JSON.parse(JSON.stringify(state.onboarding)),
    ema:        JSON.parse(JSON.stringify(state.ema)),
    modules:    {}
  };

  if (cfg.study.completion_lock === undefined) cfg.study.completion_lock = true;
  if (cfg.study.resume_enabled  === undefined) cfg.study.resume_enabled  = true;
  cfg.onboarding.consent_text = sanitizeConsentHtml(cfg.onboarding.consent_text);

  // Always emit phase_sequence — runtime prefers this over legacy triple
  (cfg.ema?.scheduling?.windows || []).forEach(w => {
    w.phase_sequence = phasesToSequence(w);
  });

  state.modules.forEach(mod => {
    if (mod.enabled) {
      cfg.modules[mod.id] = JSON.parse(JSON.stringify(mod.settings));
    }
  });

 // Emit hr_capture settings if any question is of type heart_rate
  const hasHr = (cfg.ema?.questions || []).some(q => q.type === 'heart_rate');
  if (hasHr) cfg.modules.hr_capture = { enabled: true };

  return cfg;
}
