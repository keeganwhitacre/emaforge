"use strict";

(function attachProtocolValidator(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EMAForgeProtocolValidator = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createProtocolValidator() {
  const VALID_OPERATORS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "includes"]);
  const VALID_QUESTION_TYPES = new Set([
    "instruction", "slider", "choice", "checkbox", "text", "numeric", "affect_grid", "body_map", "heart_rate", "place_context", "page_break"
  ]);
  const RESPONSE_TYPES = new Set(["slider", "choice", "checkbox", "text", "numeric", "affect_grid", "body_map", "heart_rate", "place_context"]);
  const placeContext = typeof module !== "undefined" && module.exports
    ? require('./place-context.js') : globalThis.EMAForgePlaceContext;
  const PLACEHOLDER_CONSENT = /researcher action required|replace this placeholder|lorem ipsum/i;

  function issue(severity, code, path, message) {
    return { severity, code, path, message };
  }

  function textOnly(html) {
    return String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  function validHm(value) {
    return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  function conditionRules(condition) {
    if (!condition) return [];
    return Array.isArray(condition.rules) ? condition.rules : [condition];
  }

  function validateCondition(condition, allowedIds, path, issues) {
    if (!condition) return;
    const rules = conditionRules(condition);
    if (rules.length === 0) {
      issues.push(issue("error", "condition_empty", path, "Condition is enabled but contains no rules."));
      return;
    }
    rules.forEach((rule, index) => {
      const rulePath = `${path}.rules[${index}]`;
      if (!rule || !rule.question_id) {
        issues.push(issue("error", "condition_question_missing", rulePath, "Select a source question for this condition."));
      } else if (!allowedIds.has(rule.question_id)) {
        issues.push(issue(
          "error",
          "condition_question_unavailable",
          rulePath,
          `Condition references "${rule.question_id}", which is not available earlier in this session.`
        ));
      }
      if (!VALID_OPERATORS.has(rule && rule.operator)) {
        issues.push(issue("error", "condition_operator_invalid", rulePath, "Condition uses an unsupported operator."));
      }
      if (!rule || rule.value === undefined || rule.value === null || rule.value === "") {
        issues.push(issue("error", "condition_value_missing", rulePath, "Condition comparison value is missing."));
      }
    });
  }

  function validateConditionAvailability(condition, allowedIds, path, issues) {
    conditionRules(condition).forEach((rule, index) => {
      if (rule && rule.question_id && !allowedIds.has(rule.question_id)) {
        issues.push(issue(
          "error",
          "condition_question_unavailable_in_session",
          `${path}.rules[${index}]`,
          `Condition source "${rule.question_id}" is not presented earlier in this session.`
        ));
      }
    });
  }

  function pipingTokens(text) {
    return Array.from(String(text || "").matchAll(/\{\{([^{}]+)\}\}/g)).map(match => {
      const parts = match[1].split("|");
      return { questionId: (parts.shift() || "").trim(), fallback: parts.join("|").trim() };
    });
  }

  function validatePipingSyntax(text, questionId, declaredIds, path, issues) {
    const value = String(text || "");
    const tokens = pipingTokens(value);
    const residue = value.replace(/\{\{[^{}]+\}\}/g, "");
    if (residue.includes("{{") || residue.includes("}}")) {
      issues.push(issue("error", "piping_syntax_invalid", path, "An earlier-answer placeholder is incomplete."));
    }
    tokens.forEach(token => {
      if (!token.questionId || !declaredIds.has(token.questionId)) {
        issues.push(issue("error", "piping_source_unknown", path, `Earlier-answer source "${token.questionId || "(missing)"}" does not exist.`));
      } else if (token.questionId === questionId) {
        issues.push(issue("error", "piping_source_self", path, "A question cannot insert its own answer."));
      }
    });
  }

  function validatePipingAvailability(text, targetId, allowedIds, questionsById, path, sessionLabel, issues) {
    pipingTokens(text).forEach(token => {
      if (!token.questionId || token.questionId === targetId || !questionsById.has(token.questionId)) return;
      if (!allowedIds.has(token.questionId)) {
        issues.push(issue(
          "error",
          "piping_source_unavailable_in_session",
          path,
          `Earlier answer "${token.questionId}" is not presented before this question in ${sessionLabel}.`
        ));
        return;
      }
      if (!token.fallback && questionsById.get(token.questionId)?.condition) {
        issues.push(issue(
          "warning",
          "piping_fallback_missing",
          path,
          `Add fallback wording because "${token.questionId}" can be skipped by logic.`
        ));
      }
    });
  }

  function validate(config) {
    const issues = [];
    const study = config && config.study || {};
    const onboarding = config && config.onboarding || {};
    const ema = config && config.ema || {};
    const scheduling = ema.scheduling || {};
    const questions = Array.isArray(ema.questions) ? ema.questions : [];
    const windows = Array.isArray(scheduling.windows) ? scheduling.windows : [];
    const modules = config && config.modules || {};
    const declaredQuestionIds = new Set(questions.map(question => question && question.id).filter(Boolean));
    const questionsById = new Map(questions.map(question => [question && question.id, question]).filter(([id]) => id));
    const questionIndexes = new Map(questions.map((question, index) => [question && question.id, index]).filter(([id]) => id));

    if (!String(study.name || "").trim()) {
      issues.push(issue("error", "study_name_missing", "study.name", "Study name is required."));
    }
    if (!String(study.institution || "").trim()) {
      issues.push(issue("warning", "institution_missing", "study.institution", "Institution or study-team name is blank."));
    }
    if (!["csv", "json"].includes(study.output_format || "csv")) {
      issues.push(issue("error", "output_format_invalid", "study.output_format", "Output format must be CSV or JSON."));
    }
    if (study.webhook_url) {
      try {
        const webhook = String(study.webhook_url).trim();
        if (!/^\/(?!\/)/.test(webhook)) {
          const url = new URL(webhook);
          if (url.protocol !== "https:") throw new Error("HTTPS required");
        }
      } catch (error) {
        issues.push(issue("error", "webhook_url_invalid", "study.webhook_url", "Webhook URL must be an HTTPS address or a same-host path such as /submit."));
      }
    } else {
      issues.push(issue("warning", "webhook_missing", "study.webhook_url", "No independent receiver is configured. The prepared Cloudflare export will use its built-in private storage; other exports will require manual return."));
    }

    if (onboarding.enabled !== false) {
      const consent = textOnly(onboarding.consent_text);
      if (!consent || PLACEHOLDER_CONSENT.test(consent)) {
        issues.push(issue("error", "consent_placeholder", "onboarding.consent_text", "Replace the consent placeholder with study-approved language before export."));
      } else if (consent.length < 200) {
        issues.push(issue("warning", "consent_short", "onboarding.consent_text", "Consent text is unusually short; verify it matches the approved protocol."));
      }
    } else {
      issues.push(issue("warning", "onboarding_disabled", "onboarding.enabled", "Onboarding and in-app consent are disabled; confirm consent is handled externally."));
    }

    const studyDays = Number(scheduling.study_days);
    if (!Number.isInteger(studyDays) || studyDays < 1 || studyDays > 365) {
      issues.push(issue("error", "study_days_invalid", "ema.scheduling.study_days", "Study length must be an integer from 1 to 365 days."));
    }
    const activeDays = Array.isArray(scheduling.days_of_week) ? scheduling.days_of_week : [];
    if (activeDays.length === 0 || activeDays.some(day => !Number.isInteger(Number(day)) || Number(day) < 1 || Number(day) > 7)) {
      issues.push(issue("error", "weekdays_invalid", "ema.scheduling.days_of_week", "Select at least one valid active weekday."));
    }
    const expiry = Number(scheduling.timing && scheduling.timing.expiry_minutes);
    const grace = Number(scheduling.timing && scheduling.timing.grace_minutes);
    if (!Number.isFinite(expiry) || expiry < 0 || expiry > 1440) {
      issues.push(issue("error", "expiry_invalid", "ema.scheduling.timing.expiry_minutes", "Expiry must be between 0 and 1440 minutes."));
    } else if (expiry === 0) {
      issues.push(issue("warning", "expiry_disabled", "ema.scheduling.timing.expiry_minutes", "Link expiry is disabled; old prompt links will remain usable."));
    }
    if (!Number.isFinite(grace) || grace < 0 || grace > 240) {
      issues.push(issue("error", "grace_invalid", "ema.scheduling.timing.grace_minutes", "Grace period must be between 0 and 240 minutes."));
    }

    if (windows.length === 0) {
      issues.push(issue("error", "windows_missing", "ema.scheduling.windows", "Add at least one session window."));
    }

    const windowIds = new Set();
    windows.forEach((window, windowIndex) => {
      const path = `ema.scheduling.windows[${windowIndex}]`;
      if (!window || !String(window.id || "").trim()) {
        issues.push(issue("error", "window_id_missing", `${path}.id`, "Session window ID is missing."));
      } else if (windowIds.has(window.id)) {
        issues.push(issue("error", "window_id_duplicate", `${path}.id`, `Duplicate session window ID "${window.id}".`));
      } else {
        windowIds.add(window.id);
      }
      if (!String(window && window.label || "").trim()) {
        issues.push(issue("error", "window_label_missing", `${path}.label`, "Session window label is missing."));
      }
      if (!validHm(window && window.start) || !validHm(window && window.end) || window.start > window.end) {
        issues.push(issue("error", "window_time_invalid", path, "Session window needs a valid start time at or before its end time."));
      }
    });

    const questionIds = new Set();
    const priorQuestionIds = new Set();
    questions.forEach((question, questionIndex) => {
      const path = `ema.questions[${questionIndex}]`;
      if (!question || !String(question.id || "").trim()) {
        issues.push(issue("error", "question_id_missing", `${path}.id`, "Question ID is missing."));
      } else if (questionIds.has(question.id)) {
        issues.push(issue("error", "question_id_duplicate", `${path}.id`, `Duplicate question ID "${question.id}".`));
      } else {
        questionIds.add(question.id);
      }
      if (!VALID_QUESTION_TYPES.has(question && question.type)) {
        issues.push(issue("error", "question_type_invalid", `${path}.type`, "Question type is unsupported."));
      }
      if (question && question.type !== "page_break" && !String(question.text || "").trim()) {
        issues.push(issue("error", "question_text_missing", `${path}.text`, "Question text is required."));
      }
      if (question && question.type !== "page_break") {
        validatePipingSyntax(question.text, question.id, declaredQuestionIds, `${path}.text`, issues);
      }
      if (question && (question.type === "choice" || question.type === "checkbox")) {
        const options = Array.isArray(question.options) ? question.options.map(option => String(option).trim()) : [];
        if (options.length < 2 || options.some(option => !option)) {
          issues.push(issue("error", "question_options_invalid", `${path}.options`, "Choice questions need at least two non-empty options."));
        } else if (new Set(options).size !== options.length) {
          issues.push(issue("error", "question_options_duplicate", `${path}.options`, "Choice options must be unique."));
        }
      }
      if (question && question.type === "slider") {
        if (![question.min, question.max, question.step].every(value => Number.isFinite(Number(value))) ||
            Number(question.min) >= Number(question.max) || Number(question.step) <= 0) {
          issues.push(issue("error", "slider_range_invalid", path, "Slider minimum, maximum, and step define an invalid range."));
        }
      }
      if (question && question.type === "heart_rate") {
        const duration = Number(question.duration_sec);
        if (!Number.isFinite(duration) || duration < 10 || duration > 120) {
          issues.push(issue("error", "heart_rate_duration_invalid", `${path}.duration_sec`, "Heart-rate capture duration must be 10–120 seconds."));
        }
      }
      if (question && question.type === "place_context") {
        if (question.required) issues.push(issue("error", "place_context_optional", `${path}.required`, "Place context must allow participants to skip location access."));
        if (!question.location_terms_accepted) issues.push(issue("error", "place_context_terms", path, "Review the place-context setup notice before adding this measure."));
        const datasetError = placeContext.validate(question.location_dataset);
        if (datasetError) issues.push(issue("error", "place_context_dataset", `${path}.location_dataset`, datasetError));
      }
      if (question && question.type === "body_map") {
        const regions = Array.isArray(question.regions) ? question.regions : [];
        const ids = regions.map(region => String(region && region.id || "").trim());
        const labels = regions.map(region => String(region && region.label || "").trim());
        if (!["single", "multiple"].includes(question.selection_mode)) {
          issues.push(issue("error", "body_map_mode_invalid", `${path}.selection_mode`, "Body map selection must be single or multiple."));
        }
        if (regions.length < 2 || ids.some(id => !id) || labels.some(label => !label) || new Set(ids).size !== ids.length) {
          issues.push(issue("error", "body_map_regions_invalid", `${path}.regions`, "Body maps need at least two uniquely identified, labeled regions."));
        }
      }
      validateCondition(question && question.condition, priorQuestionIds, `${path}.condition`, issues);
      if (question && RESPONSE_TYPES.has(question.type) && question.id) priorQuestionIds.add(question.id);
    });

    const surveyStepIds = new Set();
    const assignedQuestionIds = new Set();
    windows.forEach((window, windowIndex) => {
      if (!window) return;
      const path = `ema.scheduling.windows[${windowIndex}]`;
      const sequence = Array.isArray(window.phase_sequence) && window.phase_sequence.length
        ? window.phase_sequence
        : [];
      if (sequence.length === 0) {
        issues.push(issue("error", "phase_sequence_empty", `${path}.phase_sequence`, "Session window has no runnable steps."));
        return;
      }

      const availableResponses = new Set();
      sequence.forEach((step, stepIndex) => {
        const stepPath = `${path}.phase_sequence[${stepIndex}]`;
        if (step.kind === "ema") {
          if (!step.id || surveyStepIds.has(step.id)) {
            issues.push(issue("error", "survey_step_id_invalid", `${stepPath}.id`, "Survey steps need distinct IDs."));
          }
          surveyStepIds.add(step.id);
          const ids = Array.isArray(step.question_ids) ? step.question_ids : [];
          if (new Set(ids).size !== ids.length || ids.some(id => !questionIds.has(id))) {
            issues.push(issue("error", "survey_question_ids_invalid", `${stepPath}.question_ids`, "Survey step contains duplicate or unknown question IDs."));
          }
          ids.forEach(id => assignedQuestionIds.add(id));
          const eligible = ids.map(id => questionsById.get(id)).filter(question => question && question.type !== "page_break");
          if (eligible.length === 0) {
            issues.push(issue("error", "ema_step_empty", stepPath, `Survey step has no questions for "${window.label || window.id}".`));
          }
          eligible.forEach(question => {
            validateConditionAvailability(question.condition, availableResponses, `question:${question.id}.condition@${window.id}`, issues);
            const questionIndex = questionIndexes.get(question.id);
            validatePipingAvailability(
              question.text,
              question.id,
              availableResponses,
              questionsById,
              `ema.questions[${questionIndex}].text`,
              `session "${window.label || window.id}"`,
              issues
            );
            if (RESPONSE_TYPES.has(question.type)) availableResponses.add(question.id);
          });
          return;
        }
        if (step.kind === "task") {
          if (!step.id || !modules[step.id]) {
            issues.push(issue("error", "task_module_unavailable", `${stepPath}.id`, `Task module "${step.id || "(none)"}" is not enabled.`));
          }
          validateCondition(step.condition, availableResponses, `${stepPath}.condition`, issues);
          return;
        }
        issues.push(issue("error", "phase_kind_unsupported", `${stepPath}.kind`, `Phase kind "${step.kind || "(missing)"}" is not supported by the runtime.`));
      });
    });
    questions.forEach((question, index) => {
      if (question.type !== "page_break" && !assignedQuestionIds.has(question.id)) {
        issues.push(issue("error", "question_unassigned", `ema.questions[${index}]`, "Assign this question to a survey step or delete it."));
      }
    });

    if (modules.epat) {
      const epat = modules.epat;
      const trials = Number(epat.trials);
      const duration = Number(epat.trial_duration_sec);
      const retryBudget = Number(epat.retry_budget);
      const sqi = Number(epat.sqi_threshold);
      if (!Number.isInteger(trials) || trials < 5 || trials > 40) {
        issues.push(issue("error", "epat_trials_invalid", "modules.epat.trials", "ePAT trials must be a whole number from 5 to 40."));
      }
      if (!Number.isFinite(duration) || duration < 15 || duration > 60) {
        issues.push(issue("error", "epat_duration_invalid", "modules.epat.trial_duration_sec", "ePAT trial duration must be 15–60 seconds."));
      }
      if (!Number.isInteger(retryBudget) || retryBudget < trials || retryBudget > 60) {
        issues.push(issue("error", "epat_retry_budget_invalid", "modules.epat.retry_budget", "ePAT retry budget must be at least the trial count and no more than 60."));
      }
      if (!Number.isFinite(sqi) || sqi < 0.001 || sqi > 0.05) {
        issues.push(issue("error", "epat_sqi_invalid", "modules.epat.sqi_threshold", "ePAT SQI threshold must be between 0.001 and 0.05."));
      }
    }

    if (modules.hct) {
      const hct = modules.hct;
      const intervals = Array.isArray(hct.intervals) ? hct.intervals.map(Number) : [];
      if (intervals.length === 0 || intervals.some(value => !Number.isFinite(value) || value < 5 || value > 300)) {
        issues.push(issue("error", "hct_intervals_invalid", "modules.hct.intervals", "HCT needs one or more intervals between 5 and 300 seconds."));
      }
      const practiceDuration = Number(hct.practice_duration_sec);
      if (!Number.isFinite(practiceDuration) || practiceDuration < 5 || practiceDuration > 60) {
        issues.push(issue("error", "hct_practice_invalid", "modules.hct.practice_duration_sec", "HCT practice duration must be 5–60 seconds."));
      }
      const retryBudget = Number(hct.retry_budget);
      if (!Number.isInteger(retryBudget) || retryBudget < 0 || retryBudget > 30) {
        issues.push(issue("error", "hct_retry_budget_invalid", "modules.hct.retry_budget", "HCT retry budget must be a whole number from 0 to 30."));
      }
    }

    if (modules.iat) {
      const iat = modules.iat;
      const trials = Array.isArray(iat.block_trials) ? iat.block_trials.map(Number) : [];
      if (trials.length !== 7 || trials.some(value => !Number.isInteger(value) || value < 10 || value > 80)) {
        issues.push(issue("error", "iat_block_trials_invalid", "modules.iat.block_trials", "IAT requires seven block counts, each from 10 to 80 trials."));
      }
      const iti = Number(iat.iti_ms);
      if (!Number.isFinite(iti) || iti < 100 || iti > 1000) {
        issues.push(issue("error", "iat_iti_invalid", "modules.iat.iti_ms", "IAT inter-trial interval must be 100–1000 ms."));
      }
      ["target_a_words", "target_b_words", "attr_pos_words", "attr_neg_words"].forEach(field => {
        const words = Array.isArray(iat[field]) ? iat[field].map(String).map(word => word.trim()).filter(Boolean) : [];
        if (words.length < 2 || new Set(words.map(word => word.toLowerCase())).size !== words.length) {
          issues.push(issue("error", "iat_words_invalid", `modules.iat.${field}`, "Each IAT category needs at least two unique, non-empty words."));
        }
      });
    }

    if (modules.iat) {
      issues.push(issue("warning", "iat_experimental", "modules.iat", "IAT is experimental and should not be used for confirmatory research without independent validation."));
    }
    if (questions.some(question => question.type === "heart_rate") || modules.epat || modules.hct) {
      issues.push(issue("warning", "physiology_device_pilot", "modules", "Physiological capture requires HTTPS, camera permission, and device-specific pilot testing."));
    }

    return {
      valid: !issues.some(item => item.severity === "error"),
      errors: issues.filter(item => item.severity === "error"),
      warnings: issues.filter(item => item.severity === "warning"),
      issues
    };
  }

  return { validate, textOnly, validHm };
});
