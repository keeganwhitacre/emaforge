"use strict";

// Pure, dependency-free helpers shared by the generated participant runtime
// and the regression suite. Keep protocol decisions here so the builder and
// runtime cannot silently diverge.
(function attachRuntimeUtils(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EMAForgeRuntimeUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createRuntimeUtils() {
  function responseValue(record) {
    if (record && typeof record === "object" && "value" in record) return record.value;
    return record;
  }

  function parsePipingToken(rawToken) {
    const parts = String(rawToken || "").split("|");
    return {
      questionId: (parts.shift() || "").trim(),
      fallback: parts.join("|").trim()
    };
  }

  function formatPipedValue(value) {
    if (value === undefined || value === null || value === "") return null;
    if (Array.isArray(value)) {
      const items = value.map(item => String(item).trim()).filter(Boolean);
      if (items.length === 0) return null;
      if (items.length === 1) return items[0];
      if (items.length === 2) return `${items[0]} and ${items[1]}`;
      return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(Math.round(value * 10) / 10);
    }
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "object") return null;
    const text = String(value).trim();
    if (!text) return null;
    const numeric = Number(text);
    return Number.isFinite(numeric) ? String(Math.round(numeric * 10) / 10) : text;
  }

  function interpolateText(text, responses) {
    return String(text || "").replace(/\{\{([^{}]+)\}\}/g, (_match, rawToken) => {
      const token = parsePipingToken(rawToken);
      if (!token.questionId) return token.fallback;
      const formatted = formatPipedValue(responseValue((responses || {})[token.questionId]));
      return formatted === null ? token.fallback : formatted;
    }).replace(/\s+([,.;!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
  }

  function evaluateCondition(condition, responses) {
    if (!condition) return true;

    if (Array.isArray(condition.rules)) {
      if (condition.rules.length === 0) return true;
      const results = condition.rules.map(rule => evaluateCondition(rule, responses));
      return condition.logical_op === "OR" ? results.some(Boolean) : results.every(Boolean);
    }

    if (!condition.question_id) return false;
    const value = responseValue((responses || {})[condition.question_id]);
    if (value === undefined || value === null || value === "") return false;

    const comparison = condition.value;
    switch (condition.operator) {
      case "eq": return value == comparison; // Preserve legacy numeric/string configs.
      case "neq": return value != comparison;
      case "gt": return Number(value) > Number(comparison);
      case "gte": return Number(value) >= Number(comparison);
      case "lt": return Number(value) < Number(comparison);
      case "lte": return Number(value) <= Number(comparison);
      case "includes": {
        const expected = Array.isArray(comparison) ? comparison : [comparison];
        const actual = Array.isArray(value) ? value : [value];
        return expected.some(item => actual.includes(item));
      }
      default: return false;
    }
  }

  function buildPhasePlan(windowConfig, enabledModules) {
    const sequence = Array.isArray(windowConfig.phase_sequence) && windowConfig.phase_sequence.length
      ? windowConfig.phase_sequence
      : [];
    let surveyCount = 0;

    return sequence.flatMap((step, stepIndex) => {
      if (step.kind === "ema") {
        surveyCount += 1;
        const ordinal = surveyCount;
        const prefix = ordinal === 1 ? "survey" : `survey${ordinal}`;
        return [{
          token: `${prefix}_${windowConfig.id}`,
          kind: "ema",
          stepId: step.id,
          questionIds: step.question_ids,
          windowId: windowConfig.id,
          ordinal,
          stepIndex
        }];
      }

      if (step.kind === "task" && step.id && enabledModules && enabledModules[step.id]) {
        return [{
          token: step.id,
          kind: "task",
          moduleId: step.id,
          condition: step.condition || null,
          stepIndex
        }];
      }

      return [];
    });
  }

  function questionsForStep(questions, questionIds) {
    const byId = new Map((questions || []).map(question => [question.id, question]));
    return (questionIds || []).map(questionId => byId.get(questionId)).filter(Boolean);
  }

  function pageContainsPhysiology(page) {
    return (page || []).some(question => question && question.type === "heart_rate");
  }

  function canNavigateBack(enabled, currentPageIndex, pages) {
    if (enabled !== true || currentPageIndex <= 0) return false;
    return !pageContainsPhysiology(pages?.[currentPageIndex]) &&
      !pageContainsPhysiology(pages?.[currentPageIndex - 1]);
  }

  function questionIdsAfterPage(pages, pageIndex) {
    return (pages || []).slice(pageIndex + 1).flatMap(page =>
      (page || []).map(question => question && question.id).filter(Boolean)
    );
  }

  function isWebhookAcknowledgement(receipt, submissionId) {
    return !!receipt && typeof receipt === "object" && receipt.status === "success" &&
      (!Object.prototype.hasOwnProperty.call(receipt, "submission_id") || receipt.submission_id === submissionId);
  }

  function parseUserAgentMetadata(userAgent) {
    const ua = String(userAgent || "");
    let deviceModel = "Unknown";
    let osName = "Unknown";
    let osVersion = "";
    let browserName = "Unknown";
    let browserVersion = "";

    if (/iPhone/.test(ua)) {
      deviceModel = "iPhone";
      osName = "iOS";
      const match = ua.match(/OS (\d+[_\.]\d+[_\.]?\d*)/);
      if (match) osVersion = match[1].replace(/_/g, ".");
    } else if (/iPad/.test(ua)) {
      deviceModel = "iPad";
      osName = "iPadOS";
      const match = ua.match(/OS (\d+[_\.]\d+[_\.]?\d*)/);
      if (match) osVersion = match[1].replace(/_/g, ".");
    } else if (/Android/.test(ua)) {
      osName = "Android";
      const match = ua.match(/Android ([\d.]+)/);
      if (match) osVersion = match[1];
      const model = ua.match(/;\s*([^;)]+)\s*Build\//);
      deviceModel = model ? model[1].trim() : "Android Device";
    } else if (/Mac OS X/.test(ua)) {
      osName = "macOS";
      const match = ua.match(/Mac OS X ([\d_]+)/);
      if (match) osVersion = match[1].replace(/_/g, ".");
      deviceModel = "Mac";
    } else if (/Windows/.test(ua)) {
      osName = "Windows";
      const match = ua.match(/Windows NT ([\d.]+)/);
      if (match) osVersion = match[1];
      deviceModel = "PC";
    }

    const browserPatterns = [
      ["Edge", /EdgiOS\/([\d.]+)/],
      ["Chrome", /CriOS\/([\d.]+)/],
      ["Firefox", /FxiOS\/([\d.]+)/],
      ["Edge", /Edg\/([\d.]+)/],
      ["Chrome", /Chrome\/([\d.]+)/],
      ["Firefox", /Firefox\/([\d.]+)/],
      ["Safari", /Version\/([\d.]+).*Safari\//]
    ];
    for (const [name, pattern] of browserPatterns) {
      const match = ua.match(pattern);
      if (!match) continue;
      browserName = name;
      browserVersion = match[1];
      break;
    }

    return { deviceModel, osName, osVersion, browserName, browserVersion };
  }

  function parseEmaPhaseToken(token) {
    const match = /^survey(\d*)_(.+)$/.exec(token || "");
    if (!match) return null;
    return {
      block: "survey",
      ordinal: match[1] ? Number(match[1]) : 1,
      windowId: match[2]
    };
  }

  function collectResponses(data) {
    const responses = {};
    (data || []).forEach(entry => {
      if (entry && entry.type === "ema_response" && entry.responses) {
        Object.assign(responses, entry.responses);
      }
      if (entry && entry.type === "hr_capture" && entry.question_id) {
        responses[entry.question_id] = { value: entry.bpm, respondedAt: entry.capturedAt };
      }
    });
    return responses;
  }

  function phaseMsFromKnob(finalKnobValue, rrMs) {
    if (!Number.isFinite(finalKnobValue) || !Number.isFinite(rrMs) || rrMs <= 0) return null;
    return finalKnobValue * rrMs / 2;
  }

  function buildResponseWindowPolicy(sentAtValue, timing) {
    const rawSentAt = String(sentAtValue || "").trim();
    const sentAtMs = /^\d+$/.test(rawSentAt) ? Number(rawSentAt) : NaN;
    const expiryMinutes = Number(timing && timing.expiry_minutes) || 0;
    const graceMinutes = Number(timing && timing.grace_minutes) || 0;
    const hasTimestamp = Number.isFinite(sentAtMs);
    return {
      enforced: hasTimestamp && expiryMinutes > 0,
      sentAtMs,
      expiresAtMs: hasTimestamp ? sentAtMs + expiryMinutes * 60000 : null,
      graceUntilMs: hasTimestamp ? sentAtMs + (expiryMinutes + graceMinutes) * 60000 : null
    };
  }

  function canStartResponseWindow(policy, nowMs) {
    return !policy?.enforced || nowMs <= policy.expiresAtMs;
  }

  function isResponseWindowHardExpired(policy, nowMs) {
    return !!policy?.enforced && nowMs > policy.graceUntilMs;
  }

  function sanitizeStudyHtml(html) {
    if (typeof document === "undefined") return String(html || "");
    const allowedTags = new Set(["H1", "H2", "H3", "H4", "P", "UL", "OL", "LI", "STRONG", "EM", "A", "BR"]);
    const template = document.createElement("template");
    template.innerHTML = String(html || "");

    Array.from(template.content.querySelectorAll("*")).forEach(element => {
      if (!allowedTags.has(element.tagName)) {
        element.replaceWith(document.createTextNode(element.textContent || ""));
        return;
      }
      Array.from(element.attributes).forEach(attribute => {
        if (element.tagName !== "A" || attribute.name !== "href") element.removeAttribute(attribute.name);
      });
      if (element.tagName === "A") {
        const href = element.getAttribute("href") || "";
        if (!/^(?:https?:|mailto:)/i.test(href)) element.removeAttribute("href");
        element.setAttribute("rel", "noopener noreferrer");
        element.setAttribute("target", "_blank");
      }
    });
    return template.innerHTML;
  }

  return {
    responseValue,
    parsePipingToken,
    formatPipedValue,
    interpolateText,
    evaluateCondition,
    buildPhasePlan,
    questionsForStep,
    pageContainsPhysiology,
    canNavigateBack,
    questionIdsAfterPage,
    isWebhookAcknowledgement,
    parseUserAgentMetadata,
    parseEmaPhaseToken,
    collectResponses,
    phaseMsFromKnob,
    buildResponseWindowPolicy,
    canStartResponseWindow,
    isResponseWindowHardExpired,
    sanitizeStudyHtml
  };
});
