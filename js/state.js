"use strict";

const SCHEMA_VERSION = "1.0.0";

let state = {
  study: {
    name: "Interoception Study",
    institution: "",
    accent_color: "#e8716a",
    output_format: "json",
    greetings: { morning: "Good Morning", afternoon: "Check-In", evening: "Good Evening" }
  },
  tasks: ["ema"],
  ema: {
    sessions: [
      { id: "morning",   label: "Morning Check-In",   greeting_key: "morning" },
      { id: "afternoon", label: "Afternoon Check-In",  greeting_key: "afternoon" },
      { id: "evening",   label: "Evening Check-In",    greeting_key: "evening" }
    ],
    questions: [
      { id: "q1", type: "slider", text: "How would you rate your current mood?", min: 0, max: 100, step: 1, unit: null, anchors: ["Very Negative", "Very Positive"], required: true, condition: null },
      { id: "q2", type: "slider", text: "How physically rested do you feel?", min: 0, max: 100, step: 1, unit: null, anchors: ["Exhausted", "Fully Energized"], required: true, condition: null },
      { id: "q3", type: "choice", text: "What are you currently doing?", options: ["Working", "Exercising", "Relaxing", "Socializing", "Other"], required: true, condition: null }
    ],
    scheduling: {
      study_days: 14,
      daily_prompts: 3,
      days_of_week: [1,2,3,4,5],
      windows: [
        { id: "w1", label: "Morning",   start: "08:00", end: "10:00" },
        { id: "w2", label: "Afternoon", start: "13:00", end: "15:00" },
        { id: "w3", label: "Evening",   start: "19:00", end: "21:00" }
      ],
      timing: { expiry_minutes: 60, grace_minutes: 10 }
    }
  },
  pat: {
    enabled: false,
    trials: 20,
    trial_duration_sec: 30,
    retry_budget: 30,
    sqi_threshold: 0.3,
    confidence_ratings: true,
    two_phase_practice: true
  }
};

let previewSession = "morning";
let previewDebounceTimer = null;
let qIdCounter = 10;
let wIdCounter = 10;

function genQId() { return `q${++qIdCounter}`; }
function genWId() { return `w${++wIdCounter}`; }

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

function buildConfig() {
  const cfg = {
    schema_version: SCHEMA_VERSION,
    study: JSON.parse(JSON.stringify(state.study)),
    tasks: [...state.tasks],
    ema: JSON.parse(JSON.stringify(state.ema))
  };
  if (state.pat.enabled) {
    cfg.pat = JSON.parse(JSON.stringify(state.pat));
    if (!cfg.tasks.includes("pat")) cfg.tasks.push("pat");
  }
  return cfg;
}
