"use strict";

// ---------------------------------------------------------------------------
// Schedule Tab
//
// Changes from v1.1:
//   - Each window card now renders a Phase Sequencer section showing the
//     three slots: Pre-EMA, Task, Post-EMA.
//   - The task dropdown is populated dynamically from state.modules filtered
//     to only enabled modules — so enabling a module in the Tasks tab
//     immediately makes it available here (renderWindows is called on toggle).
//   - Pre/Post toggles are independent; post is only meaningful when a task
//     is selected (the UI dims it otherwise to signal this).
//   - Window phase defaults are set in state.js; this file never writes
//     defaults itself so there is one source of truth.
// ---------------------------------------------------------------------------

function bindScheduleTab() {
  const bindNum = (id, setter) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { setter(parseInt(el.value)||0); schedulePreview(); });
  };
  bindNum('study-days',    v => state.ema.scheduling.study_days = v);
  bindNum('daily-prompts', v => state.ema.scheduling.daily_prompts = v);
  bindNum('window-expiry', v => state.ema.scheduling.timing.expiry_minutes = v);
  bindNum('grace-period',  v => state.ema.scheduling.timing.grace_minutes = v);

  document.querySelectorAll('#dow-grid .dow-chip').forEach(chip => {
    const dow = parseInt(chip.dataset.dow);
    chip.classList.toggle('on', state.ema.scheduling.days_of_week.includes(dow));
    chip.addEventListener('click', () => {
      const active = chip.classList.toggle('on');
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
      label: `Window ${state.ema.scheduling.windows.length + 1}`,
      start: "12:00",
      end: "13:00",
      phases: { pre: true, task: null, post: false }
    });
    renderWindows();
    if (typeof renderGreetings === 'function') renderGreetings();
    if (typeof renderPreviewTabs === 'function') renderPreviewTabs();
    if (typeof renderQuestions === 'function') renderQuestions();
    schedulePreview();
  });
}

// ---------------------------------------------------------------------------
// renderWindows() — rebuilds the window list DOM from state
// ---------------------------------------------------------------------------
function renderWindows() {
  const list = document.getElementById('window-list');
  list.innerHTML = '';

  state.ema.scheduling.windows.forEach((w, i) => {
    // Ensure phases exist on windows loaded from older state (schema migration)
    if (!w.phases) w.phases = { pre: true, task: null, post: false };

    const el = document.createElement('div');
    el.className = 'window-item drag-item';
    el.style.cssText = 'display:flex;align-items:flex-start;gap:16px;background:var(--bg-surface);padding:16px;border:1px solid var(--border);border-radius:var(--radius);margin-bottom:12px;';

    // Build task dropdown options from enabled modules only
    // "None" means EMA-only; the window still runs the pre/post blocks.
    const enabledModules = state.modules.filter(m => m.enabled);
    const taskOptions = [
      `<option value="" ${!w.phases.task ? 'selected' : ''}>None (EMA only)</option>`,
      ...enabledModules.map(m =>
        `<option value="${m.id}" ${w.phases.task === m.id ? 'selected' : ''}>${escH(m.label)}</option>`
      )
    ].join('');

    // Post-EMA is only meaningful when a task is selected — dim it otherwise
    const postDisabled = !w.phases.task;

    el.innerHTML = `
      <div class="drag-handle" style="cursor:grab;color:var(--fg-muted);font-weight:bold;padding-right:8px;padding-top:12px;">⋮⋮</div>

      <div class="window-content" style="flex:1;display:flex;flex-direction:column;gap:10px;">

        <!-- Label + time row -->
        <input type="text" class="win-label" value="${escH(w.label)}"
          style="width:100%;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--fg);font-family:var(--font);font-size:1rem;outline:none;">
        <div style="display:flex;gap:12px;align-items:center;">
          <input type="time" class="win-start" value="${w.start}"
            style="flex:1;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--fg);font-family:var(--font-mono);font-size:0.95rem;outline:none;">
          <span style="color:var(--fg-muted);font-size:0.9rem;font-weight:500;">to</span>
          <input type="time" class="win-end" value="${w.end}"
            style="flex:1;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--fg);font-family:var(--font-mono);font-size:0.95rem;outline:none;">
        </div>

        <!-- Phase Sequencer -->
        <div class="phase-sequencer" style="border:1px solid var(--border);border-radius:8px;padding:12px 14px;background:var(--bg);display:flex;flex-direction:column;gap:10px;">
          <div style="font-size:0.75rem;font-weight:600;color:var(--fg-muted);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:2px;">Session Phase Sequence</div>

          <!-- Pre-EMA toggle -->
          <div class="phase-row" style="display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="phase-pill phase-pill-pre">PRE</span>
              <span style="font-size:0.88rem;color:var(--fg);">EMA Questions</span>
            </div>
            <label class="toggle">
              <input type="checkbox" class="phase-pre-toggle" ${w.phases.pre ? 'checked' : ''}>
              <span class="toggle-track"></span>
            </label>
          </div>

          <!-- Task selector -->
          <div class="phase-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
              <span class="phase-pill phase-pill-task">TASK</span>
              <span style="font-size:0.88rem;color:var(--fg);">Module</span>
            </div>
            <select class="phase-task-select" style="flex:1;padding:7px 10px;background:var(--bg-surface);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-family:var(--font);font-size:0.88rem;outline:none;">
              ${taskOptions}
            </select>
          </div>

          ${enabledModules.length === 0 ? `
            <div class="field-hint" style="margin:0 0 2px 0;">No task modules enabled. Enable one in the <strong>Tasks</strong> tab.</div>
          ` : ''}

          <!-- Post-EMA toggle -->
          <div class="phase-row" style="display:flex;align-items:center;justify-content:space-between;${postDisabled ? 'opacity:0.4;' : ''}">
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="phase-pill phase-pill-post">POST</span>
              <span style="font-size:0.88rem;color:var(--fg);">EMA Questions</span>
            </div>
            <label class="toggle">
              <input type="checkbox" class="phase-post-toggle" ${w.phases.post ? 'checked' : ''} ${postDisabled ? 'disabled' : ''}>
              <span class="toggle-track"></span>
            </label>
          </div>

        </div><!-- /phase-sequencer -->
      </div><!-- /window-content -->

      <button class="icon-btn del-btn" title="Remove window"
        style="background:none;border:none;color:var(--accent-red);font-size:1.4rem;cursor:pointer;padding:8px;opacity:0.7;transition:opacity 0.2s;flex-shrink:0;">✕</button>
    `;

    // ---- Event bindings ----

    el.querySelector('.win-label').addEventListener('input', e => {
      w.label = e.target.value;
      if (typeof renderGreetings === 'function') renderGreetings();
      if (typeof renderPreviewTabs === 'function') renderPreviewTabs();
      if (typeof renderQuestions === 'function') renderQuestions();
      schedulePreview();
    });
    el.querySelector('.win-start').addEventListener('input', e => { w.start = e.target.value; schedulePreview(); });
    el.querySelector('.win-end').addEventListener('input',   e => { w.end   = e.target.value; schedulePreview(); });

    // Pre toggle
    el.querySelector('.phase-pre-toggle').addEventListener('change', e => {
      w.phases.pre = e.target.checked;
      schedulePreview();
    });

    // Task select — when a task is chosen, enable the post row; when cleared, disable + uncheck it
    el.querySelector('.phase-task-select').addEventListener('change', e => {
      w.phases.task = e.target.value || null;
      const postRow  = el.querySelector('.phase-row:last-child');
      const postChk  = el.querySelector('.phase-post-toggle');
      const hasTask  = !!w.phases.task;
      postRow.style.opacity = hasTask ? '1' : '0.4';
      postChk.disabled = !hasTask;
      if (!hasTask) { w.phases.post = false; postChk.checked = false; }
      schedulePreview();
    });

    // Post toggle
    el.querySelector('.phase-post-toggle').addEventListener('change', e => {
      w.phases.post = e.target.checked;
      schedulePreview();
    });

    // Delete window
    const delBtn = el.querySelector('.del-btn');
    delBtn.addEventListener('mouseover', e => e.target.style.opacity = '1');
    delBtn.addEventListener('mouseout',  e => e.target.style.opacity = '0.7');
    delBtn.addEventListener('click', () => {
      state.ema.scheduling.windows.splice(i, 1);
      if (previewSession === w.id) previewSession = 'onboarding';
      renderWindows();
      if (typeof renderGreetings === 'function') renderGreetings();
      if (typeof renderPreviewTabs === 'function') renderPreviewTabs();
      if (typeof renderQuestions === 'function') renderQuestions();
      schedulePreview();
    });

    list.appendChild(el);
  });
}