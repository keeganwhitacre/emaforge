"use strict";

// ---------------------------------------------------------------------------
// Deployment Tab — v1.4
//
// Changes from v1.2:
//   - generateTwilioScript rewritten to emit a hardened dispatcher.
//     See the top of the emitted .gs for the list of fixes, but in short:
//       * IANA timezone names (America/Los_Angeles) replace fixed hour offsets
//         -> DST transitions are handled correctly by Google's zoneinfo.
//       * Schedule is sorted ascending by end-time before lookup.
//       * "Completed" is only set after the final day's last window has fired,
//         not at the first "no more windows today" encountered on day N.
//       * Every outbound link now carries an &t= timestamp so expiry_minutes
//         in the study config is actually enforced.
//       * Idempotency: a Last_Sent_ISO column is written *before* the send,
//         and the dispatcher dedupes on (participant, day, window_id) so a
//         partial failure can't produce a duplicate text.
//       * Column access is by header name, not by positional index, so
//         researchers can rearrange or add columns without breaking things.
//       * Response codes from Twilio are inspected; failures are written to
//         a _Dispatch_Log sheet and the scheduled time is restored so it
//         retries on the next tick.
//       * SMS body is templated from the study name and includes an opt-out
//         line ("Reply STOP to opt out") as required for US A2P 10DLC.
//   - Roster schema now uses Timezone (IANA) instead of Time_Offset_Hours.
//   - URL structure for non-Twilio CSV is unchanged.
//   - Helper phaseLabel(w) is unchanged.
// ---------------------------------------------------------------------------

function bindDeploymentTab() {
  const generateBtn = document.getElementById('generate-csv-btn');
  const twilioBtn = document.getElementById('export-twilio-btn');
  const hostedInput = document.getElementById('deploy-base-url');
  const receiverInput = document.getElementById('deploy-webhook-url');
  const studyReceiverInput = document.getElementById('study-webhook');
  const adminBtn = document.getElementById('open-cloudflare-admin-btn');
  const checkBtn = document.getElementById('open-connection-check-btn');
  const receiverBtn = document.getElementById('download-receiver-btn');
  const cloudflareStudyBtn = document.getElementById('prepare-cloudflare-study-btn');
  if (!generateBtn) return;

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
  if (hostedInput) hostedInput.addEventListener('input', updateDeploymentControls);
  if (adminBtn) adminBtn.addEventListener('click', () => {
    const adminUrl = cloudflareAdminUrl(hostedInput ? hostedInput.value.trim() : '');
    if (!adminUrl) {
      alert('Enter the real HTTPS URL of the deployed Cloudflare Worker first.');
      return;
    }
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
  if (twilioBtn) {
    twilioBtn.addEventListener('click', () => {
      const baseUrlInput = document.getElementById('deploy-base-url').value.trim();
      const baseUrl  = baseUrlInput || 'https://example.com/study/';

      const windows = state.ema.scheduling.windows || [];
      if (windows.length === 0) {
        alert('No schedule windows found. Please configure your study before exporting.');
        return;
      }
      if (normalizeDaysOfWeek(state.ema.scheduling.days_of_week).length === 0) {
        alert('Select at least one active day of week before exporting.');
        return;
      }
      const invalidWindow = windows.find(w => !isValidScheduleWindow(w));
      if (invalidWindow) {
        alert(`Fix the time range for "${invalidWindow.label || invalidWindow.id}" before exporting.`);
        return;
      }
      if (!isDeployableBaseUrl(baseUrl)) {
        alert('Enter the real HTTPS URL where this study is hosted. Example.com and local URLs cannot be deployed.');
        return;
      }
      if (typeof confirmProtocolExport === 'function' && !confirmProtocolExport()) return;

      const scriptContent = generateTwilioScript(baseUrl);

      const blob = new Blob([scriptContent], { type: 'text/javascript;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = slugifyStudyName() + '-twilio-dispatcher.gs';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }
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

function cloudflareAdminUrl(value) {
  if (!isDeployableBaseUrl(value)) return null;
  const url = new URL(value);
  url.pathname = '/admin';
  return url.toString();
}

function updateDeploymentControls() {
  const hostedInput = document.getElementById('deploy-base-url');
  const adminBtn = document.getElementById('open-cloudflare-admin-btn');
  const checkBtn = document.getElementById('open-connection-check-btn');
  const hint = document.getElementById('connection-check-hint');
  const value = hostedInput ? hostedInput.value.trim() : '';
  const checkUrl = connectionCheckUrl(value);
  const adminUrl = cloudflareAdminUrl(value);
  if (adminBtn) adminBtn.disabled = !adminUrl;
  if (checkBtn) checkBtn.disabled = !checkUrl;
  if (hint) hint.textContent = checkUrl
    ? `Admin: ${adminUrl} · Connection check: ${checkUrl}`
    : 'Available after entering a valid hosted HTTPS URL.';
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

// ---------------------------------------------------------------------------
// generateTwilioScript(baseUrl) — emits a Google Apps Script (.gs) that
// dispatches scheduled SMS to participants via Twilio. The emitted script
// lives in a spreadsheet attached to the researcher's Google account.
//
// The template string is long because it contains a complete program. See
// the header comment inside for the runtime architecture.
// ---------------------------------------------------------------------------
function generateTwilioScript(baseUrl) {
  const scheduling = state.ema.scheduling || {};
  const windows   = scheduling.windows || [];
  const studyDays = scheduling.study_days || 1;
  const studyName = (state.study && state.study.name) ? state.study.name : 'Study';
  const timing = scheduling.timing || {};
  const expiryMin = Number(timing.expiry_minutes) || 0;
  const graceMin = Number(timing.grace_minutes) || 0;
  const activeDays = normalizeDaysOfWeek(scheduling.days_of_week);

  // Sort windows by end-time ascending so the dispatcher's "find the next
  // window whose end is after now" loop works regardless of the order the
  // researcher defined them in the Builder. (Fix #2.)
  const sortedWindows = windows
    .map(w => ({ id: w.id, start: w.start, end: w.end, label: w.label || w.id }))
    .sort((a, b) => a.end.localeCompare(b.end));

  const scheduleJson = JSON.stringify(sortedWindows);

  // Values also appear in comments in the generated file; neutralize comment
  // terminators there, and serialize executable constants as JSON literals.
  const commentStudyName = studyName.replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ');
  const commentBaseUrl = String(baseUrl).replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ');

  const scriptContent = `/**
 * EMA Forge — Twilio Dispatcher (Beta, v3)
 *
 * Emitted for study: ${commentStudyName}
 * Study length: ${studyDays} day(s)
 * Base URL: ${commentBaseUrl}
 *
 * HOW THIS WORKS
 *   The menu wizard writes your Twilio credentials to the script's
 *   PropertiesService (visible only to editors of this Apps Script project).
 *   Starting "Automation" installs a time-based trigger that runs
 *   dispatchPrompts() every 15 minutes. On each tick the dispatcher walks
 *   the Roster sheet and, for each Active participant:
 *
 *     1. Computes the calendar study day in the participant's timezone.
 *     2. Applies study weekdays and optional participant preferences.
 *     3. Sends the due prompt or schedules the next unsent window.
 *
 *   All reads/writes to the Roster use header-name lookup (not column
 *   indices), so you can freely insert Notes columns, reorder, etc.
 *
 * DEDUPE MODEL
 *   A ping is identified by (Participant_ID, Day, Window_ID). Before the
 *   Twilio call, we stamp Last_Sent_ISO while holding a script-wide lock.
 *   Successful Message SIDs are written to _Dispatch_Log and suppress future
 *   sends for that key. Explicit non-2xx responses retry; ambiguous network
 *   failures are logged for manual review rather than risking a duplicate.
 *
 * INBOUND OPT-OUT
 *   Deploy this script as a Web App and configure the Twilio incoming-message
 *   webhook using EMA Forge -> Show inbound webhook setup. Advanced Opt-Out's
 *   OptOutType=STOP is preferred; standard English STOP words are a fallback.
 *
 * WHAT DOES NOT SHIP IN THIS BETA
 *   - Delivery-receipt timestamps for latency analysis.
 *   - Retry back-off beyond "try again on the next 15-min tick."
 */

// ---- CONFIGURATION (baked in from the Builder) -----------------------------

const BASE_URL    = ${JSON.stringify(baseUrl)};
const STUDY_DAYS  = ${studyDays};
const STUDY_NAME  = ${JSON.stringify(studyName)};
const EXPIRY_MIN  = ${expiryMin};                     // 0 = no expiry enforcement
const GRACE_MIN   = ${graceMin};                      // participant completion buffer
const ACTIVE_DAYS = ${JSON.stringify(activeDays)};    // ISO weekday: Mon=1 ... Sun=7
const SCHEDULE    = ${scheduleJson};                  // pre-sorted by end-time

// ---- CONSTANTS -------------------------------------------------------------

const ROSTER_SHEET  = 'Roster';
const LOG_SHEET     = '_Dispatch_Log';
const TRIGGER_FN    = 'dispatchPrompts';
const TICK_MINUTES  = 15;

// Roster columns by header name. The schema is enforced at setup.
const ROSTER_COLS = [
  'Participant_ID',
  'Phone',
  'Timezone',          // IANA string, e.g. 'America/Los_Angeles'
  'Start_Date',
  'Status',            // Active | Paused | Completed
  'Schedule_Preferences_JSON', // optional onboarding schedule_pref payload
  'Current_Day',
  'Next_Window',
  'Next_Study_Day',
  'Next_Ping_ISO',
  'Last_Sent_ISO',
  'Opted_Out_At'
];


// ============================================================================
//   MENU + SETUP WIZARD
// ============================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('EMA Forge 🛠️')
    .addItem('1. Setup Twilio & Roster', 'runSetupWizard')
    .addItem('2. Start Automation (every ' + TICK_MINUTES + ' min)', 'startTrigger')
    .addItem('3. Pause Automation', 'stopTrigger')
    .addSeparator()
    .addItem('Show inbound webhook setup', 'showInboundWebhookSetup')
    .addItem('Send test message to row 2', 'sendTestMessageRow2')
    .addToUi();
}

function runSetupWizard() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();

  ui.alert(
    'EMA Forge — Twilio Setup',
    'You will need your Twilio Account SID, Auth Token, and a Twilio phone number.\\n\\n' +
    'Credentials are stored in this script\\'s private properties — anyone with ' +
    'edit access to this Apps Script project can read them back. Do not share edit ' +
    'access outside your research team.',
    ui.ButtonSet.OK
  );

  const sid = ui.prompt('Step 1 of 3', 'Enter Twilio Account SID:', ui.ButtonSet.OK_CANCEL);
  if (sid.getSelectedButton() !== ui.Button.OK) return;
  props.setProperty('TWILIO_SID', sid.getResponseText().trim());

  const tok = ui.prompt('Step 2 of 3', 'Enter Twilio Auth Token:', ui.ButtonSet.OK_CANCEL);
  if (tok.getSelectedButton() !== ui.Button.OK) return;
  props.setProperty('TWILIO_TOKEN', tok.getResponseText().trim());

  const phone = ui.prompt('Step 3 of 3', 'Enter Twilio phone number (E.164, e.g. +15551234567):', ui.ButtonSet.OK_CANCEL);
  if (phone.getSelectedButton() !== ui.Button.OK) return;
  props.setProperty('TWILIO_PHONE', phone.getResponseText().trim());
  props.setProperty('SPREADSHEET_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
  if (!props.getProperty('WEBHOOK_SECRET')) {
    props.setProperty('WEBHOOK_SECRET', Utilities.getUuid().replace(/-/g, ''));
  }

  ensureRosterSchema_();
  ensureLogSheet_();

  ui.alert('Success. Credentials stored in script properties.\\n\\nNext: deploy this script as a Web App, run "Show inbound webhook setup", then start automation.');
}

/**
 * Creates the Roster sheet if missing, or reconciles headers if it already
 * exists. Header reconciliation is non-destructive: existing data is left
 * alone, and any missing columns are appended to the right.
 */
function ensureRosterSchema_() {
  const ss = getStudySpreadsheet_();
  let sheet = ss.getSheetByName(ROSTER_SHEET);

  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName(ROSTER_SHEET);
    sheet.clear();
    sheet.getRange(1, 1, 1, ROSTER_COLS.length).setValues([ROSTER_COLS]);
    sheet.getRange(1, 1, 1, ROSTER_COLS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, ROSTER_COLS.length, 140);

    // Demo row showing IANA timezone usage.
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const demoRow = [
      'DEMO_001',
      '+15550000000',
      'America/Los_Angeles',
      today,
      'Paused',    // Paused so it doesn't accidentally text +15550000000
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ];
    sheet.getRange(2, 1, 1, demoRow.length).setValues([demoRow]);
    return;
  }

  // Reconcile existing headers.
  const lastCol = sheet.getLastColumn();
  const existing = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String)
    : [];

  ROSTER_COLS.forEach(col => {
    if (existing.indexOf(col) === -1) {
      const nextCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextCol).setValue(col).setFontWeight('bold');
    }
  });
}

function ensureLogSheet_() {
  const ss = getStudySpreadsheet_();
  let log = ss.getSheetByName(LOG_SHEET);
  if (!log) {
    log = ss.insertSheet(LOG_SHEET);
    log.getRange(1, 1, 1, 5).setValues([['Timestamp_ISO', 'Participant_ID', 'Day', 'Window_ID', 'Outcome']]);
    log.getRange(1, 1, 1, 5).setFontWeight('bold');
    log.setFrozenRows(1);
    log.hideSheet();
  }
}

function getStudySpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('Study spreadsheet is not configured. Run Setup from the bound sheet.');
  return active;
}


// ============================================================================
//   TRIGGER MANAGEMENT
// ============================================================================

function startTrigger() {
  stopTrigger();
  ScriptApp.newTrigger(TRIGGER_FN).timeBased().everyMinutes(TICK_MINUTES).create();
  SpreadsheetApp.getUi().alert('Automation started. The dispatcher will run every ' + TICK_MINUTES + ' minutes.');
}

function stopTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === TRIGGER_FN) ScriptApp.deleteTrigger(t);
  });
}

function showInboundWebhookSetup() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('WEBHOOK_SECRET');
  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('WEBHOOK_SECRET', secret);
  }
  const webAppUrl = ScriptApp.getService().getUrl();
  if (!webAppUrl) {
    SpreadsheetApp.getUi().alert(
      'Deploy this Apps Script as a Web App first (execute as you; access: anyone), then run this menu item again.'
    );
    return;
  }
  SpreadsheetApp.getUi().alert(
    'In Twilio, set the incoming-message webhook method to POST and use:\\n\\n' +
    webAppUrl + '?key=' + secret + '\\n\\n' +
    'For a Messaging Service, enable Advanced Opt-Out so Twilio sends OptOutType=STOP. ' +
    'Keep the URL private; the key protects roster updates because Apps Script does not expose the Twilio signature header.'
  );
}

// Twilio posts application/x-www-form-urlencoded fields such as From, Body,
// and (with Advanced Opt-Out) OptOutType. Return empty TwiML because Twilio
// already sends the opt-out confirmation for matched Advanced Opt-Out words.
function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  const expectedKey = props.getProperty('WEBHOOK_SECRET');
  const suppliedKey = e && e.parameter ? String(e.parameter.key || '') : '';
  if (!expectedKey || suppliedKey !== expectedKey) {
    return twimlResponse_();
  }

  const from = normalizePhone_(e.parameter.From || '');
  const body = String(e.parameter.Body || '').trim().toUpperCase();
  const optOutType = String(e.parameter.OptOutType || '').trim().toUpperCase();
  const stopWords = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'END', 'QUIT', 'REVOKE', 'OPTOUT', 'CANCEL'];
  if (optOutType !== 'STOP' && stopWords.indexOf(body) === -1) return twimlResponse_();

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return twimlResponse_();
  try {
    const ss = getStudySpreadsheet_();
    const sheet = ss.getSheetByName(ROSTER_SHEET);
    if (!sheet) return twimlResponse_();
    ensureRosterSchema_();
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(String);
    const phoneIdx = headers.indexOf('Phone');
    const statusIdx = headers.indexOf('Status');
    const optedOutIdx = headers.indexOf('Opted_Out_At');
    const nextWindowIdx = headers.indexOf('Next_Window');
    const nextDayIdx = headers.indexOf('Next_Study_Day');
    const nextPingIdx = headers.indexOf('Next_Ping_ISO');
    const pidIdx = headers.indexOf('Participant_ID');
    const log = ss.getSheetByName(LOG_SHEET) || (ensureLogSheet_(), ss.getSheetByName(LOG_SHEET));
    let matched = false;

    for (let r = 1; r < values.length; r++) {
      if (normalizePhone_(values[r][phoneIdx]) !== from) continue;
      matched = true;
      const sheetRow = r + 1;
      writeCell_(sheet, sheetRow, statusIdx, 'Opted Out');
      writeCell_(sheet, sheetRow, optedOutIdx, new Date().toISOString());
      writeCell_(sheet, sheetRow, nextWindowIdx, '');
      writeCell_(sheet, sheetRow, nextDayIdx, '');
      writeCell_(sheet, sheetRow, nextPingIdx, '');
      logOutcome_(log, values[r][pidIdx], '', '', 'opt_out:' + (optOutType || body));
    }
    if (!matched) logOutcome_(log, '', '', '', 'opt_out_unmatched_phone:' + from);
  } finally {
    lock.releaseLock();
  }
  return twimlResponse_();
}

function twimlResponse_() {
  return ContentService.createTextOutput('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
    .setMimeType(ContentService.MimeType.XML);
}


// ============================================================================
//   CORE DISPATCHER
// ============================================================================

function dispatchPrompts() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    dispatchPromptsLocked_();
  } finally {
    lock.releaseLock();
  }
}

function dispatchPromptsLocked_() {
  const props = PropertiesService.getScriptProperties();
  const sid       = props.getProperty('TWILIO_SID');
  const token     = props.getProperty('TWILIO_TOKEN');
  const fromPhone = props.getProperty('TWILIO_PHONE');
  if (!sid || !token || !fromPhone) {
    console.warn('Twilio credentials not configured. Aborting dispatch.');
    return;
  }

  const ss = getStudySpreadsheet_();
  const sheet = ss.getSheetByName(ROSTER_SHEET);
  if (!sheet) return;
  ensureRosterSchema_();
  const log = ss.getSheetByName(LOG_SHEET) || (ensureLogSheet_(), ss.getSheetByName(LOG_SHEET));

  const range = sheet.getDataRange();
  const values = range.getValues();
  if (values.length < 2) return;

  const headers = values[0].map(String);
  const colIdx = {};
  ROSTER_COLS.forEach(name => { colIdx[name] = headers.indexOf(name); });

  // Any missing required column -> fix schema and bail this tick.
  const required = ['Participant_ID', 'Phone', 'Timezone', 'Start_Date', 'Status'];
  const missing = required.filter(c => colIdx[c] === -1);
  if (missing.length) {
    console.warn('Roster is missing required columns: ' + missing.join(', ') + '. Running ensureRosterSchema_.');
    ensureRosterSchema_();
    return;
  }

  const now = new Date();
  const nowMs = now.getTime();

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const sheetRow = r + 1;

    const pid      = row[colIdx['Participant_ID']];
    const phone    = String(row[colIdx['Phone']] || '').trim();
    const tz       = String(row[colIdx['Timezone']] || '').trim();
    const startRaw = row[colIdx['Start_Date']];
    const status   = String(row[colIdx['Status']] || '').trim();

    if (status !== 'Active' || !pid || !phone || !startRaw || !tz) continue;

    // --- 1. Compute current day in participant's timezone. -----------------
    const startDate = parseParticipantStartDate_(startRaw, tz);
    if (!startDate) {
      logOutcome_(log, pid, '', '', 'bad_start_date');
      continue;
    }

    const pTodayYmd = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    const pStartYmd = Utilities.formatDate(startDate, tz, 'yyyy-MM-dd');
    const dayNumber = dayDiffYmd_(pStartYmd, pTodayYmd) + 1;

    if (dayNumber < 1) continue;

    // Completion: dayNumber past the end AND no windows are still pending today.
    // (We handle "day N evening not yet fired" inside the send loop below.)
    if (dayNumber > STUDY_DAYS) {
      writeCell_(sheet, sheetRow, colIdx['Status'], 'Completed');
      continue;
    }

    // Sync Current_Day if it changed.
    if (colIdx['Current_Day'] !== -1 && row[colIdx['Current_Day']] !== dayNumber) {
      writeCell_(sheet, sheetRow, colIdx['Current_Day'], dayNumber);
    }

    const nextPingIso  = String(row[colIdx['Next_Ping_ISO']]  || '').trim();
    const nextWindowId = String(row[colIdx['Next_Window']]    || '').trim();
    const nextStudyDay = Number(row[colIdx['Next_Study_Day']]) || dayNumber;
    const participantSchedule = participantSchedule_(row[colIdx['Schedule_Preferences_JSON']]);

    // --- 2. Send if a ping is due. -----------------------------------------
    if (nextPingIso && nextWindowId) {
      const due = new Date(nextPingIso);
      if (!isNaN(due.getTime()) && nowMs >= due.getTime()) {
        const pendingWindow = participantSchedule.windows.find(window => window.id === nextWindowId);
        const pendingYmd = addDaysYmd_(pStartYmd, nextStudyDay - 1);
        const windowEnd = pendingWindow
          ? dateFromLocalString_(pendingYmd + 'T' + pendingWindow.end + ':00', tz)
          : null;

        // A dispatcher outage must not send an old prompt hours or days late.
        if (!pendingWindow || nextStudyDay > STUDY_DAYS ||
            (windowEnd && nowMs > windowEnd.getTime() + TICK_MINUTES * 60000)) {
          logOutcome_(log, pid, nextStudyDay, nextWindowId, 'missed:dispatcher_late');
          clearNextPing_(sheet, sheetRow, colIdx);
        } else if (alreadySent_(log, pid, nextStudyDay, nextWindowId)) {
          clearNextPing_(sheet, sheetRow, colIdx);
        } else {

          // Stamp before the network call so concurrent triggers cannot send
          // the same prompt. ScriptLock serializes this entire dispatcher.
          const sentAtIso = now.toISOString();
          writeCell_(sheet, sheetRow, colIdx['Last_Sent_ISO'], sentAtIso);

          const url  = buildLinkUrl_(pid, nextStudyDay, nextWindowId, nowMs);
          const body = buildSmsBody_(url);
          const res = sendTwilioSMS_(sid, token, fromPhone, phone, body);

          if (res.ok) {
            logOutcome_(log, pid, nextStudyDay, nextWindowId, 'accepted:' + res.status + ':' + (res.sid || 'no_sid'));
            clearNextPing_(sheet, sheetRow, colIdx);
          } else if (res.uncertain) {
            // Retrying an ambiguous network failure can duplicate an SMS.
            // Leave a visible audit event and require researcher review.
            logOutcome_(log, pid, nextStudyDay, nextWindowId, 'uncertain:manual_review:' + (res.message || ''));
            clearNextPing_(sheet, sheetRow, colIdx);
            continue;
          } else {
            writeCell_(sheet, sheetRow, colIdx['Last_Sent_ISO'], '');
            logOutcome_(log, pid, nextStudyDay, nextWindowId, 'fail:' + res.status + ':' + (res.message || ''));
            continue;
          }
        }
      } else {
        // Not yet time; do nothing this tick.
        continue;
      }
    }

    // --- 3. Schedule the next window, if any. ------------------------------
    if (SCHEDULE.length === 0) continue;

    const scheduled = computeNextPing_(tz, pStartYmd, now, participantSchedule, pid, log);
    if (!scheduled) {
      // No more windows this study. Mark completed if we've exhausted all days.
      if (dayNumber >= STUDY_DAYS) {
        writeCell_(sheet, sheetRow, colIdx['Status'], 'Completed');
      }
      continue;
    }

    writeCell_(sheet, sheetRow, colIdx['Next_Window'],   scheduled.windowId);
    writeCell_(sheet, sheetRow, colIdx['Next_Study_Day'], scheduled.forDay);
    writeCell_(sheet, sheetRow, colIdx['Next_Ping_ISO'], scheduled.pingDate.toISOString());
  }
}


// ============================================================================
//   SCHEDULING MATH
// ============================================================================

/**
 * Scan calendar study days and return the next unsent eligible window.
 * Study day remains a calendar offset from Start_Date; excluded weekdays are
 * skipped, not renumbered, so URL day values stay stable and auditable.
 *
 * The ping time is randomized within [window.start, window.end] in the
 * participant's local time, then converted back to a real Date object.
 */
function computeNextPing_(tz, startYmd, now, participantSchedule, pid, log) {
  const pNowHm = Utilities.formatDate(now, tz, 'HH:mm');
  const pNowYmd = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  const firstDay = Math.max(1, dayDiffYmd_(startYmd, pNowYmd) + 1);

  for (let studyDay = firstDay; studyDay <= STUDY_DAYS; studyDay++) {
    const targetYmd = addDaysYmd_(startYmd, studyDay - 1);
    const isoDow = isoWeekdayYmd_(targetYmd);
    if (participantSchedule.days.indexOf(isoDow) === -1) continue;

    for (let i = 0; i < participantSchedule.windows.length; i++) {
      const target = participantSchedule.windows[i];
      if (alreadySent_(log, pid, studyDay, target.id)) continue;
      if (targetYmd === pNowYmd && target.end < pNowHm) continue;

      const startMins = hmToMinutes_(target.start);
      const endMins = hmToMinutes_(target.end);
      let scheduledMins = startMins === endMins
        ? startMins
        : Math.floor(Math.random() * (endMins - startMins + 1)) + startMins;

      if (targetYmd === pNowYmd) {
        const nowMins = hmToMinutes_(pNowHm);
        scheduledMins = Math.max(scheduledMins, nowMins + 1);
        if (scheduledMins > endMins) continue;
      }

      const hh = Math.floor(scheduledMins / 60).toString().padStart(2, '0');
      const mm = (scheduledMins % 60).toString().padStart(2, '0');
      const pingDate = dateFromLocalString_(targetYmd + 'T' + hh + ':' + mm + ':00', tz);
      return { windowId: target.id, pingDate: pingDate, forDay: studyDay };
    }
  }
  return null;
}

function participantSchedule_(rawPreferences) {
  let preferences = null;
  if (rawPreferences) {
    try { preferences = JSON.parse(String(rawPreferences)); }
    catch (e) { console.warn('Invalid Schedule_Preferences_JSON; using study schedule.'); }
  }

  let days = ACTIVE_DAYS.slice();
  if (preferences && Array.isArray(preferences.days)) {
    const dayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const preferred = preferences.days.map(day => dayMap[day] || Number(day)).filter(Boolean);
    days = days.filter(day => preferred.indexOf(day) !== -1);
  }

  const overrides = preferences && preferences.windows && typeof preferences.windows === 'object'
    ? preferences.windows
    : {};
  const windows = SCHEDULE.map(window => {
    const override = overrides[window.id] || {};
    const start = validHm_(override.start) ? override.start : window.start;
    const end = validHm_(override.end) ? override.end : window.end;
    return hmToMinutes_(end) >= hmToMinutes_(start)
      ? { id: window.id, label: window.label, start: start, end: end }
      : window;
  }).sort((a, b) => a.end.localeCompare(b.end));

  return { days: days, windows: windows };
}

function validHm_(value) {
  return typeof value === 'string' && /^(?:[01]\\d|2[0-3]):[0-5]\\d$/.test(value);
}

function hmToMinutes_(hm) {
  const parts = String(hm).split(':').map(Number);
  return parts[0] * 60 + parts[1];
}

function isoWeekdayYmd_(ymd) {
  const day = new Date(ymd + 'T12:00:00Z').getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * Convert "yyyy-MM-ddTHH:mm:ss" in a given IANA zone to a real UTC Date.
 *
 * This is the one piece of timezone math Apps Script doesn't give us for
 * free. The trick: format the UTC Date in the target zone, compute the
 * offset (observed at that exact moment, so DST is respected), then subtract.
 */
function dateFromLocalString_(localIso, tz) {
  // Parse as if it were UTC to get a provisional instant.
  const asUtc = new Date(localIso + 'Z');
  // Format that provisional instant in the target zone.
  const zonedStr = Utilities.formatDate(asUtc, tz, "yyyy-MM-dd'T'HH:mm:ss");
  const zoned    = new Date(zonedStr + 'Z');
  // offset = (what it reads in zone) - (provisional UTC value)
  const offsetMs = zoned.getTime() - asUtc.getTime();
  // The real UTC instant we wanted is the provisional minus the offset.
  return new Date(asUtc.getTime() - offsetMs);
}

function parseParticipantStartDate_(raw, tz) {
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw;
  const s = String(raw).trim();
  if (!s) return null;
  // Accept yyyy-MM-dd or MM/dd/yyyy; interpret as midnight in participant tz.
  let ymd = null;
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(s)) {
    ymd = s;
  } else if (/^\\d{1,2}\\/\\d{1,2}\\/\\d{4}$/.test(s)) {
    const [mo, da, yr] = s.split('/').map(Number);
    ymd = yr + '-' + String(mo).padStart(2, '0') + '-' + String(da).padStart(2, '0');
  } else {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return dateFromLocalString_(ymd + 'T00:00:00', tz);
}

function dayDiffYmd_(ymdA, ymdB) {
  // Both are yyyy-MM-dd strings. Treat them as UTC midnights and diff.
  const a = new Date(ymdA + 'T00:00:00Z').getTime();
  const b = new Date(ymdB + 'T00:00:00Z').getTime();
  return Math.round((b - a) / (24 * 3600 * 1000));
}

function addDaysYmd_(ymd, n) {
  const base = new Date(ymd + 'T00:00:00Z');
  base.setUTCDate(base.getUTCDate() + n);
  return Utilities.formatDate(base, 'Etc/UTC', 'yyyy-MM-dd');
}


// ============================================================================
//   URL + MESSAGE BUILDERS
// ============================================================================

function buildLinkUrl_(pid, day, windowId, tMs) {
  let base = BASE_URL;
  if (!base.endsWith('/') && !base.endsWith('.html')) base += '/';
  const sep = base.indexOf('?') === -1 ? '?' : '&';
  // Always include t= so expiry_minutes in the study config is enforced.
  return base + sep + 'id=' + encodeURIComponent(pid) +
         '&day=' + day +
         '&session=' + encodeURIComponent(windowId) +
         '&t=' + tMs;
}

function buildSmsBody_(url) {
  const expiryNote = EXPIRY_MIN > 0
    ? ' Expires in ' + EXPIRY_MIN + ' min.'
    : '';
  return STUDY_NAME + ': time for your check-in.' + expiryNote + ' ' +
         url + '  Reply STOP to opt out.';
}


// ============================================================================
//   TWILIO + LOGGING
// ============================================================================

function sendTwilioSMS_(sid, token, fromPhone, toPhone, body) {
  const twilioUrl = 'https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json';
  const options = {
    method: 'post',
    payload: { To: toPhone, From: fromPhone, Body: body },
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(sid + ':' + token) },
    muteHttpExceptions: true
  };
  try {
    const resp = UrlFetchApp.fetch(twilioUrl, options);
    const code = resp.getResponseCode();
    const text = resp.getContentText();
    if (code >= 200 && code < 300) {
      let sid = '';
      try { sid = JSON.parse(text).sid || ''; } catch (e) {}
      return { ok: true, status: code, sid: sid };
    }
    return { ok: false, status: code, message: truncate_(text, 300) };
  } catch (e) {
    return { ok: false, uncertain: true, status: 0, message: String(e).slice(0, 300) };
  }
}

function logOutcome_(log, pid, day, windowId, outcome) {
  try {
    log.appendRow([new Date().toISOString(), pid, day, windowId, outcome]);
  } catch (e) {
    // Best-effort; don't let logging failures take down the dispatcher.
    console.warn('Log append failed: ' + e);
  }
}

function alreadySent_(log, pid, dayNumber, windowId) {
  const last = log.getLastRow();
  if (last < 2) return false;
  const rows = log.getRange(2, 1, last - 1, 5).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    const [tsIso, rPid, rDay, rWin, outcome] = rows[i];
    if (!outcome || !String(outcome).startsWith('accepted:')) continue;
    if (String(rPid) !== String(pid)) continue;
    if (Number(rDay) !== Number(dayNumber)) continue;
    if (String(rWin) !== String(windowId)) continue;
    return true;
  }
  return false;
}

function clearNextPing_(sheet, sheetRow, colIdx) {
  writeCell_(sheet, sheetRow, colIdx['Next_Window'], '');
  writeCell_(sheet, sheetRow, colIdx['Next_Study_Day'], '');
  writeCell_(sheet, sheetRow, colIdx['Next_Ping_ISO'], '');
}

function normalizePhone_(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function writeCell_(sheet, row, colIndexZeroBased, value) {
  if (colIndexZeroBased === -1) return;
  sheet.getRange(row, colIndexZeroBased + 1).setValue(value);
}

function truncate_(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }


// ============================================================================
//   MANUAL TEST
// ============================================================================

function sendTestMessageRow2() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const sid = props.getProperty('TWILIO_SID');
  const token = props.getProperty('TWILIO_TOKEN');
  const fromPhone = props.getProperty('TWILIO_PHONE');
  if (!sid || !token || !fromPhone) { ui.alert('Run Setup first.'); return; }

  const sheet = getStudySpreadsheet_().getSheetByName(ROSTER_SHEET);
  if (!sheet || sheet.getLastRow() < 2) { ui.alert('No roster rows.'); return; }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const phoneIdx = headers.indexOf('Phone');
  const pidIdx   = headers.indexOf('Participant_ID');
  if (phoneIdx === -1 || pidIdx === -1) { ui.alert('Roster schema broken. Re-run setup.'); return; }

  const phone = String(sheet.getRange(2, phoneIdx + 1).getValue() || '').trim();
  const pid   = sheet.getRange(2, pidIdx + 1).getValue();
  if (!phone) { ui.alert('Row 2 has no phone.'); return; }

  const url = buildLinkUrl_(pid, 1, (SCHEDULE[0] && SCHEDULE[0].id) || 'w1', Date.now());
  const body = '[TEST] ' + buildSmsBody_(url);
  const res = sendTwilioSMS_(sid, token, fromPhone, phone, body);
  if (res.ok) ui.alert('Test sent (HTTP ' + res.status + ').');
  else        ui.alert('Test failed (HTTP ' + res.status + '): ' + (res.message || ''));
}
`;

  return scriptContent;
}
