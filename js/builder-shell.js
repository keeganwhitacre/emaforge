"use strict";

// This shell reads the same protocol report that gates exports. It does not
// maintain a second, potentially divergent notion of readiness.
const builderSections = {
  study: ["Overview", "Set up your study identity, participant experience, and data output."],
  onboarding: ["Onboarding", "Prepare the welcome and consent experience for participants."],
  questions: ["Questions", "Create and organize the questions participants will answer."],
  schedule: ["Schedule", "Choose when sessions open and which phases they contain."],
  tasks: ["Tasks", "Configure the measurements and tasks used in your sessions."],
  deployment: ["Deployment", "Prepare participant links and delivery tools for your study."]
};

function renderBuilderShell() {
  const name = (state.study.name || "").trim();
  document.getElementById("builder-project-name").textContent = name || "Untitled study";

  const questions = state.ema.questions || [];
  const count = questions.filter(q => q.type !== "page_break").length;
  const blocks = count ? 1 + questions.filter(q => q.type === "page_break").length : 0;
  const report = EMAForgeProtocolValidator.validate(buildConfig());
  const { errors, warnings, issues } = report;
  document.getElementById("summary-question-count").textContent = count;
  document.getElementById("summary-block-count").textContent = blocks;
  document.getElementById("summary-issue-count").textContent = errors.length + warnings.length;

  const hasConsent = !issues.some(issue => issue.code === "consent_placeholder") &&
    !!EMAForgeProtocolValidator.textOnly(state.onboarding.consent_text);
  const hasSchedule = Array.isArray(state.ema.scheduling.windows) && state.ema.scheduling.windows.length > 0 &&
    !errors.some(issue => issue.path.startsWith("ema.scheduling"));
  const checks = [
    ["Study details completed", !!name && !!(state.study.institution || "").trim(), "study"],
    ["Consent flow configured", !!state.onboarding.enabled && hasConsent, "onboarding"],
    ["At least one question added", count > 0, "questions"],
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
}));
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
