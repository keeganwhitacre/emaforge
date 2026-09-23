"use strict";

const LibraryPage = {
  curated: [],
  catalog: [],
  kind: 'all',
  query: '',
  selectedPersonalId: null,
  objectUrl: null,

  async init() {
    const status = document.getElementById('library-page-status');
    try {
      const response = await fetch('library/catalog.json?v=20260923c');
      if (!response.ok) throw new Error('The library catalog could not be loaded.');
      const catalog = await response.json();
      const result = EMAForgeLibraryUtils.validateCatalog(catalog);
      if (!result.valid) throw new Error(result.errors[0]);
      this.curated = catalog.items.map(item => ({ ...item, origin: 'curated' }));
      this.refreshPersonal();
    } catch (error) {
      status.textContent = error.message;
    }
  },

  refreshPersonal() {
    const personal = EMAForgeLibraryUtils.loadPersonalLibrary(localStorage).map(item => ({
      ...item, badge: 'My Library', origin: 'personal', payload: item
    }));
    this.catalog = [...personal, ...this.curated];
    this.render();
  },

  matches(item) {
    if (this.kind !== 'all' && item.kind !== this.kind) return false;
    const haystack = [item.name, item.description, ...(item.features || [])].join(' ').toLowerCase();
    return haystack.includes(this.query);
  },

  render() {
    const items = this.catalog.filter(item => this.matches(item));
    const personalCount = this.catalog.filter(item => item.origin === 'personal').length;
    document.getElementById('library-page-status').textContent = `${items.length} shown · ${this.curated.length} curated · ${personalCount} in My Library`;
    const grid = document.getElementById('library-page-grid');
    grid.innerHTML = items.map(item => {
      const physiology = item.kind === 'task_preset' || (item.features || []).some(feature => /ppg|epat|hct|physio/i.test(feature));
      return `<button type="button" class="library-page-card ${physiology ? 'physiology' : ''} ${item.origin === 'personal' ? 'personal' : ''}" data-id="${this.escape(item.id)}" data-origin="${item.origin}">
        <span class="library-page-card-head"><h2>${this.escape(item.name)}</h2><span class="library-kind">${item.origin === 'personal' ? 'My Library' : this.kindLabel(item.kind)}</span></span>
        <p>${this.escape(item.description)}</p>
        <span class="library-page-features">${(item.features || []).map(feature => `<span>${this.escape(feature)}</span>`).join('')}</span>
        <span class="library-view">Preview details →</span>
      </button>`;
    }).join('') || '<p class="questions-empty">No library items match this search.</p>';
    grid.querySelectorAll('[data-id]').forEach(card => card.addEventListener('click', () => this.open(card.dataset.id, card.dataset.origin)));
  },

  async open(id, origin) {
    const summary = this.catalog.find(item => item.id === id && item.origin === origin);
    if (!summary) return;
    let item;
    if (summary.origin === 'personal') item = summary.payload;
    else {
      const response = await fetch(summary.path);
      if (!response.ok) return;
      item = await response.json();
    }
    const result = EMAForgeLibraryUtils.validateItem(item);
    if (!result.valid) return;
    this.selectedPersonalId = summary.origin === 'personal' ? id : null;
    document.getElementById('library-detail-kind').textContent = summary.origin === 'personal' ? `My Library · ${this.kindLabel(item.kind)}` : this.kindLabel(item.kind);
    document.getElementById('library-detail-title').textContent = item.name;
    document.getElementById('library-detail-description').textContent = item.description || summary.description;
    const rows = [
      ['Intended use', item.intended_use],
      ['Estimated burden', item.estimated_burden],
      ['Validation status', item.validation_status],
      ['Device requirements', item.device_requirements || 'No special device requirements listed.'],
      ['Source', item.source],
      ['License', item.license]
    ];
    document.getElementById('library-detail-meta').innerHTML = rows.map(([label, value]) => `<dt>${this.escape(label)}</dt><dd>${this.escape(value || 'Not provided')}</dd>`).join('');
    const references = Array.isArray(item.references) ? item.references : [];
    document.getElementById('library-detail-references').innerHTML = references.length
      ? `<h3>Evidence and implementation links</h3><ul>${references.map(reference => `<li><a href="${this.safeUrl(reference.url)}" target="_blank" rel="noopener noreferrer">${this.escape(reference.label)}</a>${reference.note ? ` — ${this.escape(reference.note)}` : ''}</li>`).join('')}</ul>`
      : '<h3>Evidence and implementation links</h3><p class="library-detail-description">No external references are attached. Review provenance and validation before research use.</p>';
    document.getElementById('library-use-link').href = `builder.html?library=${encodeURIComponent(id)}#library`;
    const jsonLink = document.getElementById('library-json-link');
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    if (summary.origin === 'personal') {
      this.objectUrl = URL.createObjectURL(new Blob([JSON.stringify(item, null, 2)], { type: 'application/json' }));
      jsonLink.href = this.objectUrl;
      jsonLink.download = `${item.id}.json`;
      jsonLink.textContent = 'Download JSON';
    } else {
      jsonLink.href = summary.path;
      jsonLink.removeAttribute('download');
      jsonLink.textContent = 'Inspect JSON ↗';
    }
    document.getElementById('library-delete-btn').hidden = summary.origin !== 'personal';
    document.getElementById('library-detail-modal').classList.add('open');
    document.getElementById('library-detail-close').focus();
  },

  openCreator() {
    const draft = this.currentDraft();
    const taskSelect = document.getElementById('contribution-module');
    taskSelect.innerHTML = (draft?.modules || []).map(module => `<option value="${this.escape(module.id)}">${this.escape(module.label || module.id)}</option>`).join('');
    document.getElementById('library-create-status').textContent = draft
      ? 'Ready to copy from the study saved in this browser.'
      : 'No saved study found. Open the Builder and make or save a study first.';
    this.toggleModuleField();
    document.getElementById('library-create-modal').classList.add('open');
    document.getElementById('contribution-name').focus();
  },

  currentDraft() {
    try { return JSON.parse(localStorage.getItem('ema_studio_project_v1') || 'null'); } catch { return null; }
  },

  toggleModuleField() {
    document.getElementById('contribution-module-wrap').hidden = document.getElementById('contribution-kind').value !== 'task_preset';
  },

  metadata() {
    const value = id => document.getElementById(id).value.trim();
    return {
      kind: value('contribution-kind'), module_id: value('contribution-module'), name: value('contribution-name'),
      description: value('contribution-description'), source: value('contribution-source'), license: value('contribution-license'),
      validation_status: value('contribution-validation'), intended_use: value('contribution-use'),
      estimated_burden: value('contribution-burden'), device_requirements: value('contribution-device'),
      features: value('contribution-features').split(',').map(part => part.trim()).filter(Boolean)
    };
  },

  saveContribution(download) {
    const status = document.getElementById('library-create-status');
    try {
      const item = EMAForgeLibraryUtils.createContribution(this.currentDraft(), this.metadata());
      EMAForgeLibraryUtils.savePersonalItem(item, localStorage);
      if (download) this.download(item);
      status.textContent = `“${item.name}” was added to My Library${download ? ' and downloaded' : ''}.`;
      this.refreshPersonal();
      setTimeout(() => { document.getElementById('library-create-modal').classList.remove('open'); }, 450);
    } catch (error) {
      status.textContent = error.message;
    }
  },

  download(item) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(item, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${item.id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  deleteSelected() {
    if (!this.selectedPersonalId || !confirm('Delete this item from My Library in this browser?')) return;
    EMAForgeLibraryUtils.deletePersonalItem(this.selectedPersonalId, localStorage);
    this.close();
    this.refreshPersonal();
  },

  close() { document.getElementById('library-detail-modal').classList.remove('open'); },
  kindLabel(kind) { return ({ protocol: 'Protocol', question_pack: 'Survey pack', task_preset: 'Physiology preset' })[kind] || kind; },
  escape(value) { const span = document.createElement('span'); span.textContent = String(value || ''); return span.innerHTML; },
  safeUrl(value) { try { const url = new URL(value, location.href); return ['http:', 'https:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; } }
};

document.getElementById('library-search').addEventListener('input', event => { LibraryPage.query = event.target.value.trim().toLowerCase(); LibraryPage.render(); });
document.querySelectorAll('.library-filters button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.library-filters button').forEach(candidate => candidate.classList.remove('active'));
  button.classList.add('active');
  LibraryPage.kind = button.dataset.kind;
  LibraryPage.render();
}));
document.getElementById('library-detail-close').addEventListener('click', () => LibraryPage.close());
document.getElementById('library-detail-modal').addEventListener('click', event => { if (event.target.id === 'library-detail-modal') LibraryPage.close(); });
document.getElementById('library-delete-btn').addEventListener('click', () => LibraryPage.deleteSelected());
document.getElementById('library-create-btn').addEventListener('click', () => LibraryPage.openCreator());
document.getElementById('library-create-close').addEventListener('click', () => document.getElementById('library-create-modal').classList.remove('open'));
document.getElementById('library-create-modal').addEventListener('click', event => { if (event.target.id === 'library-create-modal') event.currentTarget.classList.remove('open'); });
document.getElementById('contribution-kind').addEventListener('change', () => LibraryPage.toggleModuleField());
document.getElementById('library-create-form').addEventListener('submit', event => { event.preventDefault(); LibraryPage.saveContribution(false); });
document.getElementById('library-create-download').addEventListener('click', () => LibraryPage.saveContribution(true));
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  LibraryPage.close();
  document.getElementById('library-create-modal').classList.remove('open');
});
LibraryPage.init();
