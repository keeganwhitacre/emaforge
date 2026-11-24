"use strict";

// ---------------------------------------------------------------------------
// EMA Forge — StorageManager
// v1.4.0
// ---------------------------------------------------------------------------

const blankStudyDraft = JSON.stringify({ ...state, schema_version: SCHEMA_VERSION });
const StorageManager = {
    STORAGE_KEY: 'ema_studio_project_v1',
    DRAFT_PREFIX: 'ema_forge_draft_v2:',
    ACTIVE_KEY: 'ema_forge_active_draft_v2',
    WORKSPACE_PREFIX: 'ema_forge_builder_view_v1:',
    _draftId: null,
    hasDraft: false,
    _saveTimer: null,
    _blockedOlderDraft: false,

    init() {
        let saved;
        try {
            this._draftId = localStorage.getItem(this.ACTIVE_KEY);
            saved = (this._draftId && localStorage.getItem(this.DRAFT_PREFIX + this._draftId))
                || localStorage.getItem(this.STORAGE_KEY);
        } catch (_) { /* The editor can still export a backup. */ }
        if (!this._draftId) this._draftId = this.newId();
        this.hasDraft = !!saved || (typeof location !== 'undefined' &&
            (location.hash === '#library' || new URLSearchParams(location.search).has('library')));
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                this.mergeState(parsed);
                this.assignStudyId();
            } catch (e) {
                console.warn('EMA Forge: could not parse saved state, using defaults.', e);
            }
        }

        this.assignStudyId();
        this.renderDrafts();
        document.getElementById('draft-select')?.addEventListener('change', event => this.openDraft(event.target.value));

        const saveBtn   = document.getElementById('btn-save-project');
        const resetBtn  = document.getElementById('btn-reset');
        
        // Modal Elements
        const importModalBtn = document.getElementById('btn-import-modal');
        const importModal = document.getElementById('import-modal');
        const importModalClose = document.getElementById('import-modal-close');
        const customImportBtn = document.getElementById('import-custom-file');
        const importIn  = document.getElementById('import-file');

        if (saveBtn)   saveBtn.addEventListener('click', () => this.saveProject());
        if (resetBtn)  resetBtn.addEventListener('click', () => this.resetProject());
        
        // Modal Logic
        if (importModalBtn) importModalBtn.addEventListener('click', () => importModal.classList.add('open'));
        if (importModalClose) importModalClose.addEventListener('click', () => importModal.classList.remove('open'));
        if (customImportBtn) customImportBtn.addEventListener('click', () => importIn && importIn.click());
        
        if (importIn)  importIn.addEventListener('change', e => {
            if (importModal) importModal.classList.remove('open');
            this.importProject(e);
        });
    },

    newId() {
        return globalThis.crypto?.randomUUID?.() || `study-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    },

    assignStudyId() {
        if (!state.study.id) state.study.id = this.newId();
    },

    renderDrafts() {
        const select = document.getElementById('draft-select');
        if (!select) return;
        const drafts = new Map([[this._draftId, state.study.name || 'Untitled study']]);
        try {
            for (let index = 0; index < localStorage.length; index++) {
                const key = localStorage.key(index);
                if (!key?.startsWith(this.DRAFT_PREFIX)) continue;
                const id = key.slice(this.DRAFT_PREFIX.length);
                if (drafts.has(id)) continue;
                const draft = JSON.parse(localStorage.getItem(key));
                drafts.set(id, draft.study?.name || 'Untitled study');
            }
        } catch (_) { /* Draft picker still shows the current study. */ }
        select.replaceChildren();
        for (const [id, name] of drafts) {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = name;
            select.append(option);
        }
        select.value = this._draftId;
    },

    openDraft(id) {
        if (id === this._draftId) return;
        if (!this.saveLocalState() && !this._blockedOlderDraft) { this.renderDrafts(); return; }
        try {
            const draft = JSON.parse(localStorage.getItem(this.DRAFT_PREFIX + id));
            if (!draft) throw new Error('Draft unavailable');
            this.replaceDraft(draft, id);
        } catch (_) {
            this.renderDrafts();
            alert('This draft could not be opened.');
        }
    },

    replaceDraft(draft, id) {
        clearTimeout(this._saveTimer);
        this._saveTimer = null;
        const previous = state;
        const wasBlocked = this._blockedOlderDraft;
        state = JSON.parse(blankStudyDraft);
        try {
            if (!this.mergeState(draft)) throw new Error('Incompatible schema version');
        } catch (error) {
            state = previous;
            this._blockedOlderDraft = wasBlocked;
            throw error;
        }
        this._draftId = id;
        this.hasDraft = true;
        measureSessionId = state.ema.scheduling.windows[0]?.id ?? null;
        previewSession = measureSessionId || 'onboarding';
        this.assignStudyId();
        this.saveLocalState();
        this.renderDrafts();
        this.triggerUIRefresh();
        if (typeof restoreBuilderWorkspace === 'function') restoreBuilderWorkspace();
    },

    readWorkspace() {
        try { return JSON.parse(localStorage.getItem(this.WORKSPACE_PREFIX + this._draftId)) || {}; }
        catch (_) { return {}; }
    },

    rememberWorkspace(section, session, measureSession = null) {
        if (!this.hasDraft || this._blockedOlderDraft) return;
        try { localStorage.setItem(this.WORKSPACE_PREFIX + this._draftId, JSON.stringify({ section, session, measureSession })); }
        catch (_) { /* The draft can still be used if local preferences cannot be written. */ }
    },

    createDraft({ name = '', theme = '', blank = false } = {}) {
        if (!this.saveLocalState() && !this._blockedOlderDraft) return false;
        const draft = JSON.parse(blankStudyDraft);
        draft.study.name = name;
        if (theme) draft.study.theme = theme;
        if (blank) {
            draft.ema.questions = [];
            draft.ema.scheduling.windows[0].phase_sequence = [];
        } else {
            draft.ema.scheduling.days_of_week = [1, 2, 3, 4, 5, 6, 7];
        }
        this.replaceDraft(draft, this.newId());
        return true;
    },

    _compareVersions(a, b) {
        const pa = (a || '0.0.0').split('.').map(n => parseInt(n) || 0);
        const pb = (b || '0.0.0').split('.').map(n => parseInt(n) || 0);
        for (let i = 0; i < 3; i++) {
            if ((pa[i] || 0) < (pb[i] || 0)) return -1;
            if ((pa[i] || 0) > (pb[i] || 0)) return  1;
        }
        return 0;
    },

    mergeState(saved) {
        const currentVersion = typeof SCHEMA_VERSION !== 'undefined' ? SCHEMA_VERSION : '1.4.0';
        const savedVer = saved.schema_version || saved._schema_version || '1.0.0';
        const cmp = this._compareVersions(savedVer, currentVersion);

        if (cmp > 0) {
            console.warn(`EMA Forge: saved project is schema v${savedVer}, runtime is v${currentVersion}. Refusing to load to avoid data corruption. Export a backup from the newer builder version, or reset this project.`);
            this.reportSaveStatus('Incompatible backup', 'error');
            return false;
        }

        if (cmp < 0) {
            console.warn(`EMA Forge: older project v${savedVer} uses global question sets. Download a backup before starting a new v${currentVersion} project.`);
            this.reportSaveStatus('Older draft could not be loaded', 'error');
            this._blockedOlderDraft = true;
            return false;
        }

        if (!saved.study || typeof saved.study !== 'object' ||
            !saved.onboarding || typeof saved.onboarding !== 'object' ||
            !Array.isArray(saved.ema?.questions) || !Array.isArray(saved.ema?.scheduling?.windows)) {
            return false;
        }
        ['deployment', 'study', 'onboarding', 'ema'].forEach(key => {
            if (saved[key] !== undefined) state[key] = saved[key];
        });

        if (!state.deployment || typeof state.deployment !== 'object') state.deployment = { hosted_url: '' };
        if (typeof state.deployment.hosted_url !== 'string') state.deployment.hosted_url = '';

        if (Array.isArray(saved.modules)) {
            saved.modules.forEach(savedMod => {
                const live = state.modules.find(m => m.id === savedMod.id);
                if (live) {
                    live.enabled  = savedMod.enabled;
                    live.settings = Object.assign({}, live.settings, savedMod.settings);
                }
            });
        }

        if (state.study.completion_lock === undefined) state.study.completion_lock = true;
        if (state.study.resume_enabled  === undefined) state.study.resume_enabled  = true;
        if (state.ema.allow_back_navigation === undefined) state.ema.allow_back_navigation = false;
        state.onboarding.consent_text = sanitizeConsentHtml(state.onboarding.consent_text);
        this._blockedOlderDraft = false;
        return true;
    },

    reportSaveStatus(message, statusType) {
        const status = document.getElementById('save-status');
        if (status) {
            status.dataset.state = statusType;
            status.textContent = message;
        }
    },

    debouncedSave() {
        if (!this.hasDraft || this._blockedOlderDraft) return;
        this.reportSaveStatus('Saving…', 'pending');
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            this.saveLocalState();
        }, 800);
    },

    saveLocalState() {
        if (this._blockedOlderDraft) return false;
        if (!this.hasDraft) return true;
        try {
            const currentVersion = typeof SCHEMA_VERSION !== 'undefined' ? SCHEMA_VERSION : '1.4.0';
            const toSave = Object.assign({}, state, { schema_version: currentVersion });
            localStorage.setItem(this.DRAFT_PREFIX + this._draftId, JSON.stringify(toSave));
            localStorage.setItem(this.ACTIVE_KEY, this._draftId);
            const currentOption = document.getElementById('draft-select')?.selectedOptions[0];
            if (currentOption?.value === this._draftId) currentOption.textContent = state.study.name || 'Untitled study';
            this.reportSaveStatus('Saved in this browser', 'saved');
            return true;
        } catch (e) {
            console.warn('EMA Forge: localStorage save failed.', e);
            this.reportSaveStatus('Could not save locally. Download a backup.', 'error');
            return false;
        }
    },

    saveProject() {
        if (typeof state === 'undefined') return;
        const currentVersion = typeof SCHEMA_VERSION !== 'undefined' ? SCHEMA_VERSION : '1.4.0';
        const toSave = Object.assign({}, state, { schema_version: currentVersion });
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(toSave, null, 2));
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
                if (!this.saveLocalState() && !this._blockedOlderDraft) return;
                this.replaceDraft(imported, this.newId());
                document.getElementById('study-setup')?.close();
            } catch (err) {
                alert("Error parsing JSON file. Please ensure it is a valid EMA Forge backup.");
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    },

    resetProject() {
        if (!confirm('Reset this draft? Download a backup first if you need a copy.')) return;
        if (this._blockedOlderDraft) localStorage.removeItem(this.STORAGE_KEY);
        const current = this._draftId;
        this.rememberWorkspace('study', null);
        this.replaceDraft(JSON.parse(blankStudyDraft), current);
    },

    loadTemplate(templateObj, { name = '', theme = '' } = {}) {
        if (!this.saveLocalState() && !this._blockedOlderDraft) return false;
        const draft = JSON.parse(JSON.stringify(templateObj));
        if (name) draft.study.name = name;
        if (theme) draft.study.theme = theme;
        delete draft.study.id;
        draft.deployment = { hosted_url: '' };
        this.replaceDraft(draft, this.newId());
        document.getElementById('import-modal')?.classList.remove('open');
        return true;
    },

    triggerUIRefresh() {
        const el = id => document.getElementById(id);

        // 1. Study Tab
        if (el('study-name'))    el('study-name').value = state.study.name || '';
        if (el('institution'))   el('institution').value = state.study.institution || '';
        if (el('study-webhook')) el('study-webhook').value = state.study.webhook_url || '';
        if (el('deploy-webhook-url')) el('deploy-webhook-url').value = state.study.webhook_url || '';
        if (el('deploy-base-url')) el('deploy-base-url').value = state.deployment?.hosted_url || '';
        
        if (el('accent-color')) {
            el('accent-color').value = state.study.accent_color || '#e8716a';
            const sw = el('color-preview-swatch');
            if (sw) sw.style.background = state.study.accent_color || '#e8716a';
        }
        if (el('study-theme'))   el('study-theme').value = state.study.theme || 'oled';
        document.querySelectorAll('#format-ctrl .seg-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.fmt === state.study.output_format);
        });

        if (el('study-completion-lock')) el('study-completion-lock').checked = !!state.study.completion_lock;
        if (el('study-resume-enabled'))  el('study-resume-enabled').checked  = !!state.study.resume_enabled;
        if (el('ema-allow-back'))        el('ema-allow-back').checked = state.ema.allow_back_navigation === true;

        // 2. Onboarding tab
        if (el('ob-toggle'))        el('ob-toggle').checked = !!state.onboarding.enabled;
        if (el('ob-schedule-toggle')) el('ob-schedule-toggle').checked = state.onboarding.ask_schedule !== false;
        
        // FIX: contenteditable divs use innerHTML, not value!
        if (el('ob-consent-text'))  el('ob-consent-text').innerHTML = state.onboarding.consent_text || '';

        // 3. Schedule tab numeric fields
        if (el('study-days'))      el('study-days').value    = state.ema.scheduling.study_days || 14;
        if (el('daily-prompts'))   el('daily-prompts').value = state.ema.scheduling.windows?.length || 0;
        if (el('window-expiry'))   el('window-expiry').value = state.ema.scheduling.timing?.expiry_minutes || 60;
        if (el('grace-period'))    el('grace-period').value  = state.ema.scheduling.timing?.grace_minutes  || 10;
        document.querySelectorAll('#dow-grid .dow-chip').forEach(chip => {
            const dow = parseInt(chip.dataset.dow);
            chip.classList.toggle('on', (state.ema.scheduling.days_of_week || []).includes(dow));
            chip.setAttribute('aria-pressed', String(chip.classList.contains('on')));
        });

        // 4. Re-render panels
        if (typeof updateDeploymentControls === 'function') updateDeploymentControls();
        if (typeof updateSuggestedWorkerName === 'function') updateSuggestedWorkerName();
        if (typeof renderWindows      === 'function') renderWindows();
        if (typeof renderQuestions    === 'function') renderQuestions();
        if (typeof renderGreetings    === 'function') renderGreetings();
        if (typeof renderModules      === 'function') renderModules();
        if (typeof renderPreviewTabs  === 'function') renderPreviewTabs();
        if (typeof schedulePreview    === 'function') schedulePreview();
    }
};

// Initialize immediately so state is loaded BEFORE the inline script in builder.html triggers renders
StorageManager.init();
function flushPendingDraftSave() {
    if (StorageManager._saveTimer === null) return;
    clearTimeout(StorageManager._saveTimer);
    StorageManager._saveTimer = null;
    StorageManager.saveLocalState();
}

window.addEventListener('pagehide', flushPendingDraftSave);
document.addEventListener?.('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingDraftSave();
});
