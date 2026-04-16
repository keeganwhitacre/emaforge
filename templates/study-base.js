"use strict";

// {{CONFIG_LOADER}}

function show(id) { 
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); 
  document.getElementById(id).classList.add('active'); 
}

function evalCond(cond, responses) {
  if (!cond) return true;
  const val = responses[cond.question_id];
  if (val === undefined || val === null) return false;
  const cv = cond.value;
  switch(cond.operator) {
    case 'eq': return val == cv; case 'neq': return val != cv;
    case 'gt': return Number(val) > Number(cv); case 'gte': return Number(val) >= Number(cv);
    case 'lt': return Number(val) < Number(cv); case 'lte': return Number(val) <= Number(cv);
    case 'includes': { const arr = Array.isArray(cv)?cv:[cv]; const ans = Array.isArray(val)?val:[val]; return arr.some(v => ans.includes(v)); }
    default: return true;
  }
}

function esc(str) { 
  return (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); 
}

(async function() {
  const config = await loadConfig();
  const study  = config.study;
  const ema    = config.ema;
  
  document.documentElement.style.setProperty('--accent', study.accent_color || '#e8716a');
  document.getElementById('study-title').textContent = study.name || 'Study';
  document.getElementById('inst-label').textContent  = study.institution || '';
  document.title = study.name || 'Study';

  const params = new URLSearchParams(window.location.search);
  
  // {{EXPIRY_CHECK}}
  // {{PREVIEW_SESSION_FORCE}}
  
  const sessionCfg = ema.sessions.find(s => s.id === sessionId) || ema.sessions[0];
  const greeting = study.greetings?.[sessionCfg.greeting_key] || sessionCfg.label || 'Check-In';
  document.getElementById('ema-greeting').textContent = greeting;
  document.getElementById('ema-sublabel').textContent = study.name || '';

  const pidInput = document.getElementById('pid-input');
  const pidBtn   = document.getElementById('pid-btn');
  pidInput.addEventListener('input', () => { pidBtn.disabled = !pidInput.value.trim(); });

  const sessionData = { session: sessionId, responses: {}, timestamps: {}, meta: { schema_version: config.schema_version } };

  pidBtn.addEventListener('click', () => {
    sessionData.participantID = pidInput.value.trim();
    sessionData.start_time    = new Date().toISOString();
    renderQuestions(ema.questions, sessionData.responses);
    show('screen-ema');
  });

  function renderQuestions(questions, responses) {
    const wrap = document.getElementById('questions-wrap');
    function rebuild() {
      wrap.innerHTML = '';
      let n = 0;
      questions.forEach(q => {
        if (!evalCond(q.condition, responses)) return;
        n++;
        const label = n + '. ' + esc(q.text);
        if (q.type === 'slider') {
          const mid = ((q.min||0) + (q.max||100)) / 2;
          const cur = responses[q.id] !== undefined ? responses[q.id] : mid;
          const grp = document.createElement('div'); grp.className = 'slider-group';
          grp.innerHTML = '<span class="slider-label">' + label + '</span>' +
            '<input type="range" class="range-slider" min="' + (q.min||0) + '" max="' + (q.max||100) + '" step="' + (q.step||1) + '" value="' + cur + '">' +
            '<div class="slider-labels"><span>' + esc((q.anchors||['',''])[0]) + '</span><span>' + esc((q.anchors||['',''])[1]) + '</span></div>';
          const inp = grp.querySelector('input');
          if (responses[q.id] === undefined) {
            responses[q.id] = Number(inp.value);
            inp.addEventListener('input', function handler() {
              responses[q.id] = Number(inp.value);
              sessionData.timestamps[q.id] = Date.now();
              inp.removeEventListener('input', handler);
              checkSubmit();
            });
          }
          inp.addEventListener('input', () => { responses[q.id] = Number(inp.value); sessionData.timestamps[q.id] = Date.now(); checkSubmit(); });
          wrap.appendChild(grp);
        } else if (q.type === 'choice') {
          const grp = document.createElement('div'); grp.className = 'choice-group';
          const selVal = responses[q.id];
          grp.innerHTML = '<span class="slider-label">' + label + '</span><div class="choice-options">' +
            (q.options||[]).map(o => '<button class="choice-opt' + (selVal===o?' selected':'') + '" data-val="' + esc(o) + '">' + esc(o) + '</button>').join('') + '</div>';
          grp.querySelectorAll('.choice-opt').forEach(btn => {
            btn.addEventListener('click', () => {
              responses[q.id] = btn.dataset.val;
              sessionData.timestamps[q.id] = Date.now();
              rebuild(); checkSubmit();
            });
          });
          wrap.appendChild(grp);
        }
      });
    }
    rebuild();
    function checkSubmit() {
      const required = questions.filter(q => q.required && evalCond(q.condition, responses));
      document.getElementById('submit-btn').disabled = !required.every(q => responses[q.id] !== undefined && responses[q.id] !== '');
    }
    checkSubmit();
  }

  function finalizeSession() {
    // {{SUBMIT_ACTION}}
  }

  document.getElementById('submit-btn').addEventListener('click', () => {
    if (config.tasks && config.tasks.includes('pat')) {
      if (typeof startPATSession === 'function') {
        startPATSession();
      } else {
        finalizeSession();
      }
    } else {
      finalizeSession();
    }
  });

  // {{PAT_LOGIC}}
})();
