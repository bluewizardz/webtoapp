// Theme initialization (runs immediately to prevent flash of unstyled content)
(function () {
  "use strict";
  let savedTheme = null;
  try {
    savedTheme = localStorage.getItem("theme");
  } catch (error) {
    // Storage blocked (private mode / disabled cookies): fall back to system preference.
  }
  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (savedTheme === "light" || (!savedTheme && !systemPrefersDark)) {
    document.documentElement.classList.add("light-theme");
  } else {
    document.documentElement.classList.remove("light-theme");
  }
})();

// Theme toggle event handler (runs after DOM is ready)
document.addEventListener("DOMContentLoaded", () => {
  const toggleBtn = document.getElementById("themeToggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const isLight = document.documentElement.classList.contains("light-theme");
      const next = isLight ? "dark" : "light";
      document.documentElement.classList.toggle("light-theme", !isLight);
      try {
        localStorage.setItem("theme", next);
      } catch (error) {
        /* storage blocked — the toggle still works for this session */
      }
    });
  }
});
