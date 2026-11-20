"use strict";

const studySetup = document.getElementById('study-setup');
const setupLibrary = document.getElementById('setup-library');
const protocolFields = document.getElementById('setup-library-fields');
const protocolSelect = document.getElementById('setup-protocol');
const protocolDescription = document.getElementById('setup-protocol-description');
const protocolButton = document.getElementById('setup-use-protocol');
const setupStatus = document.getElementById('setup-status');
const setupCancel = document.getElementById('setup-cancel');
let loadingProtocol = false;

function setupMessage(message) {
  setupStatus.hidden = !message;
  setupStatus.textContent = message;
}

function setupDetails() {
  return {
    name: document.getElementById('setup-name').value.trim(),
    theme: document.getElementById('setup-theme').value
  };
}

function openStudySetup() {
  document.getElementById('setup-name').value = '';
  document.getElementById('setup-theme').value = '';
  protocolFields.hidden = true;
  setupLibrary.setAttribute('aria-expanded', 'false');
  studySetup.querySelector('details').open = false;
  setupCancel.hidden = !StorageManager.hasDraft;
  setupMessage('');
  studySetup.showModal();
}

function finishStudySetup() {
  studySetup.close();
  document.querySelector('.tab-btn[data-tab="questions"]').click();
  const heading = document.getElementById('builder-section-title');
  heading.tabIndex = -1;
  heading.focus();
}

function startStudyFromSetup(blank) {
  if (loadingProtocol) return;
  if (StorageManager.createDraft({ ...setupDetails(), blank })) finishStudySetup();
  else setupMessage('The current draft could not be saved. Download a backup before starting another study.');
}

function updateSetupProtocolDescription() {
  const selected = protocolLibraryCatalog?.items.find(item => item.id === protocolSelect.value);
  protocolDescription.textContent = selected?.description || '';
  protocolButton.disabled = !selected || loadingProtocol;
}

setupLibrary.addEventListener('click', async () => {
  protocolFields.hidden = !protocolFields.hidden;
  setupLibrary.setAttribute('aria-expanded', String(!protocolFields.hidden));
  if (protocolFields.hidden) return;
  if (!protocolLibraryCatalog) {
    setupMessage('Loading protocols…');
    await loadProtocolLibrary();
  }
  if (!studySetup.open || protocolFields.hidden) return;
  const protocols = protocolLibraryCatalog?.items.filter(item => item.kind === 'protocol') || [];
  setupMessage(protocols.length ? '' : 'The library could not be loaded. Choose another starting point or try again.');
  protocolSelect.replaceChildren();
  protocols.forEach(item => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name;
    protocolSelect.append(option);
  });
  updateSetupProtocolDescription();
  protocolSelect.focus();
});

protocolSelect.addEventListener('change', updateSetupProtocolDescription);
protocolButton.addEventListener('click', async () => {
  if (!protocolSelect.value || loadingProtocol) return;
  loadingProtocol = true;
  protocolButton.disabled = true;
  setupCancel.disabled = true;
  setupMessage('Opening protocol…');
  try {
    const item = await fetchCatalogItem(protocolSelect.value);
    validateProtocolBeforeLoad(item);
    if (StorageManager.loadTemplate(item.protocol, setupDetails())) finishStudySetup();
    else setupMessage('The current draft could not be saved. Download a backup before starting another study.');
  } catch (error) {
    setupMessage(error.message);
  } finally {
    loadingProtocol = false;
    setupCancel.disabled = false;
    updateSetupProtocolDescription();
  }
});

document.getElementById('setup-daily').onclick = () => startStudyFromSetup(false);
document.getElementById('setup-blank').onclick = () => startStudyFromSetup(true);
document.getElementById('new-draft-btn').onclick = openStudySetup;
setupCancel.onclick = () => studySetup.close();
document.getElementById('setup-restore').onclick = () => document.getElementById('import-file').click();
studySetup.addEventListener('cancel', event => {
  if (loadingProtocol || !StorageManager.hasDraft) event.preventDefault();
});

const narrowBuilder = window.matchMedia('(max-width: 850px)');
function offerFirstStudy() {
  if (!StorageManager.hasDraft && !narrowBuilder.matches && !studySetup.open) openStudySetup();
}
narrowBuilder.addEventListener('change', offerFirstStudy);
offerFirstStudy();
