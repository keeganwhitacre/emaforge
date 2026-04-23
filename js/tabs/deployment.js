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
  const twilioBtn = document.getElementById('export-twilio-btn');
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
  if (twilioBtn) {
    twilioBtn.addEventListener('click', () => {
      const baseUrlInput = document.getElementById('deploy-base-url').value.trim();
      const baseUrl  = baseUrlInput || 'https://example.com/study/';
      
      const windows = state.ema.scheduling.windows || [];
      if (windows.length === 0 && !state.onboarding.enabled) {
        alert('No schedule windows found. Please configure your study before exporting.');
        return;
      }

      // Generate the script using the function we define in Step 3
      const scriptContent = generateTwilioScript(baseUrl);

      // Create a downloadable file
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

// Add this at the bottom of deployment.js
function generateTwilioScript(baseUrl) {
  const windows = state.ema.scheduling.windows || [];
  const studyDays = state.ema.scheduling.study_days || 1;
  
  // Format schedule for the Apps Script
  const scheduleString = JSON.stringify(windows.map(w => ({
    id: w.id,
    start: w.start, 
    end: w.end      
  })));

  const scriptContent = `
// ==========================================================
// EMA Forge - Twilio Dispatcher (Timezone Aware)
// DO NOT EDIT THIS CODE. USE THE "EMA Forge" MENU IN SHEETS.
// ==========================================================

const BASE_URL = '${baseUrl}';
const STUDY_DAYS = ${studyDays};
const SCHEDULE = ${scheduleString};

// --- 1. THE MENU WIZARD ---
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('EMA Forge 🛠️')
      .addItem('1. Setup Twilio & Roster', 'runSetupWizard')
      .addItem('2. Start Automation (15m)', 'startTrigger')
      .addItem('3. Pause Automation', 'stopTrigger')
      .addToUi();
}

function runSetupWizard() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  
  ui.alert('Welcome to the Twilio Dispatcher Setup.\\nYou will need your Twilio Account SID, Auth Token, and Twilio Phone Number.');

  const sidResp = ui.prompt('Step 1/3', 'Enter Twilio Account SID:', ui.ButtonSet.OK_CANCEL);
  if (sidResp.getSelectedButton() !== ui.Button.OK) return;
  props.setProperty('TWILIO_SID', sidResp.getResponseText().trim());

  const tokenResp = ui.prompt('Step 2/3', 'Enter Twilio Auth Token:', ui.ButtonSet.OK_CANCEL);
  if (tokenResp.getSelectedButton() !== ui.Button.OK) return;
  props.setProperty('TWILIO_TOKEN', tokenResp.getResponseText().trim());

  const phoneResp = ui.prompt('Step 3/3', 'Enter Twilio Phone Number (e.g., +15551234567):', ui.ButtonSet.OK_CANCEL);
  if (phoneResp.getSelectedButton() !== ui.Button.OK) return;
  props.setProperty('TWILIO_PHONE', phoneResp.getResponseText().trim());

  // Setup the Roster Sheet
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Roster');
  
  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName('Roster');
    sheet.clear();
    
    // Headers including the new Timezone Offset
    const headers = ['Participant_ID', 'Phone', 'Time_Offset_Hours', 'Start_Date', 'Status', 'Current_Day', 'Next_Session', 'Next_Ping_Time'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    
    // Resize columns for readability
    sheet.setColumnWidth(1, 120); // ID
    sheet.setColumnWidth(2, 130); // Phone
    sheet.setColumnWidth(3, 150); // Offset
    sheet.setColumnWidth(8, 180); // Ping Time
    
    // Demo Row: Shows researcher how to use negative offset for PST vs EST
    const today = new Date();
    const dateStr = (today.getMonth()+1) + '/' + today.getDate() + '/' + today.getFullYear();
    sheet.getRange(2, 1, 1, 5).setValues([['Demo_001', '+15550000000', '-3', dateStr, 'Active']]);
  }
  
  ui.alert('Success! Credentials saved securely.\\n\\nNext: Go to the EMA Forge menu and click "2. Start Automation".');
}

// --- 2. TRIGGER MANAGEMENT ---
function startTrigger() {
  stopTrigger(); 
  ScriptApp.newTrigger('dispatchPrompts')
           .timeBased()
           .everyMinutes(15)
           .create();
  SpreadsheetApp.getUi().alert('Automation started! Texts will evaluate every 15 minutes.');
}

function stopTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
}

// --- 3. DISPATCHER ENGINE ---
function dispatchPrompts() {
  const props = PropertiesService.getScriptProperties();
  const sid = props.getProperty('TWILIO_SID');
  const token = props.getProperty('TWILIO_TOKEN');
  const fromPhone = props.getProperty('TWILIO_PHONE');
  
  if (!sid || !token || !fromPhone) return;
  
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Roster');
  if (!sheet) return;
  
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  
  // Format current time in script's timezone (e.g., "14:30")
  const nowTimeStr = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');
  
  // Skip row 0 (headers)
  for (let i = 1; i < data.length; i++) {
    const id = data[i][0];
    const phone = data[i][1];
    const offsetHours = parseFloat(data[i][2]) || 0; // The Timezone Math
    const startDateStr = data[i][3];
    const status = data[i][4];
    let currentDay = data[i][5] || 1;
    let nextSession = data[i][6];
    let nextPingTimeStr = data[i][7];
    
    if (status !== 'Active' || !phone || !startDateStr) continue;
    
    // 1. Evaluate Current Day
    const startDate = new Date(startDateStr);
    startDate.setHours(0,0,0,0); 
    const diffTime = now.getTime() - startDate.getTime();
    const calculatedDay = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
    
    if (calculatedDay > STUDY_DAYS) {
      sheet.getRange(i + 1, 5).setValue('Completed'); // Col 5 is Status
      continue;
    }
    
    if (calculatedDay !== currentDay) {
      currentDay = calculatedDay;
      sheet.getRange(i + 1, 6).setValue(currentDay); // Col 6 is Current_Day
    }
    
    // 2. Do we need to SEND a text?
    if (nextPingTimeStr) {
      const nextPingTime = new Date(nextPingTimeStr);
      if (now >= nextPingTime) {
        let cleanBase = BASE_URL;
        if (!cleanBase.endsWith('/')) cleanBase += '/';
        const url = cleanBase + "?id=" + id + "&day=" + currentDay + "&session=" + nextSession;
        const body = "New study prompt available: " + url;
        
        try {
          sendTwilioSMS(sid, token, fromPhone, phone, body);
          sheet.getRange(i + 1, 8).setValue(""); // Clear Ping Time (Col 8)
          nextPingTimeStr = ""; 
        } catch(e) {
          console.error("Failed to send to " + id + ": " + e);
        }
      }
    }
    
    // 3. Do we need to SCHEDULE a text?
    if (!nextPingTimeStr && SCHEDULE.length > 0) {
      // Convert current time to participant's local time to find the right window
      let pNow = new Date(now.getTime());
      pNow.setHours(pNow.getHours() + offsetHours);
      const pNowTimeStr = pNow.getHours().toString().padStart(2, '0') + ":" + pNow.getMinutes().toString().padStart(2, '0');

      let targetWindow = null;
      for (let w = 0; w < SCHEDULE.length; w++) {
         if (SCHEDULE[w].end >= pNowTimeStr) {
            targetWindow = SCHEDULE[w];
            break;
         }
      }
      
      let targetDate = new Date();
      
      if (!targetWindow) {
         targetWindow = SCHEDULE[0];
         targetDate.setDate(targetDate.getDate() + 1);
         if (currentDay + 1 > STUDY_DAYS) {
             sheet.getRange(i + 1, 5).setValue('Completed');
             continue;
         }
      }
      
      const [startH, startM] = targetWindow.start.split(':').map(Number);
      const [endH, endM] = targetWindow.end.split(':').map(Number);
      const startMins = (startH * 60) + startM;
      const endMins = (endH * 60) + endM;
      
      let scheduledMins = startMins;
      if (startMins !== endMins) {
         scheduledMins = Math.floor(Math.random() * (endMins - startMins + 1)) + startMins;
      }
      
      // SHIFT TIMEZONE: If scheduled for 08:00 PST (-3), we subtract the offset to schedule it at 11:00 EST on Google's clock.
      const dispatchMins = scheduledMins - (offsetHours * 60);
      targetDate.setHours(Math.floor(dispatchMins / 60), dispatchMins % 60, 0, 0);
      
      // Write it to the sheet
      sheet.getRange(i + 1, 7).setValue(targetWindow.id); // Col 7
      sheet.getRange(i + 1, 8).setValue(targetDate.toString()); // Col 8
    }
  }
}

// --- 4. TWILIO API CALL ---
function sendTwilioSMS(sid, token, fromPhone, toPhone, body) {
  const twilioUrl = 'https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json';
  const payload = { "To": toPhone, "From": fromPhone, "Body": body };
  const options = {
    "method": "post",
    "payload": payload,
    "headers": { "Authorization": "Basic " + Utilities.base64Encode(sid + ":" + token) },
    "muteHttpExceptions": true
  };
  UrlFetchApp.fetch(twilioUrl, options);
}
`;
  return scriptContent;
}