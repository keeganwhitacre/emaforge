"use strict";

// ---------------------------------------------------------------------------
// StorageManager
//
// Changes from v1.1:
//   - triggerUIRefresh no longer references any hardcoded module DOM IDs.
//     The Tasks tab refresh is now a single renderModules() call, which
//     rebuilds cards dynamically from state.modules.
//   - Removed stale greeting-morning/afternoon/evening fallback lookups
//     (greetings are now keyed by window ID, rendered by renderGreetings()).
// ---------------------------------------------------------------------------

const StorageManager = {
    STORAGE_KEY: 'ema_studio_project_v1',

    init() {
        const saved = localStorage.getItem(this.STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                // Deep merge into state so any new fields added in state.js
                // (e.g. modules, phases) survive across schema bumps.
                this.mergeState(parsed);
            } catch (e) {
                console.warn('EMA Studio: could not parse saved state, using defaults.', e);
            }
        }

        // Wire top-bar buttons
        document.getElementById('btn-save-project').addEventListener('click', () => this.saveProject());
        document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
        document.getElementById('import-file').addEventListener('change', e => this.importProject(e));
        document.getElementById('btn-reset').addEventListener('click', () => this.resetProject());

        // Auto-save on any state change (debounced via schedulePreview → storage hook below)
        this.startAutoSave();
    },

    // -----------------------------------------------------------------------
    // mergeState — overlays saved data onto the live state object.
    // We overwrite at the top level but preserve any keys in state that
    // don't exist in the saved file (forward-compat for new fields).
    // -----------------------------------------------------------------------
    mergeState(saved) {
        // Top-level scalar/object keys
        ['study', 'onboarding', 'ema'].forEach(key => {
            if (saved[key] !== undefined) state[key] = saved[key];
        });

        // modules: merge by id so new modules added in state.js appear even
        // in projects saved before they existed.
        if (Array.isArray(saved.modules)) {
            saved.modules.forEach(savedMod => {
                const live = state.modules.find(m => m.id === savedMod.id);
                if (live) {
                    live.enabled  = savedMod.enabled;
                    live.settings = Object.assign({}, live.settings, savedMod.settings);
                }
                // Unknown module ids (from future versions) are silently ignored.
            });
        }

        // Legacy compat: if saved state has old state.pat blob but no modules array,
        // migrate it into the epat module entry.
        if (saved.pat && !Array.isArray(saved.modules)) {
            const epatMod = state.modules.find(m => m.id === 'epat');
            if (epatMod) {
                epatMod.enabled  = saved.pat.enabled || false;
                epatMod.settings = Object.assign({}, epatMod.settings, {
                    trials:              saved.pat.trials,
                    trial_duration_sec:  saved.pat.trial_duration_sec,
                    retry_budget:        saved.pat.retry_budget,
                    sqi_threshold:       saved.pat.sqi_threshold,
                    confidence_ratings:  saved.pat.confidence_ratings,
                    two_phase_practice:  saved.pat.two_phase_practice,
                    body_map:            saved.pat.body_map
                });
            }
        }
    },

    startAutoSave() {
        // Patch schedulePreview to also persist after the debounce fires.
        // This avoids a second timer and piggybacks on the existing debounce.
        const original = window.schedulePreview;
        if (typeof original === 'function') {
            window.schedulePreview = () => {
                original();
                // Save slightly after the preview debounce (600ms) so we
                // don't thrash localStorage on every keystroke.
                clearTimeout(this._saveTimer);
                this._saveTimer = setTimeout(() => this.saveLocalState(), 800);
            };
        }
    },

    saveLocalState() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
            const status = document.getElementById('save-status');
            if (status) status.textContent = 'Up to date';
        } catch (e) {
            console.warn('EMA Studio: localStorage save failed.', e);
        }
    },

    saveProject() {
        if (typeof state === 'undefined') return;
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
        const a = document.createElement('a');
        a.setAttribute("href", dataStr);
        a.setAttribute("download", "ema_project_backup.json");
        document.body.appendChild(a);
        a.click();
        a.remove();
    },

    importProject(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const imported = JSON.parse(e.target.result);
                // Merge rather than replace so the live module registry
                // stays intact even if the backup is from an older schema.
                this.mergeState(imported);
                this.saveLocalState();
                this.triggerUIRefresh();
                const status = document.getElementById('save-status');
                if (status) status.textContent = 'Project imported';
            } catch (err) {
                alert("Error parsing JSON file. Please ensure it is a valid EMA Studio backup.");
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    },

    resetProject() {
        if (confirm("Are you sure you want to completely restart? All unsaved progress will be lost.")) {
            localStorage.removeItem(this.STORAGE_KEY);
            location.reload();
        }
    },

    // -----------------------------------------------------------------------
    // triggerUIRefresh — re-syncs every tab's DOM with the current state.
    // Called after import/merge. Keep in sync with any new tabs added later.
    // -----------------------------------------------------------------------
    triggerUIRefresh() {
        // 1. Study Tab
        if (document.getElementById('study-name'))
            document.getElementById('study-name').value = state.study.name;
        if (document.getElementById('institution'))
            document.getElementById('institution').value = state.study.institution;
        if (document.getElementById('accent-color')) {
            document.getElementById('accent-color').value = state.study.accent_color;
            document.getElementById('color-preview-swatch').style.background = state.study.accent_color;
        }
        if (document.getElementById('study-theme'))
            document.getElementById('study-theme').value = state.study.theme;
        document.querySelectorAll('#format-ctrl .seg-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.fmt === state.study.output_format);
        });

        // 2. Onboarding Tab
        if (document.getElementById('ob-toggle')) {
            document.getElementById('ob-toggle').checked = state.onboarding.enabled;
            const settings = document.getElementById('ob-settings');
            if (settings) settings.style.display = state.onboarding.enabled ? 'block' : 'none';
        }
        if (document.getElementById('ob-schedule-toggle'))
            document.getElementById('ob-schedule-toggle').checked = state.onboarding.ask_schedule !== false;
        if (document.getElementById('ob-consent-text'))
            document.getElementById('ob-consent-text').value = state.onboarding.consent_text;

        // 3. Schedule Tab
        if (document.getElementById('study-days'))
            document.getElementById('study-days').value = state.ema.scheduling.study_days;
        if (document.getElementById('daily-prompts'))
            document.getElementById('daily-prompts').value = state.ema.scheduling.daily_prompts;
        if (document.getElementById('window-expiry'))
            document.getElementById('window-expiry').value = state.ema.scheduling.timing.expiry_minutes;
        if (document.getElementById('grace-period'))
            document.getElementById('grace-period').value = state.ema.scheduling.timing.grace_minutes;
        document.querySelectorAll('.dow-chip').forEach(chip => {
            chip.classList.toggle('on', state.ema.scheduling.days_of_week.includes(parseInt(chip.dataset.dow)));
        });
        if (typeof renderWindows === 'function') renderWindows();

        // 4. Tasks Tab — dynamic render, no hardcoded IDs
        if (typeof renderModules === 'function') renderModules();

        // 5. Questions Tab + Preview
        if (typeof renderGreetings  === 'function') renderGreetings();
        if (typeof renderQuestions  === 'function') renderQuestions();
        if (typeof schedulePreview  === 'function') schedulePreview();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    StorageManager.init();
});