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
  config.study.name = 'Everyday mood check-in';
  config.onboarding.enabled = false;
  config.ema.allow_back_navigation = true;
  const window = config.ema.scheduling.windows[0];
  const { questions } = config.ema;
  questions.push(
    { id: 'sample_company_page', type: 'page_break' },
    {
      id: 'sample_company', type: 'choice', text: 'Who are you with right now?', required: true,
      options: ['Alone', 'With other people']
    },
    { id: 'sample_connection_page', type: 'page_break' },
    {
      id: 'sample_connection', type: 'slider',
      text: 'How connected do you feel to the people around you?', required: true,
      min: 0, max: 10, step: 1, anchors: ['Not at all', 'Very connected'],
      condition: { question_id: 'sample_company', operator: 'eq', value: 'With other people' }
    }
  );
  if (withHeartRate) {
    questions.push(
      { id: 'sample_pulse_page', type: 'page_break' },
      {
        id: 'sample_heart_rate', type: 'heart_rate', text: 'Try a simulated heart-rate reading',
        duration_sec: 15, report_as: 'bpm', required: true
      }
    );
    config.modules.hr_capture = { enabled: true };
  }
  questions.push(
    { id: 'sample_reflection_page', type: 'page_break' },
    {
      id: 'sample_reflection', type: 'text',
      text: 'What were you doing just before this check-in?', required: false
    }
  );
  window.phase_sequence[0].question_ids = questions.map(question => question.id);
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
