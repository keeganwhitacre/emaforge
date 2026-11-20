"use strict";

const surveyButton = document.getElementById('sample-survey');
const physiologyButton = document.getElementById('sample-physiology');
const sampleFrame = document.getElementById('sample-frame');
const sampleStatus = document.getElementById('sample-status');
let sampleRequest = 0;

async function showSample(withHeartRate) {
  const request = ++sampleRequest;
  surveyButton.setAttribute('aria-pressed', String(!withHeartRate));
  physiologyButton.setAttribute('aria-pressed', String(withHeartRate));
  sampleStatus.textContent = 'Loading sample…';
  const config = buildConfig();
  config.study.name = 'Sample daily check-in';
  config.onboarding.enabled = false;
  const window = config.ema.scheduling.windows[0];
  if (withHeartRate) {
    const id = 'sample_heart_rate';
    config.ema.questions.push({
      id, type: 'heart_rate', text: 'Measure your heart rate',
      duration_sec: 15, report_as: 'bpm', required: false
    });
    window.phase_sequence.push({ kind: 'ema', id: 'sample_ppg', question_ids: [id] });
    config.modules.hr_capture = { enabled: true };
  }
  try {
    const html = await buildStudyHtml({
      configInline: true, configOverride: config, previewMode: true, previewSession: window.id
    });
    if (request !== sampleRequest) return;
    sampleFrame.srcdoc = html;
    sampleFrame.hidden = false;
    sampleStatus.textContent = '';
  } catch (error) {
    if (request === sampleRequest) sampleStatus.textContent = 'The sample could not load. Select a sample to try again.';
  }
}

surveyButton.onclick = () => showSample(false);
physiologyButton.onclick = () => showSample(true);
showSample(false);
