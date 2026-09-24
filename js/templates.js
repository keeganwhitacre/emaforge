"use strict";

let protocolLibraryCatalog = null;

async function loadProtocolLibrary() {
  const container = document.getElementById('library-items');
  const status = document.getElementById('library-status');
  if (!container) return;
  if (status) status.textContent = 'Loading library…';
  try {
    const response = await fetch('library/catalog.json?v=20260924d');
    if (!response.ok) throw new Error('Library catalog could not be loaded.');
    const catalog = await response.json();
    const result = EMAForgeLibraryUtils.validateCatalog(catalog);
    if (!result.valid) throw new Error(result.errors[0]);
    const personal = EMAForgeLibraryUtils.loadPersonalLibrary(localStorage).map(item => ({
      ...item, badge: 'My Library', origin: 'personal', payload: item
    }));
    protocolLibraryCatalog = { ...catalog, items: [...personal, ...catalog.items.map(item => ({ ...item, origin: 'curated' }))] };
    renderProtocolLibrary(protocolLibraryCatalog.items);
    if (status) status.textContent = `${catalog.items.length} curated · ${personal.length} in My Library · every item is inspectable JSON`;
  } catch (error) {
    container.innerHTML = `<p class="questions-empty">${escH(error.message)}</p>`;
    if (status) status.textContent = '';
  }
}

function renderProtocolLibrary(items) {
  const container = document.getElementById('library-items');
  if (!container) return;
  const groups = [
    ['personal', 'My Library'],
    ['protocol', 'Complete protocols'],
    ['question_pack', 'Question packs'],
    ['task_preset', 'Physiology task presets']
  ];
  container.innerHTML = groups.map(([kind, label]) => {
    const matching = kind === 'personal' ? items.filter(item => item.origin === 'personal') : items.filter(item => item.kind === kind && item.origin !== 'personal');
    if (!matching.length) return '';
    return `<section class="library-group"><h3>${label}</h3><div class="library-grid">${matching.map(item => `
      <button type="button" class="library-card" data-library-id="${escH(item.id)}" style="--library-accent:${escH(item.accent || '#e8716a')}">
        <span class="library-card-top"><strong>${escH(item.name)}</strong><span>${escH(item.badge || '')}</span></span>
        <span class="library-card-desc">${escH(item.description)}</span>
        <span class="library-features">${(item.features || []).map(feature => `<span>${escH(feature)}</span>`).join('')}</span>
        <span class="library-action">${item.kind === 'protocol' ? 'Use protocol' : item.kind === 'question_pack' ? 'Add question pack' : 'Add task preset'} →</span>
      </button>`).join('')}</div></section>`;
  }).join('');

  container.querySelectorAll('.library-card').forEach(card => {
    card.addEventListener('click', () => installCatalogItem(card.dataset.libraryId));
  });
  const requestedId = new URLSearchParams(window.location.search).get('library');
  const requestedCard = requestedId && container.querySelector(`[data-library-id="${CSS.escape(requestedId)}"]`);
  if (requestedCard) {
    requestedCard.classList.add('requested');
    requestedCard.scrollIntoView({ block: 'center' });
    const status = document.getElementById('library-status');
    if (status) status.textContent = `Selected “${requestedCard.querySelector('strong')?.textContent || requestedId}” · review it, then choose the install action.`;
  }
}

async function fetchCatalogItem(id) {
  const item = protocolLibraryCatalog?.items.find(candidate => candidate.id === id);
  if (!item) throw new Error('Library item not found.');
  if (item.origin === 'personal') {
    const result = EMAForgeLibraryUtils.validateItem(item.payload);
    if (!result.valid) throw new Error(result.errors[0]);
    return JSON.parse(JSON.stringify(item.payload));
  }
  const response = await fetch(item.path);
  if (!response.ok) throw new Error('Library item could not be loaded.');
  const payload = await response.json();
  const result = EMAForgeLibraryUtils.validateItem(payload);
  if (!result.valid) throw new Error(result.errors[0]);
  if (payload.id !== item.id || payload.kind !== item.kind) throw new Error('Library catalog and item metadata do not match.');
  return payload;
}

async function installCatalogItem(id) {
  const status = document.getElementById('library-status');
  try {
    if (status) status.textContent = 'Preparing item…';
    const item = await fetchCatalogItem(id);
    if (item.kind === 'protocol') {
      validateProtocolBeforeLoad(item);
      StorageManager.loadTemplate(item.protocol);
      return;
    }
    const action = item.kind === 'question_pack'
      ? `Add “${item.name}” as a new survey step in the first session?`
      : `Apply “${item.name}” to the first session?`;
    if (!confirm(action)) return;
    applyLibraryItem(item);
  } catch (error) {
    if (status) status.textContent = error.message;
  }
}

function applyLibraryItem(item) {
  if (item.kind === 'question_pack') {
    EMAForgeLibraryUtils.installQuestionPack(state, item, { genQId, genSId });
  } else if (item.kind === 'task_preset') {
    EMAForgeLibraryUtils.installTaskPreset(state, item);
  } else {
    throw new Error('Unsupported library item.');
  }
  StorageManager.saveLocalState();
  StorageManager.triggerUIRefresh();
  const modal = document.getElementById('import-modal');
  if (modal) modal.classList.remove('open');
  const saveStatus = document.getElementById('save-status');
  if (saveStatus) {
    saveStatus.textContent = item.kind === 'question_pack' ? 'Question pack added' : 'Task preset added';
    saveStatus.style.color = 'var(--accent)';
  }
}

function validateProtocolBeforeLoad(item) {
  if (typeof EMAForgeProtocolValidator === 'undefined') return;
  const config = EMAForgeLibraryUtils.protocolForValidation(item.protocol);
  const report = EMAForgeProtocolValidator.validate(config);
  const blocking = report.errors.filter(issue => issue.code !== 'consent_placeholder');
  if (blocking.length) throw new Error(`Protocol failed validation: ${blocking[0].message}`);
}

function importLibraryItem(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const status = document.getElementById('library-status');
    try {
      const item = JSON.parse(reader.result);
      const result = EMAForgeLibraryUtils.validateItem(item);
      if (!result.valid) throw new Error(result.errors[0]);
      if (item.kind === 'protocol') {
        validateProtocolBeforeLoad(item);
        StorageManager.loadTemplate(item.protocol);
      } else if (confirm(`Install the imported ${item.kind === 'question_pack' ? 'question pack' : 'task preset'} “${item.name}”?`)) {
        applyLibraryItem(item);
      }
    } catch (error) {
      if (status) status.textContent = `Import failed: ${error.message}`;
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

document.addEventListener('DOMContentLoaded', () => {
  loadProtocolLibrary();
  const importButton = document.getElementById('import-library-item');
  const input = document.getElementById('library-item-file');
  if (importButton && input) importButton.addEventListener('click', () => input.click());
  if (input) input.addEventListener('change', importLibraryItem);
});
