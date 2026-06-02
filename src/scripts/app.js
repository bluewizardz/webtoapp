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
    
    // Progress Bar
    buildProgress: document.querySelector("#buildProgress"),
    progressText: document.querySelector("#progressText"),
    progressFill: document.querySelector("#progressFill"),

    // Icon Fetching & Previews
    autoFetchIcon: document.querySelector("#autoFetchIcon"),
    iconPreview: document.querySelector("#iconPreview"),
    iconPreviewPlaceholder: document.querySelector("#iconPreviewPlaceholder"),
    iconPreviewSpinner: document.querySelector("#iconPreviewSpinner"),
    previewIcon: document.querySelector("#previewIcon")
  };

  let packageWasEdited = false;
  let base64Icon = null;

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

  function initials(name) {
    const pieces = String(name || "Site App").trim().split(/\s+/).filter(Boolean);
    const first = pieces[0] ? pieces[0].charAt(0) : "S";
    const second = pieces.length > 1 ? pieces[1].charAt(0) : (pieces[0] ? pieces[0].charAt(1) : "A");
    return (first + second).toUpperCase();
  }

  function getAppConfig() {
    const url = normalizeUrl(els.siteUrl.value);
    const name = String(els.appName.value || "").trim() || titleCaseFromSlug(slugify(new URL(url).hostname, "site-app"));
    const version = normalizeVersion(els.appVersion.value);
    const appId = normalizePackageId(els.appId.value || derivePackageId(url, name));
    return {
      url,
      name,
      version,
      appId,
      initials: initials(name)
    };
  }

  // === UI Helpers ===

  function setMessage(message, kind) {
    els.validationMessage.textContent = kind === "error" ? message : "";
    els.statusPill.textContent = message;
    els.statusPill.style.color = kind === "error" ? "#ff0000" : "#0070f3";
    els.statusPill.style.borderColor = kind === "error" ? "rgba(255, 0, 0, 0.3)" : "rgba(0, 112, 243, 0.3)";
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

  function setButtonLoading(loading) {
    els.downloadButton.disabled = loading;
    if (loading) {
      els.downloadButton.innerHTML = '<span class="spinner" aria-hidden="true"></span> Building APK…';
    } else {
      els.downloadButton.innerHTML = 'Build & Download APK';
    }
  }

  function resetPreviewsToInitials(initialsText) {
    if (els.iconPreviewSpinner) {
      els.iconPreviewSpinner.style.display = "none";
    }
    if (els.iconPreview) {
      els.iconPreview.removeAttribute("src");
      els.iconPreview.style.display = "none";
    }
    if (els.iconPreviewPlaceholder) {
      els.iconPreviewPlaceholder.textContent = initialsText;
      els.iconPreviewPlaceholder.style.display = "block";
    }
    if (els.previewIcon) {
      els.previewIcon.removeAttribute("src");
      els.previewIcon.style.display = "none";
    }
    if (els.previewInitials) {
      els.previewInitials.textContent = initialsText;
      els.previewInitials.style.display = "grid";
    }
  }

  function updatePreview() {
    let appInitials = "SA";
    try {
      if (!packageWasEdited) {
        els.appId.value = derivePackageId(els.siteUrl.value, els.appName.value);
      }
      const app = getAppConfig();
      appInitials = app.initials;
      els.previewInitials.textContent = app.initials;
      els.previewName.textContent = app.name;
      els.previewUrl.textContent = app.url;
      els.outputAppName.textContent = app.name;
      els.outputAppId.textContent = app.appId;
      els.artifactSummary.textContent = "Android APK";
      setMessage("Ready", "ok");
    } catch (error) {
      els.previewName.textContent = els.appName.value || "Site App";
      els.previewUrl.textContent = els.siteUrl.value || "https://example.com";
      setMessage(error.message, "error");
    }

    // Icon Preview Handling
    if (base64Icon) {
      // Custom uploaded icon
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
    } else if (els.autoFetchIcon && els.autoFetchIcon.checked && els.siteUrl.value) {
      // Auto-fetch website icon
      let domain = "";
      try {
        domain = new URL(normalizeUrl(els.siteUrl.value)).hostname;
      } catch (e) {}
      
      if (domain) {
        const faviconUrl = `${backendUrl}/api/favicon?url=${encodeURIComponent(normalizeUrl(els.siteUrl.value))}`;
        
        // Show spinner while fetching auto-fetched icon
        if (els.iconPreviewSpinner) {
          els.iconPreviewSpinner.style.display = "block";
        }
        if (els.iconPreview) {
          els.iconPreview.style.display = "none"; // Hide image until loaded
        }
        if (els.iconPreviewPlaceholder) {
          els.iconPreviewPlaceholder.style.display = "none";
        }
        if (els.previewIcon) {
          els.previewIcon.style.display = "none"; // Hide device preview image until loaded
        }
        if (els.previewInitials) {
          els.previewInitials.textContent = appInitials;
          els.previewInitials.style.display = "grid"; // Show initials as placeholder during load
        }
        
        // Set sources (triggers loading)
        if (els.iconPreview) {
          els.iconPreview.src = faviconUrl;
        }
        if (els.previewIcon) {
          els.previewIcon.src = faviconUrl;
        }
      } else {
        if (els.iconPreviewSpinner) {
          els.iconPreviewSpinner.style.display = "none";
        }
        resetPreviewsToInitials(appInitials);
      }
    } else {
      if (els.iconPreviewSpinner) {
        els.iconPreviewSpinner.style.display = "none";
      }
      resetPreviewsToInitials(appInitials);
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

        const downloadLink = document.createElement("a");
        downloadLink.href = `${backendUrl}/api/download/${buildId}`;
        downloadLink.download = status.filename || "app.apk";
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);

        setMessage("Build complete!", "ok");
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
    const requestBody = {
      siteUrl: app.url,
      appName: app.name,
      appId: app.appId,
      appVersion: app.version,
      icon: base64Icon,
      autoFetchIcon: els.autoFetchIcon ? els.autoFetchIcon.checked : true,
      showSpinner: els.showSpinner.checked,
      pullToRefresh: els.pullToRefresh.checked,
      allowZoom: els.allowZoom.checked,
      showSplash: els.showSplash.checked,
      splashDuration: parseInt(els.splashDuration.value, 10) || 2000,
      fullScreen: els.fullScreen.checked,
      customUserAgent: els.customUserAgent.value
    };

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
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setButtonLoading(false);
      hideProgress();
    }
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

  els.resetIdButton.addEventListener("click", () => {
    packageWasEdited = false;
    els.appId.value = derivePackageId(els.siteUrl.value, els.appName.value);
    updatePreview();
  });

  els.sampleButton.addEventListener("click", () => {
    els.siteUrl.value = "https://example.com";
    els.appName.value = "Example Portal";
    els.appVersion.value = "1.0.0";
    packageWasEdited = false;
    updatePreview();
  });

  els.appId.addEventListener("input", () => {
    packageWasEdited = true;
    updatePreview();
  });

  els.appIcon.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        base64Icon = event.target.result;
        updatePreview();
      };
      reader.readAsDataURL(file);
    } else {
      base64Icon = null;
      updatePreview();
    }
  });

  if (els.autoFetchIcon) {
    els.autoFetchIcon.addEventListener("change", updatePreview);
  }

  els.showSplash.addEventListener("change", (e) => {
    els.splashDurationField.style.display = e.target.checked ? "block" : "none";
  });

  [
    els.siteUrl,
    els.appName,
    els.appVersion
  ].forEach((el) => {
    el.addEventListener("input", updatePreview);
    el.addEventListener("change", updatePreview);
  });

  if (els.iconPreview) {
    els.iconPreview.addEventListener("load", () => {
      if (els.iconPreviewSpinner) {
        els.iconPreviewSpinner.style.display = "none";
      }
      if (base64Icon || (els.autoFetchIcon && els.autoFetchIcon.checked)) {
        els.iconPreview.style.display = "block";
        if (els.iconPreviewPlaceholder) {
          els.iconPreviewPlaceholder.style.display = "none";
        }
        if (els.previewIcon) {
          els.previewIcon.style.display = "block";
        }
        if (els.previewInitials) {
          els.previewInitials.style.display = "none";
        }
      }
    });

    els.iconPreview.addEventListener("error", () => {
      const currentSrc = els.iconPreview.src;
      if (currentSrc && currentSrc.includes("google.com/s2/favicons")) {
        try {
          const urlObj = new URL(currentSrc);
          const domain = urlObj.searchParams.get("domain");
          if (domain) {
            const fallbackUrl = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
            els.iconPreview.src = fallbackUrl;
            if (els.previewIcon) {
              els.previewIcon.src = fallbackUrl;
            }
            return;
          }
        } catch (e) {}
      }
      
      if (els.iconPreviewSpinner) {
        els.iconPreviewSpinner.style.display = "none";
      }
      const app = getAppConfig();
      resetPreviewsToInitials(app.initials || "SA");
    });
  }

  // === Init ===
  els.siteUrl.value = "https://example.com";
  els.appName.value = "Site App";
  updatePreview();
})();
