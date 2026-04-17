"use strict";

// ---------------------------------------------------------------------------
// Deployment Tab — v1.2
//
// Changes from v1.1:
//   - CSV now includes a Phase_Sequence column describing what each session
//     contains (e.g. "Pre-EMA → ePAT → Post-EMA"), so researchers can
//     verify the schedule before sending links to participants.
//   - URL structure is unchanged — a single link per session per day, with
//     the runtime handling all phase sequencing internally.
//   - Helper phaseLabel(w) builds the human-readable sequence string from
//     the window's phases config.
// ---------------------------------------------------------------------------

function bindDeploymentTab() {
  const generateBtn = document.getElementById('generate-csv-btn');
  if (!generateBtn) return;

  generateBtn.addEventListener('click', () => {
    const baseUrlInput = document.getElementById('deploy-base-url').value.trim();
    const baseUrl  = baseUrlInput || 'https://example.com/study/';
    const startId  = parseInt(document.getElementById('deploy-start-id').value) || 1;
    const endId    = parseInt(document.getElementById('deploy-end-id').value)   || 20;

    const windows   = state.ema.scheduling.windows || [];
    const studyDays = state.ema.scheduling.study_days || 1;

    if (windows.length === 0 && !state.onboarding.enabled) {
      alert('No schedule windows or onboarding found. Please configure your study before generating links.');
      return;
    }

    const cleanBase = baseUrl.endsWith('/') || baseUrl.endsWith('.html')
      ? baseUrl
      : baseUrl + '/';

    // CSV header — Phase_Sequence tells the researcher what each link does
    let csv = 'Participant_ID,Day,Session,Phase_Sequence,URL\n';

    for (let p = startId; p <= endId; p++) {

      // Onboarding link (Day 0)
      if (state.onboarding.enabled) {
        const url = `${cleanBase}?id=${p}&session=onboarding`;
        csv += `${p},0,Setup,Onboarding,${url}\n`;
      }

      // Daily session links
      for (let day = 1; day <= studyDays; day++) {
        windows.forEach(w => {
          const label    = w.label.replace(/,/g, '');   // guard against CSV breaks
          const sequence = phaseLabel(w);
          const url      = `${cleanBase}?id=${p}&day=${day}&session=${w.id}`;
          csv += `${p},${day},${label},${sequence},${url}\n`;
        });
      }
    }

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

// ---------------------------------------------------------------------------
// phaseLabel(window) — builds a human-readable phase sequence string.
// e.g. { pre: true, task: "epat", post: true } → "Pre-EMA → ePAT → Post-EMA"
//      { pre: true, task: null, post: false }   → "EMA"
// ---------------------------------------------------------------------------
function phaseLabel(w) {
  const ph = w.phases || { pre: true, task: null, post: false };
  const parts = [];

  if (ph.pre)  parts.push('Pre-EMA');
  if (ph.task) {
    // Try to get the human label from the module registry
    const mod = state.modules.find(m => m.id === ph.task);
    parts.push(mod ? mod.label : ph.task);
  }
  if (ph.post) parts.push('Post-EMA');

  // If no task, collapse "Pre-EMA" to just "EMA" — cleaner for simple studies
  if (!ph.task && parts.length === 1 && parts[0] === 'Pre-EMA') return 'EMA';

  return parts.join(' → ') || 'EMA';
}

function slugifyStudyName() {
  return (state.study.name || 'study').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}