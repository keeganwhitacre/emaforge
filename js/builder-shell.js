"use strict";

// This shell reads the same protocol report that gates exports. It does not
// maintain a second, potentially divergent notion of readiness.
const builderSections = {
  study: ["Overview", "Set up your study identity, participant experience, and data output."],
  onboarding: ["Onboarding", "Prepare the welcome and consent experience for participants."],
  questions: ["Questions", "Create and organize the questions participants will answer."],
  schedule: ["Schedule", "Choose when sessions open and what participants do in each one."],
  tasks: ["Tasks", "Configure the measurements and tasks used in your sessions."],
  deployment: ["Review & Deploy", "Review, export, host, and prepare participant links."]
};

function sectionForIssue(issue) {
  if (issue.path.startsWith("ema.questions")) return "questions";
  if (issue.path.startsWith("ema.scheduling")) return "schedule";
  if (issue.path.startsWith("onboarding")) return "onboarding";
  if (issue.path.startsWith("modules")) return "tasks";
  return "study";
}

function showBuilderIssue(issue) {
  const section = sectionForIssue(issue);
  if (!document.getElementById(`tab-${section}`).classList.contains("active")) {
    document.querySelector(`.tab-btn[data-tab="${section}"]`).click();
  }
  const questionIndex = /^ema\.questions\[(\d+)\]/.exec(issue.path);
  const windowIndex = /^ema\.scheduling\.windows\[(\d+)\]/.exec(issue.path);
  let target = questionIndex && document.querySelectorAll("#question-list .q-card")[Number(questionIndex[1])];
  if (!target && windowIndex) target = document.querySelectorAll("#window-list .window-item")[Number(windowIndex[1])];
  if (target) target.classList.add("expanded");
  if (!target && issue.path === "study.name") target = document.getElementById("study-name");
  if (!target && issue.path === "study.institution") target = document.getElementById("institution");
  if (!target && issue.path === "study.webhook_url") target = document.getElementById("study-webhook");
  if (!target && issue.path === "onboarding.consent_text") target = document.getElementById("ob-consent-text");
  if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
}

function renderSectionIssues(issues) {
  const section = document.querySelector(".tab-btn.active")?.dataset.tab || "study";
  const relevant = issues.filter(issue => sectionForIssue(issue) === section);
  const panel = document.getElementById("builder-inline-issues");
  panel.hidden = relevant.length === 0;
  panel.replaceChildren();
  if (!relevant.length) return;
  const heading = document.createElement("strong");
  heading.textContent = `${relevant.length} ${section === "questions" ? "question" : "section"} issue${relevant.length === 1 ? "" : "s"}`;
  panel.append(heading);
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

function renderBuilderShell() {
  const name = (state.study.name || "").trim();
  document.getElementById("builder-project-name").textContent = name || "Untitled study";

  const questions = state.ema.questions || [];
  const count = questions.filter(q => q.type !== "page_break").length;
  const blocks = count ? 1 + questions.filter(q => q.type === "page_break").length : 0;
  const report = EMAForgeProtocolValidator.validate(buildConfig());
  const { errors, warnings, issues } = report;
  renderSectionIssues(issues);
  document.getElementById("summary-question-count").textContent = count;
  document.getElementById("summary-block-count").textContent = blocks;
  document.getElementById("summary-issue-count").textContent = issues.filter(issue => sectionForIssue(issue) === "questions").length;

  const hasConsent = !issues.some(issue => issue.code === "consent_placeholder") &&
    !!EMAForgeProtocolValidator.textOnly(state.onboarding.consent_text);
  const hasSchedule = Array.isArray(state.ema.scheduling.windows) && state.ema.scheduling.windows.length > 0 &&
    !errors.some(issue => issue.path.startsWith("ema.scheduling"));
  const hasMeasures = state.ema.scheduling.windows.length > 0 && state.ema.scheduling.windows.every(w =>
    Array.isArray(w.phase_sequence) && w.phase_sequence.length > 0);
  const checks = [
    ["Study details completed", !!name && !!(state.study.institution || "").trim(), "study"],
    ["Consent flow configured", !!state.onboarding.enabled && hasConsent, "onboarding"],
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
    button.append(icon, document.createTextNode(label));
    const arrow = document.createElement("span");
    arrow.className = "readiness-arrow";
    arrow.textContent = "›";
    button.append(arrow);
    button.addEventListener("click", () => document.querySelector(`.tab-btn[data-tab="${section}"]`).click());
    list.append(button);
  });
  if (issues.length) {
    const detail = document.createElement("p");
    detail.className = "readiness-detail";
    detail.textContent = `${errors.length} blocking issue${errors.length === 1 ? "" : "s"} · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}. ${issues[0].message}`;
    list.append(detail);
  }
}

document.querySelectorAll(".tab-btn").forEach(button => button.addEventListener("click", () => {
  const [title, description] = builderSections[button.dataset.tab];
  document.querySelectorAll(".tab-btn").forEach(tab => tab.removeAttribute("aria-current"));
  button.setAttribute("aria-current", "page");
  document.getElementById("builder-section-title").textContent = title;
  document.getElementById("builder-section-description").textContent = description;
  document.getElementById("config-panel").scrollTop = 0;
  if (button.dataset.tab === "onboarding" && state.onboarding.enabled) previewSession = "onboarding";
  if (["questions", "schedule", "tasks"].includes(button.dataset.tab) && state.ema.scheduling.windows.length) {
    previewSession = state.ema.scheduling.windows[0].id;
  }
  renderPreviewTabs();
  renderPreview();
  renderBuilderShell();
}));
document.getElementById("start-template-btn").addEventListener("click", () => {
  document.getElementById("import-modal").classList.add("open");
});
document.getElementById("builder-preview-btn").addEventListener("click", () => {
  if (window.matchMedia("(max-width: 1050px)").matches) {
    document.getElementById("preview-panel").classList.toggle("open-mobile");
  } else {
    document.getElementById("preview-panel").scrollIntoView({ behavior: "smooth" });
    document.getElementById("preview-iframe").focus();
  }
});
document.getElementById("close-preview-btn").addEventListener("click", () => {
  document.getElementById("preview-panel").classList.remove("open-mobile");
});
document.addEventListener("click", event => {
  const menu = document.querySelector(".project-menu");
  if (menu.open && !menu.contains(event.target)) menu.open = false;
});
renderBuilderShell();
