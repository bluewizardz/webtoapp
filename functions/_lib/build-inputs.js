// Validation for Android build inputs, shared by the Cloudflare Pages function,
// the Express dev server and the CI CLI.
//
// These values originate in an untrusted HTTP request (or a manually dispatched
// workflow) and end up on a build runner, where they are embedded into Android
// resource XML, Gradle files and Java source. Every field therefore has a strict
// allow-list: quotes, backslashes, angle brackets, ampersands, semicolons, pipes,
// command substitutions and control characters are rejected instead of escaped.

// GitHub caps the whole workflow_dispatch input payload at 65,535 characters.
export const MAX_ICON_CHARS = 48000;

const ICON_DATA_URI = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i;
// Letters (any script), digits, spaces and punctuation that is safe inside both
// Android string resources and Gradle strings.
const APP_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .,_+@#!?():/-]*$/u;
const APP_ID_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]{1,16})?$/;
// Printable ASCII without double quotes (0x22), backslashes (0x5C) or the shell
// metacharacters $ ` | < > : a user agent is written into Java source as a
// double-quoted string literal, so quotes and escapes can never appear in it.
const USER_AGENT_PATTERN = /^[\x20\x21\x23\x25-\x3B\x3F-\x5B\x5D-\x5F\x61-\x7A\x7B\x7D-\x7E]*$/;

function readText(value, label, { fallback, maxLength, pattern, message }) {
  if (value === undefined || value === null) {
    return { value: fallback };
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return { error: `${label} must be text` };
  }
  const text = String(value).trim();
  if (!text) {
    return { value: fallback };
  }
  if (text.length > maxLength) {
    return { error: `${label} must be ${maxLength} characters or fewer` };
  }
  if (!pattern.test(text)) {
    return { error: message };
  }
  return { value: text };
}

function readBoolean(value, label, fallback) {
  if (value === undefined || value === null || value === "") {
    return { value: fallback };
  }
  if (typeof value === "boolean") {
    return { value };
  }
  const text = String(value).trim().toLowerCase();
  if (text === "true") return { value: true };
  if (text === "false") return { value: false };
  return { error: `${label} must be true or false` };
}

function readInteger(value, label, { fallback, min, max }) {
  if (value === undefined || value === null || value === "") {
    return { value: fallback };
  }
  if (typeof value === "boolean") {
    return { error: `${label} must be a whole number between ${min} and ${max}` };
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    return { error: `${label} must be a whole number between ${min} and ${max}` };
  }
  return { value: number };
}

function readIcon(value) {
  if (value === undefined || value === null) {
    return { value: "" };
  }
  if (typeof value !== "string") {
    return { error: "Custom icon must be a base64 image data URI" };
  }
  const raw = value.trim();
  if (!raw) {
    return { value: "" };
  }
  if (!ICON_DATA_URI.test(raw)) {
    return { error: "Custom icon must be a base64 image data URI" };
  }
  if (raw.length > MAX_ICON_CHARS) {
    return { error: "Custom icon is too large for the build pipeline; upload an image under 2 MB" };
  }
  return { value: raw };
}

/**
 * Normalise a website URL to an absolute http(s) URL.
 * Returns { value } or { error }.
 */
export function normalizeSiteUrl(value) {
  const raw = String(value === undefined || value === null ? "" : value).trim();
  if (!raw) {
    return { error: "Website URL is required" };
  }
  if (raw.length > 2048) {
    return { error: "Website URL must be 2048 characters or fewer" };
  }
  // Reject anything that has no business in a URL before parsing it.
  if (/[\s<>"'`\\\u0000-\u001f\u007f]/.test(raw)) {
    return { error: "Website URL contains unsupported characters" };
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch (error) {
    return { error: "Website URL is not a valid URL" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { error: "Website URL must use http or https" };
  }
  if (parsed.username || parsed.password) {
    return { error: "Website URL must not contain credentials" };
  }
  if (!/^[a-z0-9.-]+$/i.test(parsed.hostname)) {
    return { error: "Website URL has an invalid hostname" };
  }

  return { value: parsed.toString() };
}

/**
 * Validate an Android application ID (Java package name). The ID is used as a
 * source directory and a Gradle namespace, so it must be a plain package name.
 * Returns { value } or { error }.
 */
export function validateAppId(value) {
  return readText(value, "App ID", {
    fallback: "com.example.app",
    maxLength: 150,
    pattern: APP_ID_PATTERN,
    message: "App ID must be a lowercase Java package name such as com.example.app"
  });
}

/** Validate a semantic version string. Returns { value } or { error }. */
export function validateAppVersion(value) {
  return readText(value, "App version", {
    fallback: "1.0.0",
    maxLength: 32,
    pattern: APP_VERSION_PATTERN,
    message: "App version must look like 1.0.0"
  });
}

/**
 * Validate and normalise every field of an APK build request.
 * Returns { inputs } with typed values, or { error } describing the first problem.
 */
export function validateBuildInputs(raw) {
  const body = raw && typeof raw === "object" ? raw : {};

  const siteUrl = normalizeSiteUrl(body.siteUrl ?? "https://example.com");
  if (siteUrl.error) return siteUrl;

  const appName = readText(body.appName, "App name", {
    fallback: "My Web App",
    maxLength: 64,
    pattern: APP_NAME_PATTERN,
    message: "App name may only contain letters, numbers, spaces and . , _ - + @ # ! ? ( ) : /"
  });
  if (appName.error) return appName;

  const appId = validateAppId(body.appId);
  if (appId.error) return appId;

  const appVersion = validateAppVersion(body.appVersion);
  if (appVersion.error) return appVersion;

  const customUserAgent = readText(body.customUserAgent, "Custom user agent", {
    fallback: "",
    maxLength: 256,
    pattern: USER_AGENT_PATTERN,
    message: "Custom user agent may only contain printable characters, without quotes or backslashes"
  });
  if (customUserAgent.error) return customUserAgent;

  const icon = readIcon(body.icon);
  if (icon.error) return icon;

  const splashDuration = readInteger(body.splashDuration, "Splash duration", {
    fallback: 2000,
    min: 0,
    max: 10000
  });
  if (splashDuration.error) return splashDuration;

  const pullToRefresh = readBoolean(body.pullToRefresh, "Pull to refresh", true);
  if (pullToRefresh.error) return pullToRefresh;

  const allowZoom = readBoolean(body.allowZoom, "Allow zoom", false);
  if (allowZoom.error) return allowZoom;

  const showSpinner = readBoolean(body.showSpinner, "Show spinner", true);
  if (showSpinner.error) return showSpinner;

  const showSplash = readBoolean(body.showSplash, "Show splash", true);
  if (showSplash.error) return showSplash;

  const fullScreen = readBoolean(body.fullScreen, "Full screen", false);
  if (fullScreen.error) return fullScreen;

  const autoFetchIcon = readBoolean(body.autoFetchIcon, "Auto fetch icon", true);
  if (autoFetchIcon.error) return autoFetchIcon;

  // Compatibility escape hatch: insecure subresources stay blocked by default.
  const allowMixedContent = readBoolean(body.allowMixedContent, "Allow mixed content", false);
  if (allowMixedContent.error) return allowMixedContent;

  return {
    inputs: {
      siteUrl: siteUrl.value,
      appName: appName.value,
      appId: appId.value,
      appVersion: appVersion.value,
      pullToRefresh: pullToRefresh.value,
      allowZoom: allowZoom.value,
      showSpinner: showSpinner.value,
      showSplash: showSplash.value,
      splashDuration: splashDuration.value,
      fullScreen: fullScreen.value,
      customUserAgent: customUserAgent.value,
      icon: icon.value,
      autoFetchIcon: autoFetchIcon.value,
      allowMixedContent: allowMixedContent.value
    }
  };
}
