"use strict";

(() => {
  const preferred = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  let saved;
  try { saved = localStorage.getItem("ema-forge-theme"); } catch (_) { /* Storage is optional. */ }
  document.documentElement.dataset.theme = saved === "dark" || saved === "light" ? saved : preferred;
})();
