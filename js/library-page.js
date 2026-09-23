"use strict";

const LibraryPage = {
  catalog: [],
  kind: 'all',
  query: '',

  async init() {
    const status = document.getElementById('library-page-status');
    try {
      const response = await fetch('library/catalog.json?v=20260923c');
      if (!response.ok) throw new Error('The library catalog could not be loaded.');
      const catalog = await response.json();
      const result = EMAForgeLibraryUtils.validateCatalog(catalog);
      if (!result.valid) throw new Error(result.errors[0]);
      this.catalog = catalog.items;
      this.render();
    } catch (error) {
      status.textContent = error.message;
    }
  },

  matches(item) {
    if (this.kind !== 'all' && item.kind !== this.kind) return false;
    const haystack = [item.name, item.description, ...(item.features || [])].join(' ').toLowerCase();
    return haystack.includes(this.query);
  },

  render() {
    const items = this.catalog.filter(item => this.matches(item));
    document.getElementById('library-page-status').textContent = `${items.length} of ${this.catalog.length} curated items`;
    const grid = document.getElementById('library-page-grid');
    grid.innerHTML = items.map(item => {
      const physiology = item.kind === 'task_preset' || (item.features || []).some(feature => /ppg|epat|hct|physio/i.test(feature));
      return `<button type="button" class="library-page-card ${physiology ? 'physiology' : ''}" data-id="${this.escape(item.id)}">
        <span class="library-page-card-head"><h2>${this.escape(item.name)}</h2><span class="library-kind">${this.kindLabel(item.kind)}</span></span>
        <p>${this.escape(item.description)}</p>
        <span class="library-page-features">${(item.features || []).map(feature => `<span>${this.escape(feature)}</span>`).join('')}</span>
        <span class="library-view">Preview details →</span>
      </button>`;
    }).join('');
    grid.querySelectorAll('[data-id]').forEach(card => card.addEventListener('click', () => this.open(card.dataset.id)));
  },

  async open(id) {
    const summary = this.catalog.find(item => item.id === id);
    if (!summary) return;
    const response = await fetch(summary.path);
    if (!response.ok) return;
    const item = await response.json();
    const result = EMAForgeLibraryUtils.validateItem(item);
    if (!result.valid) return;
    document.getElementById('library-detail-kind').textContent = this.kindLabel(item.kind);
    document.getElementById('library-detail-title').textContent = item.name;
    document.getElementById('library-detail-description').textContent = summary.description;
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
      : '<h3>Evidence and implementation links</h3><p class="library-detail-description">No external references are attached to this original demonstration item.</p>';
    document.getElementById('library-use-link').href = `builder.html?library=${encodeURIComponent(id)}#library`;
    document.getElementById('library-json-link').href = summary.path;
    document.getElementById('library-detail-modal').classList.add('open');
    document.getElementById('library-detail-close').focus();
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
document.addEventListener('keydown', event => { if (event.key === 'Escape') LibraryPage.close(); });
LibraryPage.init();
