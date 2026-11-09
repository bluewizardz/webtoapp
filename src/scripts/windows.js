(function () {
  "use strict";

  const backendUrl = import.meta.env.PUBLIC_BACKEND_URL || window.location.origin;

  const els = {
    form: document.querySelector("#winForm"),
    url: document.querySelector("#winUrl"),
    name: document.querySelector("#winName"),
    version: document.querySelector("#winVersion"),
    appId: document.querySelector("#winAppId"),
    resetId: document.querySelector("#winResetId"),
    installer: document.querySelector("#winInstaller"),
    width: document.querySelector("#winWidth"),
    height: document.querySelector("#winHeight"),
    fullScreen: document.querySelector("#winFullScreen"),
    userAgent: document.querySelector("#winUserAgent"),
    icon: document.querySelector("#winIcon"),
    autoIcon: document.querySelector("#winAutoIcon"),
    removeIcon: document.querySelector("#winRemoveIcon"),
    iconPreview: document.querySelector("#winIconPreview"),
    iconPlaceholder: document.querySelector("#winIconPlaceholder"),
    iconSpinner: document.querySelector("#winIconSpinner"),
    advanced: document.querySelector("#winAdvanced"),
    badge: document.querySelector("#winBadge"),
    resetDefaults: document.querySelector("#winResetDefaults"),
    buildButton: document.querySelector("#winBuild"),
    progress: document.querySelector("#winProgress"),
    progressFill: document.querySelector("#winProgressFill"),
    progressText: document.querySelector("#winProgressText"),
    message: document.querySelector("#winMessage"),
    success: document.querySelector("#winSuccess"),
    retry: document.querySelector("#winRetry"),
    retryLink: document.querySelector("#winRetryLink"),
    frame: document.querySelector("#winFrame"),
    titleIcon: document.querySelector("#winTitleIcon"),
    titleName: document.querySelector("#winTitleName"),
    pageIcon: document.querySelector("#winPageIcon"),
    pageName: document.querySelector("#winPageName"),
    pageUrl: document.querySelector("#winPageUrl"),
    taskbarTile: document.querySelector("#winTaskbarTile"),
    modal: document.querySelector("#winModal"),
    modalClose: document.querySelector("#winModalClose"),
    modalDismiss: document.querySelector("#winModalDismiss")
  };

  const ADVANCED_KEY = "siteapp_windows_advanced";
  const OPEN_KEY = "siteapp_windows_open";

  const DEFAULTS = {
    appVersion: "1.0.0",
    installerType: "nsis",
    engine: "electron",
    windowWidth: 1200,
    windowHeight: 800,
    fullScreen: false,
    customUserAgent: ""
  };

  let nameEdited = false;
  let idEdited = false;
  let uploadedIcon = null;
  let fetchedIcon = null;
  let faviconTimer = null;
  let faviconToken = 0;
  let downloadUrl = "";
  let noticeReturnFocus = null;

  // === URL & naming ===

  function normalizeUrl(value) {
    let raw = String(value || "").trim();
    if (!raw) throw new Error("Website URL is required.");
    raw = raw.replace(/,/g, ".");
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw;
    const parsed = new URL(withScheme);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Use an http or https website URL.");
    }
    return parsed.toString();
  }

  function titleCase(value) {
    return String(value || "")
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function deriveName(urlValue) {
    try {
      const host = new URL(normalizeUrl(urlValue)).hostname.replace(/^www\./i, "");
      return titleCase(host.split(".")[0]) || "My Desktop App";
    } catch (error) {
      return "My Desktop App";
    }
  }

  function segment(value) {
    let out = String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "");
    if (!out) out = "app";
    if (!/^[a-z_]/.test(out)) out = "a" + out;
    return out.slice(0, 32);
  }

  function deriveAppId(urlValue, nameValue) {
    let parts = ["site", "local"];
    try {
      parts = new URL(normalizeUrl(urlValue)).hostname
        .split(".")
        .filter(Boolean)
        .reverse()
        .map(segment);
    } catch (error) {
      parts = ["site", "local"];
    }
    const all = parts.concat(segment(titleCase(nameValue).replace(/\s+/g, "")));
    if (all.length < 2) all.unshift("site");
    return all.join(".");
  }

  function normalizeAppId(value) {
    const parts = String(value || "")
      .split(".")
      .map(segment)
      .filter(Boolean);
    if (parts.length < 2) parts.unshift("site");
    return parts.join(".");
  }

  function normalizeVersion(value) {
    const version = String(value || DEFAULTS.appVersion).trim();
    return /^\d+\.\d+\.\d+([-.][a-z0-9.-]+)?$/i.test(version) ? version : DEFAULTS.appVersion;
  }

  function clamp(value, min, max, fallback) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  // === Build engine ===

  function getEngine() {
    const checked = document.querySelector('input[name="winEngine"]:checked');
    return checked && checked.value === "tauri" ? "tauri" : "electron";
  }

  function setEngine(value) {
    const wanted = value === "tauri" ? "tauri" : "electron";
    document.querySelectorAll('input[name="winEngine"]').forEach((radio) => {
      radio.checked = radio.value === wanted;
    });
  }

  // === Status helpers ===

  function setStatus(text, kind) {
    if (els.message) {
      els.message.textContent = kind === "error" ? text : "";
    }
  }

  function showProgress(text, percent) {
    if (!els.progress) return;
    els.progress.style.display = "block";
    els.progressText.textContent = text;
    els.progressFill.style.width = percent + "%";
  }

  function hideProgress() {
    if (!els.progress) return;
    els.progress.style.display = "none";
    els.progressFill.style.width = "0%";
  }

  function setLoading(loading) {
    if (!els.buildButton) return;
    els.buildButton.disabled = loading;
    els.buildButton.innerHTML = loading
      ? '<span class="spinner" aria-hidden="true"></span> Building installer…'
      : "Build Windows Installer";
  }

  // === Preview ===

  function effectiveIcon() {
    if (uploadedIcon) return uploadedIcon;
    if (els.autoIcon && els.autoIcon.checked) return fetchedIcon;
    return null;
  }

  function initialsFor(name) {
    const words = String(name || "App").trim().split(/\s+/);
    const initials = words.length > 1
      ? words[0][0] + words[1][0]
      : (words[0][0] || "A") + (words[0][1] || "");
    return initials.toUpperCase();
  }

  function paintIcon(element, name) {
    if (!element) return;
    const icon = effectiveIcon();
    if (icon) {
      element.innerHTML = "";
      const img = document.createElement("img");
      img.src = icon;
      img.alt = "";
      element.appendChild(img);
    } else {
      element.textContent = initialsFor(name);
    }
  }

  function updateIconPreview() {
    if (!els.iconPreview) return;
    const icon = effectiveIcon();
    if (els.iconSpinner) els.iconSpinner.style.display = "none";
    if (icon) {
      els.iconPreview.src = icon;
      els.iconPreview.style.display = "block";
      if (els.iconPlaceholder) els.iconPlaceholder.style.display = "none";
    } else {
      els.iconPreview.removeAttribute("src");
      els.iconPreview.style.display = "none";
      if (els.iconPlaceholder) els.iconPlaceholder.style.display = "grid";
    }
    if (els.removeIcon) {
      els.removeIcon.style.display = uploadedIcon ? "inline-flex" : "none";
    }
  }

  function updatePreview() {
    const hasUrl = String(els.url.value || "").trim().length > 0;

    if (!nameEdited) {
      els.name.value = hasUrl ? deriveName(els.url.value) : "";
    }
    if (!idEdited) {
      els.appId.value = hasUrl ? deriveAppId(els.url.value, els.name.value) : "";
    }

    const displayName = String(els.name.value || "").trim() || "My Desktop App";
    const displayUrl = String(els.url.value || "").trim() || "https://example.com";
    els.titleName.textContent = displayName;
    els.pageName.textContent = displayName;
    els.pageUrl.textContent = displayUrl;

    paintIcon(els.titleIcon, displayName);
    paintIcon(els.pageIcon, displayName);
    paintIcon(els.taskbarTile, displayName);

    if (els.frame) {
      els.frame.classList.toggle("is-fullscreen", !!(els.fullScreen && els.fullScreen.checked));
    }

    updateIconPreview();

    if (hasUrl) {
      try {
        normalizeUrl(els.url.value);
        setStatus("Ready");
      } catch (error) {
        setStatus(error.message, "error");
      }
    } else {
      setStatus("Ready");
    }

    updateBadge();
  }

  // === Favicon ===

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("favicon-unavailable"));
      img.src = src;
    });
  }

  async function refreshFavicon() {
    if (uploadedIcon || !els.autoIcon || !els.autoIcon.checked) return;
    let url;
    try {
      url = normalizeUrl(els.url.value);
    } catch (error) {
      return;
    }

    const token = ++faviconToken;
    if (els.iconSpinner) els.iconSpinner.style.display = "block";

    try {
      const img = await loadImage(
        `${backendUrl}/api/favicon?url=${encodeURIComponent(url)}`
      );
      if (token !== faviconToken) return;
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas-unavailable");
      ctx.drawImage(img, 0, 0, 256, 256);
      fetchedIcon = canvas.toDataURL("image/png");
    } catch (error) {
      if (token === faviconToken) fetchedIcon = null;
    }

    if (token === faviconToken) updatePreview();
  }

  function scheduleFavicon() {
    if (faviconTimer) clearTimeout(faviconTimer);
    faviconTimer = setTimeout(refreshFavicon, 500);
  }

  // === Advanced state ===

  function getAdvancedState() {
    return {
      appVersion: els.version.value,
      installerType: els.installer.value,
      engine: getEngine(),
      windowWidth: clamp(els.width.value, 800, 3840, DEFAULTS.windowWidth),
      windowHeight: clamp(els.height.value, 600, 2160, DEFAULTS.windowHeight),
      fullScreen: els.fullScreen.checked,
      customUserAgent: els.userAgent.value
    };
  }

  function applyAdvancedState(state) {
    if (!state) return;
    if (typeof state.appVersion === "string" && state.appVersion) els.version.value = state.appVersion;
    if (state.installerType === "portable" || state.installerType === "nsis") {
      els.installer.value = state.installerType;
    }
    if (state.engine === "tauri" || state.engine === "electron") {
      setEngine(state.engine);
    }
    els.width.value = clamp(state.windowWidth, 800, 3840, DEFAULTS.windowWidth);
    els.height.value = clamp(state.windowHeight, 600, 2160, DEFAULTS.windowHeight);
    if (typeof state.fullScreen === "boolean") els.fullScreen.checked = state.fullScreen;
    if (typeof state.customUserAgent === "string") els.userAgent.value = state.customUserAgent;
  }

  function countCustomOptions() {
    const state = getAdvancedState();
    let count = 0;
    if (normalizeVersion(state.appVersion) !== DEFAULTS.appVersion) count += 1;
    if (state.installerType !== DEFAULTS.installerType) count += 1;
    if (state.engine !== DEFAULTS.engine) count += 1;
    if (state.windowWidth !== DEFAULTS.windowWidth) count += 1;
    if (state.windowHeight !== DEFAULTS.windowHeight) count += 1;
    if (state.fullScreen !== DEFAULTS.fullScreen) count += 1;
    if (String(state.customUserAgent || "").trim() !== DEFAULTS.customUserAgent) count += 1;
    return count;
  }

  function updateBadge() {
    if (!els.badge) return;
    const count = countCustomOptions();
    els.badge.hidden = count === 0;
    els.badge.textContent = count > 0 ? count + " custom" : "";
  }

  function persistAdvanced() {
    try {
      localStorage.setItem(ADVANCED_KEY, JSON.stringify(getAdvancedState()));
      localStorage.setItem(OPEN_KEY, els.advanced && els.advanced.open ? "1" : "0");
    } catch (error) {
      /* storage unavailable */
    }
  }

  function restoreAdvanced() {
    try {
      const raw = localStorage.getItem(ADVANCED_KEY);
      if (raw) applyAdvancedState(JSON.parse(raw));
      if (els.advanced) els.advanced.open = localStorage.getItem(OPEN_KEY) === "1";
    } catch (error) {
      /* ignore corrupt storage */
    }
  }

  function resetAdvancedDefaults() {
    els.version.value = DEFAULTS.appVersion;
    els.installer.value = DEFAULTS.installerType;
    setEngine(DEFAULTS.engine);
    els.width.value = DEFAULTS.windowWidth;
    els.height.value = DEFAULTS.windowHeight;
    els.fullScreen.checked = DEFAULTS.fullScreen;
    els.userAgent.value = DEFAULTS.customUserAgent;
    uploadedIcon = null;
    els.icon.value = "";
    if (els.autoIcon) els.autoIcon.checked = true;
    idEdited = false;
    updatePreview();
    scheduleFavicon();
    persistAdvanced();
  }

  // === SmartScreen modal ===

  function showNotice() {
    if (!els.modal || !els.modal.hidden) return;
    noticeReturnFocus = document.activeElement;
    els.modal.hidden = false;
    document.body.classList.add("modal-open");
    if (els.modalClose) els.modalClose.focus();
  }

  function hideNotice() {
    if (!els.modal || els.modal.hidden) return;
    els.modal.hidden = true;
    document.body.classList.remove("modal-open");
    if (noticeReturnFocus && typeof noticeReturnFocus.focus === "function") {
      noticeReturnFocus.focus();
    }
    noticeReturnFocus = null;
  }

  // === Build ===

  function readConfig() {
    const url = normalizeUrl(els.url.value);
    const name = String(els.name.value || "").trim() || deriveName(url);
    return {
      siteUrl: url,
      appName: name,
      appId: normalizeAppId(els.appId.value || deriveAppId(url, name)),
      appVersion: normalizeVersion(els.version.value),
      installerType: els.installer.value === "portable" ? "portable" : "nsis",
      engine: getEngine(),
      windowWidth: clamp(els.width.value, 800, 3840, DEFAULTS.windowWidth),
      windowHeight: clamp(els.height.value, 600, 2160, DEFAULTS.windowHeight),
      fullScreen: !!els.fullScreen.checked,
      customUserAgent: String(els.userAgent.value || "").trim(),
      icon: effectiveIcon()
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function pollBuild(buildId) {
    const maxAttempts = 300;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await fetch(`${backendUrl}/api/exe/${buildId}`);
      const status = await response.json();

      if (status.status === "completed") {
        startDownload(buildId);
        return;
      }
      if (status.status === "error") {
        throw new Error(status.error || "Windows build failed.");
      }

      const waited = Math.round((attempt * 3));
      showProgress(
        `Compiling installer on the Windows runner… ${waited}s`,
        Math.min(15 + attempt * 1.2, 92)
      );
      await sleep(3000);
    }

    throw new Error("Build timed out. Please try again.");
  }

  function startDownload(buildId) {
    downloadUrl = `${backendUrl}/api/exe/download/${buildId}`;

    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showProgress("Installer compiled. Download started.", 100);
    setStatus("Build complete!");
    if (els.success) els.success.style.display = "flex";
    if (els.retry) els.retry.style.display = "block";
    if (els.retryLink) els.retryLink.href = downloadUrl;

    showNotice();
  }

  async function runBuild(config) {
    try {
      setLoading(true);
      showProgress("Queuing Windows build…", 10);
      if (els.success) els.success.style.display = "none";
      if (els.retry) els.retry.style.display = "none";

      const response = await fetch(`${backendUrl}/api/build/exe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Could not start the Windows build.");
      }

      const { buildId } = await response.json();
      showProgress("Provisioning Windows runner…", 15);
      await pollBuild(buildId);
    } catch (error) {
      hideProgress();
      setStatus(error.message, "error");
    } finally {
      setLoading(false);
    }
  }

  // === Listeners ===

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const config = readConfig();
      runBuild(config);
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  els.url.addEventListener("input", () => {
    updatePreview();
    scheduleFavicon();
  });
  els.url.addEventListener("change", updatePreview);

  els.name.addEventListener("input", () => {
    nameEdited = true;
    updatePreview();
  });
  els.name.addEventListener("change", () => {
    if (!String(els.name.value || "").trim()) {
      nameEdited = false;
      updatePreview();
    }
  });

  els.appId.addEventListener("input", () => {
    idEdited = true;
  });

  els.resetId.addEventListener("click", () => {
    idEdited = false;
    els.appId.value = deriveAppId(els.url.value, els.name.value);
    updatePreview();
  });

  els.icon.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      uploadedIcon = null;
      updatePreview();
      return;
    }
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      uploadedIcon = loadEvent.target.result;
      updatePreview();
    };
    reader.readAsDataURL(file);
  });

  els.removeIcon.addEventListener("click", () => {
    uploadedIcon = null;
    els.icon.value = "";
    updatePreview();
    scheduleFavicon();
  });

  if (els.autoIcon) {
    els.autoIcon.addEventListener("change", () => {
      updatePreview();
      if (els.autoIcon.checked && !fetchedIcon) scheduleFavicon();
    });
  }

  els.resetDefaults.addEventListener("click", resetAdvancedDefaults);

  [els.installer, els.width, els.height, els.fullScreen, els.userAgent, els.version].forEach((el) => {
    el.addEventListener("input", () => {
      updatePreview();
      persistAdvanced();
    });
    el.addEventListener("change", () => {
      updatePreview();
      persistAdvanced();
    });
  });

  document.querySelectorAll('input[name="winEngine"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      updatePreview();
      persistAdvanced();
    });
  });

  if (els.advanced) {
    els.advanced.addEventListener("toggle", persistAdvanced);
  }

  [els.modalClose, els.modalDismiss].forEach((button) => {
    if (button) button.addEventListener("click", hideNotice);
  });

  if (els.modal) {
    els.modal.addEventListener("click", (event) => {
      if (event.target === els.modal) hideNotice();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !els.modal.hidden) hideNotice();
    });
  }

  // === Init ===

  els.url.value = "";
  els.name.value = "";
  restoreAdvanced();
  updatePreview();
})();
