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
    installerControl: document.querySelector("#winInstallerControl"),
    installerTrigger: document.querySelector("#winInstallerTrigger"),
    installerValue: document.querySelector("#winInstallerValue"),
    installerListbox: document.querySelector("#winInstallerListbox"),
    installerOptions: document.querySelectorAll("#winInstallerListbox [data-installer-value]"),
    width: document.querySelector("#winWidth"),
    height: document.querySelector("#winHeight"),
    resetSize: document.querySelector("#winResetSize"),
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
    buildHistory: document.querySelector("#winBuildHistory"),
    historyList: document.querySelector("#winHistoryList"),
    clearHistory: document.querySelector("#winClearHistory"),
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

  const OPEN_KEY = "siteapp_windows_open";
  const HISTORY_KEY = "siteapp_windows_build_history";
  const LAST_BUILD_KEY = "siteapp_windows_last_successful_build";
  const MAX_HISTORY = 5;

  const DEFAULTS = {
    appVersion: "1.0.0",
    installerType: "nsis",
    engine: "tauri",
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
  let activeInstallerIndex = 0;
  let buildInProgress = false;
  let lastSuccessfulBuildFingerprint = null;

  try {
    lastSuccessfulBuildFingerprint = localStorage.getItem(LAST_BUILD_KEY);
  } catch {}

  function syncInstallerDropdown() {
    if (!els.installer || !els.installerValue) return;
    const selectedOption = Array.from(els.installer.options).find((option) => option.value === els.installer.value);
    if (selectedOption) els.installerValue.textContent = selectedOption.textContent.trim();
    els.installerOptions.forEach((option) => {
      option.setAttribute("aria-selected", String(option.dataset.installerValue === els.installer.value));
    });
  }

  function setActiveInstallerOption(index) {
    const options = Array.from(els.installerOptions);
    if (!options.length || !els.installerTrigger) return;
    activeInstallerIndex = Math.max(0, Math.min(index, options.length - 1));
    options.forEach((option) => delete option.dataset.active);
    const activeOption = options[activeInstallerIndex];
    activeOption.dataset.active = "true";
    els.installerTrigger.setAttribute("aria-activedescendant", activeOption.id);
    activeOption.scrollIntoView({ block: "nearest" });
  }

  function closeInstallerDropdown() {
    if (!els.installerListbox || !els.installerTrigger) return;
    els.installerListbox.hidden = true;
    els.installerTrigger.setAttribute("aria-expanded", "false");
    els.installerTrigger.removeAttribute("aria-activedescendant");
    els.installerOptions.forEach((option) => delete option.dataset.active);
  }

  function openInstallerDropdown() {
    if (!els.installer || !els.installerListbox || !els.installerTrigger) return;
    els.installerListbox.hidden = false;
    els.installerTrigger.setAttribute("aria-expanded", "true");
    const selectedIndex = Array.from(els.installerOptions).findIndex((option) => option.dataset.installerValue === els.installer.value);
    setActiveInstallerOption(selectedIndex < 0 ? 0 : selectedIndex);
  }

  function chooseInstallerOption(index) {
    const option = Array.from(els.installerOptions)[index];
    if (!option || !els.installer) return;
    els.installer.value = option.dataset.installerValue;
    els.installer.dispatchEvent(new Event("change", { bubbles: true }));
    closeInstallerDropdown();
    els.installerTrigger.focus();
  }

  function initInstallerDropdown() {
    if (!els.installer || !els.installerControl || !els.installerTrigger || !els.installerListbox) return;
    els.installerControl.classList.add("is-enhanced");
    els.installer.tabIndex = -1;
    els.installer.setAttribute("aria-hidden", "true");
    els.installerTrigger.hidden = false;
    syncInstallerDropdown();

    els.installer.addEventListener("change", syncInstallerDropdown);
    els.installerTrigger.addEventListener("click", () => {
      if (els.installerListbox.hidden) openInstallerDropdown();
      else closeInstallerDropdown();
    });
    els.installerTrigger.addEventListener("keydown", (event) => {
      const options = Array.from(els.installerOptions);
      const isOpen = !els.installerListbox.hidden;

      if (event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        closeInstallerDropdown();
        return;
      }
      if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        openInstallerDropdown();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!isOpen) openInstallerDropdown();
        else setActiveInstallerOption(activeInstallerIndex + (event.key === "ArrowDown" ? 1 : -1));
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        if (!isOpen) openInstallerDropdown();
        setActiveInstallerOption(event.key === "Home" ? 0 : options.length - 1);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (!isOpen) openInstallerDropdown();
        else chooseInstallerOption(activeInstallerIndex);
        return;
      }
      if (event.key === "Escape" && isOpen) {
        event.preventDefault();
        closeInstallerDropdown();
        return;
      }
      if (event.key === "Tab") {
        closeInstallerDropdown();
        return;
      }
      if (event.key.length === 1 && /^[a-z0-9]$/i.test(event.key)) {
        const index = options.findIndex((option) => option.textContent.trim().toLowerCase().startsWith(event.key.toLowerCase()));
        if (index >= 0) {
          event.preventDefault();
          chooseInstallerOption(index);
        }
      }
    });

    els.installerOptions.forEach((option, index) => {
      option.addEventListener("pointermove", () => setActiveInstallerOption(index));
      option.addEventListener("click", () => chooseInstallerOption(index));
    });
    document.addEventListener("pointerdown", (event) => {
      if (!els.installerControl.contains(event.target)) closeInstallerDropdown();
    });
  }

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

  function getCurrentConfig() {
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

  function fingerprintConfig(config) {
    const value = JSON.stringify(config);
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    }
    return value.length + "-" + (hash >>> 0).toString(36);
  }

  function updateBuildButtonState() {
    if (!els.buildButton) return;
    let unchangedSinceBuild = false;
    if (lastSuccessfulBuildFingerprint) {
      try {
        unchangedSinceBuild = fingerprintConfig(getCurrentConfig()) === lastSuccessfulBuildFingerprint;
      } catch {}
    }
    els.buildButton.disabled = buildInProgress || unchangedSinceBuild;
  }

  function loadHistory() {
    try {
      const history = JSON.parse(localStorage.getItem(HISTORY_KEY));
      return Array.isArray(history) ? history : [];
    } catch {
      return [];
    }
  }

  function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = String(value || "");
    return element.innerHTML;
  }

  function timeAgo(dateString) {
    const elapsedMinutes = Math.floor((Date.now() - new Date(dateString).getTime()) / 60000);
    if (!Number.isFinite(elapsedMinutes) || elapsedMinutes < 1) return "Just now";
    if (elapsedMinutes < 60) return elapsedMinutes + "m ago";
    const hours = Math.floor(elapsedMinutes / 60);
    if (hours < 24) return hours + "h ago";
    return Math.floor(hours / 24) + "d ago";
  }

  function renderHistory() {
    if (!els.buildHistory || !els.historyList) return;
    const history = loadHistory();
    if (history.length === 0) {
      els.buildHistory.style.display = "none";
      return;
    }
    els.buildHistory.style.display = "block";
    els.historyList.innerHTML = history.map((item) => {
      const engine = item.engine === "tauri" ? "Tauri" : "Electron";
      const installer = item.installerType === "portable" ? "Portable" : "Installer";
      const href = `${backendUrl}/api/exe/download/${encodeURIComponent(item.buildId)}`;
      return '<li class="history-item">' +
        '<div class="history-item-info">' +
          '<span class="history-item-name">' + escapeHtml(item.name) + '</span>' +
          '<span class="history-item-meta">' +
            '<span>' + escapeHtml(item.appId) + '</span>' +
            '<span class="history-item-dot"></span>' +
            '<span>' + engine + ' · ' + installer + '</span>' +
            '<span class="history-item-dot"></span>' +
            '<span>' + timeAgo(item.date) + '</span>' +
          '</span>' +
        '</div>' +
        '<a href="' + escapeHtml(href) + '" download class="history-item-download">Download</a>' +
      '</li>';
    }).join("");
  }

  function addToHistory(config, buildId) {
    const history = loadHistory();
    history.unshift({
      buildId,
      name: config.appName,
      appId: config.appId,
      engine: config.engine,
      installerType: config.installerType,
      date: new Date().toISOString()
    });
    lastSuccessfulBuildFingerprint = fingerprintConfig(config);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
    } catch {}
    try {
      localStorage.setItem(LAST_BUILD_KEY, lastSuccessfulBuildFingerprint);
    } catch {}
    updateBuildButtonState();
    renderHistory();
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
    buildInProgress = loading;
    els.buildButton.innerHTML = loading
      ? '<span class="spinner" aria-hidden="true"></span> Building installer…'
      : '<svg class="ui-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4"/><path d="M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg> Build Windows Installer';
    updateBuildButtonState();
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

  function updateIconUploadState(hasUploadedIcon = !!uploadedIcon) {
    if (!els.autoIcon) return;
    els.autoIcon.disabled = hasUploadedIcon;
    const label = els.autoIcon.closest(".icon-fetch-label");
    if (label) label.classList.toggle("disabled", hasUploadedIcon);
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
      img.crossOrigin = "anonymous";
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

    if (token === faviconToken) {
      updatePreview();
      updateBuildButtonState();
    }
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

  function countCustomOptions() {
    const state = getAdvancedState();
    let count = 0;
    if (normalizeVersion(state.appVersion) !== DEFAULTS.appVersion) count += 1;
    if (state.installerType !== DEFAULTS.installerType) count += 1;
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
      localStorage.setItem(OPEN_KEY, els.advanced && els.advanced.open ? "1" : "0");
    } catch (error) {
      /* storage unavailable */
    }
  }

  function restoreAdvanced() {
    try {
      localStorage.removeItem("siteapp_windows_advanced");
      if (els.advanced) els.advanced.open = localStorage.getItem(OPEN_KEY) === "1";
    } catch (error) {
      /* ignore corrupt storage */
    }
  }

  function resetAdvancedDefaults() {
    els.version.value = DEFAULTS.appVersion;
    els.installer.value = DEFAULTS.installerType;
    syncInstallerDropdown();
    setEngine(DEFAULTS.engine);
    els.width.value = DEFAULTS.windowWidth;
    els.height.value = DEFAULTS.windowHeight;
    els.fullScreen.checked = DEFAULTS.fullScreen;
    els.userAgent.value = DEFAULTS.customUserAgent;
    uploadedIcon = null;
    els.icon.value = "";
    if (els.autoIcon) els.autoIcon.checked = true;
    updateIconUploadState();
    idEdited = false;
    updatePreview();
    scheduleFavicon();
    persistAdvanced();
    updateBuildButtonState();
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

  async function readConfig() {
    if (!uploadedIcon && els.autoIcon && els.autoIcon.checked && !fetchedIcon) {
      if (faviconTimer) clearTimeout(faviconTimer);
      faviconTimer = null;
      await refreshFavicon();
    }

    return getCurrentConfig();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function pollBuild(buildId, config) {
    const maxAttempts = 300;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await fetch(`${backendUrl}/api/exe/${buildId}`);
      const status = await response.json();

      if (status.status === "completed") {
        startDownload(buildId, config);
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

  function startDownload(buildId, config) {
    downloadUrl = `${backendUrl}/api/exe/download/${buildId}`;

    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showProgress("Installer compiled. Download started.", 100);
    setStatus("Build complete");
    if (els.success) els.success.style.display = "flex";
    if (els.retry) els.retry.style.display = "block";
    if (els.retryLink) els.retryLink.href = downloadUrl;

    addToHistory(config, buildId);

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
      await pollBuild(buildId, config);
    } catch (error) {
      hideProgress();
      setStatus(error.message, "error");
    } finally {
      setLoading(false);
    }
  }

  // === Listeners ===

  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const config = await readConfig();
      runBuild(config);
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  ["input", "change"].forEach((eventName) => {
    els.form.addEventListener(eventName, updateBuildButtonState);
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
    updateBuildButtonState();
  });

  els.icon.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      uploadedIcon = null;
      updateIconUploadState();
      updatePreview();
      updateBuildButtonState();
      return;
    }
    updateIconUploadState(true);
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      uploadedIcon = loadEvent.target.result;
      updateIconUploadState();
      updatePreview();
      updateBuildButtonState();
    };
    reader.readAsDataURL(file);
  });

  els.removeIcon.addEventListener("click", () => {
    uploadedIcon = null;
    els.icon.value = "";
    updateIconUploadState();
    updatePreview();
    updateBuildButtonState();
    scheduleFavicon();
  });

  if (els.autoIcon) {
    els.autoIcon.addEventListener("change", () => {
      updatePreview();
      if (els.autoIcon.checked && !fetchedIcon) scheduleFavicon();
    });
  }

  els.resetDefaults.addEventListener("click", resetAdvancedDefaults);

  els.resetSize.addEventListener("click", () => {
    els.width.value = DEFAULTS.windowWidth;
    els.height.value = DEFAULTS.windowHeight;
    updatePreview();
    persistAdvanced();
    updateBuildButtonState();
  });

  if (els.clearHistory) {
    els.clearHistory.addEventListener("click", () => {
      try {
        localStorage.removeItem(HISTORY_KEY);
      } catch {}
      renderHistory();
    });
  }

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
  initInstallerDropdown();
  updatePreview();
  renderHistory();
  updateBuildButtonState();
})();
