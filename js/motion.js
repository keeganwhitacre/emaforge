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

  function initMobileNavigation() {
    const nav = document.querySelector(".forge-header .forge-nav");
    if (!nav) return;

    nav.id = "forge-site-navigation";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "forge-header-link forge-nav-toggle";
    toggle.textContent = "Menu";
    toggle.setAttribute("aria-controls", nav.id);
    toggle.setAttribute("aria-expanded", "false");
    nav.before(toggle);

    function setOpen(open) {
      nav.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
    }
    toggle.addEventListener("click", () => setOpen(!nav.classList.contains("is-open")));
    document.addEventListener("click", event => {
      if (!nav.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && nav.classList.contains("is-open")) {
        setOpen(false);
        toggle.focus();
      }
    });
    nav.parentElement.addEventListener("focusout", event => {
      if (event.relatedTarget !== toggle && !nav.contains(event.relatedTarget)) setOpen(false);
    });
    matchMedia("(max-width: 760px)").addEventListener("change", () => setOpen(false));
  }

  function init() {
    initThemeButton();
    initMobileNavigation();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
