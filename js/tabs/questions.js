"use strict";

// ---------------------------------------------------------------------------
// Questions are optional in a physiology-only study. A survey step is
// inserted into the first session when the first question is created.
// ---------------------------------------------------------------------------

function renderQuestions() {
  renderMeasureComposer();
  if (typeof renderBuilderShell === 'function') renderBuilderShell();
}

let measureInsertIndex = null;
let draggedMeasureIndex = null;

const surveyMeasureCatalog = [
  { value: 'slider', label: 'Rating scale', description: 'Numeric range with anchors' },
  { value: 'choice', label: 'Single choice', description: 'Choose one response' },
  { value: 'checkbox', label: 'Multiple choice', description: 'Choose any that apply' },
  { value: 'text', label: 'Open text', description: 'Free response' },
  { value: 'numeric', label: 'Number', description: 'Numeric entry' },
  { value: 'affect_grid', label: 'Affect grid', description: 'Valence × arousal' },
  { value: 'body_map', label: 'Body map', description: 'Select body regions' },
  { value: 'place_context', label: 'Place context', description: 'Optional location-derived area indicators' }
];

const structureMeasureCatalog = [
  { value: 'instruction', label: 'Instruction screen', description: 'Standalone guidance' },
  { value: 'page_break', label: 'New screen', description: 'Start a named survey section' }
];

function selectedMeasureWindow() {
  const windows = state.ema.scheduling.windows || [];
  const selected = windows.find(window => window.id === previewSession);
  if (selected) return selected;
  if (windows[0]) previewSession = windows[0].id;
  return windows[0] || null;
}

function selectMeasureSession(windowId) {
  if (!state.ema.scheduling.windows.some(window => window.id === windowId)) return;
  previewSession = windowId;
  measureInsertIndex = null;
  closeMeasurePicker();
  renderPreviewTabs();
  renderMeasureComposer();
  renderPreview();
}

function renderMeasureSessionTabs() {
  const tabs = document.getElementById('measure-session-tabs');
  const addButton = document.getElementById('open-measure-picker');
  if (!tabs) return;
  const windows = state.ema.scheduling.windows || [];
  const selected = selectedMeasureWindow();
  tabs.replaceChildren();
  windows.forEach(window => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `measure-session-tab${selected?.id === window.id ? ' active' : ''}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(selected?.id === window.id));
    button.textContent = window.label || 'Untitled session';
    button.addEventListener('click', () => selectMeasureSession(window.id));
    tabs.appendChild(button);
  });
  if (!windows.length) tabs.innerHTML = '<span class="field-hint">Add a session in Schedule first.</span>';
  if (addButton) addButton.disabled = !windows.length;
}

function measurePickerGroups() {
  const stable = (state.modules || []).filter(module => module.badge !== 'Experimental');
  const experimental = (state.modules || []).filter(module => module.badge === 'Experimental');
  const physiology = [
    { value: 'heart_rate', label: 'PPG heart rate', description: 'Camera-based BPM and IBI' },
    ...stable.map(module => ({ value: `task:${module.id}`, label: module.label, description: module.desc || 'Built-in physiology task' }))
  ];
  const groups = [
    { label: 'Survey responses', items: surveyMeasureCatalog },
    { label: 'Guidance & structure', items: structureMeasureCatalog },
    { label: 'Physiology', items: physiology }
  ];
  if (experimental.length) groups.push({
    label: 'Experimental',
    items: experimental.map(module => ({ value: `task:${module.id}`, label: module.label, description: module.desc || 'Experimental task' }))
  });
  return groups;
}

function renderMeasurePicker(query = '') {
  const container = document.getElementById('measure-picker-groups');
  if (!container) return;
  const needle = query.trim().toLowerCase();
  container.innerHTML = measurePickerGroups().map(group => {
    const items = group.items.filter(item => !needle || `${item.label} ${item.description}`.toLowerCase().includes(needle));
    if (!items.length) return '';
    return `<section class="measure-picker-group"><h3>${escH(group.label)}</h3><div class="measure-picker-grid">${items.map(item =>
      `<button type="button" class="measure-picker-item" data-measure-type="${escH(item.value)}"><strong>${escH(item.label)}</strong><span>${escH(item.description)}</span></button>`
    ).join('')}</div></section>`;
  }).join('') || '<p class="questions-empty">No measures match that search.</p>';
  container.querySelectorAll('.measure-picker-item').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.measureType === 'place_context') {
      confirmPlaceContext(() => addMeasureAt('place_context', measureInsertIndex));
    } else addMeasureAt(button.dataset.measureType, measureInsertIndex);
  }));
}

function confirmPlaceContext(onAccept) {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', 'Place context setup');
  dialog.style.cssText = 'max-width:min(540px,calc(100vw - 32px));padding:24px;border:1px solid #c9ced3;border-radius:8px;color:#222;background:#fff;line-height:1.55;box-shadow:0 20px 60px #0004';
  dialog.innerHTML = `<h2 style="margin:0 0 12px">Add place context?</h2>
    <p>This optional measure asks for the participant’s current location only when they tap Use my location. Automatic EPA built-environment measures and Census urban/rural require a Cloudflare study host and send coordinates to the study Worker and each selected provider. Alternatively, upload a licensed area dataset so matching happens entirely in the participant browser.</p>
    <p>Coordinates are not written to EMA Forge responses in either mode. Services involved in an online lookup may process requests and metadata; derived area categories can still be sensitive with participant IDs and response times. Check consent, IRB and institutional requirements, source terms, coverage, and device accuracy before enrollment.</p>
    <label style="display:flex;gap:10px;align-items:start;margin:16px 0"><input type="checkbox" required style="margin-top:6px"><span>I understand the source, consent, and privacy limits.</span></label>
    <div style="display:flex;gap:10px;justify-content:end"><button type="button" data-action="cancel">Cancel</button><button type="button" data-action="add" disabled>Add optional measure</button></div>`;
  document.body.append(dialog);
  const check = dialog.querySelector('input');
  const add = dialog.querySelector('[data-action="add"]');
  check.addEventListener('change', () => { add.disabled = !check.checked; });
  dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());
  add.addEventListener('click', () => { if (check.checked) { dialog.close(); onAccept(); } });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
}

function openMeasurePicker(index = null) {
  const picker = document.getElementById('measure-picker');
  const window = selectedMeasureWindow();
  if (!picker || !window) return;
  const entries = EMAForgeMeasureFlow.flatten(window);
  measureInsertIndex = Number.isInteger(index) ? Math.max(0, Math.min(index, entries.length)) : entries.length;
  const context = document.getElementById('measure-picker-context');
  if (context) context.textContent = measureInsertIndex === entries.length
    ? `Add to the end of ${window.label}.`
    : `Insert as step ${measureInsertIndex + 1} in ${window.label}.`;
  picker.hidden = false;
  const search = document.getElementById('measure-picker-search');
  if (search) search.value = '';
  renderMeasurePicker();
  search?.focus();
  picker.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeMeasurePicker() {
  const picker = document.getElementById('measure-picker');
  if (picker) picker.hidden = true;
}

function renderMeasureComposer() {
  const flow = document.getElementById('measure-flow');
  const windows = state.ema.scheduling.windows || [];
  renderMeasureSessionTabs();
  if (!flow) return;
  if (!windows.length) {
    flow.innerHTML = '<div class="measure-flow-heading"><strong>Participant flow</strong><span>Add a session in Schedule to place measures.</span></div>';
    return;
  }
  const window = selectedMeasureWindow();
  const entries = EMAForgeMeasureFlow.flatten(window);
  flow.innerHTML = `<div class="measure-flow-heading"><div><strong>${escH(window.label || 'Untitled session')}</strong><span class="measure-flow-session">Participant flow</span></div><span>Expand to edit · drag to reorder</span></div>`;
  const list = document.createElement('div');
  list.className = 'measure-flow-list';
  if (!entries.length) list.innerHTML = '<p class="questions-empty">Nothing here yet. Add a question, instruction, or physiology task to begin.</p>';
  appendFlowDropSlot(list, 0);
  entries.forEach((entry, index) => {
    list.appendChild(buildMeasureFlowCard(window, entries, entry, index));
    appendFlowDropSlot(list, index + 1);
  });
  wireFlowListReordering(list, window, entries);
  flow.appendChild(list);
}

function appendFlowDropSlot(list, index) {
  const slot = document.createElement('div');
  slot.className = 'flow-drop-slot';
  slot.dataset.dropIndex = String(index);
  slot.innerHTML = `<button type="button" class="flow-insert-button" aria-label="Add measure at position ${index + 1}" title="Add measure here">+</button>`;
  slot.querySelector('button').addEventListener('click', () => openMeasurePicker(index));
  list.appendChild(slot);
}

function clearFlowDropTargets(list) {
  list.classList.remove('drag-active');
  list.querySelectorAll('.flow-drop-slot').forEach(slot => slot.classList.remove('drag-target'));
}

function wireFlowListReordering(list, window, entries) {
  list.addEventListener('dragover', event => {
    if (!Number.isInteger(draggedMeasureIndex)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    list.classList.add('drag-active');
    const cards = Array.from(list.querySelectorAll('.flow-item'));
    let insertionIndex = entries.length;
    for (let index = 0; index < cards.length; index++) {
      const rect = cards[index].getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) { insertionIndex = index; break; }
    }
    list.querySelectorAll('.flow-drop-slot').forEach(slot => slot.classList.toggle('drag-target', Number(slot.dataset.dropIndex) === insertionIndex));
  });
  list.addEventListener('drop', event => {
    if (!Number.isInteger(draggedMeasureIndex)) return;
    event.preventDefault();
    const target = Number(list.querySelector('.flow-drop-slot.drag-target')?.dataset.dropIndex);
    const from = draggedMeasureIndex;
    clearFlowDropTargets(list);
    draggedMeasureIndex = null;
    if (!Number.isInteger(target) || from < 0 || from >= entries.length) return;
    const [moved] = entries.splice(from, 1);
    const adjusted = target > from ? target - 1 : target;
    entries.splice(adjusted, 0, moved);
    commitMeasureFlow(window, entries);
  });
  list.addEventListener('dragleave', event => {
    if (!list.contains(event.relatedTarget)) clearFlowDropTargets(list);
  });
}

function buildMeasureFlowCard(window, entries, entry, index) {
  const question = entry.kind === 'question' ? state.ema.questions.find(candidate => candidate.id === entry.questionId) : null;
  if (question) return buildQuestionFlowCard(window, entries, entry, index, question);
  const card = document.createElement('div');
  card.className = `measure-flow-card flow-item ${entry.kind}`;
  card.draggable = true;
  card.dataset.index = String(index);
  const module = entry.kind === 'task' ? state.modules.find(candidate => candidate.id === entry.taskId) : null;
  const type = 'Physiology task';
  const title = module?.label || entry.taskId;
  const description = module?.desc || 'Built-in participant task';
  card.innerHTML = `<span class="measure-flow-handle" aria-hidden="true">⠿</span>
    <span class="measure-flow-order">${index + 1}</span>
    <span class="measure-flow-copy"><strong>${escH(title)}</strong><span>${escH(type)} · ${escH(description)}</span></span>
    <span class="measure-flow-actions">
      <button type="button" class="measure-edit">Settings</button>
      <button type="button" class="measure-up" aria-label="Move earlier" ${index === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="measure-down" aria-label="Move later" ${index === entries.length - 1 ? 'disabled' : ''}>↓</button>
      <button type="button" class="measure-remove" aria-label="Remove from session">✕</button>
    </span>`;
  if (entry.kind === 'task') {
    const details = document.createElement('details');
    details.className = 'measure-flow-condition';
    const summary = document.createElement('summary');
    summary.textContent = entry.condition ? 'Conditional · edit rule' : 'Add conditional logic';
    const taskStep = window.phase_sequence[entry.sourceStepIndex];
    if (taskStep) {
      details.append(summary, buildConditionRow(taskStep, window));
      details.addEventListener('toggle', () => { if (details.open) summary.textContent = 'Conditional logic'; });
      card.appendChild(details);
    }
  }
  card.addEventListener('dragstart', event => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
    draggedMeasureIndex = index;
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    draggedMeasureIndex = null;
    const list = card.closest('.measure-flow-list');
    if (list) clearFlowDropTargets(list);
  });
  card.querySelector('.measure-up')?.addEventListener('click', () => {
    if (index > 0) [entries[index - 1], entries[index]] = [entries[index], entries[index - 1]];
    commitMeasureFlow(window, entries);
  });
  card.querySelector('.measure-down')?.addEventListener('click', () => {
    if (index < entries.length - 1) [entries[index], entries[index + 1]] = [entries[index + 1], entries[index]];
    commitMeasureFlow(window, entries);
  });
  card.querySelector('.measure-remove')?.addEventListener('click', () => {
    entries.splice(index, 1);
    commitMeasureFlow(window, entries);
    if (entry.kind === 'task' && !state.ema.scheduling.windows.some(candidate =>
      candidate.phase_sequence?.some(step => step.kind === 'task' && step.id === entry.taskId))) {
      const taskModule = state.modules.find(candidate => candidate.id === entry.taskId);
      if (taskModule) taskModule.enabled = false;
      if (typeof renderModules === 'function') renderModules();
    }
  });
  card.querySelector('.measure-edit')?.addEventListener('click', () => {
    document.querySelector('.tab-btn[data-tab="tasks"]')?.click();
    const taskCard = document.querySelector(`.task-card[data-mod-id="${CSS.escape(entry.taskId)}"]`);
    const settings = taskCard?.querySelector('details.task-settings');
    if (settings) settings.open = true;
    taskCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  return card;
}

function buildQuestionFlowCard(window, entries, entry, flowIndex, question) {
  const questionIndex = state.ema.questions.indexOf(question);
  const pipeSources = entries.slice(0, flowIndex)
    .filter(candidate => candidate.kind === 'question')
    .map(candidate => state.ema.questions.find(item => item.id === candidate.questionId))
    .filter(candidate => candidate && !['page_break', 'instruction', 'affect_grid'].includes(candidate.type));
  const card = buildQCard(question, questionIndex, flowIndex + 1, { flow: true, pipeSources });
  card.classList.add('flow-item', 'flow-question-card');
  const header = card.querySelector('.q-header');
  const actions = document.createElement('span');
  actions.className = 'measure-flow-actions';
  actions.innerHTML = `<button type="button" class="measure-up" aria-label="Move earlier" ${flowIndex === 0 ? 'disabled' : ''}>↑</button>
    <button type="button" class="measure-down" aria-label="Move later" ${flowIndex === entries.length - 1 ? 'disabled' : ''}>↓</button>
    <button type="button" class="measure-remove" aria-label="Remove from this session" title="Remove from this session">✕</button>`;
  const chevron = header.querySelector('.q-chevron');
  header.insertBefore(actions, chevron || null);
  wireQuestionFlowReordering(card, window, entries, entry, flowIndex);
  actions.querySelector('.measure-up').addEventListener('click', event => {
    event.stopPropagation();
    if (flowIndex > 0) [entries[flowIndex - 1], entries[flowIndex]] = [entries[flowIndex], entries[flowIndex - 1]];
    commitMeasureFlow(window, entries);
  });
  actions.querySelector('.measure-down').addEventListener('click', event => {
    event.stopPropagation();
    if (flowIndex < entries.length - 1) [entries[flowIndex], entries[flowIndex + 1]] = [entries[flowIndex + 1], entries[flowIndex]];
    commitMeasureFlow(window, entries);
  });
  actions.querySelector('.measure-remove').addEventListener('click', event => {
    event.stopPropagation();
    entries.splice(flowIndex, 1);
    window.phase_sequence = EMAForgeMeasureFlow.compile(entries, genSId);
    const stillUsed = state.ema.scheduling.windows.some(candidate => candidate.phase_sequence?.some(step =>
      step.kind === 'ema' && (step.question_ids || []).includes(question.id)));
    if (!stillUsed) state.ema.questions = state.ema.questions.filter(candidate => candidate.id !== question.id);
    renderWindows(); renderQuestions(); renderPreviewTabs(); schedulePreview();
  });
  return card;
}

function wireQuestionFlowReordering(card, window, entries, entry, flowIndex) {
  const handle = card.querySelector('.q-drag-handle');
  card.draggable = false;
  handle?.addEventListener('mousedown', () => { card.draggable = true; });
  handle?.addEventListener('mouseup', () => { card.draggable = false; });
  card.addEventListener('dragstart', event => {
    if (!card.draggable) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(flowIndex));
    draggedMeasureIndex = flowIndex;
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    card.draggable = false;
    card.classList.remove('dragging');
    draggedMeasureIndex = null;
    const list = card.closest('.measure-flow-list');
    if (list) clearFlowDropTargets(list);
  });
}

function measureTypeLabel(type) {
  return ({ slider: 'Rating scale', choice: 'Single choice', text: 'Open text', numeric: 'Number',
    checkbox: 'Multiple choice', affect_grid: 'Affect grid', body_map: 'Body map',
    instruction: 'Instruction screen', page_break: 'New screen', heart_rate: 'PPG heart-rate capture', place_context: 'Place context' })[type] || 'Survey item';
}

function commitMeasureFlow(window, entries) {
  window.phase_sequence = EMAForgeMeasureFlow.compile(entries, genSId);
  previewSession = window.id;
  renderWindows();
  renderQuestions();
  renderPreviewTabs();
  schedulePreview();
}

function setMeasureFeedback(message, isError = false) {
  const feedback = document.getElementById('measure-add-feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.style.color = isError ? 'var(--red)' : 'var(--fg-2)';
}

function questionPipingTokens(text) {
  return Array.from(String(text || '').matchAll(/\{\{([^{}]+)\}\}/g)).map(match => {
    const parts = match[1].split('|');
    return { id: (parts.shift() || '').trim(), fallback: parts.join('|').trim() };
  });
}

function pipingQuestionLabel(questionId) {
  const source = state.ema.questions.find(question => question.id === questionId);
  return source?.text?.replace(/\{\{[^{}]+\}\}/g, 'earlier answer').trim() || questionId;
}

function questionDisplayText(text) {
  return String(text || '').replace(/\{\{([^{}]+)\}\}/g, (_match, rawToken) => {
    const id = rawToken.split('|')[0].trim();
    return `[Answer: ${pipingQuestionLabel(id)}]`;
  });
}

function buildPipingControls(sources, question) {
  const usedCount = questionPipingTokens(question?.text).length;
  if (!sources.length && usedCount === 0) return '';
  return `<details class="q-piping" aria-label="Personalize question with an earlier answer">
    <summary><span>Personalize with an earlier answer</span><span class="q-pipe-count${usedCount ? ' active' : ''}">${usedCount ? `${usedCount} used` : 'Optional'}</span></summary>
    <div class="q-piping-body">
      <div class="q-piping-row">
      <select class="q-pipe-source" aria-label="Earlier answer">
        <option value="">Choose an earlier question…</option>
        ${sources.map(source => `<option value="${escH(source.id)}">${escH((source.text || source.id).slice(0, 72))} · ${escH(measureTypeLabel(source.type))}</option>`).join('')}
      </select>
      <input type="text" class="q-pipe-fallback" value="your earlier response" aria-label="Fallback wording" placeholder="Fallback if unanswered">
      <button type="button" class="q-pipe-insert" disabled>Insert</button>
      </div>
      <div class="field-hint">Inserted at the cursor. Fallback wording appears only when the earlier answer is unavailable.</div>
      <div class="q-pipe-summary" aria-live="polite"></div>
    </div>
  </details>`;
}

function renderPipingSummary(card, q) {
  const summary = card.querySelector('.q-pipe-summary');
  if (!summary) return;
  const tokens = questionPipingTokens(q.text);
  const count = card.querySelector('.q-pipe-count');
  if (count) {
    count.textContent = tokens.length ? `${tokens.length} used` : 'Optional';
    count.classList.toggle('active', tokens.length > 0);
  }
  summary.innerHTML = tokens.map(token => {
    const exists = state.ema.questions.some(question => question.id === token.id);
    return `<span class="q-pipe-chip${exists ? '' : ' invalid'}"><span>Answer from</span> ${escH(pipingQuestionLabel(token.id))}${token.fallback ? `<small>Fallback: ${escH(token.fallback)}</small>` : '<small>No fallback</small>'}</span>`;
  }).join('');
}

function bindPipingControls(card, q) {
  const select = card.querySelector('.q-pipe-source');
  const fallback = card.querySelector('.q-pipe-fallback');
  const insert = card.querySelector('.q-pipe-insert');
  const input = card.querySelector('.q-text');
  if (!select || !insert || !input) return;
  select.addEventListener('change', () => { insert.disabled = !select.value; });
  insert.addEventListener('click', () => {
    if (!select.value) return;
    const safeFallback = String(fallback?.value || '').replace(/[{}|]/g, '').trim();
    const token = `{{${select.value}${safeFallback ? `|${safeFallback}` : ''}}}`;
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    input.value = `${input.value.slice(0, start)}${token}${input.value.slice(end)}`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    input.setSelectionRange(start + token.length, start + token.length);
    select.value = '';
    insert.disabled = true;
  });
}

// Add displayNum as the third argument here
function buildQCard(q, index, displayNum, options = {}) {
  const card = document.createElement('div');
  card.className = 'q-card';
  card.dataset.qid = q.id;

  // Fill missing optional measurement controls.
  if (q.type === 'affect_grid') {
    if (!q.valence_labels) q.valence_labels = ['Unpleasant', 'Pleasant'];
    if (!q.arousal_labels) q.arousal_labels = ['Deactivated', 'Activated'];
    if (q.show_quadrant_labels === undefined) q.show_quadrant_labels = true;
  }
  if (q.type === 'heart_rate') {
    if (!q.duration_sec) q.duration_sec = 30;
    if (!q.report_as)    q.report_as    = 'bpm';
    if (q.display_bpm === undefined) q.display_bpm = true;   // backward-compat default
  }
  if (q.type === 'body_map') {
    if (!['single', 'multiple'].includes(q.selection_mode)) q.selection_mode = 'multiple';
    if (!Array.isArray(q.regions) || !q.regions.length) q.regions = defaultBodyRegions();
    if (q.allow_none === undefined) q.allow_none = true;
  }

  if (q.type === 'page_break') {
    card.classList.add('page-break');
    if (!q.label) q.label = 'New screen';
    card.innerHTML = `
      <div class="q-header" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;">
        <span class="q-drag-handle" style="cursor:grab;flex-shrink:0;">⠿</span>
        <span class="page-break-name" style="flex:1;">${escH(q.label)}</span>
        <span class="q-type-badge">New screen</span>
        <svg class="q-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4l4 4 4-4"/></svg>
      </div>
      <div class="q-body"><div class="field-group" style="padding-top:10px"><label class="field-label">Screen name</label><input type="text" class="page-break-label" value="${escH(q.label)}" placeholder="e.g. Evening reflection"></div></div>
    `;
    card.querySelector('.q-header').addEventListener('click', event => {
      if (!event.target.closest('.q-drag-handle, .measure-flow-actions')) card.classList.toggle('expanded');
    });
    card.querySelector('.page-break-label').addEventListener('input', event => {
      q.label = event.target.value;
      card.querySelector('.page-break-name').textContent = q.label || 'New screen';
      schedulePreview();
    });
    return card;
  }

  let typeLabel = q.type.charAt(0).toUpperCase() + q.type.slice(1).replace('_', ' ');
  if (q.type === 'choice')      typeLabel = 'Single Choice';
  if (q.type === 'checkbox')    typeLabel = 'Multi Select';
  if (q.type === 'affect_grid') typeLabel = 'Affect Grid';
  if (q.type === 'body_map')    typeLabel = 'Body Map';
  if (q.type === 'instruction') typeLabel = 'Instruction';
  if (q.type === 'heart_rate')  typeLabel = 'Heart Rate';
  if (q.type === 'place_context') typeLabel = 'Place context';

  card.innerHTML = `
    <div class="q-header">
      <span class="q-drag-handle">⠿</span>
      <span class="q-num">${displayNum}</span>
      <span class="q-preview-text">${escH(questionDisplayText(q.text)) || '<em style="color:var(--fg-3)">(no text)</em>'}</span>
      <span class="q-type-badge ${q.type}" style="${q.type==='heart_rate'?'background:rgba(246,201,14,0.12);color:#f6c90e;':''}"> ${typeLabel}</span>
      <svg class="q-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4l4 4 4-4"/></svg>
    </div>
    <div class="q-body">
      <div class="field-group" style="padding-top:10px">
        <div style="display: flex; justify-content: space-between; align-items: flex-end;">
            <label class="field-label">${q.type === 'instruction' ? 'Instruction text' : 'Label / Caption'}</label>
            <span style="font-size: 10px; color: var(--fg-muted); font-family: monospace;">ID: ${q.id}</span>
        </div>
        <input type="text" class="q-text" value="${escH(q.text)}" placeholder="${q.type === 'instruction' ? 'Tell participants what happens next…' : q.type === 'heart_rate' ? 'e.g. Measuring your heart rate…' : 'Enter question…'}">
      </div>

      ${q.type === 'slider'                              ? buildSliderFields(q)     : ''}
      ${(q.type === 'choice' || q.type === 'checkbox')   ? buildChoiceFields(q)     : ''}
      ${q.type === 'affect_grid'                         ? buildAffectGridFields(q) : ''}
      ${q.type === 'body_map'                            ? buildBodyMapFields(q)    : ''}
      ${q.type === 'heart_rate'                          ? buildHeartRateFields(q)  : ''}
      ${q.type === 'place_context'                       ? buildPlaceContextFields(q) : ''}
      ${q.type === 'instruction'
        ? '<div class="field-hint" style="margin-top:6px">Shown on its own screen. It collects no response and can be personalized or conditional.</div>' : ''}
      ${(q.type === 'text' || q.type === 'numeric')
        ? `<div class="field-hint" style="margin-top:6px">Participants type a ${q.type === 'numeric' ? 'number' : 'text'} response.</div>` : ''}

      ${buildPipingControls(options.pipeSources || [], q)}

      <div class="field-group condition-wrapper" style="margin-top:10px;">
        <label class="field-label">Skip Logic</label>
        ${buildConditionBlock(q, index)}
      </div>
      ${q.type !== 'instruction' && q.type !== 'place_context' ? `<div class="toggle-row">
        <span class="toggle-label">Required</span>
        <label class="toggle">
          <input type="checkbox" class="q-required" ${q.required ? 'checked' : ''}>
          <span class="toggle-track"></span>
        </label>
      </div>` : ''}
      <div class="q-footer">
        <button class="q-del-btn-full">Delete Question</button>
      </div>
    </div>
  `;

  card.querySelector('.q-header').addEventListener('click', e => {
    if (e.target.closest('.q-drag-handle, .measure-flow-actions')) return;
    card.classList.toggle('expanded');
  });
  card.querySelector('.q-text').addEventListener('input', e => {
    q.text = e.target.value;
    card.querySelector('.q-preview-text').textContent = questionDisplayText(q.text) || '(no text)';
    renderPipingSummary(card, q);
    schedulePreview();
  });
  bindPipingControls(card, q);
  renderPipingSummary(card, q);
  const reqChk = card.querySelector('.q-required');
  if (reqChk) reqChk.addEventListener('change', e => { q.required = e.target.checked; schedulePreview(); });
  const delBtn = card.querySelector('.q-del-btn-full');
  if (delBtn) delBtn.addEventListener('click', () => {
    detachQuestion(q.id);
    state.ema.questions = state.ema.questions.filter(x => x.id !== q.id);
    renderQuestions(); schedulePreview();
  });

  if (q.type === 'slider')                              bindSliderFields(card, q);
  if (q.type === 'choice' || q.type === 'checkbox')     bindChoiceFields(card, q);
  if (q.type === 'affect_grid')                         bindAffectGridFields(card, q);
  if (q.type === 'body_map')                            bindBodyMapFields(card, q);
  if (q.type === 'heart_rate')                          bindHeartRateFields(card, q);
  if (q.type === 'place_context')                       bindPlaceContextFields(card, q);

  bindConditionBlock(card, q, index);
  return card;
}

function buildPlaceContextFields(q) {
  const dataset = q.location_dataset;
  const mode = q.location_mode || (dataset ? 'local_dataset' : 'epa_walkability');
  const selected = mode === 'online_indicators' ? q.location_indicators || [] :
    mode === 'census_urbanicity' ? ['urbanicity'] : ['walkability'];
  return `<div class="field-group"><strong>Study-area indicator lookup</strong>
    <label class="field-label">Lookup method</label>
    <select class="place-mode"><option value="online_indicators" ${mode !== 'local_dataset' ? 'selected' : ''}>Automatic public indicators (US; Cloudflare host)</option><option value="local_dataset" ${mode === 'local_dataset' ? 'selected' : ''}>On-device lookup from my study-area data</option></select>
    <div class="place-online-options" ${mode === 'local_dataset' ? 'hidden' : ''}>
      <label class="toggle-row"><input type="checkbox" value="walkability" ${selected.includes('walkability') ? 'checked' : ''}> EPA walkability (2021)</label>
      <label class="toggle-row"><input type="checkbox" value="urbanicity" ${selected.includes('urbanicity') ? 'checked' : ''}> Census urban / rural (2020)</label>
      <label class="toggle-row"><input type="checkbox" value="population_density" ${selected.includes('population_density') ? 'checked' : ''}> EPA population density (2018 estimate; people per developable acre)</label>
      <label class="toggle-row"><input type="checkbox" value="transit_distance" ${selected.includes('transit_distance') ? 'checked' : ''}> EPA distance to transit (historical block-group centroid)</label>
      <label class="toggle-row"><input type="checkbox" value="car_free_households" ${selected.includes('car_free_households') ? 'checked' : ''}> EPA share of households without a car (2018 estimate)</label>
    </div>
    <p class="place-mode-hint field-hint">${mode === 'local_dataset'
      ? 'Coordinates stay in the participant browser. Upload a small GeoJSON FeatureCollection of areas with documented indicator categories. Its geometry is published with the study.'
      : 'Select any combination. One permission request sends coordinates through the Worker to EPA and/or Census as needed. Only broad categories and per-indicator statuses are stored. Combining categories with response times and participant IDs can still narrow a location.'}</p>
    <input type="file" class="place-dataset-file" ${mode === 'local_dataset' ? '' : 'hidden'} accept=".geojson,.json,application/geo+json,application/json" aria-label="Study-area GeoJSON lookup">
    <p class="place-dataset-status field-hint" role="status">${dataset?.metadata && Array.isArray(dataset.features) ? `${escH(String(dataset.metadata.name || 'Unknown'))} · ${escH(String(dataset.metadata.version || '?'))} · ${dataset.features.length} areas` : 'No dataset yet. Export is blocked until you add one.'}</p>
    <p class="place-upload-hint field-hint">Up to 2 MB. Use licensed public data and document each band. Never include addresses or participant records in the file.</p></div>`;
}

function bindPlaceContextFields(card, q) {
  if (['epa_walkability', 'census_urbanicity'].includes(q.location_mode)) {
    q.location_indicators = [q.location_mode === 'epa_walkability' ? 'walkability' : 'urbanicity'];
    q.location_mode = 'online_indicators';
  }
  q.location_mode = q.location_mode || (q.location_dataset ? 'local_dataset' : 'online_indicators');
  if (q.location_mode === 'online_indicators' && !q.location_indicators) q.location_indicators = ['walkability'];
  const update = () => {
    const local = q.location_mode === 'local_dataset';
    card.querySelector('.place-online-options').hidden = local;
    card.querySelector('.place-dataset-file').hidden = !local;
    card.querySelector('.place-dataset-status').hidden = !local;
    card.querySelector('.place-upload-hint').hidden = !local;
    card.querySelector('.place-mode-hint').textContent = local
      ? 'Coordinates stay in the participant browser. Upload a GeoJSON lookup of areas and documented indicator categories. Its geometry is published with the study.'
      : 'Select any combination. One permission request sends coordinates through the Worker to EPA and/or Census as needed. Only broad categories and per-indicator statuses are stored. Combining categories with response times and participant IDs can still narrow a location.';
  };
  card.querySelector('.place-mode').addEventListener('change', event => {
    q.location_mode = event.target.value;
    update(); schedulePreview(); renderBuilderShell();
  });
  card.querySelectorAll('.place-online-options input').forEach(input => input.addEventListener('change', () => {
    q.location_indicators = [...card.querySelectorAll('.place-online-options input:checked')].map(el => el.value);
    schedulePreview(); renderBuilderShell();
  }));
  update();
  card.querySelector('.place-dataset-file')?.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const status = card.querySelector('.place-dataset-status');
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Dataset exceeds the 2 MB study lookup limit.');
      const data = JSON.parse(await file.text());
      const error = EMAForgePlaceContext.validate(data);
      if (error) throw new Error(error);
      q.location_dataset = data;
      status.textContent = `${data.metadata.name} · ${data.metadata.version} · ${data.features.length} areas added`;
      status.style.color = '';
      schedulePreview();
      renderBuilderShell();
    } catch (error) {
      status.textContent = error.message;
      status.style.color = 'var(--accent-red)';
    }
    event.target.value = '';
  });
}

function defaultBodyRegions() {
  return [
    ['head', 'Head'], ['neck', 'Neck or throat'], ['chest', 'Chest'],
    ['abdomen', 'Abdomen'], ['arms', 'Arms'], ['hands', 'Hands or fingers'],
    ['legs', 'Legs'], ['feet', 'Feet'], ['whole_body', 'Whole body'],
    ['other', 'Somewhere else']
  ].map(([id, label]) => ({ id, label }));
}

function buildBodyMapFields(q) {
  const rows = (q.regions || []).map((region, index) => `
    <div class="option-row body-region-row" data-ri="${index}"><code>${escH(region.id)}</code>
      <input type="text" class="body-region-label" value="${escH(region.label)}" aria-label="Label for ${escH(region.id)}">
    </div>`).join('');
  return `
    <div class="field-hint" style="margin-top:6px;margin-bottom:8px;">Participants select named regions on an accessible body diagram. Stable region IDs are saved for analysis.</div>
    <div class="q-row-2">
      <div class="field-group"><label class="field-label">Selection</label><select class="body-map-mode"><option value="multiple" ${q.selection_mode !== 'single' ? 'selected' : ''}>Multiple regions</option><option value="single" ${q.selection_mode === 'single' ? 'selected' : ''}>One region</option></select></div>
      <div class="toggle-row"><span class="toggle-label">Allow “None”</span><label class="toggle"><input type="checkbox" class="body-map-none" ${q.allow_none !== false ? 'checked' : ''}><span class="toggle-track"></span></label></div>
    </div>
    <details class="body-map-labels"><summary>Edit region labels</summary><div class="options-list">${rows}</div></details>`;
}

function bindBodyMapFields(card, q) {
  card.querySelector('.body-map-mode')?.addEventListener('change', event => { q.selection_mode = event.target.value; schedulePreview(); });
  card.querySelector('.body-map-none')?.addEventListener('change', event => { q.allow_none = event.target.checked; schedulePreview(); });
  card.querySelectorAll('.body-region-label').forEach((input, index) => input.addEventListener('input', event => {
    q.regions[index].label = event.target.value; schedulePreview();
  }));
}

// ---------------------------------------------------------------------------
// Heart Rate fields
// ---------------------------------------------------------------------------
function buildHeartRateFields(q) {
  return `
    <div class="field-hint" style="margin-top:6px;margin-bottom:8px;">
      Captures PPG via the rear camera for the specified duration. The resulting BPM value
      is stored and can be referenced in conditional task logic. Requires a compatible camera and flashlight.
    </div>
    <div class="q-row-2">
      <div class="field-group">
        <label class="field-label">Duration (seconds)</label>
        <input type="number" class="hr-duration" value="${q.duration_sec || 30}" min="10" max="120" step="5">
        <div class="field-hint">10–120 sec. Longer = more stable BPM estimate.</div>
      </div>
      <div class="toggle-row" style="margin-top:12px;">
      <span class="toggle-label">Show BPM to participant</span>
      <label class="toggle">
        <input type="checkbox" class="hr-display-bpm" ${q.display_bpm !== false ? 'checked' : ''}>
        <span class="toggle-track"></span>
      </label>
    </div>
    <div class="field-hint" style="margin-top:-4px;">
      Turn off when this question precedes a task that should not be biased by
      the participant knowing their heart rate (e.g. heartbeat counting tasks).
      The BPM is still recorded in the data; only the on-screen number is hidden.
    </div>
      <div class="field-group">
        <label class="field-label">Report As</label>
        <select class="hr-report-as" style="width:100%;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-family:var(--font);font-size:0.88rem;outline:none;">
          <option value="bpm" ${q.report_as === 'bpm' ? 'selected' : ''}>BPM (for conditions)</option>
        </select>
        <div class="field-hint">BPM is stored as the condition-comparable value. Full IBI series is always saved in the JSON output.</div>
      </div>
    </div>
    <div style="padding:8px 10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;font-size:0.78rem;color:var(--fg-muted);">
      Question ID: <code style="color:var(--accent)">${q.id}</code> — use this ID in task step conditions to reference the captured BPM.
    </div>
  `;
}

function bindHeartRateFields(card, q) {
  const durEl = card.querySelector('.hr-duration');
  const repEl = card.querySelector('.hr-report-as');
  if (durEl) durEl.addEventListener('input', e => {
    q.duration_sec = parseInt(e.target.value) || 30;
    schedulePreview();
  });
  if (repEl) repEl.addEventListener('change', e => { q.report_as = e.target.value; schedulePreview(); });
  const dispEl = card.querySelector('.hr-display-bpm');
  if (dispEl) dispEl.addEventListener('change', e => {
    q.display_bpm = e.target.checked;
    schedulePreview();
  });
}

// ---------------------------------------------------------------------------
// Slider fields
// ---------------------------------------------------------------------------
function buildSliderFields(q) {
  return `
    <div class="q-row-3">
      <div class="field-group"><label class="field-label">Min</label><input type="number" class="q-min" value="${q.min}"></div>
      <div class="field-group"><label class="field-label">Max</label><input type="number" class="q-max" value="${q.max}"></div>
      <div class="field-group"><label class="field-label">Step</label><input type="number" class="q-step" value="${q.step}" min="0.01" step="0.5"></div>
    </div>
    <div class="q-row-2">
      <div class="field-group"><label class="field-label">Left Anchor</label><input type="text" class="q-anchor-l" value="${escH((q.anchors||['',''])[0])}"></div>
      <div class="field-group"><label class="field-label">Right Anchor</label><input type="text" class="q-anchor-r" value="${escH((q.anchors||['',''])[1])}"></div>
    </div>
    <div class="field-group"><label class="field-label">Unit Suffix</label><input type="text" class="q-unit" value="${escH(q.unit||'')}" placeholder="e.g. hrs, bpm"></div>
  `;
}

function bindSliderFields(card, q) {
  const n = (sel, key) => {
    const el = card.querySelector(sel);
    if (el) el.addEventListener('input', () => { q[key] = parseFloat(el.value)||0; schedulePreview(); });
  };
  n('.q-min','min'); n('.q-max','max'); n('.q-step','step');
  const al = card.querySelector('.q-anchor-l');
  const ar = card.querySelector('.q-anchor-r');
  const un = card.querySelector('.q-unit');
  if (al) al.addEventListener('input', e => { q.anchors[0] = e.target.value; schedulePreview(); });
  if (ar) ar.addEventListener('input', e => { q.anchors[1] = e.target.value; schedulePreview(); });
  if (un) un.addEventListener('input', e => { q.unit = e.target.value || null; schedulePreview(); });
}

// ---------------------------------------------------------------------------
// Choice / Checkbox fields
// ---------------------------------------------------------------------------
function buildChoiceFields(q) {
  const opts = (q.options||[]).map((o,i) => `
    <div class="option-row" data-oi="${i}">
      <input type="text" class="opt-text" value="${escH(o)}" placeholder="Option ${i+1}">
      <button class="option-del">×</button>
    </div>`).join('');
  return `
    <div class="field-group" style="margin-top:10px;">
      <label class="field-label">Options</label>
      <div class="options-list">${opts}</div>
      <button class="btn add-opt-btn" style="margin-top:6px;font-size:11px">+ Add option</button>
    </div>
  `;
}

function bindChoiceFields(card, q) {
  const list = card.querySelector('.options-list');
  if (!list) return;
  function refresh() {
    list.innerHTML = (q.options||[]).map((o,i) => `
      <div class="option-row" data-oi="${i}">
        <input type="text" class="opt-text" value="${escH(o)}" placeholder="Option ${i+1}">
        <button class="option-del">×</button>
      </div>`).join('');
    list.querySelectorAll('.opt-text').forEach((inp,i) => inp.addEventListener('input', e => { q.options[i] = e.target.value; schedulePreview(); }));
    list.querySelectorAll('.option-del').forEach((btn,i) => btn.addEventListener('click', () => { q.options.splice(i,1); refresh(); schedulePreview(); }));
  }
  const addBtn = card.querySelector('.add-opt-btn');
  if (addBtn) addBtn.addEventListener('click', () => { q.options = q.options||[]; q.options.push(''); refresh(); schedulePreview(); });
  refresh();
}

// ---------------------------------------------------------------------------
// Affect Grid fields
// ---------------------------------------------------------------------------
function buildAffectGridFields(q) {
  return `
    <div class="field-hint" style="margin-top:6px;margin-bottom:8px;">
      A 2D tap-target for valence × arousal. Responses stored as <code>{valence, arousal}</code> each in [−1, 1].
    </div>
    <div class="q-row-2">
      <div class="field-group"><label class="field-label">Valence — Low</label><input type="text" class="q-vlo" value="${escH((q.valence_labels||[])[0]||'')}" placeholder="Unpleasant"></div>
      <div class="field-group"><label class="field-label">Valence — High</label><input type="text" class="q-vhi" value="${escH((q.valence_labels||[])[1]||'')}" placeholder="Pleasant"></div>
    </div>
    <div class="q-row-2">
      <div class="field-group"><label class="field-label">Arousal — Low</label><input type="text" class="q-alo" value="${escH((q.arousal_labels||[])[0]||'')}" placeholder="Deactivated"></div>
      <div class="field-group"><label class="field-label">Arousal — High</label><input type="text" class="q-ahi" value="${escH((q.arousal_labels||[])[1]||'')}" placeholder="Activated"></div>
    </div>
    <div class="toggle-row">
      <span class="toggle-label">Show quadrant labels</span>
      <label class="toggle"><input type="checkbox" class="q-quadrants" ${q.show_quadrant_labels?'checked':''}><span class="toggle-track"></span></label>
    </div>
  `;
}

function bindAffectGridFields(card, q) {
  const bind = (sel, setter) => { const el = card.querySelector(sel); if (el) el.addEventListener('input', e => { setter(e.target.value); schedulePreview(); }); };
  bind('.q-vlo', v => q.valence_labels[0] = v);
  bind('.q-vhi', v => q.valence_labels[1] = v);
  bind('.q-alo', v => q.arousal_labels[0] = v);
  bind('.q-ahi', v => q.arousal_labels[1] = v);
  const qd = card.querySelector('.q-quadrants');
  if (qd) qd.addEventListener('change', () => { q.show_quadrant_labels = qd.checked; schedulePreview(); });
}

// ---------------------------------------------------------------------------
// Skip Logic / Condition block
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Skip Logic / Compound Condition block
// ---------------------------------------------------------------------------
function buildConditionBlock(q, index) {
  const priors = state.ema.questions.slice(0, index).filter(p => !['page_break', 'instruction', 'checkbox', 'affect_grid'].includes(p.type));
  if (priors.length === 0) return `<div style="font-size:11px;color:var(--fg-3);padding:4px 0">No prior questions available.</div>`;

  // Migrate legacy condition to compound array
  if (q.condition && !q.condition.rules) {
    q.condition = { logical_op: 'AND', rules: [q.condition] };
  }

  const has = !!q.condition;
  const rules = has ? q.condition.rules : [];
  const logOp = has ? (q.condition.logical_op || 'AND') : 'AND';

  let rulesHtml = rules.map((r, ri) => {
    const qOpts = priors.map(p => `<option value="${p.id}" ${p.id===r.question_id?'selected':''}>${escH(p.text?.slice(0,40)||p.id)}</option>`).join('');
    const ops = ['eq','neq','gt','gte','lt','lte','includes'].map(op => `<option value="${op}" ${r.operator===op?'selected':''}>${op}</option>`).join('');
    return `
      <div class="condition-row" data-ri="${ri}" style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
        <select class="cond-q" style="flex:1;min-width:0;padding:4px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--fg);">${qOpts}</select>
        <select class="cond-op" style="padding:4px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--fg);">${ops}</select>
        <input type="text" class="cond-val" value="${escH(String(r.value??''))}" placeholder="val" style="width:60px;padding:4px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--fg);">
        <button class="cond-del-rule" style="background:none;border:none;color:var(--accent-red);cursor:pointer;font-size:16px;">✕</button>
      </div>
    `;
  }).join('');

  return `
    <div class="q-condition-block">
      <div class="toggle-row">
        <span class="toggle-label" style="font-size:11px;">Enable skip logic</span>
        <label class="toggle"><input type="checkbox" class="cond-enable" ${has?'checked':''}><span class="toggle-track"></span></label>
      </div>
      <div class="cond-fields" style="display:${has?'flex':'none'};flex-direction:column;gap:6px;margin-top:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <select class="cond-logical-op" style="padding:2px 6px;font-size:11px;border:1px solid var(--border);background:var(--bg);color:var(--fg);border-radius:4px;">
            <option value="AND" ${logOp==='AND'?'selected':''}>Match ALL rules (AND)</option>
            <option value="OR"  ${logOp==='OR'?'selected':''}>Match ANY rule (OR)</option>
          </select>
          <button class="cond-add-rule" style="font-size:11px;background:none;border:1px solid var(--border);color:var(--accent);border-radius:4px;cursor:pointer;padding:2px 6px;">+ Add Rule</button>
        </div>
        <div class="rules-container" style="background:var(--bg-elevated);padding:8px;border-radius:6px;border:1px solid var(--border);">
          ${rulesHtml || '<div style="font-size:11px;color:var(--fg-3);">No rules defined. Click + Add Rule.</div>'}
        </div>
      </div>
    </div>
  `;
}

function refreshConditionBlock(card, q, index) {
  const wrapper = card.querySelector('.condition-wrapper');
  wrapper.innerHTML = `<label class="field-label">Skip Logic</label>` + buildConditionBlock(q, index);
  bindConditionBlock(card, q, index);
}

function bindConditionBlock(card, q, index) {
  const toggle = card.querySelector('.cond-enable');
  if (!toggle) return;

  toggle.addEventListener('change', () => {
    if (toggle.checked) {
      q.condition = { logical_op: 'AND', rules: [{ question_id: '', operator: 'eq', value: '' }] };
    } else {
      q.condition = null;
    }
    schedulePreview();
    refreshConditionBlock(card, q, index);
  });

  if (!q.condition) return;

  const logOp = card.querySelector('.cond-logical-op');
  if (logOp) logOp.addEventListener('change', e => { q.condition.logical_op = e.target.value; schedulePreview(); });

  const addBtn = card.querySelector('.cond-add-rule');
  if (addBtn) addBtn.addEventListener('click', () => {
    q.condition.rules.push({ question_id: '', operator: 'eq', value: '' });
    schedulePreview(); 
    refreshConditionBlock(card, q, index);
  });

  card.querySelectorAll('.condition-row').forEach((row, i) => {
    const rule = q.condition.rules[i];
    const qSel = row.querySelector('.cond-q');
    const opSel = row.querySelector('.cond-op');
    const valInp = row.querySelector('.cond-val');
    const delBtn = row.querySelector('.cond-del-rule');

    qSel.addEventListener('change', e => { rule.question_id = e.target.value; schedulePreview(); });
    opSel.addEventListener('change', e => { rule.operator = e.target.value; schedulePreview(); });
    valInp.addEventListener('input', e => {
      const v = e.target.value;
      if (v.includes(',')) rule.value = v.split(',').map(x => x.trim());
      else if (v !== '' && !isNaN(Number(v))) rule.value = Number(v);
      else rule.value = v;
      schedulePreview();
    });
    delBtn.addEventListener('click', () => {
      q.condition.rules.splice(i, 1);
      if (q.condition.rules.length === 0) q.condition = null;
      schedulePreview(); 
      refreshConditionBlock(card, q, index);
    });
  });
}

function detachQuestion(qid) {
  (state.ema.scheduling.windows || []).forEach(window =>
    (window.phase_sequence || []).filter(step => step.kind === 'ema').forEach(step => {
      step.question_ids = (step.question_ids || []).filter(id => id !== qid);
    }));
  renderWindows();
}

// ---------------------------------------------------------------------------
// Add measure helpers
// ---------------------------------------------------------------------------
function addMeasureAt(type, insertionIndex = null) {
  if (!type) return;
  const targetWindow = selectedMeasureWindow();
  if (!targetWindow) {
    setMeasureFeedback('Add a session in Schedule before adding a measure.', true);
    return;
  }
  const entries = EMAForgeMeasureFlow.flatten(targetWindow);
  const targetIndex = Number.isInteger(insertionIndex)
    ? Math.max(0, Math.min(insertionIndex, entries.length))
    : entries.length;
  if (type.startsWith('task:')) {
    const moduleId = type.slice(5);
    const module = state.modules.find(candidate => candidate.id === moduleId);
    if (!module) {
      setMeasureFeedback('That task is not available in this build.', true);
      return;
    }
    module.enabled = true;
    entries.splice(targetIndex, 0, { kind: 'task', taskId: moduleId, condition: null });
    targetWindow.phase_sequence = EMAForgeMeasureFlow.compile(entries, genSId);
    if (typeof renderModules === 'function') renderModules();
    if (typeof renderWindows === 'function') renderWindows();
    previewSession = targetWindow.id;
    renderPreviewTabs();
    renderMeasureComposer();
    schedulePreview();
    setMeasureFeedback(`${module.label} added to ${targetWindow.label}. Fine-tune it in Task settings.`);
    closeMeasurePicker();
    return;
  }
  const question = { id: genQId(), type, text: '', required: true, condition: null };
  if (type === 'slider') Object.assign(question, { min: 0, max: 100, step: 1, unit: null, anchors: ['', ''] });
  if (type === 'choice' || type === 'checkbox') question.options = ['', ''];
  if (type === 'affect_grid') Object.assign(question, {
    text: 'Right now, how are you feeling?', valence_labels: ['Unpleasant', 'Pleasant'],
    arousal_labels: ['Deactivated', 'Activated'], show_quadrant_labels: true
  });
  if (type === 'instruction') Object.assign(question, {
    text: 'Before you continue, please read the following instructions carefully.', required: false
  });
  if (type === 'body_map') Object.assign(question, {
    text: 'Where in your body do you notice this sensation?', selection_mode: 'multiple',
    regions: defaultBodyRegions(), allow_none: true
  });
  if (type === 'heart_rate') Object.assign(question, {
    text: 'Measuring your heart rate…', duration_sec: 30, report_as: 'bpm'
  });
  if (type === 'place_context') Object.assign(question, {
    text: 'What is the area around you like right now?', required: false,
    location_terms_accepted: true, location_mode: 'online_indicators', location_indicators: ['walkability']
  });
  if (type === 'page_break') {
    delete question.text;
    Object.assign(question, { required: false, label: 'New screen' });
  }
  state.ema.questions.push(question);
  entries.splice(targetIndex, 0, { kind: 'question', questionId: question.id, sourceLabel: 'Survey' });
  targetWindow.phase_sequence = EMAForgeMeasureFlow.compile(entries, genSId);
  previewSession = targetWindow.id;
  renderWindows();
  renderQuestions();
  renderPreviewTabs();
  schedulePreview();
  setMeasureFeedback(`${measureTypeLabel(type)} added to ${targetWindow.label}.`);
  closeMeasurePicker();
  const card = document.querySelector(`.flow-question-card[data-qid="${CSS.escape(question.id)}"]`);
  if (card) {
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (type !== 'page_break' && type !== 'heart_rate') card.querySelector('.q-text')?.focus({ preventScroll: true });
  }
}

document.getElementById('open-measure-picker')?.addEventListener('click', () => openMeasurePicker());
document.getElementById('close-measure-picker')?.addEventListener('click', closeMeasurePicker);
document.getElementById('measure-picker-search')?.addEventListener('input', event => renderMeasurePicker(event.target.value));
