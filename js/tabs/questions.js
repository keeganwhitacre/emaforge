"use strict";

// ---------------------------------------------------------------------------
// Questions are optional in a physiology-only study. A survey step is
// inserted into the first session when the first question is created.
// ---------------------------------------------------------------------------

function renderQuestions() {
  const list = document.getElementById('question-list');
  list.innerHTML = '';
  if (!state.ema.questions.length) {
    list.innerHTML = '<p class="questions-empty">Questions are optional. Add one here or add a survey to a session in Schedule.</p>';
  }
  
  let displayNum = 1; // Track the visual question number
  
  state.ema.questions.forEach((q, i) => {
    // Pass the displayNum to the card builder
    list.appendChild(buildQCard(q, i, displayNum));
    
    // Only increment the number if it's an actual question
    if (q.type !== 'page_break') {
      displayNum++;
    }
  });
  if (typeof renderBuilderShell === 'function') renderBuilderShell();
}

// Add displayNum as the third argument here
function buildQCard(q, index, displayNum) {
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

  if (q.type === 'page_break') {
    card.classList.add('page-break');
    card.innerHTML = `
      <div class="q-header" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;">
        <span class="q-drag-handle" style="cursor:grab;flex-shrink:0;">⠿</span>
        <span style="flex:1;text-align:center;font-size:11px;font-weight:700;letter-spacing:0.1em;color:var(--accent);">--- PAGE BREAK ---</span>
        <button class="q-del-btn" style="flex-shrink:0;padding:2px 8px;border:1px solid var(--border);border-radius:var(--radius);background:transparent;color:var(--fg-3);cursor:pointer;">✕</button>
      </div>
    `;
    card.querySelector('.q-del-btn').addEventListener('click', () => {
      detachQuestion(q.id);
      state.ema.questions = state.ema.questions.filter(x => x.id !== q.id);
      renderQuestions(); schedulePreview();
    });
    return card;
  }

  let typeLabel = q.type.charAt(0).toUpperCase() + q.type.slice(1).replace('_', ' ');
  if (q.type === 'choice')      typeLabel = 'Single Choice';
  if (q.type === 'checkbox')    typeLabel = 'Multi Select';
  if (q.type === 'affect_grid') typeLabel = 'Affect Grid';
  if (q.type === 'heart_rate')  typeLabel = 'Heart Rate';

  card.innerHTML = `
    <div class="q-header">
      <span class="q-drag-handle">⠿</span>
      <span class="q-num">${displayNum}</span>
      <span class="q-preview-text">${escH(q.text) || '<em style="color:var(--fg-3)">(no text)</em>'}</span>
      <span class="q-type-badge ${q.type}" style="${q.type==='heart_rate'?'background:rgba(246,201,14,0.12);color:#f6c90e;':''}"> ${typeLabel}</span>
      <svg class="q-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4l4 4 4-4"/></svg>
    </div>
    <div class="q-body">
      <div class="field-group" style="padding-top:10px">
        <div style="display: flex; justify-content: space-between; align-items: flex-end;">
            <label class="field-label">Label / Caption</label>
            <span style="font-size: 10px; color: var(--fg-muted); font-family: monospace;">ID: ${q.id}</span>
        </div>
        <input type="text" class="q-text" value="${escH(q.text)}" placeholder="${q.type === 'heart_rate' ? 'e.g. Measuring your heart rate…' : 'Enter question…'}">
        <div class="field-hint" style="margin-top:4px">
          To display this answer in later questions, type <code style="color:var(--accent)">{{${q.id}}}</code>
        </div>
      </div>

      ${q.type === 'slider'                              ? buildSliderFields(q)     : ''}
      ${(q.type === 'choice' || q.type === 'checkbox')   ? buildChoiceFields(q)     : ''}
      ${q.type === 'affect_grid'                         ? buildAffectGridFields(q) : ''}
      ${q.type === 'heart_rate'                          ? buildHeartRateFields(q)  : ''}
      ${(q.type === 'text' || q.type === 'numeric')
        ? `<div class="field-hint" style="margin-top:6px">Participants type a ${q.type === 'numeric' ? 'number' : 'text'} response.</div>` : ''}

      <div class="field-group" style="margin-top:10px">
        <label class="field-label">Show in these survey steps</label>
        <div class="q-session-checks">${buildStepSelector(q)}</div>
      </div>

      <div class="field-group condition-wrapper" style="margin-top:10px;">
        <label class="field-label">Skip Logic</label>
        ${buildConditionBlock(q, index)}
      </div>
      <div class="toggle-row">
        <span class="toggle-label">Required</span>
        <label class="toggle">
          <input type="checkbox" class="q-required" ${q.required ? 'checked' : ''}>
          <span class="toggle-track"></span>
        </label>
      </div>
      <div class="q-footer">
        <button class="q-del-btn-full">Delete Question</button>
      </div>
    </div>
  `;

  card.querySelector('.q-header').addEventListener('click', e => {
    if (e.target.closest('.q-drag-handle')) return;
    card.classList.toggle('expanded');
  });
  card.querySelector('.q-text').addEventListener('input', e => {
    q.text = e.target.value;
    card.querySelector('.q-preview-text').textContent = q.text || '(no text)';
    schedulePreview();
  });
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
  if (q.type === 'heart_rate')                          bindHeartRateFields(card, q);

  bindConditionBlock(card, q, index);
  bindStepSelector(card, q);

  return card;
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
  const priors = state.ema.questions.slice(0, index).filter(p => p.type !== 'page_break' && p.type !== 'checkbox' && p.type !== 'affect_grid');
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

// ---------------------------------------------------------------------------
// A question can be reused in any number of explicitly selected survey steps.
// ---------------------------------------------------------------------------
function surveySteps() {
  return (state.ema.scheduling.windows || []).flatMap(w =>
    (w.phase_sequence || []).filter(step => step.kind === 'ema').map(step => ({ window: w, step })));
}

function buildStepSelector(q) {
  const steps = surveySteps();
  if (!steps.length) return '<div class="field-hint">Add a survey to a session first.</div>';
  return steps.map(({ window: w, step }) => {
    const checked = (step.question_ids || []).includes(q.id);
    return `<label class="session-check-row"><input type="checkbox" class="step-chk" data-step-id="${escH(step.id)}" ${checked?'checked':''}><span>${escH(w.label)} · ${escH(step.label || 'Survey questions')}</span></label>`;
  }).join('');
}

function bindStepSelector(card, q) {
  card.querySelectorAll('.step-chk').forEach(chk => {
    chk.addEventListener('change', () => {
      const found = surveySteps().find(({ step }) => step.id === chk.dataset.stepId);
      if (!found) return;
      const ids = found.step.question_ids || (found.step.question_ids = []);
      found.step.question_ids = chk.checked ? [...new Set([...ids, q.id])] : ids.filter(id => id !== q.id);
      renderWindows();
      schedulePreview();
    });
  });
}

function detachQuestion(qid) {
  surveySteps().forEach(({ step }) => {
    step.question_ids = (step.question_ids || []).filter(id => id !== qid);
  });
  renderWindows();
}

// ---------------------------------------------------------------------------
// Add question helpers
// ---------------------------------------------------------------------------
function addQ(obj, targetStep) {
  const windows = state.ema.scheduling.windows || [];
  if (!targetStep) {
    const preferred = windows.find(w => w.id === previewSession);
    targetStep = preferred?.phase_sequence?.find(step => step.kind === 'ema') || surveySteps()[0]?.step;
  }
  if (!targetStep && windows.length) {
    targetStep = { kind: 'ema', id: genSId(), question_ids: [] };
    windows[0].phase_sequence.unshift(targetStep);
  }
  if (targetStep) (targetStep.question_ids || (targetStep.question_ids = [])).push(obj.id);
  state.ema.questions.push(obj);
  renderWindows();
  renderQuestions(); schedulePreview();
  const cards = document.querySelectorAll('.q-card');
  if (cards.length && obj.type !== 'page_break') cards[cards.length-1].classList.add('expanded');
}

document.getElementById('add-question-select').addEventListener('change', event => {
  const type = event.target.value;
  if (!type) return;
  const question = { id: genQId(), type, text: '', required: true, condition: null };
  if (type === 'slider') Object.assign(question, { min: 0, max: 100, step: 1, unit: null, anchors: ['', ''] });
  if (type === 'choice' || type === 'checkbox') question.options = ['', ''];
  if (type === 'affect_grid') Object.assign(question, {
    text: 'Right now, how are you feeling?', valence_labels: ['Unpleasant', 'Pleasant'],
    arousal_labels: ['Deactivated', 'Activated'], show_quadrant_labels: true
  });
  if (type === 'heart_rate') Object.assign(question, {
    text: 'Measuring your heart rate…', duration_sec: 30, report_as: 'bpm'
  });
  if (type === 'page_break') delete question.text;
  addQ(question);
  event.target.value = '';
  const card = document.querySelector('#question-list .q-card:last-child');
  if (card) {
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (type !== 'page_break' && type !== 'heart_rate') card.querySelector('.q-text')?.focus({ preventScroll: true });
  }
});
