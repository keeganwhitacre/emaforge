"use strict";

const undoBanner = document.getElementById('builder-undo');
const undoAction = document.getElementById('builder-undo-action');
let undoRemoval = null;

function clearBuilderUndo() {
  undoRemoval = null;
  undoBanner.hidden = true;
  document.getElementById('builder-change-status').textContent = '';
}

function offerBuilderUndo(label, restore, event) {
  undoRemoval = restore;
  undoBanner.hidden = false;
  document.getElementById('builder-undo-message').textContent = label;
  document.getElementById('builder-change-status').textContent = `${label} Undo is available.`;
  if (event?.detail === 0) undoAction.focus();
}

undoAction.addEventListener('click', () => {
  const restore = undoRemoval;
  clearBuilderUndo();
  restore?.();
  document.getElementById('builder-change-status').textContent = 'Removal undone.';
  document.getElementById('builder-section-title').focus({ preventScroll: true });
});

document.getElementById('builder-undo-dismiss').addEventListener('click', () => {
  clearBuilderUndo();
  document.getElementById('builder-section-title').focus({ preventScroll: true });
});

// Use surviving neighbors when an item was added or moved before Undo.
function rememberBuilderPosition(items, index, same = (a, b) => a === b) {
  const before = items.slice(0, index).reverse();
  const after = items.slice(index + 1);
  return (current, item) => {
    for (const neighbor of after) {
      const next = current.findIndex(candidate => same(candidate, neighbor));
      if (next !== -1) {
        current.splice(next, 0, item);
        return;
      }
    }
    for (const neighbor of before) {
      const previous = current.findIndex(candidate => same(candidate, neighbor));
      if (previous !== -1) {
        current.splice(previous + 1, 0, item);
        return;
      }
    }
    current.splice(Math.min(index, current.length), 0, item);
  };
}

function refreshAfterRemoval() {
  renderWindows();
  renderQuestions();
  renderPreviewTabs();
  rememberBuilderWorkspace();
  schedulePreview();
}

function removeTaskFromSession(window, stepIndex, event) {
  const step = window.phase_sequence[stepIndex];
  const restorePosition = rememberBuilderPosition(window.phase_sequence, stepIndex, sameBuilderStep);
  window.phase_sequence.splice(stepIndex, 1);
  const module = state.modules.find(candidate => candidate.id === step.id);
  const wasEnabled = module?.enabled;
  if (module && !state.ema.scheduling.windows.some(candidate =>
    candidate.phase_sequence.some(phase => phase.kind === 'task' && phase.id === step.id))) {
    module.enabled = false;
  }
  renderModules();
  refreshAfterRemoval();
  offerBuilderUndo('Task removed from session.', () => {
    restorePosition(window.phase_sequence, step);
    if (module && wasEnabled) module.enabled = true;
    renderModules();
    refreshAfterRemoval();
  }, event);
}

function sameBuilderStep(a, b) {
  return a === b || (a.kind === b.kind && a.id === b.id);
}

function removeQuestionFromSession(question, window, entries, flowIndex, event) {
  const { sourceStepIndex } = entries[flowIndex];
  const step = window.phase_sequence[sourceStepIndex];
  const index = entries.slice(0, flowIndex)
    .filter(candidate => candidate.sourceStepIndex === sourceStepIndex).length;
  removeBuilderQuestion(question, [{ window, step, index }], event);
}

function removeBuilderQuestion(question, assignments, event) {
  const questions = state.ema.questions;
  const questionIndex = questions.indexOf(question);
  const restoreQuestion = rememberBuilderPosition(questions, questionIndex, (a, b) => a.id === b.id);
  const restoreAssignments = assignments.map(({ window, step, index }) => {
    const restoreStep = rememberBuilderPosition(window.phase_sequence, window.phase_sequence.indexOf(step), sameBuilderStep);
    const restoreId = rememberBuilderPosition(step.question_ids, index);
    return () => {
      const liveStep = window.phase_sequence.find(candidate => sameBuilderStep(candidate, step));
      if (liveStep) restoreId(liveStep.question_ids, question.id);
      else {
        const restored = { ...step, question_ids: [] };
        restoreId(restored.question_ids, question.id);
        restoreStep(window.phase_sequence, restored);
      }
    };
  });

  // Work backwards so removing multiple occurrences does not shift later indexes.
  for (const { window, step, index } of [...assignments].reverse()) {
    step.question_ids.splice(index, 1);
    if (!step.question_ids.length) window.phase_sequence.splice(window.phase_sequence.indexOf(step), 1);
  }
  const stillAssigned = state.ema.scheduling.windows.some(window =>
    window.phase_sequence.some(step => step.question_ids?.includes(question.id)));
  if (!stillAssigned && questionIndex !== -1) questions.splice(questionIndex, 1);

  refreshAfterRemoval();
  offerBuilderUndo(question.type === 'page_break' ? 'Screen removed.' : 'Measure removed.', () => {
    if (questionIndex !== -1 && !state.ema.questions.some(candidate => candidate.id === question.id)) {
      restoreQuestion(state.ema.questions, question);
    }
    restoreAssignments.forEach(restore => restore());
    refreshAfterRemoval();
  }, event);
}
