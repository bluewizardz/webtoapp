(function () {
  "use strict";

  const backendUrl = import.meta.env.PUBLIC_BACKEND_URL || window.location.origin;

  // === DOM Elements ===
  const els = {
    form: document.querySelector("#generatorForm"),
    siteUrl: document.querySelector("#siteUrl"),
    appName: document.querySelector("#appName"),
    appVersion: document.querySelector("#appVersion"),
    appId: document.querySelector("#appId"),
    resetIdButton: document.querySelector("#resetIdButton"),
    sampleButton: document.querySelector("#sampleButton"),
    validationMessage: document.querySelector("#validationMessage"),
    statusPill: document.querySelector("#statusPill"),
    previewInitials: document.querySelector("#previewInitials"),
    previewName: document.querySelector("#previewName"),
    previewUrl: document.querySelector("#previewUrl"),
    splashName: document.querySelector("#splashName"),
    splashIconImage: document.querySelector("#splashIconImage"),
    previewPlay: document.querySelector("#androidPreviewPlay"),
    previewStatus: document.querySelector("#androidPreviewStatus"),
    outputAppName: document.querySelector("#outputAppName"),
    outputAppId: document.querySelector("#outputAppId"),
    artifactSummary: document.querySelector("#artifactSummary"),
    downloadButton: document.querySelector("#downloadButton"),
    appIcon: document.querySelector("#appIcon"),
    showSpinner: document.querySelector("#showSpinner"),
    pullToRefresh: document.querySelector("#pullToRefresh"),
    allowZoom: document.querySelector("#allowZoom"),
    showSplash: document.querySelector("#showSplash"),
    splashDurationField: document.querySelector("#splashDurationField"),
    splashDuration: document.querySelector("#splashDuration"),
    fullScreen: document.querySelector("#fullScreen"),
    customUserAgent: document.querySelector("#customUserAgent"),
    advancedPanel: document.querySelector("#advancedPanel"),
    advancedBadge: document.querySelector("#advancedBadge"),
    resetDefaultsButton: document.querySelector("#resetDefaultsButton"),
    
    // Progress Bar
    buildProgress: document.querySelector("#buildProgress"),
    progressText: document.querySelector("#progressText"),
    progressFill: document.querySelector("#progressFill"),

    // Build Success & Retry
    buildSuccess: document.querySelector("#buildSuccess"),
    buildRetry: document.querySelector("#buildRetry"),
    retryDownloadLink: document.querySelector("#retryDownloadLink"),

    // Play Protect Notice Popup
    playProtectModal: document.querySelector("#playProtectModal"),
    playProtectClose: document.querySelector("#playProtectClose"),
    playProtectDismiss: document.querySelector("#playProtectDismiss"),

    // Build History
    buildHistory: document.querySelector("#buildHistory"),
    historyList: document.querySelector("#historyList"),
    clearHistoryBtn: document.querySelector("#clearHistoryBtn"),

    // Icon Remove
    removeIconButton: document.querySelector("#removeIconButton"),

    // Phone Preview
    phoneScreen: document.querySelector("#phoneScreen"),
    screenProgress: document.querySelector("#screenProgress"),
    screenSplash: document.querySelector("#screenSplash"),
    splashInitials: document.querySelector("#splashInitials"),
    phoneNavBar: document.querySelector("#phoneNavBar"),
    phoneStatusBar: document.querySelector("#phoneStatusBar"),
    screenPullRefresh: document.querySelector("#screenPullRefresh"),
    androidSample: document.querySelector(".android-sample"),
    sampleLogo: document.querySelector("#sampleLogo"),
    sampleBrand: document.querySelector("#sampleBrand"),
    sampleHeading: document.querySelector("#sampleHeading"),
    sampleUrl: document.querySelector("#sampleUrl"),

    // Icon Fetching & Previews
    autoFetchIcon: document.querySelector("#autoFetchIcon"),
    iconPreview: document.querySelector("#iconPreview"),
    iconPreviewPlaceholder: document.querySelector("#iconPreviewPlaceholder"),
    iconPreviewSpinner: document.querySelector("#iconPreviewSpinner"),
    previewIcon: document.querySelector("#previewIcon")
  };

  let packageWasEdited = false;
  let nameWasEdited = false;
  let base64Icon = null;
  let iconUploadToken = 0;
  let iconProcessing = false;
  const MAX_ICON_DATA_URL_LENGTH = 48 * 1024;

  const javaKeywords = new Set([
    "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
    "class", "const", "continue", "default", "do", "double", "else", "enum",
    "extends", "final", "finally", "float", "for", "goto", "if", "implements",
    "import", "instanceof", "int", "interface", "long", "native", "new",
    "package", "private", "protected", "public", "return", "short", "static",
    "strictfp", "super", "switch", "synchronized", "this", "throw", "throws",
    "transient", "try", "void", "volatile", "while"
  ]);

  // === URL & String Utilities ===

  function normalizeUrl(value) {
    let raw = String(value || "").trim();
    if (!raw) {
      throw new Error("Website URL is required.");
    }
    // Correct common keyboard typos where commas are entered instead of dots (e.g., anwin,pages,dev)
    raw = raw.replace(/,/g, ".");

    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw;
    const parsed = new URL(withScheme);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Use an http or https website URL.");
    }
    parsed.hash = parsed.hash || "";
    return parsed.toString();
  }

  function titleCaseFromSlug(slug) {
    return slug
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function slugify(value, fallback) {
    const slug = String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 56);
    return slug || fallback;
  }

  function packageSegment(value) {
    let segment = String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "");
    if (!segment) {
      segment = "app";
    }
    if (!/^[a-z_]/.test(segment)) {
      segment = "a" + segment;
    }
    if (javaKeywords.has(segment)) {
      segment = segment + "app";
    }
    return segment.slice(0, 32);
  }

  function derivePackageId(urlValue, nameValue) {
    let hostParts = ["site", "local"];
    try {
      hostParts = new URL(normalizeUrl(urlValue)).hostname
        .split(".")
        .filter(Boolean)
        .reverse()
        .map(packageSegment)
        .filter(Boolean);
    } catch (error) {
      hostParts = ["site", "local"];
    }
    const appPart = packageSegment(slugify(nameValue, "app"));
    const parts = [...hostParts, appPart].filter(Boolean);
    if (parts.length < 2) {
      parts.unshift("site");
    }
    return parts.join(".");
  }

  function normalizePackageId(value) {
    const parts = String(value || "")
      .split(".")
      .map(packageSegment)
      .filter(Boolean);
    if (parts.length < 2) {
      parts.unshift("site");
    }
    return parts.join(".");
  }

  // Allow decimals and standard version formats
  function normalizeVersion(value) {
    const version = String(value || "1.0.0").trim();
    return /^\d+\.\d+\.\d+([-.][a-z0-9.-]+)?$/i.test(version) ? version : "1.0.0";
  }

  function deriveAppName(urlValue) {
    try {
      const hostname = new URL(normalizeUrl(urlValue)).hostname.replace(/^www\./i, "");
      return titleCaseFromSlug(slugify(hostname.split(".")[0], "site-app"));
    } catch (error) {
      return "Site App";
    }
  }

  function getAppConfig() {
    const url = normalizeUrl(els.siteUrl.value);
    const name = String(els.appName.value || "").trim() || deriveAppName(url);
    const version = normalizeVersion(els.appVersion.value);
    const appId = normalizePackageId(els.appId.value || derivePackageId(url, name));
    return {
      url,
      name,
      version,
      appId
    };
  }

  // === UI Helpers ===

  function setMessage(message, kind) {
    els.validationMessage.textContent = kind === "error" ? message : "";
    if (els.statusPill) {
      els.statusPill.textContent = message;
      els.statusPill.style.color = kind === "error" ? "#ff0000" : "#0070f3";
      els.statusPill.style.borderColor = kind === "error" ? "rgba(255, 0, 0, 0.3)" : "rgba(0, 112, 243, 0.3)";
    }
  }

  function showProgress(text, percent) {
    els.buildProgress.style.display = "block";
    els.progressText.textContent = text;
    els.progressFill.style.width = percent + "%";
  }

  function hideProgress() {
    els.buildProgress.style.display = "none";
    els.progressFill.style.width = "0%";
  }

  function showBuildSuccess(downloadUrl, filename) {
    if (els.buildSuccess) {
      els.buildSuccess.style.display = "flex";
    }
    if (els.buildRetry && els.retryDownloadLink) {
      els.buildRetry.style.display = "block";
      els.retryDownloadLink.href = downloadUrl;
      els.retryDownloadLink.download = filename || "app.apk";
    }
  }

  function hideBuildSuccess() {
    if (els.buildSuccess) {
      els.buildSuccess.style.display = "none";
    }
    if (els.buildRetry) {
      els.buildRetry.style.display = "none";
    }
  }

  // === Play Protect Notice ===
  //
  // Shown as a popup the moment an APK download starts, so the warning is
  // visible exactly when it matters (before installing the file).

  let noticeReturnFocus = null;

  function showPlayProtectNotice() {
    if (!els.playProtectModal || !els.playProtectModal.hidden) return;
    noticeReturnFocus = document.activeElement;
    els.playProtectModal.hidden = false;
    document.body.classList.add("modal-open");
    if (els.playProtectClose) {
      els.playProtectClose.focus();
    }
  }

  function hidePlayProtectNotice() {
    if (!els.playProtectModal || els.playProtectModal.hidden) return;
    els.playProtectModal.hidden = true;
    document.body.classList.remove("modal-open");
    if (noticeReturnFocus && typeof noticeReturnFocus.focus === "function") {
      noticeReturnFocus.focus();
    }
    noticeReturnFocus = null;
  }

  // === Build History ===

  const HISTORY_KEY = "sitetapp_build_history";
  const LAST_BUILD_KEY = "sitetapp_last_successful_build";
  const MAX_HISTORY = 5;
  let buildInProgress = false;
  let lastSuccessfulBuildFingerprint = null;

  try {
    lastSuccessfulBuildFingerprint = localStorage.getItem(LAST_BUILD_KEY);
  } catch {}

  function fingerprintConfig(config) {
    const value = JSON.stringify(config);
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    }
    return value.length + "-" + (hash >>> 0).toString(36);
  }

  function currentBuildRequest(app) {
    const config = app || getAppConfig();
    return {
      siteUrl: config.url,
      appName: config.name,
      appId: config.appId,
      appVersion: config.version,
      icon: base64Icon,
      autoFetchIcon: els.autoFetchIcon ? els.autoFetchIcon.checked : true,
      showSpinner: els.showSpinner.checked,
      pullToRefresh: els.pullToRefresh.checked,
      allowZoom: els.allowZoom.checked,
      showSplash: els.showSplash.checked,
      splashDuration: Math.min(10000, Math.max(500, parseInt(els.splashDuration.value, 10) || 2000)),
      fullScreen: els.fullScreen.checked,
      customUserAgent: els.customUserAgent.value
    };
  }

  function updateBuildButtonState() {
    if (!els.downloadButton) return;
    let unchangedSinceBuild = false;
    if (lastSuccessfulBuildFingerprint) {
      try {
        unchangedSinceBuild = fingerprintConfig(currentBuildRequest()) === lastSuccessfulBuildFingerprint;
      } catch {}
    }
    els.downloadButton.disabled = buildInProgress || iconProcessing || unchangedSinceBuild;
  }

  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveHistory(history) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {}
  }

  function addToHistory(entry) {
    const history = loadHistory();
    history.unshift(entry);
    saveHistory(history.slice(0, MAX_HISTORY));
    renderHistory();
  }

  function timeAgo(dateStr) {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffMs = now - then;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return mins + "m ago";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    const days = Math.floor(hrs / 24);
    return days + "d ago";
  }

  function renderHistory() {
    const history = loadHistory();
    if (!els.buildHistory || !els.historyList) return;

    if (history.length === 0) {
      els.buildHistory.style.display = "none";
      return;
    }

    els.buildHistory.style.display = "block";
    els.historyList.innerHTML = history
      .map(function (item) {
        return '<li class="history-item">' +
          '<div class="history-item-info">' +
            '<span class="history-item-name">' + escapeHtml(item.name) + '</span>' +
            '<span class="history-item-meta">' +
              '<span>' + escapeHtml(item.appId) + '</span>' +
              '<span class="history-item-dot"></span>' +
              '<span>' + timeAgo(item.date) + '</span>' +
            '</span>' +
          '</div>' +
          '<a href="' + escapeHtml(item.url) + '" download="' + escapeHtml(item.filename) + '" class="history-item-download">Download</a>' +
        '</li>';
      })
      .join("");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function setButtonLoading(loading) {
    buildInProgress = loading;
    if (loading) {
      els.downloadButton.innerHTML = '<span class="spinner" aria-hidden="true"></span> Building APK…';
    } else {
      els.downloadButton.innerHTML = '<svg class="ui-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4"/><path d="M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg> Build & Download APK';
    }
    updateBuildButtonState();
  }

  // === Icon Preview State ===
  //
  // The favicon is refetched shortly after the URL stops changing, and a request
  // token guarantees a slow response for an old URL can never overwrite the icon
  // for the URL that is currently in the field.

  const FAVICON_DEBOUNCE_MS = 450;
  let iconFetchTimer = null;
  let iconFetchToken = 0;
  let iconAppliedUrl = "";
  let iconScheduledUrl = "";

  function cancelPendingIconFetch() {
    if (iconFetchTimer) {
      clearTimeout(iconFetchTimer);
      iconFetchTimer = null;
    }
    iconFetchToken++;
  }

  function showPlaceholderIcon() {
    if (els.iconPreviewSpinner) {
      els.iconPreviewSpinner.style.display = "none";
    }
    if (els.iconPreview) {
      els.iconPreview.removeAttribute("src");
      els.iconPreview.style.display = "none";
    }
    if (els.iconPreviewPlaceholder) {
      els.iconPreviewPlaceholder.style.display = "grid";
    }
    if (els.previewIcon) {
      els.previewIcon.removeAttribute("src");
      els.previewIcon.style.display = "none";
    }
    if (els.previewInitials) {
      els.previewInitials.style.display = "grid";
    }
    iconAppliedUrl = "";
  }

  function showIconPending() {
    if (els.iconPreviewSpinner) {
      els.iconPreviewSpinner.style.display = "block";
    }
    if (els.iconPreview) {
      els.iconPreview.style.display = "none";
    }
    if (els.iconPreviewPlaceholder) {
      els.iconPreviewPlaceholder.style.display = "none";
    }
    if (els.previewIcon) {
      els.previewIcon.style.display = "none";
    }
    if (els.previewInitials) {
      els.previewInitials.style.display = "grid";
    }
  }

  function showUploadedIcon() {
    if (els.iconPreviewSpinner) {
      els.iconPreviewSpinner.style.display = "none";
    }
    if (els.iconPreview) {
      els.iconPreview.src = base64Icon;
      els.iconPreview.style.display = "block";
    }
    if (els.iconPreviewPlaceholder) {
      els.iconPreviewPlaceholder.style.display = "none";
    }
    if (els.previewIcon) {
      els.previewIcon.src = base64Icon;
      els.previewIcon.style.display = "block";
    }
    if (els.previewInitials) {
      els.previewInitials.style.display = "none";
    }
    iconAppliedUrl = "";
  }

  function showFetchedIcon(src) {
    if (els.iconPreviewSpinner) {
      els.iconPreviewSpinner.style.display = "none";
    }
    if (els.iconPreview) {
      els.iconPreview.src = src;
      els.iconPreview.style.display = "block";
    }
    if (els.iconPreviewPlaceholder) {
      els.iconPreviewPlaceholder.style.display = "none";
    }
    if (els.previewIcon) {
      els.previewIcon.src = src;
      els.previewIcon.style.display = "block";
    }
    if (els.previewInitials) {
      els.previewInitials.style.display = "none";
    }
  }

  function preloadImage(src) {
    return new Promise((resolve, reject) => {
      const probe = new Image();
      probe.onload = () => resolve(src);
      probe.onerror = () => reject(new Error("favicon-unavailable"));
      probe.src = src;
    });
  }

  function isFetchableHost(url) {
    try {
      const hostname = new URL(url).hostname;
      return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(hostname) && /\.[a-z]{2,}$/i.test(hostname);
    } catch (error) {
      return false;
    }
  }

  async function refreshFavicon(rawValue) {
    let url;
    try {
      url = normalizeUrl(rawValue);
    } catch (error) {
      showPlaceholderIcon();
      return;
    }

    if (!isFetchableHost(url)) {
      showPlaceholderIcon();
      return;
    }

    if (url === iconAppliedUrl) {
      return;
    }

    const token = ++iconFetchToken;
    const faviconUrl = `${backendUrl}/api/favicon?url=${encodeURIComponent(url)}`;

    try {
      await preloadImage(faviconUrl);
    } catch (error) {
      if (token === iconFetchToken) {
        showPlaceholderIcon();
      }
      return;
    }

    if (token !== iconFetchToken) {
      return;
    }

    iconAppliedUrl = url;
    showFetchedIcon(faviconUrl);
    updatePhonePreview();
  }

  function scheduleFaviconRefresh() {
    const rawValue = String(els.siteUrl.value || "").trim();

    if (!rawValue) {
      cancelPendingIconFetch();
      iconScheduledUrl = "";
      showPlaceholderIcon();
      return;
    }

    if (rawValue === iconScheduledUrl) {
      // The URL did not change (the app name or version was edited) — keep the icon.
      return;
    }

    iconScheduledUrl = rawValue;
    cancelPendingIconFetch();
    showIconPending();

    iconFetchTimer = setTimeout(() => {
      iconFetchTimer = null;
      refreshFavicon(rawValue);
    }, FAVICON_DEBOUNCE_MS);
  }

  function updatePreview() {
    const hasUrl = String(els.siteUrl.value || "").trim().length > 0;
    try {
      // The name is derived from the URL until the user types their own
      if (!nameWasEdited) {
        els.appName.value = hasUrl ? deriveAppName(els.siteUrl.value) : "";
      }
      if (!packageWasEdited) {
        els.appId.value = hasUrl ? derivePackageId(els.siteUrl.value, els.appName.value) : "";
      }
      const app = getAppConfig();
      if (els.previewName) els.previewName.textContent = app.name;
      if (els.previewUrl) els.previewUrl.textContent = app.url;
      if (els.outputAppName) els.outputAppName.textContent = app.name;
      if (els.outputAppId) els.outputAppId.textContent = app.appId;
      if (els.artifactSummary) els.artifactSummary.textContent = "Android APK";
      setMessage("Ready", "ok");
    } catch (error) {
      if (els.previewName) els.previewName.textContent = els.appName.value || "Site App";
      if (els.previewUrl) els.previewUrl.textContent = els.siteUrl.value || "https://example.com";
      setMessage(hasUrl ? error.message : "Ready", hasUrl ? "error" : "ok");
    }

    // Icon Preview Handling
    if (base64Icon) {
      cancelPendingIconFetch();
      iconScheduledUrl = "";
      showUploadedIcon();
    } else if (els.autoFetchIcon && els.autoFetchIcon.checked) {
      scheduleFaviconRefresh();
    } else {
      cancelPendingIconFetch();
      iconScheduledUrl = "";
      showPlaceholderIcon();
    }

    updatePhonePreview();
    updateAdvancedBadge();
  }

  // === Phone Preview ===

  function sampleDomain() {
    try {
      return new URL(normalizeUrl(els.siteUrl.value)).hostname.replace(/^www\./, "");
    } catch (error) {
      return "example.com";
    }
  }

  // Version and package name never show up in the mock UI, so the line under
  // the phone reports them live instead.
  function androidPreviewSummary() {
    const version = String(els.appVersion.value || "").trim() || "1.0.0";
    const appId = String(els.appId.value || "").trim();
    return "Preview · v" + version + (appId ? " · " + appId : "");
  }

  function updatePhonePreview() {
    const name = String(els.appName.value || "").trim() || "My Website";
    const iconSrc = els.iconPreview ? els.iconPreview.getAttribute("src") : null;

    // Sample page content follows the form
    if (els.sampleBrand) els.sampleBrand.textContent = name;
    if (els.sampleHeading) els.sampleHeading.textContent = "Welcome to " + name;
    if (els.sampleUrl) els.sampleUrl.textContent = sampleDomain();
    if (els.sampleLogo) {
      els.sampleLogo.classList.toggle("has-icon", !!iconSrc);
      els.sampleLogo.style.backgroundImage = iconSrc ? 'url("' + iconSrc + '")' : "";
    }

    // Splash screen uses the same icon
    if (els.splashName) els.splashName.textContent = name;
    if (els.splashIconImage) {
      els.splashIconImage.hidden = !iconSrc;
      els.splashIconImage.src = iconSrc || "";
      if (els.splashInitials) els.splashInitials.hidden = !!iconSrc;
    }

    // Full screen — hide status bar and nav bar
    const fullScreen = els.fullScreen && els.fullScreen.checked;
    if (els.phoneStatusBar) {
      els.phoneStatusBar.classList.toggle("hidden", fullScreen);
    }
    if (els.phoneNavBar) {
      els.phoneNavBar.classList.toggle("hidden", fullScreen);
    }

    if (els.previewStatus) els.previewStatus.textContent = androidPreviewSummary();
  }

  // === Preview playback ===
  // The phone plays itself: the progress line runs once, the page fades in,
  // then pull-to-refresh and zoom demonstrate themselves without interaction.

  const PREVIEW_PROGRESS_MS = 1000;
  const PREVIEW_FADE_MS = 240;
  const PREVIEW_PULL_MS = 900;
  const PREVIEW_ZOOM_MS = 1400;
  let previewTimers = [];

  function clearPreviewTimers() {
    previewTimers.forEach(function (id) {
      clearTimeout(id);
    });
    previewTimers = [];
  }

  function later(fn, ms) {
    previewTimers.push(setTimeout(fn, ms));
  }

  function setPreviewLoading(loading) {
    if (els.screenProgress) els.screenProgress.classList.toggle("active", loading);
    if (els.androidSample) els.androidSample.classList.toggle("is-pending", loading);
  }

  function runPullDemo(done) {
    const indicator = els.screenPullRefresh;
    const sample = els.androidSample;
    if (!indicator || !sample) {
      if (done) done();
      return;
    }
    indicator.classList.remove("active");
    void indicator.offsetWidth;
    indicator.classList.add("active");
    sample.classList.add("is-pulling");
    later(function () {
      indicator.classList.remove("active");
      sample.classList.remove("is-pulling");
      // Refreshing reloads the page: blank screen, one progress sweep, then the page.
      if (els.showSpinner && els.showSpinner.checked) {
        setPreviewLoading(true);
        later(function () {
          setPreviewLoading(false);
          if (done) done();
        }, PREVIEW_PROGRESS_MS);
      } else if (done) {
        done();
      }
    }, PREVIEW_PULL_MS);
  }

  function runZoomDemo() {
    const sample = els.androidSample;
    if (!sample) return;
    sample.classList.remove("is-zooming");
    void sample.offsetWidth;
    sample.classList.add("is-zooming");
    later(function () {
      sample.classList.remove("is-zooming");
    }, PREVIEW_ZOOM_MS);
  }

  function runPreviewSequence() {
    clearPreviewTimers();
    const sample = els.androidSample;
    if (!sample) return;
    sample.classList.remove("is-pulling", "is-zooming");
    if (els.screenPullRefresh) els.screenPullRefresh.classList.remove("active");

    const spinnerOn = !!(els.showSpinner && els.showSpinner.checked);
    const pullOn = !!(els.pullToRefresh && els.pullToRefresh.checked);
    const zoomOn = !!(els.allowZoom && els.allowZoom.checked);

    if (spinnerOn) {
      setPreviewLoading(true);
      later(function () {
        setPreviewLoading(false);
      }, PREVIEW_PROGRESS_MS);
    } else {
      setPreviewLoading(false);
    }

    const cursor = spinnerOn ? PREVIEW_PROGRESS_MS + 520 : 600;
    if (pullOn) {
      later(function () {
        runPullDemo(function () {
          if (zoomOn) later(runZoomDemo, PREVIEW_FADE_MS);
        });
      }, cursor);
    } else if (zoomOn) {
      later(runZoomDemo, cursor);
    }
  }

  function playAndroidPreview() {
    clearPreviewTimers();
    const duration = Math.min(10000, Math.max(0, parseInt(els.splashDuration.value, 10) || 2000));
    const showSplash = els.showSplash.checked;
    const summary = androidPreviewSummary();
    if (showSplash) {
      els.screenSplash.classList.add("active");
      els.previewStatus.textContent = `Splash screen · ${duration} ms`;
      setPreviewLoading(true);
      later(function () {
        els.screenSplash.classList.remove("active");
        els.previewStatus.textContent = summary;
        runPreviewSequence();
      }, duration);
    } else {
      els.screenSplash.classList.remove("active");
      els.previewStatus.textContent = "App preview ready · no splash screen";
      runPreviewSequence();
      later(function () {
        els.previewStatus.textContent = summary;
      }, PREVIEW_ZOOM_MS + 200);
    }
  }

  // === Backend Build API ===

  async function pollAndDownload(buildId, backendUrl, label) {
    let attempts = 0;
    const maxAttempts = 300;

    while (attempts < maxAttempts) {
      const response = await fetch(`${backendUrl}/api/build/${buildId}`);
      const status = await response.json();

      if (status.status === "completed") {
        showProgress(`${label} compiled! Downloading…`, 100);

        const downloadUrl = `${backendUrl}/api/download/${buildId}`;
        const filename = status.filename || "app.apk";

        const downloadLink = document.createElement("a");
        downloadLink.href = downloadUrl;
        downloadLink.download = filename;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);

        showPlayProtectNotice();
        setMessage("Build complete", "ok");
        showBuildSuccess(downloadUrl, filename);
        return;
      } else if (status.status === "error") {
        throw new Error(status.error || "Build failed");
      }

      showProgress(`Compiling APK with Gradle…`, Math.min(20 + attempts * 2.5, 95));
      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    throw new Error("Build timed out. Please try again.");
  }

  async function buildAndDownload(app) {
    const requestBody = currentBuildRequest(app);

    try {
      setButtonLoading(true);
      showProgress("Queuing Android compiler build…", 15);

      const response = await fetch(`${backendUrl}/api/build/apk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Build failed");
      }

      const { buildId } = await response.json();
      showProgress("Initializing build environment…", 30);
      await pollAndDownload(buildId, backendUrl, "Android APK");

      lastSuccessfulBuildFingerprint = fingerprintConfig(requestBody);
      try {
        localStorage.setItem(LAST_BUILD_KEY, lastSuccessfulBuildFingerprint);
      } catch {}

      const finalUrl = `${backendUrl}/api/download/${buildId}`;
      addToHistory({
        name: app.name,
        appId: app.appId,
        url: finalUrl,
        filename: "app.apk",
        date: new Date().toISOString()
      });
    } catch (error) {
      hideBuildSuccess();
      setMessage(error.message, "error");
    } finally {
      setButtonLoading(false);
      hideProgress();
    }
  }

  // === Simple vs Advanced Settings ===

  const ADVANCED_STORAGE_KEY = "siteapp_advanced_settings";
  const ADVANCED_OPEN_KEY = "siteapp_advanced_open";

  const DEFAULTS = {
    appVersion: "1.0.0",
    showSpinner: true,
    pullToRefresh: true,
    allowZoom: false,
    showSplash: true,
    splashDuration: 2000,
    fullScreen: false,
    customUserAgent: ""
  };

  function getAdvancedState() {
    return {
      appVersion: els.appVersion.value,
      showSpinner: els.showSpinner.checked,
      pullToRefresh: els.pullToRefresh.checked,
      allowZoom: els.allowZoom.checked,
      showSplash: els.showSplash.checked,
      splashDuration: String(els.splashDuration.value),
      fullScreen: els.fullScreen.checked,
      customUserAgent: els.customUserAgent.value
    };
  }

  function applyAdvancedState(state) {
    if (!state) return;
    if (typeof state.appVersion === "string" && state.appVersion) {
      els.appVersion.value = state.appVersion;
    }
    if (typeof state.showSpinner === "boolean") els.showSpinner.checked = state.showSpinner;
    if (typeof state.pullToRefresh === "boolean") els.pullToRefresh.checked = state.pullToRefresh;
    if (typeof state.allowZoom === "boolean") els.allowZoom.checked = state.allowZoom;
    if (typeof state.showSplash === "boolean") els.showSplash.checked = state.showSplash;
    if (state.splashDuration != null) els.splashDuration.value = state.splashDuration;
    if (typeof state.fullScreen === "boolean") els.fullScreen.checked = state.fullScreen;
    if (typeof state.customUserAgent === "string") els.customUserAgent.value = state.customUserAgent;
    els.splashDurationField.style.display = els.showSplash.checked ? "block" : "none";
  }

  function countCustomOptions() {
    const state = getAdvancedState();
    let count = 0;
    if (normalizeVersion(state.appVersion) !== DEFAULTS.appVersion) count += 1;
    if (state.showSpinner !== DEFAULTS.showSpinner) count += 1;
    if (state.pullToRefresh !== DEFAULTS.pullToRefresh) count += 1;
    if (state.allowZoom !== DEFAULTS.allowZoom) count += 1;
    if (state.showSplash !== DEFAULTS.showSplash) count += 1;
    if ((parseInt(state.splashDuration, 10) || DEFAULTS.splashDuration) !== DEFAULTS.splashDuration) count += 1;
    if (state.fullScreen !== DEFAULTS.fullScreen) count += 1;
    if (String(state.customUserAgent || "").trim() !== DEFAULTS.customUserAgent) count += 1;
    return count;
  }

  function updateAdvancedBadge() {
    if (!els.advancedBadge) return;
    const count = countCustomOptions();
    els.advancedBadge.hidden = count === 0;
    els.advancedBadge.textContent = count > 0 ? count + " custom" : "";
  }

  function persistAdvanced() {
    try {
      localStorage.setItem(ADVANCED_STORAGE_KEY, JSON.stringify(getAdvancedState()));
      localStorage.setItem(ADVANCED_OPEN_KEY, els.advancedPanel && els.advancedPanel.open ? "1" : "0");
    } catch {}
  }

  function restoreAdvanced() {
    try {
      const raw = localStorage.getItem(ADVANCED_STORAGE_KEY);
      if (raw) applyAdvancedState(JSON.parse(raw));
      if (els.advancedPanel) els.advancedPanel.open = localStorage.getItem(ADVANCED_OPEN_KEY) === "1";
    } catch {}
  }

  function resetAdvancedDefaults() {
    els.appVersion.value = DEFAULTS.appVersion;
    els.showSpinner.checked = DEFAULTS.showSpinner;
    els.pullToRefresh.checked = DEFAULTS.pullToRefresh;
    els.allowZoom.checked = DEFAULTS.allowZoom;
    els.showSplash.checked = DEFAULTS.showSplash;
    els.splashDuration.value = DEFAULTS.splashDuration;
    els.fullScreen.checked = DEFAULTS.fullScreen;
    els.customUserAgent.value = DEFAULTS.customUserAgent;
    els.splashDurationField.style.display = "block";
    els.autoFetchIcon.checked = true;
    iconUploadToken++;
    iconProcessing = false;
    base64Icon = null;
    els.appIcon.value = "";
    packageWasEdited = false;
    updateIconUploadState();
    updatePreview();
    persistAdvanced();
    updateBuildButtonState();
  }

  // === Event Listeners ===

  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const app = getAppConfig();
      await buildAndDownload(app);
    } catch (error) {
      setMessage(error.message, "error");
    }
  });

  ["input", "change"].forEach((eventName) => {
    els.form.addEventListener(eventName, updateBuildButtonState);
  });

  els.resetIdButton.addEventListener("click", () => {
    packageWasEdited = false;
    els.appId.value = derivePackageId(els.siteUrl.value, els.appName.value);
    updatePreview();
    updateBuildButtonState();
  });

  if (els.sampleButton) {
    els.sampleButton.addEventListener("click", () => {
      els.siteUrl.value = "https://example.com";
      els.appName.value = "Example Portal";
      els.appVersion.value = "1.0.0";
      packageWasEdited = false;
      updatePreview();
      updateBuildButtonState();
    });
  }

  els.appId.addEventListener("input", () => {
    packageWasEdited = true;
    updatePreview();
  });

  // === Icon Upload State Management ===

  function updateIconUploadState() {
    const hasIcon = !!base64Icon;

    // Show/hide remove button
    if (els.removeIconButton) {
      els.removeIconButton.style.display = hasIcon ? "inline-flex" : "none";
    }

    // Grey out auto-fetch toggle
    if (els.autoFetchIcon) {
      const label = els.autoFetchIcon.closest(".icon-fetch-label");
      if (label) {
        label.classList.toggle("disabled", hasIcon);
      }
      els.autoFetchIcon.disabled = hasIcon;
    }
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("This browser could not process the selected icon."));
      }, type, quality);
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read the prepared app icon."));
      reader.readAsDataURL(blob);
    });
  }

  async function prepareUploadedIcon(file) {
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      throw new Error("Choose a PNG or JPEG image for the app icon.");
    }
    if (file.size > 20 * 1024 * 1024) {
      throw new Error("The selected image is too large. Choose an image under 20 MB.");
    }

    const bitmap = await createImageBitmap(file);
    try {
      // Keep transparency while reducing the image to launcher-icon dimensions.
      for (const size of [192, 160, 128, 96]) {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("This browser could not process the selected icon.");
        context.clearRect(0, 0, size, size);

        const scale = Math.min(size / bitmap.width, size / bitmap.height);
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);

        for (const quality of [0.9, 0.82, 0.74, 0.66]) {
          const blob = await canvasToBlob(canvas, "image/webp", quality);
          const dataUrl = await blobToDataUrl(blob);
          if (typeof dataUrl === "string" && dataUrl.length <= MAX_ICON_DATA_URL_LENGTH) {
            return dataUrl;
          }
          // Unsupported WebP encoders return PNG regardless of quality; try a smaller canvas.
          if (blob.type !== "image/webp") break;
        }
      }
    } finally {
      bitmap.close();
    }

    throw new Error("Could not reduce this image enough to upload. Try a simpler or smaller icon.");
  }

  els.appIcon.addEventListener("change", (e) => {
    const file = e.target.files[0];
    const token = ++iconUploadToken;
    if (file) {
      iconProcessing = true;
      updateBuildButtonState();
      prepareUploadedIcon(file).then((preparedIcon) => {
        if (token !== iconUploadToken) return;
        base64Icon = preparedIcon;
        iconProcessing = false;
        updateIconUploadState();
        updatePreview();
        updateBuildButtonState();
      }).catch((error) => {
        if (token !== iconUploadToken) return;
        base64Icon = null;
        iconProcessing = false;
        els.appIcon.value = "";
        updateIconUploadState();
        updatePreview();
        updateBuildButtonState();
        setMessage(error.message, "error");
      });
    } else {
      base64Icon = null;
      iconProcessing = false;
      updateIconUploadState();
      updatePreview();
      updateBuildButtonState();
    }
  });

  // Remove icon button
  if (els.removeIconButton) {
    els.removeIconButton.addEventListener("click", function () {
      iconUploadToken++;
      iconProcessing = false;
      base64Icon = null;
      els.appIcon.value = "";
      updateIconUploadState();
      updatePreview();
      updateBuildButtonState();
    });
  }

  if (els.autoFetchIcon) {
    els.autoFetchIcon.addEventListener("change", updatePreview);
  }

  els.showSplash.addEventListener("change", (e) => {
    els.splashDurationField.style.display = e.target.checked ? "block" : "none";
    updatePhonePreview();
  });

  els.fullScreen.addEventListener("change", function () {
    updatePhonePreview();
  });

  els.previewPlay.addEventListener("click", playAndroidPreview);
  els.splashDuration.addEventListener("input", updatePhonePreview);

  if (els.allowZoom) {
    els.allowZoom.addEventListener("change", function () {
      updatePhonePreview();
      runPreviewSequence();
    });
  }

  els.showSpinner.addEventListener("change", function () {
    updatePhonePreview();
    runPreviewSequence();
  });

  els.pullToRefresh.addEventListener("change", function () {
    updatePhonePreview();
    runPreviewSequence();
  });

  [els.siteUrl, els.appVersion].forEach((el) => {
    el.addEventListener("input", updatePreview);
    el.addEventListener("change", updatePreview);
  });

  els.appName.addEventListener("input", () => {
    nameWasEdited = true;
    updatePreview();
  });

  els.appName.addEventListener("change", () => {
    // Clearing the field hands the label back to the URL-derived name
    if (!String(els.appName.value || "").trim()) {
      nameWasEdited = false;
      updatePreview();
    }
  });

  if (els.advancedPanel) {
    els.advancedPanel.addEventListener("toggle", persistAdvanced);

    const advancedBody = els.advancedPanel.querySelector(".advanced-body");
    if (advancedBody) {
      ["input", "change"].forEach((eventName) => {
        advancedBody.addEventListener(eventName, () => {
          updateAdvancedBadge();
          persistAdvanced();
        });
      });
    }
  }

  if (els.resetDefaultsButton) {
    els.resetDefaultsButton.addEventListener("click", resetAdvancedDefaults);
  }

  if (els.playProtectModal) {
    [els.playProtectClose, els.playProtectDismiss].forEach((button) => {
      if (button) {
        button.addEventListener("click", hidePlayProtectNotice);
      }
    });

    els.playProtectModal.addEventListener("click", (event) => {
      if (event.target === els.playProtectModal) {
        hidePlayProtectNotice();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !els.playProtectModal.hidden) {
        hidePlayProtectNotice();
      }
    });
  }

  // === Init ===
  els.siteUrl.value = "";
  els.appName.value = "";
  restoreAdvanced();
  updatePreview();
  renderHistory();
  updateBuildButtonState();
  runPreviewSequence();

  if (els.clearHistoryBtn) {
    els.clearHistoryBtn.addEventListener("click", function () {
      saveHistory([]);
      renderHistory();
    });
  }
})();
