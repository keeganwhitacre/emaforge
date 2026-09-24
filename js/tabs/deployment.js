"use strict";

// ---------------------------------------------------------------------------
// Deployment Tab — Cloudflare-first hosting, administration, and routing.
// ---------------------------------------------------------------------------

function bindDeploymentTab() {
  const generateBtn = document.getElementById('generate-csv-btn');
  const messagingBtn = document.getElementById('open-cloudflare-messaging-btn');
  const hostedInput = document.getElementById('deploy-base-url');
  const receiverInput = document.getElementById('deploy-webhook-url');
  const studyReceiverInput = document.getElementById('study-webhook');
  const adminBtn = document.getElementById('open-cloudflare-admin-btn');
  const checkBtn = document.getElementById('open-connection-check-btn');
  const participantBtn = document.getElementById('open-participant-study-btn');
  const copyParticipantBtn = document.getElementById('copy-participant-study-btn');
  const copyAdminBtn = document.getElementById('copy-cloudflare-admin-btn');
  const copyWorkerNameBtn = document.getElementById('copy-worker-name-btn');
  const receiverBtn = document.getElementById('download-receiver-btn');
  const cloudflareStudyBtn = document.getElementById('prepare-cloudflare-study-btn');
  if (!generateBtn) return;

  if (hostedInput) hostedInput.value = state.deployment?.hosted_url || '';
  updateSuggestedWorkerName();

  if (receiverInput) {
    receiverInput.value = state.study.webhook_url || '';
    receiverInput.addEventListener('input', () => {
      state.study.webhook_url = receiverInput.value.trim();
      if (studyReceiverInput) studyReceiverInput.value = receiverInput.value;
      if (typeof schedulePreview === 'function') schedulePreview();
    });
  }
  if (studyReceiverInput && receiverInput) {
    studyReceiverInput.addEventListener('input', () => { receiverInput.value = studyReceiverInput.value; });
  }
  if (hostedInput) hostedInput.addEventListener('input', () => {
    rememberHostedStudyUrl(hostedInput.value);
    updateDeploymentControls();
  });
  if (adminBtn) adminBtn.addEventListener('click', () => {
    const adminUrl = cloudflareAdminUrl(hostedInput ? hostedInput.value.trim() : '');
    if (!adminUrl) {
      alert('Enter the real HTTPS URL of the deployed Cloudflare Worker first.');
      return;
    }
    window.open(adminUrl, '_blank', 'noopener,noreferrer');
  });
  if (participantBtn) participantBtn.addEventListener('click', () => {
    const participantUrl = participantStudyUrl(hostedInput ? hostedInput.value.trim() : '');
    if (!participantUrl) return alert('Enter the real HTTPS URL of the deployed Cloudflare Worker first.');
    window.open(participantUrl, '_blank', 'noopener,noreferrer');
  });
  if (copyParticipantBtn) copyParticipantBtn.addEventListener('click', () => {
    const participantUrl = participantStudyUrl(hostedInput ? hostedInput.value.trim() : '');
    if (participantUrl) copyDeploymentValue(participantUrl, copyParticipantBtn);
  });
  if (copyAdminBtn) copyAdminBtn.addEventListener('click', () => {
    const adminUrl = cloudflareAdminUrl(hostedInput ? hostedInput.value.trim() : '');
    if (adminUrl) copyDeploymentValue(adminUrl, copyAdminBtn);
  });
  if (copyWorkerNameBtn) copyWorkerNameBtn.addEventListener('click', () => {
    copyDeploymentValue(suggestedWorkerName(), copyWorkerNameBtn);
  });
  if (messagingBtn) messagingBtn.addEventListener('click', () => {
    const adminUrl = cloudflareAdminUrl(hostedInput ? hostedInput.value.trim() : '');
    if (!adminUrl) return alert('Connect the deployed Cloudflare Worker above before configuring messaging.');
    window.open(adminUrl, '_blank', 'noopener,noreferrer');
  });
  if (checkBtn) checkBtn.addEventListener('click', () => {
    const checkUrl = connectionCheckUrl(hostedInput ? hostedInput.value.trim() : '');
    if (!checkUrl) {
      alert('Enter the real HTTPS URL of the hosted study first.');
      return;
    }
    window.open(checkUrl, '_blank', 'noopener,noreferrer');
  });
  if (receiverBtn) receiverBtn.addEventListener('click', downloadReceiverStarter);
  if (cloudflareStudyBtn) cloudflareStudyBtn.addEventListener('click', downloadCloudflareStudy);
  updateDeploymentControls();

  generateBtn.addEventListener('click', () => {
    const baseUrlInput = document.getElementById('deploy-base-url').value.trim();
    const baseUrl  = baseUrlInput || 'https://example.com/study/';
    const startId  = Number(document.getElementById('deploy-start-id').value);
    const endId    = Number(document.getElementById('deploy-end-id').value);

    const scheduling = state.ema.scheduling || {};
    const windows   = scheduling.windows || [];
    const studyDays = state.ema.scheduling.study_days || 1;
    const activeDays = normalizeDaysOfWeek(scheduling.days_of_week);

    if (!Number.isInteger(startId) || !Number.isInteger(endId) || startId < 1 || endId < startId || endId - startId > 99999) {
      alert('Participant ID range must use positive whole numbers, with the end at or after the start (maximum 100,000 IDs).');
      return;
    }

    if (windows.length === 0 && !state.onboarding.enabled) {
      alert('No schedule windows or onboarding found. Please configure your study before generating links.');
      return;
    }
    if (windows.length > 0 && activeDays.length === 0) {
      alert('Select at least one active day of week before generating deployment links.');
      return;
    }
    const invalidWindow = windows.find(w => !isValidScheduleWindow(w));
    if (invalidWindow) {
      alert(`Fix the time range for "${invalidWindow.label || invalidWindow.id}" before generating links.`);
      return;
    }
    if (!isDeployableBaseUrl(baseUrl)) {
      alert('Enter the real HTTPS URL where this study is hosted. Example.com and local URLs cannot be deployed.');
      return;
    }
    if (typeof confirmProtocolExport === 'function' && !confirmProtocolExport()) return;

    const cleanBase = baseUrl.endsWith('/') || baseUrl.endsWith('.html')
      ? baseUrl
      : baseUrl + '/';

    // This is intentionally a send-time template. A static timestamp would
    // either expire before use or silently defeat the configured expiry rule.
    const activeDayLabels = activeDays.map(dayNumberToLabel).join('|');
    const rows = [[
      'Participant_ID', 'Day', 'Active_Weekdays', 'Session',
      'Phase_Sequence', 'Send_Window_Local', 'URL_Template'
    ]];

    for (let p = startId; p <= endId; p++) {

      // Onboarding link (Day 0)
      if (state.onboarding.enabled) {
        const url = `${cleanBase}?id=${p}&session=onboarding`;
        rows.push([p, 0, 'Any', 'Setup', 'Onboarding', 'Researcher scheduled', url]);
      }

      // Daily session links
      for (let day = 1; day <= studyDays; day++) {
        windows.forEach(w => {
          const label    = w.label || w.id;
          const sequence = phaseLabel(w);
          const url      = `${cleanBase}?id=${encodeURIComponent(p)}&day=${day}&session=${encodeURIComponent(w.id)}&t={sent_at_ms}`;
          rows.push([p, day, activeDayLabels, label, sequence, `${w.start}-${w.end}`, url]);
        });
      }
    }

    const csv = rows.map(row => row.map(csvCell).join(',')).join('\n') + '\n';

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = slugifyStudyName() + '_deployment_links.csv';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
}

async function downloadCloudflareStudy() {
  const button = document.getElementById('prepare-cloudflare-study-btn');
  const status = document.getElementById('cloudflare-study-status');
  const cloudflareConfig = buildConfig();
  cloudflareConfig.study.webhook_url = '/submit';
  if (typeof confirmProtocolExport === 'function' && !confirmProtocolExport(cloudflareConfig)) return;
  if (button) button.disabled = true;
  if (status) status.textContent = 'Preparing the participant study…';
  try {
    const html = await buildCloudflareStudyHtml();
    const objectUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `${slugifyStudyName()}-cloudflare-study.html`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    if (status) status.textContent = 'Downloaded. Deploy the template, then upload this file at your Worker’s /admin page.';
  } catch (error) {
    if (status) status.textContent = `Could not prepare the study: ${error.message}`;
  } finally {
    if (button) button.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// phaseLabel(window) — readable summary of the ordered session flow.
// ---------------------------------------------------------------------------
function phaseLabel(w) {
  const labels = (w.phase_sequence || []).map(step => {
    if (step.kind === 'ema') return step.label || 'Survey questions';
    if (step.kind === 'task') {
      const mod = state.modules.find(module => module.id === step.id);
      return mod ? mod.label : (step.id || 'Task');
    }
    return step.kind || 'Step';
  });
  return labels.join(' → ') || 'No measures';
}

function normalizeDaysOfWeek(days) {
  const normalized = (Array.isArray(days) ? days : [])
    .map(Number)
    .filter(day => Number.isInteger(day) && day >= 1 && day <= 7);
  return [...new Set(normalized)].sort((a, b) => a - b);
}

function dayNumberToLabel(day) {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day - 1] || '';
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function isValidScheduleWindow(window) {
  const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  return !!window && validTime(window.start) && validTime(window.end) && window.start <= window.end;
}

function isDeployableBaseUrl(value) {
  try {
    const url = new URL(value);
    const blockedHosts = new Set(['example.com', 'www.example.com', 'localhost', '127.0.0.1', '0.0.0.0']);
    return url.protocol === 'https:' &&
      !blockedHosts.has(url.hostname.toLowerCase()) &&
      !url.search &&
      !url.hash;
  } catch (error) {
    return false;
  }
}

function connectionCheckUrl(value) {
  if (!isDeployableBaseUrl(value)) return null;
  const url = new URL(value);
  if (/\/[^/]+\.html$/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/[^/]+\.html$/i, 'check.html');
  } else {
    url.pathname = url.pathname.replace(/\/?$/, '/') + 'check.html';
  }
  return url.toString();
}

function participantStudyUrl(value) {
  if (!isDeployableBaseUrl(value)) return null;
  const url = new URL(value);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function rememberHostedStudyUrl(value) {
  if (!state.deployment || typeof state.deployment !== 'object') state.deployment = {};
  state.deployment.hosted_url = String(value || '').trim();
  if (typeof StorageManager !== 'undefined') StorageManager.debouncedSave();
  return state.deployment.hosted_url;
}

function cloudflareAdminUrl(value) {
  if (!isDeployableBaseUrl(value)) return null;
  const url = new URL(value);
  url.pathname = '/admin';
  return url.toString();
}

function suggestedWorkerName() {
  const studySlug = slugifyStudyName().replace(/^-+|-+$/g, '');
  const name = studySlug && studySlug !== 'study' ? `ema-forge-${studySlug}` : 'ema-forge-study';
  return name.slice(0, 63).replace(/-+$/g, '');
}

function updateSuggestedWorkerName() {
  const target = document.getElementById('suggested-worker-name');
  if (target) target.textContent = suggestedWorkerName();
}

async function copyDeploymentValue(value, button) {
  if (!value) return;
  const previous = button ? button.textContent : '';
  try {
    await navigator.clipboard.writeText(value);
    if (button) button.textContent = 'Copied';
  } catch (error) {
    window.prompt('Copy this value:', value);
  }
  if (button) setTimeout(() => { button.textContent = previous; }, 1200);
}

function updateDeploymentControls() {
  const hostedInput = document.getElementById('deploy-base-url');
  const adminBtn = document.getElementById('open-cloudflare-admin-btn');
  const checkBtn = document.getElementById('open-connection-check-btn');
  const participantBtn = document.getElementById('open-participant-study-btn');
  const copyParticipantBtn = document.getElementById('copy-participant-study-btn');
  const copyAdminBtn = document.getElementById('copy-cloudflare-admin-btn');
  const messagingBtn = document.getElementById('open-cloudflare-messaging-btn');
  const destinationGrid = document.getElementById('deployment-destinations');
  const hint = document.getElementById('connection-check-hint');
  const value = hostedInput ? hostedInput.value.trim() : '';
  const checkUrl = connectionCheckUrl(value);
  const adminUrl = cloudflareAdminUrl(value);
  const participantUrl = participantStudyUrl(value);
  if (adminBtn) adminBtn.disabled = !adminUrl;
  if (checkBtn) checkBtn.disabled = !checkUrl;
  if (participantBtn) participantBtn.disabled = !participantUrl;
  if (copyParticipantBtn) copyParticipantBtn.disabled = !participantUrl;
  if (copyAdminBtn) copyAdminBtn.disabled = !adminUrl;
  if (messagingBtn) messagingBtn.disabled = !adminUrl;
  if (destinationGrid) destinationGrid.hidden = !participantUrl;
  if (hint) hint.textContent = participantUrl
    ? 'Connected. Test storage once, then use Study Admin for installation, messaging, monitoring, analysis, and exports.'
    : 'Paste a valid hosted HTTPS URL to reveal the participant, admin, and connection-check destinations.';
}

async function downloadReceiverStarter() {
  const button = document.getElementById('download-receiver-btn');
  const status = document.getElementById('receiver-starter-status');
  const hosted = document.getElementById('deploy-base-url')?.value.trim() || '';
  let origin = 'https://your-study-host.example';
  if (isDeployableBaseUrl(hosted)) origin = new URL(hosted).origin;

  if (button) button.disabled = true;
  if (status) status.textContent = 'Preparing receiver files…';
  try {
    const paths = ['receiver/worker.mjs', 'receiver/wrangler.jsonc', 'receiver/README.md'];
    const responses = await Promise.all(paths.map(path => fetch(path)));
    if (responses.some(response => !response.ok)) throw new Error('Receiver files could not be loaded.');
    const content = await Promise.all(responses.map(response => response.text()));
    content[1] = content[1].replace('https://your-study-host.example', origin);
    const files = [
      { path: 'worker.mjs', content: content[0] },
      { path: 'wrangler.jsonc', content: content[1] },
      { path: 'README.md', content: content[2] }
    ];
    const objectUrl = URL.createObjectURL(makeZip(files));
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `${slugifyStudyName()}-receiver.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    if (status) status.textContent = origin.includes('your-study-host.example')
      ? 'Downloaded. Enter your hosted study URL in wrangler.jsonc before deploying.'
      : `Downloaded with allowed origin ${origin}.`;
  } catch (error) {
    if (status) status.textContent = error.message;
  } finally {
    if (button) button.disabled = false;
  }
}

function slugifyStudyName() {
  return (state.study.name || 'study').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
