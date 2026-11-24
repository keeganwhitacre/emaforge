"use strict";

// Theme switching works with or without view transitions.
(() => {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  // Run a DOM change inside a same-document view transition when available.
  // `className` is added to <html> for the duration so CSS can pick the
  // animation (a theme swap fades; it should not slide like a page change).
  function withTransition(change, className = "") {
    if (!document.startViewTransition || reduceMotion.matches) { change(); return; }
    const root = document.documentElement;
    if (className) root.classList.add(className);
    const transition = document.startViewTransition(change);
    transition.finished.finally(() => { if (className) root.classList.remove(className); });
  }

  function toggleTheme(afterChange) {
    withTransition(() => {
      const root = document.documentElement;
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try { localStorage.setItem("ema-forge-theme", next); } catch (_) { /* Storage is optional. */ }
      if (typeof afterChange === "function") afterChange(next);
    }, "theme-swap");
  }

  window.ForgeMotion = { toggleTheme };

  // Pages using the shared header mark their theme button with
  // data-forge-theme and get the toggle without any page script.
  function initThemeButton() {
    document.querySelectorAll("[data-forge-theme]").forEach(button => {
      button.addEventListener("click", () => toggleTheme());
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initThemeButton);
  else initThemeButton();
})();
