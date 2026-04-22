"use strict";

const StarterTemplates = {
    // ---------------------------------------------------------
    // 1. Daily Reflections
    // Features: Morning vs Evening windows, simple skip logic
    // ---------------------------------------------------------
    diary: {
      schema_version: "1.5.0",
      study: { 
        name: "Daily Reflections", institution: "Department of Psychology", 
        theme: "light", accent_color: "#388bfd", output_format: "csv", 
        completion_lock: true, resume_enabled: true, 
        greetings: { "w_morn": "Good Morning", "w_eve": "Good Evening" } 
      },
      onboarding: { enabled: true, ask_schedule: true, consent_text: "<h3>Welcome to Daily Reflections</h3><p>You will receive two prompts a day: a quick morning check-in and an evening reflection.</p>" },
      modules: [], // Clean array! Future modules will show up normally but stay disabled.
      ema: {
        randomize_questions: false,
        questions: [
          // Morning Only
          { id: "q_sleep", type: "numeric", text: "How many hours of sleep did you get last night?", required: true, block: "both", windows: ["w_morn"] },
          { id: "q_mood_m", type: "slider", text: "How are you feeling right now as you start your day?", min: 0, max: 100, step: 1, anchors: ["Terrible", "Excellent"], required: true, block: "both", windows: ["w_morn"] },
          
          // Evening Only
          { id: "q_mood_e", type: "slider", text: "Overall, how was your day?", min: 0, max: 100, step: 1, anchors: ["Terrible", "Excellent"], required: true, block: "both", windows: ["w_eve"] },
          { id: "q_stress", type: "slider", text: "How stressed did you feel today?", min: 0, max: 100, step: 1, anchors: ["Not at all", "Extremely"], required: true, block: "both", windows: ["w_eve"] },
          { id: "pb1", type: "page_break" },
          
          // Conditional Logic (Evening)
          { id: "q_exercised", type: "choice", text: "Did you intentionally exercise today?", options: ["Yes", "No"], required: true, block: "both", windows: ["w_eve"] },
          { id: "q_ex_type", type: "text", text: "What kind of exercise did you do?", required: false, condition: { logical_op: 'AND', rules: [{ question_id: "q_exercised", operator: "eq", value: "Yes" }] }, block: "both", windows: ["w_eve"] },
          { id: "q_highlight", type: "text", text: "What was the highlight of your day?", required: false, block: "both", windows: ["w_eve"] }
        ],
        scheduling: {
          study_days: 14, daily_prompts: 2, days_of_week: [1,2,3,4,5,6,7],
          timing: { expiry_minutes: 120, grace_minutes: 15 },
          windows: [
            { id: "w_morn", label: "Morning", start: "08:00", end: "10:30", phase_sequence: [{ kind: "ema", block: "pre" }] },
            { id: "w_eve", label: "Evening", start: "19:00", end: "21:30", phase_sequence: [{ kind: "ema", block: "pre" }] }
          ]
        }
      }
    },

    // ---------------------------------------------------------
    // 2. Intensive Physiology
    // Features: HR Capture, Affect Grid, Text Piping, Conditional Task Step
    // ---------------------------------------------------------
    physio: {
      schema_version: "1.5.0",
      study: { 
        name: "Cardiac Interoception & Affect", institution: "Cognitive Neuroscience Lab", 
        theme: "oled", accent_color: "#ff453a", output_format: "csv", 
        completion_lock: true, resume_enabled: true, 
        greetings: { "w1": "Morning Baseline", "w2": "Midday Check", "w3": "Evening Check" } 
      },
      onboarding: { enabled: true, ask_schedule: false, consent_text: "<h3>Overview</h3><p>This study uses your phone's camera to measure resting heart rate and tests interoceptive accuracy.</p>" },
      modules: [
        // We only mention the module we want to enable & modify
        { id: "epat", enabled: true, settings: { trials: 15, trial_duration_sec: 30, retry_budget: 30, sqi_threshold: 0.3, confidence_ratings: true, two_phase_practice: true, body_map: true } }
      ],
      ema: {
        randomize_questions: false,
        questions: [
          { id: "q_context", type: "choice", text: "What were you doing right before this prompt?", options: ["Working/Studying", "Resting", "Socializing", "Physical Activity", "Eating"], required: true, block: "pre" },
          { id: "pb1", type: "page_break" },
          
          { id: "q_affect", type: "affect_grid", text: "Think about your recent time {{q_context}}. How are you feeling right now?", valence_labels: ['Unpleasant', 'Pleasant'], arousal_labels: ['Deactivated', 'Activated'], show_quadrant_labels: true, required: true, block: "pre" },
          { id: "pb2", type: "page_break" },
          
          { id: "q_hr1", type: "heart_rate", text: "Resting Heart Rate Capture", duration_sec: 30, report_as: "bpm", required: true, block: "pre" },
          
          { id: "q_task_diff", type: "slider", text: "How challenging did you find the heartbeat task?", min: 0, max: 100, step: 1, anchors: ["Very Easy", "Very Hard"], required: true, block: "post" }
        ],
        scheduling: {
          study_days: 7, daily_prompts: 3, days_of_week: [1,2,3,4,5,6,7],
          timing: { expiry_minutes: 60, grace_minutes: 10 },
          windows: [
            { id: "w1", label: "Morning", start: "08:00", end: "10:00", phase_sequence: [{ kind: "ema", block: "pre" }, { kind: "task", id: "epat", condition: { question_id: "q_hr1", operator: "gt", value: 75 } }, { kind: "ema", block: "post" }] },
            { id: "w2", label: "Afternoon", start: "13:00", end: "15:00", phase_sequence: [{ kind: "ema", block: "pre" }, { kind: "task", id: "epat", condition: { question_id: "q_hr1", operator: "gt", value: 75 } }, { kind: "ema", block: "post" }] },
            { id: "w3", label: "Evening", start: "18:00", end: "20:00", phase_sequence: [{ kind: "ema", block: "pre" }, { kind: "task", id: "epat", condition: { question_id: "q_hr1", operator: "gt", value: 75 } }, { kind: "ema", block: "post" }] }
          ]
        }
      }
    },

    // ---------------------------------------------------------
    // 3. Workplace Context
    // Features: Weekdays only, Deep Piping, and Multi-rule Skip Logic
    // ---------------------------------------------------------
    workplace: {
      schema_version: "1.5.0",
      study: { 
        name: "Workplace Flow Experience", institution: "Organizational Behavior Group", 
        theme: "dark", accent_color: "#32d74b", output_format: "csv", 
        completion_lock: true, resume_enabled: true, 
        greetings: { "w1": "Morning Check-in", "w2": "Midday Sync", "w3": "Wrap-up" } 
      },
      onboarding: { enabled: true, ask_schedule: true, consent_text: "<h3>Workplace Study</h3><p>We are tracking focus and workflow context during standard business hours.</p>" },
      modules: [], // Clean array!
      ema: {
        randomize_questions: false,
        questions: [
          { id: "q_activity", type: "choice", text: "What is your primary activity right now?", options: ["Deep Work / Focus", "Meetings / Calls", "Email / Admin", "Taking a break", "Other"], required: true, block: "both" },
          { id: "pb1", type: "page_break" },
          
          { id: "q_focus", type: "slider", text: "How absorbed or 'in the zone' are you while doing {{q_activity}}?", min: 0, max: 100, step: 1, anchors: ["Distracted", "Completely focused"], required: true, block: "both" },
          { id: "q_blocker", type: "choice", text: "Are you facing any blockers or frustrations right now?", options: ["Yes", "No"], required: true, block: "both" },
          
          { id: "q_blocker_text", type: "text", text: "Briefly describe the blocker regarding {{q_activity}}:", required: false, condition: { logical_op: 'AND', rules: [{ question_id: "q_blocker", operator: "eq", value: "Yes" }] }, block: "both" }
        ],
        scheduling: {
          study_days: 5, daily_prompts: 3, 
          days_of_week: [1,2,3,4,5], // Monday - Friday only
          timing: { expiry_minutes: 45, grace_minutes: 10 },
          windows: [
            { id: "w1", label: "Morning", start: "09:00", end: "11:00", phase_sequence: [{ kind: "ema", block: "pre" }] },
            { id: "w2", label: "Midday", start: "12:00", end: "14:00", phase_sequence: [{ kind: "ema", block: "pre" }] },
            { id: "w3", label: "Afternoon", start: "15:00", end: "17:00", phase_sequence: [{ kind: "ema", block: "pre" }] }
          ]
        }
      }
    }
};

// Bind the template buttons
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.template-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const templateKey = e.currentTarget.dataset.template;
            if (StarterTemplates[templateKey]) {
                StorageManager.loadTemplate(StarterTemplates[templateKey]);
            }
        });
    });
});