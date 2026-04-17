"use strict";

// ---------------------------------------------------------------------------
// Tasks Tab
//
// Renders entirely from state.modules — no hardcoded module HTML.
// To add a new module, define its settings schema here in SETTINGS_RENDERERS
// and push its entry into state.modules in state.js. Nothing else needs
// touching in this file.
//
// Architecture:
//   bindTasksTab()     — called once on page load; renders initial cards
//   renderModules()    — tears down and rebuilds the module list from state
//   buildModuleCard()  — creates one card DOM element for a given module
//   SETTINGS_RENDERERS — map of module id → function that returns settings HTML
//                        and a bind function to wire events
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SETTINGS_RENDERERS
// Each entry: { html(mod) → htmlString, bind(card, mod) → void }
// html()  — returns the inner HTML for the settings panel
// bind()  — attaches event listeners after the card is inserted into the DOM
// ---------------------------------------------------------------------------
const SETTINGS_RENDERERS = {

  epat: {
    html(mod) {
      const s = mod.settings;
      return `
        <div class="field-row">
          <div class="field-group">
            <label class="field-label">Valid Trials Target</label>
            <input type="number" class="ms-trials" value="${s.trials}" min="5" max="40">
          </div>
          <div class="field-group">
            <label class="field-label">Trial Duration (s)</label>
            <input type="number" class="ms-trial-dur" value="${s.trial_duration_sec}" min="15" max="60">
          </div>
        </div>
        <div class="field-row">
          <div class="field-group">
            <label class="field-label">Retry Budget</label>
            <input type="number" class="ms-retries" value="${s.retry_budget}" min="20" max="60">
            <div class="field-hint">Max attempts covering SQI + trial quality failures.</div>
          </div>
          <div class="field-group">
            <label class="field-label">SQI Threshold</label>
            <input type="number" class="ms-sqi" value="${s.sqi_threshold}" min="0.1" max="1.0" step="0.05">
            <div class="field-hint">Perfusion index floor for trial acceptance.</div>
          </div>
        </div>
        <div class="toggle-row">
          <span class="toggle-label">Include Body Map Sensation Tracker</span>
          <label class="toggle">
            <input type="checkbox" class="ms-bodymap" ${s.body_map ? 'checked' : ''}>
            <span class="toggle-track"></span>
          </label>
        </div>
        <div class="toggle-row">
          <span class="toggle-label">Per-trial confidence ratings</span>
          <label class="toggle">
            <input type="checkbox" class="ms-conf" ${s.confidence_ratings ? 'checked' : ''}>
            <span class="toggle-track"></span>
          </label>
        </div>
        <div class="toggle-row">
          <span class="toggle-label">Two-phase practice (tone-to-tone + tone-to-heartbeat)</span>
          <label class="toggle">
            <input type="checkbox" class="ms-practice" ${s.two_phase_practice ? 'checked' : ''}>
            <span class="toggle-track"></span>
          </label>
        </div>
      `;
    },

    bind(card, mod) {
      const s = mod.settings;
      const num = (sel, key) => {
        const el = card.querySelector(sel);
        if (el) el.addEventListener('input', () => { s[key] = parseFloat(el.value) || 0; schedulePreview(); });
      };
      num('.ms-trials',    'trials');
      num('.ms-trial-dur', 'trial_duration_sec');
      num('.ms-retries',   'retry_budget');
      num('.ms-sqi',       'sqi_threshold');

      const chk = (sel, key) => {
        const el = card.querySelector(sel);
        if (el) el.addEventListener('change', () => { s[key] = el.checked; schedulePreview(); });
      };
      chk('.ms-bodymap',  'body_map');
      chk('.ms-conf',     'confidence_ratings');
      chk('.ms-practice', 'two_phase_practice');
    }
  }

  // To add Stroop, IAT, etc.:
  // stroop: { html(mod) { ... }, bind(card, mod) { ... } }
};

// ---------------------------------------------------------------------------
// buildModuleCard(mod) — creates the full card DOM element for one module
// ---------------------------------------------------------------------------
function buildModuleCard(mod) {
  const card = document.createElement('div');
  card.className = `task-card${mod.enabled ? ' enabled' : ''}`;
  card.dataset.modId = mod.id;

  const badgeHtml = mod.badge
    ? `<span class="badge badge-blue" style="margin-left:6px">${escH(mod.badge)}</span>`
    : '';

  const renderer = SETTINGS_RENDERERS[mod.id];
  const settingsHtml = renderer ? renderer.html(mod) : '';

  card.innerHTML = `
    <div class="task-header">
      <div>
        <div class="task-name">${escH(mod.label)}${badgeHtml}</div>
        <div class="task-desc">${escH(mod.desc)}</div>
      </div>
      <label class="toggle" style="margin-top:2px; flex-shrink:0;">
        <input type="checkbox" class="mod-toggle" ${mod.enabled ? 'checked' : ''}>
        <span class="toggle-track"></span>
      </label>
    </div>
    <div class="task-settings${mod.enabled ? '' : ' hidden'}" id="mod-settings-${mod.id}">
      ${settingsHtml}
    </div>
  `;

  // Wire the enable/disable toggle
  card.querySelector('.mod-toggle').addEventListener('change', e => {
    mod.enabled = e.target.checked;
    card.classList.toggle('enabled', mod.enabled);
    card.querySelector(`#mod-settings-${mod.id}`).classList.toggle('hidden', !mod.enabled);
    // Re-render windows so the task dropdowns reflect newly enabled/disabled modules
    if (typeof renderWindows === 'function') renderWindows();
    schedulePreview();
  });

  // Wire settings-specific events
  if (renderer) renderer.bind(card, mod);

  return card;
}

// ---------------------------------------------------------------------------
// renderModules() — rebuilds the full module list from state.modules
// Called by bindTasksTab() and by triggerUIRefresh() in storage.js
// ---------------------------------------------------------------------------
function renderModules() {
  const list = document.getElementById('module-list');
  if (!list) return;
  list.innerHTML = '';
  state.modules.forEach(mod => list.appendChild(buildModuleCard(mod)));
}

// ---------------------------------------------------------------------------
// bindTasksTab() — entry point, called once from builder.html on load
// ---------------------------------------------------------------------------
function bindTasksTab() {
  renderModules();
}