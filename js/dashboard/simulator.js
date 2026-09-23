"use strict";

/**
 * Deterministic synthetic study generator for the local Analyze workspace.
 * Synthetic output is deliberately marked at both study and session level.
 */
(function attachSimulator(root, factory) {
  const runtimeUtils = typeof module !== "undefined" && module.exports
    ? require("../../templates/runtime-utils.js")
    : root.EMAForgeRuntimeUtils;
  const api = factory(runtimeUtils);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EMAForgeSimulator = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSimulator(runtimeUtils) {
  const BASE_DATE = Date.UTC(2026, 0, 5);

  function clamp(value, min, max) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : min;
  }

  function hashSeed(input) {
    let hash = 2166136261;
    for (const char of String(input || "ema-forge-demo")) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    return function random() {
      let value = seed += 0x6D2B79F5;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function choose(values, random) {
    return values[Math.floor(random() * values.length)];
  }

  function normal(random, mean = 0, sd = 1) {
    const u = Math.max(random(), Number.EPSILON);
    const v = Math.max(random(), Number.EPSILON);
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function isoFor(day, time, offsetMs = 0) {
    const [hours, minutes] = String(time || "12:00").split(":").map(Number);
    return new Date(BASE_DATE + (day - 1) * 86400000 + (hours || 0) * 3600000 + (minutes || 0) * 60000 + offsetMs).toISOString();
  }

  function responseFor(question, random, participantIndex, day) {
    if (question.type === "slider") {
      const min = Number.isFinite(Number(question.min)) ? Number(question.min) : 0;
      const max = Number.isFinite(Number(question.max)) ? Number(question.max) : 100;
      const center = min + (max - min) * (0.45 + ((participantIndex % 5) - 2) * 0.025);
      return Math.round(clamp(normal(random, center + Math.sin(day / 2) * (max - min) * 0.05, (max - min) * 0.18), min, max));
    }
    if (question.type === "numeric") {
      if (/sleep/i.test(question.id + " " + question.text)) return Number(clamp(normal(random, 7, 1.1), 3, 11).toFixed(1));
      return Math.round(clamp(normal(random, 5, 2), 0, 12));
    }
    if (question.type === "choice") return choose(question.options?.length ? question.options : ["Option 1", "Option 2"], random);
    if (question.type === "checkbox") {
      const options = question.options?.length ? question.options : ["Option 1", "Option 2"];
      const first = choose(options, random);
      if (options.length > 2 && random() < 0.25) {
        const second = choose(options.filter(option => option !== first), random);
        return [first, second];
      }
      return [first];
    }
    if (question.type === "affect_grid") {
      return {
        valence: Number(clamp(normal(random, 0.16, 0.42), -1, 1).toFixed(2)),
        arousal: Number(clamp(normal(random, 0, 0.48), -1, 1).toFixed(2))
      };
    }
    if (question.type === "heart_rate") {
      const bpm = Math.round(clamp(normal(random, 72 + (participantIndex % 4) * 2, 8), 48, 120));
      return {
        bpm,
        sqi: Number(clamp(normal(random, 0.84, 0.09), 0.45, 0.99).toFixed(3)),
        ibi_series: Array.from({ length: 12 }, () => Math.round(60000 / bpm + normal(random, 0, 22)))
      };
    }
    if (question.type === "text") return choose([
      "Synthetic response for workflow testing.",
      "Nothing else to add in this simulated check-in.",
      "A brief synthetic note generated for the demo."
    ], random);
    return "Synthetic response";
  }

  function buildSurveyEntry(step, questionMap, responses, random, participantIndex, day, startedAt, missingnessRate, windowId) {
    const entry = {
      type: "ema_response",
      block: step.id || "survey",
      windowId,
      startedAt,
      submittedAt: startedAt,
      presentationOrder: [[]],
      eligibleQuestionIds: [],
      skippedQuestions: [],
      responses: {}
    };
    let responseOffset = 5000;

    for (const questionId of step.question_ids || []) {
      const question = questionMap[questionId];
      if (!question || question.type === "page_break") continue;
      entry.eligibleQuestionIds.push(questionId);
      if (!runtimeUtils.evaluateCondition(question.condition, responses)) {
        entry.skippedQuestions.push({ questionId, reason: "condition_false" });
        continue;
      }
      entry.presentationOrder[0].push(questionId);
      if (random() < missingnessRate) continue;
      responseOffset += Math.round(3500 + random() * 7000);
      const value = responseFor(question, random, participantIndex, day);
      const record = { value, respondedAt: new Date(Date.parse(startedAt) + responseOffset).toISOString() };
      entry.responses[questionId] = record;
      responses[questionId] = record;
    }
    entry.submittedAt = new Date(Date.parse(startedAt) + responseOffset + 2500).toISOString();
    return entry;
  }

  function buildEpatEntry(settings, random) {
    const trialCount = clamp(settings?.trials || 8, 3, 30);
    const trials = Array.from({ length: trialCount }, (_, index) => {
      const bpm = Math.round(clamp(normal(random, 72, 7), 48, 115));
      const rrMs = Math.round(60000 / bpm);
      const phaseMs = Math.round(clamp(normal(random, 85, 105), -rrMs / 2, rrMs / 2));
      return {
        trial: index + 1,
        phase_ms: phaseMs,
        rr_ms: rrMs,
        confidence: Math.round(clamp(normal(random, 65, 18), 0, 100)),
        sqi: Number(clamp(normal(random, 0.82, 0.1), 0.35, 0.99).toFixed(3)),
        bodyPos: Math.floor(random() * 7),
        valid: true
      };
    });
    return {
      type: "epat_response",
      trials,
      summary: {
        valid_trials: trials.length,
        failed_trials: 0,
        mean_abs_phase_ms: Math.round(trials.reduce((sum, trial) => sum + Math.abs(trial.phase_ms), 0) / trials.length)
      }
    };
  }

  function buildHctEntry(settings, random) {
    const intervals = Array.isArray(settings?.intervals) && settings.intervals.length ? settings.intervals : [25, 35, 45];
    const trials = intervals.map((seconds, index) => {
      const bpm = Math.round(clamp(normal(random, 72, 7), 48, 115));
      const actual = Math.round(bpm * seconds / 60);
      return {
        trial: index + 1,
        duration_sec: seconds,
        counted_beats: Math.max(1, Math.round(actual + normal(random, 0, actual * 0.12))),
        recorded_bpm: bpm,
        confidence: Math.round(clamp(normal(random, 66, 17), 0, 100)),
        bodyPos: Math.floor(random() * 7)
      };
    });
    return { type: "hct_response", trials, summary: { valid_trials: trials.length } };
  }

  function moduleSettings(config, moduleId) {
    const module = (config.modules || []).find(item => item.id === moduleId);
    return module?.settings || {};
  }

  function simulate(config, options = {}) {
    if (!config?.ema?.scheduling?.windows?.length) throw new Error("A protocol with at least one schedule window is required.");
    const participants = Math.round(clamp(options.participants || 12, 1, 250));
    const studyDays = Math.round(clamp(options.days || config.ema.scheduling.study_days || 7, 1, 60));
    const completionRate = clamp(options.completionRate ?? 0.85, 0.05, 1);
    const missingnessRate = clamp(options.missingnessRate ?? 0.05, 0, 0.5);
    const seed = String(options.seed || "ema-forge-demo");
    const random = mulberry32(hashSeed(seed));
    const questionMap = Object.fromEntries((config.ema.questions || []).map(question => [question.id, question]));
    const sessions = [];
    const expectedEvents = [];

    for (let participantIndex = 1; participantIndex <= participants; participantIndex++) {
      const participantId = `SIM-${String(participantIndex).padStart(3, "0")}`;
      for (let day = 1; day <= studyDays; day++) {
        for (const windowConfig of config.ema.scheduling.windows) {
          const sessionId = `${participantId}-D${String(day).padStart(2, "0")}-${windowConfig.id}`;
          const scheduledAt = isoFor(day, windowConfig.start);
          const completed = random() < completionRate;
          expectedEvents.push({ participantId, sessionId, day, windowId: windowConfig.id, scheduledAt, delivered: true, completed });
          if (!completed) continue;

          const notificationLatencyMs = Math.round((1 + random() * 34) * 60000);
          const startedAt = new Date(Date.parse(scheduledAt) + notificationLatencyMs).toISOString();
          const sessionData = [];
          const responses = {};
          let cursorMs = Date.parse(startedAt);

          for (const step of windowConfig.phase_sequence || []) {
            if (step.condition && !runtimeUtils.evaluateCondition(step.condition, responses)) continue;
            if (step.kind === "ema") {
              const entry = buildSurveyEntry(step, questionMap, responses, random, participantIndex, day, new Date(cursorMs).toISOString(), missingnessRate, windowConfig.id);
              cursorMs = Date.parse(entry.submittedAt) + 4000;
              sessionData.push(entry);
            } else if (step.kind === "task" && step.id === "epat") {
              sessionData.push(buildEpatEntry(moduleSettings(config, "epat"), random));
              cursorMs += Math.round(clamp(moduleSettings(config, "epat").trials || 8, 3, 30) * 9000);
            } else if (step.kind === "task" && step.id === "hct") {
              sessionData.push(buildHctEntry(moduleSettings(config, "hct"), random));
              cursorMs += 90000;
            }
          }

          const minimumDuration = 45000 + Math.round(random() * 30000);
          const completedAt = new Date(Math.max(cursorMs, Date.parse(startedAt) + minimumDuration)).toISOString();
          sessions.push({
            participantId,
            sessionId,
            day,
            type: windowConfig.id,
            status: "complete",
            startedAt,
            completedAt,
            notificationLatencyMs,
            synthetic: true,
            simulation: { seed, generator: "EMA Forge local simulator" },
            data: sessionData
          });
        }
      }
    }

    const simulationConfig = JSON.parse(JSON.stringify(config));
    simulationConfig.study = { ...simulationConfig.study, name: `${simulationConfig.study?.name || "EMA Study"} — Simulation` };
    simulationConfig.ema.scheduling.study_days = studyDays;
    simulationConfig.synthetic = true;
    simulationConfig.simulation = { seed, participants, studyDays, completionRate, missingnessRate };

    return {
      config: simulationConfig,
      sessions,
      manifest: {
        synthetic: true,
        generator: "EMA Forge local simulator",
        seed,
        participants,
        studyDays,
        completionRate,
        missingnessRate,
        expectedEvents
      }
    };
  }

  return { simulate, hashSeed, mulberry32 };
});
