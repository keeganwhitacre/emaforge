"use strict";

// This shell reads the same protocol report that gates exports. It does not
// maintain a second, potentially divergent notion of readiness.
const builderSections = {
  study: ["Overview", "Set up your study identity, participant experience, and data output."],
  onboarding: ["Onboarding", "Prepare the welcome and consent experience for participants."],
  questions: ["Measures", "Add survey items and physiological tasks to the same participant flow."],
  schedule: ["Schedule", "Choose when sessions open and what participants do in each one."],
  tasks: ["Task settings", "Fine-tune task duration, trials, feedback, and quality controls."],
  deployment: ["Review & Deploy", "Review, export, host, and prepare participant links."]
};

function sectionForIssue(issue) {
  if (issue.code === "phase_sequence_empty") return "questions";
  if (issue.path.startsWith("ema.questions")) return "questions";
  if (issue.path.startsWith("ema.scheduling")) return "schedule";
  if (issue.path.startsWith("onboarding")) return "onboarding";
  if (issue.path.startsWith("modules")) return "tasks";
  return "study";
}

function showBuilderIssue(issue) {
  const emptySession = issue.code === "phase_sequence_empty";
  const section = sectionForIssue(issue);
  if (!document.getElementById(`tab-${section}`).classList.contains("active")) {
    document.querySelector(`.tab-btn[data-tab="${section}"]`).click();
  }
  const questionIndex = /^ema\.questions\[(\d+)\]/.exec(issue.path);
  const windowIndex = /^ema\.scheduling\.windows\[(\d+)\]/.exec(issue.path);
  let target = null;
  if (questionIndex) {
    const question = state.ema.questions[Number(questionIndex[1])];
    const window = question && state.ema.scheduling.windows.find(candidate => candidate.phase_sequence?.some(step =>
      step.kind === "ema" && (step.question_ids || []).includes(question.id)));
    if (window) {
      previewSession = window.id;
      renderPreviewTabs();
      renderMeasureComposer();
      target = document.querySelector(`.flow-question-card[data-qid="${CSS.escape(question.id)}"]`);
    }
  }
  if (emptySession && windowIndex) {
    const window = state.ema.scheduling.windows[Number(windowIndex[1])];
    if (window) selectMeasureSession(window.id);
    target = document.querySelector(".measure-empty button");
  }
  if (!target && windowIndex) target = document.querySelectorAll("#window-list .window-item")[Number(windowIndex[1])];
  if (target?.classList.contains("q-card")) {
    setQuestionExpanded(target, true);
    target = target.querySelector(".q-text, .page-break-label") || target;
  }
  if (!target && issue.path === "study.name") target = document.getElementById("study-name");
  if (!target && issue.path === "study.institution") target = document.getElementById("institution");
  if (!target && issue.path === "study.webhook_url") target = document.getElementById("study-webhook");
  if (!target && issue.path === "onboarding.consent_text") target = document.getElementById("ob-consent-text");
  if (target?.matches("input, textarea, button, [contenteditable]")) target.focus({ preventScroll: true });
  else document.getElementById("builder-section-title").focus({ preventScroll: true });
  target?.scrollIntoView({ block: "center" });
}

function renderSectionIssues(issues) {
  const section = document.querySelector(".tab-btn.active")?.dataset.tab || "study";
  const relevant = issues.filter(issue => sectionForIssue(issue) === section);
  const panel = document.getElementById("builder-inline-issues");
  const details = document.getElementById("builder-issues-details");
  details.hidden = relevant.length === 0;
  document.getElementById("builder-issues-summary").textContent =
    `${relevant.length} item${relevant.length === 1 ? "" : "s"} to review in this section`;
  panel.replaceChildren();
  if (!relevant.length) return;
  relevant.slice(0, 6).forEach(issue => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `builder-issue ${issue.severity}`;
    button.textContent = issue.message;
    button.addEventListener("click", () => showBuilderIssue(issue));
    panel.append(button);
  });
  if (relevant.length > 6) {
    const extra = document.createElement("p");
    extra.textContent = `Plus ${relevant.length - 6} more. Resolve these or review the export report.`;
    panel.append(extra);
  }
}

function renderBuilderNextStep(errors) {
  const card = document.getElementById("builder-next");
  const action = document.getElementById("builder-next-action");
  const section = document.querySelector(".tab-btn.active")?.dataset.tab;
  const firstIssue = errors[0];
  const issue = section === "deployment" ? firstIssue : errors.find(error => sectionForIssue(error) === section);
  card.hidden = section === "deployment" ? !issue : Boolean(firstIssue && !issue);
  if (card.hidden) return;

  document.getElementById("builder-next-label").textContent = section === "deployment"
    ? `${errors.length} blocking issue${errors.length === 1 ? "" : "s"}` : "Next step";
  document.getElementById("builder-next-detail").textContent = issue?.message ||
    "Review your protocol and prepare the file for Study Admin.";
  const issueSection = issue && sectionForIssue(issue);
  action.textContent = issue ? issueSection === section ? "Go to issue" : `Open ${builderSections[issueSection][0]}`
    : "Review & Deploy";
  action.onclick = () => {
    if (issue) showBuilderIssue(issue);
    else {
      document.querySelector('.tab-btn[data-tab="deployment"]').click();
      document.getElementById("builder-section-title").focus();
    }
  };
}

// Show blocking issues in both the desktop tabs and mobile picker.
function renderSectionBadges(errors) {
  const counts = {};
  errors.forEach(issue => {
    const key = sectionForIssue(issue);
    counts[key] = (counts[key] || 0) + 1;
  });
  for (const option of sectionSelect.options) {
    const [title] = builderSections[option.value];
    const count = counts[option.value];
    const label = count ? `${title} (${count})` : title;
    if (option.textContent !== label) option.textContent = label;
  }
  document.querySelectorAll(".tab-btn[data-tab]").forEach(tab => {
    const count = counts[tab.dataset.tab] || 0;
    let badge = tab.querySelector(".tab-badge");
    if (!count) { badge?.remove(); return; }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "tab-badge";
      tab.append(badge);
    }
    if (badge.textContent !== String(count)) badge.textContent = String(count);
    badge.setAttribute("aria-label", `${count} issue${count === 1 ? "" : "s"} to fix`);
  });
}

function renderBuilderShell() {
  const name = (state.study.name || "").trim();
  document.getElementById("builder-project-name").textContent = name || "Untitled study";

  const questions = state.ema.questions || [];
  const count = questions.filter(q => q.type !== "page_break" && q.type !== "instruction").length;
  const taskCount = state.ema.scheduling.windows.reduce((total, w) =>
    total + (w.phase_sequence || []).filter(step => step.kind === "task").length, 0) +
    questions.filter(question => question.type === "heart_rate").length;
  const launchConfig = buildConfig();
  launchConfig.study.webhook_url = "/submit";
  const report = EMAForgeProtocolValidator.validate(launchConfig);
  const { errors, warnings, issues } = report;
  renderSectionIssues(issues);
  renderBuilderNextStep(errors);
  renderSectionBadges(errors);
  document.getElementById("summary-question-count").textContent = count;
  document.getElementById("summary-block-count").textContent = taskCount;
  document.getElementById("summary-issue-count").textContent = issues.filter(issue => sectionForIssue(issue) === "questions").length;

  const hasConsent = !issues.some(issue => issue.code === "consent_placeholder") &&
    !!EMAForgeProtocolValidator.textOnly(state.onboarding.consent_text);
  const hasSchedule = Array.isArray(state.ema.scheduling.windows) && state.ema.scheduling.windows.length > 0 &&
    !errors.some(issue => issue.path.startsWith("ema.scheduling"));
  const hasMeasures = state.ema.scheduling.windows.length > 0 && state.ema.scheduling.windows.every(w =>
    Array.isArray(w.phase_sequence) && w.phase_sequence.length > 0);
  const checks = [
    ["Study details completed", !!name && !!(state.study.institution || "").trim(), "study"],
    [state.onboarding.enabled ? "Consent flow configured" : "Consent handled outside EMA Forge", !state.onboarding.enabled || hasConsent, "onboarding"],
    ["Each session has a measure", hasMeasures, "schedule"],
    ["Schedule configured", hasSchedule, "schedule"],
    ["No blocking export issues", errors.length === 0, "deployment"]
  ];
  document.getElementById("readiness-count").textContent = `${checks.filter(check => check[1]).length} of ${checks.length} complete`;
  const list = document.getElementById("readiness-list");
  list.replaceChildren();
  checks.forEach(([label, complete, section]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `readiness-item ${complete ? "complete" : ""}`;
    const icon = document.createElement("span");
    icon.className = "readiness-icon";
    icon.textContent = complete ? "✓" : "○";
    icon.setAttribute("aria-hidden", "true");
    button.setAttribute("aria-label", `${label}. ${complete ? "Complete" : "Needs review"}.`);
    button.append(icon, document.createTextNode(label));
    button.disabled = section === "deployment" && complete;
    if (!button.disabled) {
      const arrow = document.createElement("span");
      arrow.className = "ui-chevron readiness-arrow";
      arrow.setAttribute("aria-hidden", "true");
      button.append(arrow);
      button.addEventListener("click", () => {
        if (section === "deployment") showBuilderIssue(errors[0]);
        else {
          document.querySelector(`.tab-btn[data-tab="${section}"]`).click();
          document.getElementById("builder-section-title").focus();
        }
      });
    }
    list.append(button);
  });
  if (issues.length) {
    const detail = document.createElement("p");
    detail.className = "readiness-detail";
    detail.textContent = `${errors.length} blocking issue${errors.length === 1 ? "" : "s"} · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}. ${(errors[0] || warnings[0]).message}`;
    list.append(detail);
  }
}

function rememberBuilderWorkspace() {
  const section = document.querySelector(".tab-btn.active")?.dataset.tab || "study";
  StorageManager.rememberWorkspace(section, previewSession);
}

function restoreBuilderWorkspace() {
  clearBuilderUndo();
  const { section, session } = StorageManager.readWorkspace();
  if (state.ema.scheduling.windows.some(window => window.id === session) ||
      (session === "onboarding" && state.onboarding.enabled)) {
    previewSession = session;
  }
  const target = Object.hasOwn(builderSections, section) ? section : "study";
  document.querySelector(`.tab-btn[data-tab="${target}"]`).click();
}

const phoneBuilder = matchMedia("(max-width: 850px)");
const projectMenu = document.querySelector(".project-menu");
const draftPicker = document.querySelector(".draft-picker");
const nextStepCard = document.getElementById("builder-next");
const sectionHeader = document.getElementById("builder-section-header");
const issuesDetails = document.getElementById("builder-issues-details");
const measuresTab = document.getElementById("tab-questions");

function layoutBuilderControls() {
  const draftSlot = document.getElementById(phoneBuilder.matches ? "phone-draft-slot" : "desktop-draft-slot");
  if (draftPicker.parentElement !== draftSlot) draftSlot.append(draftPicker);

  const editingMeasures = measuresTab.classList.contains("active");
  if (phoneBuilder.matches && editingMeasures) {
    if (nextStepCard.parentElement !== measuresTab) measuresTab.append(nextStepCard);
  } else if (nextStepCard.parentElement !== sectionHeader) {
    sectionHeader.insertBefore(nextStepCard, issuesDetails);
  }
}

phoneBuilder.addEventListener("change", layoutBuilderControls);
const phoneDraftsButton = document.getElementById("phone-drafts-btn");
projectMenu.addEventListener("toggle", () => {
  phoneDraftsButton.setAttribute("aria-expanded", String(projectMenu.open));
});
phoneDraftsButton.addEventListener("click", () => {
  projectMenu.open = !projectMenu.open;
  if (projectMenu.open) document.getElementById("draft-select").focus();
});
document.getElementById("draft-select").addEventListener("change", () => {
  if (!phoneBuilder.matches) return;
  projectMenu.open = false;
  phoneDraftsButton.focus();
});
document.getElementById("new-draft-btn").addEventListener("click", () => {
  if (phoneBuilder.matches) projectMenu.open = false;
});
layoutBuilderControls();

const sectionSelect = document.getElementById("builder-section-select");
for (const [section, [title]] of Object.entries(builderSections)) {
  sectionSelect.add(new Option(title, section));
}
sectionSelect.addEventListener("change", () => {
  document.querySelector(`.tab-btn[data-tab="${sectionSelect.value}"]`).click();
});
document.getElementById("phone-backup-btn").addEventListener("click", () => {
  document.getElementById("btn-save-project").click();
});
document.querySelectorAll(".tab-btn").forEach(button => button.addEventListener("click", () => {
  const [title, description] = builderSections[button.dataset.tab];
  document.querySelectorAll(".tab-btn").forEach(tab => tab.removeAttribute("aria-current"));
  button.setAttribute("aria-current", "page");
  sectionSelect.value = button.dataset.tab;
  document.getElementById("builder-issues-details").open = false;
  document.getElementById("builder-section-title").textContent = title;
  document.getElementById("builder-section-description").textContent = description;
  document.getElementById("config-panel").dataset.section = button.dataset.tab;
  layoutBuilderControls();
  document.getElementById("config-panel").scrollTop = 0;
  if (button.dataset.tab === "onboarding" && state.onboarding.enabled) previewSession = "onboarding";
  if (["questions", "schedule", "tasks"].includes(button.dataset.tab) && state.ema.scheduling.windows.length &&
      !state.ema.scheduling.windows.some(window => window.id === previewSession)) {
    previewSession = state.ema.scheduling.windows[0].id;
  }
  renderPreviewTabs();
  if (button.dataset.tab === "questions") renderMeasureComposer();
  rememberBuilderWorkspace();
  renderPreview();
  renderBuilderShell();
}));
document.getElementById("start-template-btn").addEventListener("click", () => {
  document.getElementById("import-modal").classList.add("open");
});
document.getElementById("builder-preview-btn").addEventListener("click", () => {
  const panel = document.getElementById("preview-panel");
  panel.classList.remove("open-mobile");
  panel.classList.add("preview-fullscreen");
  document.body.classList.add("preview-open");
  for (const sibling of panel.parentElement.children) {
    if (sibling !== panel) sibling.inert = true;
  }
  document.getElementById("close-preview-btn").focus();
});
document.getElementById("close-preview-btn").addEventListener("click", () => {
  document.getElementById("preview-panel").classList.remove("open-mobile", "preview-fullscreen");
  document.body.classList.remove("preview-open");
  for (const sibling of document.getElementById("preview-panel").parentElement.children) sibling.inert = false;
  document.getElementById("builder-preview-btn").focus();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && document.getElementById("preview-panel").classList.contains("preview-fullscreen")) {
    document.getElementById("close-preview-btn").click();
  }
});
document.addEventListener("click", event => {
  if (projectMenu.open && !event.target.closest(".project-menu, #phone-drafts-btn")) projectMenu.open = false;
});
if (StorageManager.hasDraft) restoreBuilderWorkspace();
else renderBuilderShell();
if (window.location.hash === "#library" || new URLSearchParams(window.location.search).has("library")) {
  document.getElementById("import-modal").classList.add("open");
}
