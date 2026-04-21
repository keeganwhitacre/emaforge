"use strict";

function bindOnboardingTab() {
  const toggle = document.getElementById('ob-toggle');
  const sched = document.getElementById('ob-schedule-toggle');
  const textEl = document.getElementById('ob-consent-text');

  if (toggle) {
    toggle.checked = state.onboarding.enabled;
    toggle.addEventListener('change', e => { 
      state.onboarding.enabled = e.target.checked; 
      schedulePreview(); 
    });
  }

  if (sched) {
    sched.checked = state.onboarding.ask_schedule;
    sched.addEventListener('change', e => { 
      state.onboarding.ask_schedule = e.target.checked; 
      schedulePreview(); 
    });
  }

  if (textEl) {
    // Because it's a contenteditable div, we read/write innerHTML instead of value
    textEl.innerHTML = state.onboarding.consent_text || '';
    
    textEl.addEventListener('input', e => { 
      state.onboarding.consent_text = e.target.innerHTML; 
      schedulePreview(); 
    });
    
    // Safety check: Prevent generic pasting of complex external HTML (like from Word)
    // This strips it to plaintext on paste so the config.json stays perfectly clean.
    textEl.addEventListener('paste', e => {
      e.preventDefault();
      const text = (e.originalEvent || e).clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    });
  }
}