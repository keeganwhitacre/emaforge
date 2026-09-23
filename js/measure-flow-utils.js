"use strict";

(function attachMeasureFlowUtils(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EMAForgeMeasureFlow = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMeasureFlowUtils() {
  function flatten(window) {
    const entries = [];
    (window?.phase_sequence || []).forEach((step, stepIndex) => {
      if (step.kind === 'task') {
        entries.push({
          kind: 'task',
          taskId: step.id,
          condition: step.condition || null,
          sourceStepId: step.id,
          sourceStepIndex: stepIndex
        });
        return;
      }
      (step.question_ids || []).forEach(questionId => entries.push({
        kind: 'question',
        questionId,
        sourceStepId: step.id,
        sourceLabel: step.label || 'Survey',
        sourceStepIndex: stepIndex
      }));
    });
    return entries;
  }

  function compile(entries, newStepId) {
    const steps = [];
    let survey = null;
    const usedStepIds = new Set();
    (entries || []).forEach(entry => {
      if (entry.kind === 'task') {
        survey = null;
        steps.push({ kind: 'task', id: entry.taskId, condition: entry.condition || null });
        return;
      }
      if (entry.kind !== 'question' || !entry.questionId) return;
      if (!survey) {
        const canReuse = entry.sourceStepId && !usedStepIds.has(entry.sourceStepId);
        const id = canReuse ? entry.sourceStepId : newStepId();
        usedStepIds.add(id);
        survey = { kind: 'ema', id, label: entry.sourceLabel || 'Survey', question_ids: [] };
        steps.push(survey);
      }
      survey.question_ids.push(entry.questionId);
    });
    return steps;
  }

  return { flatten, compile };
});
