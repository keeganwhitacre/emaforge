document.getElementById('preview-json-btn').addEventListener('click', () => {
  document.getElementById('json-preview').textContent = JSON.stringify(buildConfig(), null, 2);
  document.getElementById('json-modal').classList.add('open');
});
document.getElementById('json-modal-close').addEventListener('click', () => document.getElementById('json-modal').classList.remove('open'));
