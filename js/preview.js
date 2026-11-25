function schedulePreview() {
    clearTimeout(previewDebounceTimer);
    previewDebounceTimer = setTimeout(renderPreview, 600);
    // Tell storage to persist shortly after the preview updates.
    if (typeof StorageManager !== 'undefined' && StorageManager.debouncedSave) {
      StorageManager.debouncedSave();
    }
    if (typeof renderBuilderShell === 'function') renderBuilderShell();
    const tester = document.getElementById('branch-tester');
    if (tester?.open) tester.dispatchEvent(new Event('branch-change'));
  }

const previewPanel = document.getElementById('preview-panel');
const previewFrame = document.getElementById('preview-iframe');
const previewSessionSelect = document.getElementById('preview-session-select');

function choosePreviewSession(id) {
  previewSession = id;
  previewSessionSelect.value = id;
  for (const button of document.querySelectorAll('.preview-session-tab')) {
    button.setAttribute('aria-pressed', String(button.dataset.session === id));
  }
  if (typeof rememberBuilderWorkspace === 'function') rememberBuilderWorkspace();
  renderPreview();
}

function syncPreviewStage() {
  previewFrame.contentDocument?.body?.classList.toggle(
    'preview-in-stage', previewPanel.classList.contains('preview-fullscreen')
  );
}

previewFrame.addEventListener('load', () => {
  syncPreviewStage();
  previewFrame.contentDocument?.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && previewPanel.classList.contains('preview-fullscreen')) {
      document.getElementById('close-preview-btn').click();
    }
  });
});

function renderPreviewTabs() {
  const container = document.getElementById('preview-session-tabs');
  if (!container) return;
  container.innerHTML = '';
  if ((!state.onboarding.enabled && previewSession === 'onboarding') ||
      (previewSession !== 'onboarding' && !state.ema.scheduling.windows.some(w => w.id === previewSession))) {
    previewSession = state.ema.scheduling.windows[0]?.id || 'onboarding';
  }

  const sessions = state.ema.scheduling.windows.map(({ id, label }) => [id, label || 'Untitled session']);
  if (state.onboarding.enabled) sessions.unshift(['onboarding', 'Setup']);
  previewSessionSelect.replaceChildren(...sessions.map(([id, label]) => new Option(label, id)));
  previewSessionSelect.value = previewSession;
  previewSessionSelect.hidden = sessions.length === 0;
  sessions.forEach(([id, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preview-session-tab';
    button.dataset.session = id;
    button.textContent = label;
    button.setAttribute('aria-pressed', String(previewSession === id));
    button.addEventListener('click', () => choosePreviewSession(id));
    container.append(button);
  });
}

let previewRequestId = 0;
async function renderPreview() {
  clearTimeout(previewDebounceTimer);
  if (!window.buildStudyHtml) return;
  const requestId = ++previewRequestId;
  const errorEl = document.getElementById('preview-error');
  
  // Re-build tabs if windows changed
  if (document.querySelectorAll('.preview-session-tab').length !== (state.onboarding.enabled ? 1 : 0) + state.ema.scheduling.windows.length) {
      renderPreviewTabs();
  }

  try {
    const html = await buildStudyHtml({ configInline: true, previewMode: true, previewSession });
    if (requestId !== previewRequestId) return;
    previewFrame.srcdoc = html;
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
  } catch(e) {
    if (requestId !== previewRequestId) return;
    console.error("Preview render failed:", e);
    previewFrame.removeAttribute('srcdoc');
    if (errorEl) { errorEl.textContent = 'Preview could not be generated. Check the browser console and try resetting the preview.'; errorEl.hidden = false; }
  }
}

document.getElementById('preview-reset-btn').addEventListener('click', renderPreview);

previewSessionSelect.addEventListener('change', () => choosePreviewSession(previewSessionSelect.value));
document.getElementById('preview-stage-reset-btn').addEventListener('click', renderPreview);
