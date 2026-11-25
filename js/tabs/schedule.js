"use strict";

// ---------------------------------------------------------------------------
// An ordered session flow is the only source of measurement order.
// ---------------------------------------------------------------------------

function bindScheduleTab() {
  const bindNum = (id, setter) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { setter(parseInt(el.value)||0); schedulePreview(); });
  };
  bindNum('study-days',    v => state.ema.scheduling.study_days = v);
  bindNum('window-expiry', v => state.ema.scheduling.timing.expiry_minutes = v);
  bindNum('grace-period',  v => state.ema.scheduling.timing.grace_minutes = v);

  document.querySelectorAll('#dow-grid .dow-chip').forEach(chip => {
    const dow = parseInt(chip.dataset.dow);
    chip.classList.toggle('on', state.ema.scheduling.days_of_week.includes(dow));
    chip.setAttribute('aria-pressed', String(chip.classList.contains('on')));
    chip.addEventListener('click', () => {
      const active = chip.classList.toggle('on');
      chip.setAttribute('aria-pressed', String(active));
      if (active) state.ema.scheduling.days_of_week.push(dow);
      else state.ema.scheduling.days_of_week = state.ema.scheduling.days_of_week.filter(d => d !== dow);
      state.ema.scheduling.days_of_week.sort();
      schedulePreview();
    });
  });

  document.getElementById('add-window-btn').addEventListener('click', () => {
    const wId = genWId();
    state.ema.scheduling.windows.push({
      id: wId,
      label: `Session ${state.ema.scheduling.windows.length + 1}`,
      start: "12:00",
      end: "13:00",
      phase_sequence: []
    });
    renderWindows();
    if (typeof renderGreetings === 'function') renderGreetings();
    if (typeof renderPreviewTabs === 'function') renderPreviewTabs();
    if (typeof renderQuestions === 'function') renderQuestions();
    schedulePreview();
  });
}

// ---------------------------------------------------------------------------
// renderWindows — rebuilds the window list from state
// ---------------------------------------------------------------------------
function renderWindows() {
  const list = document.getElementById('window-list');
  list.innerHTML = '';
  syncDailyPromptCount();
  state.ema.scheduling.windows.forEach((w, i) => {
    migrateWindow(w);
    list.appendChild(buildWindowCard(w, i));
  });
  if (typeof renderMeasureComposer === 'function') renderMeasureComposer();
}

function syncDailyPromptCount() {
  const count = state.ema.scheduling.windows.length;
  state.ema.scheduling.daily_prompts = count;
  const input = document.getElementById('daily-prompts');
  if (input) input.value = count;
}

// Keep the editor resilient to incomplete imported configurations.
function migrateWindow(w) {
  if (!Array.isArray(w.phase_sequence)) w.phase_sequence = [];
}

// ---------------------------------------------------------------------------
// buildWindowCard
// ---------------------------------------------------------------------------
// Retained for imported projects that may still invoke the legacy step renderer.
const expandedSteps = new WeakSet();

function buildWindowCard(w, i) {
  const el = document.createElement('div');
  el.className = 'window-item session-card';
  const entries = typeof EMAForgeMeasureFlow !== 'undefined' ? EMAForgeMeasureFlow.flatten(w) : [];

  el.innerHTML = `
    <div class="session-heading">
      <label class="field-group"><span class="field-label">Session name</span>
        <input type="text" class="win-label" value="${escH(w.label)}"></label>
      <button type="button" class="del-btn builder-icon-button" aria-label="Remove ${escH(w.label)}" title="Remove session">✕</button>
    </div>
    <div class="session-time">
      <label class="field-group"><span class="field-label">From</span><input type="time" class="win-start" value="${w.start}"></label>
      <label class="field-group"><span class="field-label">To</span><input type="time" class="win-end" value="${w.end}"></label>
    </div>
    <div class="session-content">
      <div class="session-content-heading">
        <strong>Measures</strong>
        <span>${entries.length} item${entries.length === 1 ? '' : 's'} in this session</span>
      </div>
      <p class="field-hint">Question order, physiology tasks, and conditional task logic are managed in one place.</p>
      <button type="button" class="btn-ghost edit-session-measures">Edit measures for this session →</button>
    </div>
  `;

  // Wire label + time
  el.querySelector('.win-label').addEventListener('input', e => {
    w.label = e.target.value;
    if (typeof renderGreetings === 'function') renderGreetings();
    if (typeof renderPreviewTabs === 'function') renderPreviewTabs();
    if (typeof renderQuestions === 'function') renderQuestions();
    schedulePreview();
  });
  el.querySelector('.win-start').addEventListener('input', e => { w.start = e.target.value; schedulePreview(); });
  el.querySelector('.win-end').addEventListener('input',   e => { w.end   = e.target.value; schedulePreview(); });
  el.addEventListener('focusin', () => {
    if (previewSession !== w.id) {
      previewSession = w.id;
      rememberBuilderWorkspace();
      renderPreviewTabs();
      renderPreview();
    }
  });

  // Delete window
  el.querySelector('.del-btn').addEventListener('click', event => {
    const windows = state.ema.scheduling.windows;
    const index = windows.indexOf(w);
    const restoreWindow = rememberBuilderPosition(windows, index);
    const greeting = state.study.greetings?.[w.id];
    windows.splice(index, 1);
    renderGreetings();
    refreshAfterRemoval();
    offerBuilderUndo('Session removed.', () => {
      restoreWindow(windows, w);
      if (greeting !== undefined) state.study.greetings[w.id] = greeting;
      renderGreetings();
      refreshAfterRemoval();
    }, event);
  });

  el.querySelector('.edit-session-measures').addEventListener('click', () => {
    measureSessionId = w.id;
    previewSession = w.id;
    document.querySelector('.tab-btn[data-tab="questions"]')?.click();
  });

  return el;
}

// ---------------------------------------------------------------------------
// renderStepList — renders the ordered step list inside a window card
// ---------------------------------------------------------------------------
function renderStepList(container, w) {
  container.innerHTML = '';
  if (!w.phase_sequence || w.phase_sequence.length === 0) {
    container.innerHTML = '<div class="field-hint">Add a measure below to start this session.</div>';
    return;
  }

  w.phase_sequence.forEach((step, si) => {
    const row = document.createElement('div');
    row.className = 'session-step';
    row.dataset.index = String(si);
    const heading = document.createElement('div');
    heading.className = 'session-step-heading';
    const handle = document.createElement('span');
    handle.className = 'session-step-handle';
    handle.textContent = '⠿';
    handle.draggable = true;
    handle.title = 'Drag to reorder';
    handle.setAttribute('aria-hidden', 'true');
    const title = document.createElement('strong');
    const module = state.modules.find(m => m.id === step.id);
    const eligible = step.kind === 'ema' ? state.ema.questions.filter(q => q.type !== 'page_break' &&
      (step.question_ids || []).includes(q.id)) : [];
    title.textContent = step.kind === 'ema'
      ? (eligible.length === 1 && eligible[0].type === 'heart_rate'
          ? (step.label || 'PPG heart-rate capture')
          : (step.label || 'Survey questions'))
      : (module?.label || step.id || 'Task');
    heading.append(handle, title);
    if (step.condition) {
      const tag = document.createElement('span');
      tag.className = 'session-step-tag';
      tag.textContent = 'Conditional';
      heading.append(tag);
    }

    const actions = document.createElement('div');
    actions.className = 'session-step-actions';
    [['step-up', 'Move', 'earlier', '↑', si === 0],
     ['step-down', 'Move', 'later', '↓', si === w.phase_sequence.length - 1],
     ['step-del', 'Remove', '', '✕', w.phase_sequence.length === 1]].forEach(([className, action, direction, symbol, disabled]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.setAttribute('aria-label', `${action} ${title.textContent}${direction ? ' ' + direction : ''}`);
      button.disabled = disabled;
      button.textContent = symbol;
      actions.appendChild(button);
    });
    heading.appendChild(actions);
    row.appendChild(heading);
    const details = document.createElement('details');
    details.className = 'session-step-options';
    details.open = expandedSteps.has(step);
    const summary = document.createElement('summary');
    summary.textContent = 'Options';
    details.append(summary, buildStepControls(step, w));
    details.addEventListener('toggle', () => {
      if (details.open) expandedSteps.add(step);
      else expandedSteps.delete(step);
    });
    row.appendChild(details);

    handle.addEventListener('dragstart', event => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', JSON.stringify({ windowId: w.id, index: si }));
      row.classList.add('dragging');
    });
    handle.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });
    row.addEventListener('drop', event => {
      event.preventDefault();
      let drag;
      try { drag = JSON.parse(event.dataTransfer.getData('text/plain')); } catch { return; }
      if (drag.windowId !== w.id) return;
      const from = drag.index;
      if (!Number.isInteger(from) || from < 0 || from >= w.phase_sequence.length || from === si) return;
      const [moved] = w.phase_sequence.splice(from, 1);
      w.phase_sequence.splice(si, 0, moved);
      renderStepList(container, w); schedulePreview();
    });
    actions.querySelector('.step-up').addEventListener('click', () => {
      if (si > 0) { [w.phase_sequence[si-1], w.phase_sequence[si]] = [w.phase_sequence[si], w.phase_sequence[si-1]]; }
      renderStepList(container, w); schedulePreview();
    });
    actions.querySelector('.step-down').addEventListener('click', () => {
      if (si < w.phase_sequence.length - 1) { [w.phase_sequence[si], w.phase_sequence[si+1]] = [w.phase_sequence[si+1], w.phase_sequence[si]]; }
      renderStepList(container, w); schedulePreview();
    });
    actions.querySelector('.step-del').addEventListener('click', () => {
      w.phase_sequence.splice(si, 1);
      renderStepList(container, w); schedulePreview();
    });
    container.appendChild(row);
  });
}

function buildStepControls(step, w) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:6px;';

  if (step.kind === 'ema') {
    const name = document.createElement('input');
    name.type = 'text';
    name.value = step.label || 'Survey questions';
    name.setAttribute('aria-label', 'Survey step name');
    name.addEventListener('input', e => { step.label = e.target.value; schedulePreview(); });
    name.addEventListener('change', () => {
      renderStepList(wrap.closest('.step-list'), w);
      renderQuestions();
    });
    wrap.appendChild(name);
    const hint = document.createElement('span');
    hint.className = 'field-hint';
    hint.textContent = `${(step.question_ids || []).filter(id => state.ema.questions.some(q => q.id === id && q.type !== 'page_break')).length} survey items. Assign or reuse them in Measures.`;
    wrap.appendChild(hint);

  } if (step.kind === 'task') {
    const enabledMods = state.modules.filter(m => m.enabled);
    const taskSel = document.createElement('select');
    taskSel.style.cssText = 'width:100%;padding:5px 8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--fg);font-family:var(--font);font-size:0.85rem;outline:none;';
    const currentUnavailable = !enabledMods.some(m => m.id === step.id);
    taskSel.innerHTML = (currentUnavailable
      ? `<option value="${escH(step.id || '')}" selected disabled>Task unavailable — enable it in Tasks or choose another</option>`
      : '') +
      enabledMods.map(m => `<option value="${escH(m.id)}" ${step.id===m.id?'selected':''}>${escH(m.label)}</option>`).join('');
    taskSel.setAttribute('aria-label', 'Task module');
    taskSel.addEventListener('change', e => { step.id = e.target.value || null; renderStepList(wrap.closest('.step-list'), w); schedulePreview(); });
    wrap.appendChild(taskSel);

    // Condition row
    const condRow = buildConditionRow(step, w);
    wrap.appendChild(condRow);
  }

  return wrap;
}

// ---------------------------------------------------------------------------
// buildConditionRow — optional compound gate condition for task steps
// ---------------------------------------------------------------------------
function buildConditionRow(step, w) {
  const preceding = w.phase_sequence.slice(0, w.phase_sequence.indexOf(step));
  return buildBranchEditor(step, branchSources(preceding.flatMap(phase => phase.question_ids || [])), 'task');
}
