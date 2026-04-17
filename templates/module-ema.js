// ==========================================================
// EMA PAGINATION ENGINE — v1.2
// ==========================================================
//
// Changes from v1.1:
//   - EMA.start() now receives a phase token ("pre_w1", "post_w3")
//     instead of a raw session id string. It parses the token to
//     extract the windowId and block direction.
//   - buildPages(windowId, blockDir) filters questions by:
//       (1) q.windows — null means all windows; explicit array checked
//       (2) q.block   — "pre"/"both" pass for pre-phases;
//                       "post"/"both" pass for post-phases
//   - Greeting is now set by study-base.js before EMA.start() is
//     called, so module-ema.js no longer touches the greeting element.
//   - The "Submit / Next" button label logic now checks whether the
//     current phase is the last in sessionData.phases instead of
//     checking config.tasks for 'pat' specifically.
//
// ==========================================================

const EMA = (function() {
  let emaPages        = [];
  let currentPageIndex = 0;
  let emaResponses    = { type: 'ema_response', responses: {} };

  // -----------------------------------------------------------------------
  // buildPages(windowId, blockDir)
  //
  // windowId  — the schedule window id (e.g. "w1") or null for unknown
  // blockDir  — "pre" or "post" — which block we are rendering
  //
  // Filtering logic:
  //   Window filter: q.windows === null  → appears in all windows
  //                  q.windows includes windowId → appears in this window
  //   Block filter:  blockDir "pre"  → q.block is "pre" or "both"
  //                  blockDir "post" → q.block is "post" or "both"
  //
  // Page breaks are preserved as separators only if questions on both
  // sides survive the filter — orphan page breaks are dropped.
  // -----------------------------------------------------------------------
  function buildPages(windowId, blockDir) {
    emaPages = [];
    let currentBlock = [];

    config.ema.questions.forEach(q => {
      if (q.type === 'page_break') {
        if (currentBlock.length > 0) {
          emaPages.push(currentBlock);
          currentBlock = [];
        }
        return;
      }

      // Window filter
      const windowMatch = q.windows === null
        || q.windows === undefined
        || (windowId && q.windows.includes(windowId));

      // Block filter
      const block = q.block || 'both';
      const blockMatch = blockDir === 'post'
        ? (block === 'post' || block === 'both')
        : (block === 'pre'  || block === 'both');  // default pre for unknown

      if (windowMatch && blockMatch) {
        currentBlock.push(q);
      }
    });

    if (currentBlock.length > 0) emaPages.push(currentBlock);
  }

  // -----------------------------------------------------------------------
  // renderCurrentPage — unchanged from v1.1 except the "Submit/Next" label
  // -----------------------------------------------------------------------
  function renderCurrentPage() {
    const container = document.getElementById('ema-single-container');
    const nextBtn   = document.getElementById('ema-next-btn');

    // Fast-forward past pages where all questions fail skip-logic
    let visibleQuestions = [];
    while (currentPageIndex < emaPages.length) {
      visibleQuestions = emaPages[currentPageIndex].filter(
        q => evalCond(q.condition, emaResponses.responses)
      );
      if (visibleQuestions.length > 0) break;
      currentPageIndex++;
    }

    if (currentPageIndex >= emaPages.length) {
      sessionData.data.push(emaResponses);
      advancePhase();
      return;
    }

    const pct = Math.round(((currentPageIndex + 1) / emaPages.length) * 100);
    document.getElementById('ema-progress-fill').style.width = pct + '%';
    container.innerHTML = '';

    visibleQuestions.forEach(q => {
      const wrapper = document.createElement('div');
      wrapper.style.marginBottom = '48px';

      const qTitle = document.createElement('div');
      qTitle.className = 'ema-question';
      qTitle.textContent = q.text;
      wrapper.appendChild(qTitle);

      const checkSubmit = () => {
        nextBtn.disabled = !visibleQuestions.every(q =>
          !q.required || (emaResponses.responses[q.id] !== undefined && emaResponses.responses[q.id] !== '')
        );
      };

      if (q.type === 'slider') {
        const mid = ((q.min || 0) + (q.max || 100)) / 2;
        if (emaResponses.responses[q.id] === undefined) emaResponses.responses[q.id] = mid;

        const grp     = document.createElement('div'); grp.className = 'slider-group';
        const valDisp = document.createElement('div'); valDisp.className = 'slider-val-display';
        valDisp.textContent = emaResponses.responses[q.id] + (q.unit || '');

        const inp = document.createElement('input');
        inp.type = 'range'; inp.className = 'range-slider';
        inp.min = q.min; inp.max = q.max; inp.step = q.step || 1;
        inp.value = emaResponses.responses[q.id];

        inp.addEventListener('input', () => {
          emaResponses.responses[q.id] = Number(inp.value);
          valDisp.textContent = inp.value + (q.unit || '');
          checkSubmit();
        });

        const labels = document.createElement('div'); labels.className = 'slider-labels';
        labels.innerHTML = `<span>${q.anchors[0] || ''}</span><span>${q.anchors[1] || ''}</span>`;
        grp.append(valDisp, inp, labels);
        wrapper.appendChild(grp);
      }

      else if (q.type === 'choice') {
        const grp = document.createElement('div'); grp.className = 'bubble-group';
        q.options.forEach(opt => {
          const b = document.createElement('div'); b.className = 'bubble'; b.textContent = opt;
          if (emaResponses.responses[q.id] === opt) b.classList.add('selected');
          b.onclick = () => {
            grp.querySelectorAll('.bubble').forEach(x => x.classList.remove('selected'));
            b.classList.add('selected');
            emaResponses.responses[q.id] = opt;
            checkSubmit();
          };
          grp.appendChild(b);
        });
        wrapper.appendChild(grp);
      }

      else if (q.type === 'checkbox') {
        if (!Array.isArray(emaResponses.responses[q.id])) emaResponses.responses[q.id] = [];
        const grp = document.createElement('div'); grp.className = 'bubble-group';
        q.options.forEach(opt => {
          const b = document.createElement('div'); b.className = 'bubble'; b.textContent = opt;
          if (emaResponses.responses[q.id].includes(opt)) b.classList.add('selected');
          b.onclick = () => {
            b.classList.toggle('selected');
            const arr = emaResponses.responses[q.id];
            if (b.classList.contains('selected')) { if (!arr.includes(opt)) arr.push(opt); }
            else { const i = arr.indexOf(opt); if (i > -1) arr.splice(i, 1); }
            checkSubmit();
          };
          grp.appendChild(b);
        });
        wrapper.appendChild(grp);
      }

      else if (q.type === 'text' || q.type === 'numeric') {
        const grp = document.createElement('div'); grp.className = 'input-group';
        const inp = document.createElement('input');
        inp.type = q.type === 'numeric' ? 'number' : 'text';
        inp.placeholder = 'Tap to answer';
        if (emaResponses.responses[q.id] !== undefined) inp.value = emaResponses.responses[q.id];
        inp.addEventListener('input', () => {
          emaResponses.responses[q.id] = q.type === 'numeric' ? Number(inp.value) : inp.value;
          checkSubmit();
        });
        grp.appendChild(inp);
        wrapper.appendChild(grp);
      }

      container.appendChild(wrapper);
      checkSubmit();
    });

    // "Submit" on last page of last EMA phase; "Next" otherwise
    const isLastPage  = currentPageIndex === emaPages.length - 1;
    const isLastPhase = sessionData.currentPhase === sessionData.phases.length - 1;
    nextBtn.textContent = (isLastPage && isLastPhase) ? 'Submit Check-In' : 'Next';

    container.classList.remove('fade-out', 'fade-in');
    void container.offsetWidth;
    container.classList.add('fade-in');
    setTimeout(() => container.classList.remove('fade-in'), 50);
  }

  document.getElementById('ema-next-btn').addEventListener('click', () => {
    const container = document.getElementById('ema-single-container');
    container.classList.add('fade-out');
    setTimeout(() => { currentPageIndex++; renderCurrentPage(); }, 300);
  });

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------
  return {
    // phaseToken — new format: "pre_w1" | "post_w3"
    //              old format: "w1" | "w2" (plain window id, treated as pre)
    start(phaseToken) {
      // Parse token — support both new "pre_w1" format and legacy "w1" format.
      // The legacy format comes from study-base.js in the repo which still
      // builds phases as [sessionId] (e.g. ["w1"]) for ema_only sessions.
      // We detect new format by checking if token starts with "pre_" or "post_".
      let blockDir, windowId;
      if (phaseToken.startsWith('pre_') || phaseToken.startsWith('post_')) {
        const underIdx = phaseToken.indexOf('_');
        blockDir  = phaseToken.slice(0, underIdx);          // "pre" or "post"
        windowId  = phaseToken.slice(underIdx + 1);         // "w1", "w3", etc.
      } else {
        // Legacy format — plain window id, always pre-block
        blockDir = 'pre';
        windowId = phaseToken || null;
      }

      emaResponses = {
        type:     'ema_response',
        phase:    phaseToken,
        windowId: windowId,
        block:    blockDir,
        responses: {}
      };

      buildPages(windowId, blockDir);
      currentPageIndex = 0;

      // If no questions survive filtering, skip this phase entirely
      if (emaPages.length === 0) {
        advancePhase();
        return;
      }

      show('screen-ema');
      renderCurrentPage();
    }
  };
})();