import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildMainActivityJava,
  DEFAULT_AUTH_HOSTS,
  MAX_BLOB_BYTES
} from '../builders/android-main-activity.js';
import { generateAndroidProject } from '../builders/android-builder.js';

const BASE_OPTIONS = {
  appId: 'com.example.cafe',
  siteUrl: 'https://example.com/path?a=1&b=2',
  customUserAgent: 'Mozilla/5.0 (X11; Linux) "Quoted" C:\\path',
  splashDuration: 2000,
  showSplash: true,
  showSpinner: true,
  pullToRefresh: true
};

const JAVA = buildMainActivityJava(BASE_OPTIONS);

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

test('HTTP downloads use DownloadManager with cookies, MIME types and file names', () => {
  assert.match(JAVA, /setDownloadListener\(new DownloadListener\(\)/);
  assert.match(JAVA, /new DownloadManager\.Request\(Uri\.parse\(download\.url\)\)/);
  assert.match(JAVA, /request\.setMimeType\(safeMimeType\);/);
  assert.match(JAVA, /DownloadManager\.ACTION_DOWNLOAD_COMPLETE/);
  assert.match(JAVA, /reportDownloadResult\(/);
  assert.match(JAVA, /"Download failed \(code " \+ reason/);

  // Cookies from the authenticated WebView session are forwarded.
  assert.match(JAVA, /CookieManager\.getInstance\(\)\.getCookie\(download\.url\)/);
  assert.match(JAVA, /addRequestHeader\("Cookie", cookie\)/);
  assert.match(JAVA, /addRequestHeader\("User-Agent", download\.userAgent\)/);

  // File names and MIME types are derived and sanitized.
  assert.match(JAVA, /resolveDownloadFileName\(download\.contentDisposition, download\.url\)/);
  assert.match(JAVA, /MimeTypeMap\.getSingleton\(\)\.getMimeTypeFromExtension/);
  assert.match(JAVA, /private String sanitizeFileName\(String name\)/);
  assert.match(JAVA, /"application\/octet-stream"/);

  // Pre-Android 10 needs storage permission; later versions do not.
  assert.match(JAVA, /WRITE_EXTERNAL_STORAGE/);
  assert.match(JAVA, /REQ_DOWNLOAD_PERMISSION/);

  // Downloaded files are never launched automatically.
  const resultReporting = sliceBetween(JAVA, 'private void reportDownloadResult', 'private void registerDownloadReceiver');
  assert.ok(!resultReporting.includes('ACTION_VIEW'), 'download completion must not open the file');
});

test('Blob and data downloads stream through a restricted, size-capped bridge', () => {
  assert.match(JAVA, /addJavascriptInterface\(new DownloadBridge\(\), DOWNLOAD_BRIDGE_NAME\)/);
  assert.equal((JAVA.match(/@JavascriptInterface/g) || []).length, 4, 'only the four download methods are exposed');
  assert.match(JAVA, /private boolean isTrustedPage\(\)/);
  assert.match(JAVA, /if \(!isTrustedPage\(\)\) \{/);

  assert.match(JAVA, new RegExp(`MAX_BLOB_BYTES = ${MAX_BLOB_BYTES}L`));
  assert.match(JAVA, /BLOB_CHUNK_BYTES/);
  assert.match(JAVA, /blob\.size > maxBytes/);
  assert.match(JAVA, /blobReceived \+ data\.length > MAX_BLOB_BYTES/);
  assert.match(JAVA, /btoa\(binary\)/);
  assert.match(JAVA, /fetch\(url\)/);
  assert.match(JAVA, /appendBlobChunk/);
  assert.match(JAVA, /reader\.onerror/);

  // Cancellation on navigation and explicit failure reporting.
  assert.match(JAVA, /A navigation cancels any in-flight generated download/);
  assert.match(JAVA, /failBlobDownload/);
  assert.match(JAVA, /cancelBlobDownload\(boolean notifyUser\)/);
  assert.match(JAVA, /blobFailureMessage\(/);
});

test('popups are routed without creating visible extra WebViews', () => {
  assert.match(JAVA, /setSupportMultipleWindows\(true\)/);
  assert.match(JAVA, /public boolean onCreateWindow\(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg\)/);
  assert.match(JAVA, /public void onCloseWindow\(WebView window\)/);
  assert.match(JAVA, /private void destroyPopup\(\)/);

  const popupHandler = sliceBetween(JAVA, 'private boolean handlePopupUrl', 'private void destroyPopup');
  assert.match(popupHandler, /if \(isSameSite\(host\)\) \{/, 'same-site popups stay inside the app');
  assert.match(popupHandler, /webView\.loadUrl\(url\);/);
  assert.match(popupHandler, /openExternally\(url\);/);
  assert.match(popupHandler, /Blocked an unsupported popup link/);

  // The popup WebView is destroyed on teardown.
  const destroy = sliceBetween(JAVA, 'protected void onDestroy()', 'public void onRequestPermissionsResult');
  assert.match(destroy, /destroyPopup\(\);/);
});

test('auth hosts are configurable and the fallback is explicit about cookies', () => {
  for (const host of ['accounts.google.com', 'login.microsoftonline.com', 'appleid.apple.com']) {
    assert.ok(DEFAULT_AUTH_HOSTS.includes(host), `${host} missing from defaults`);
    assert.ok(JAVA.includes(`"${host}"`), `${host} missing from generated source`);
  }

  const custom = buildMainActivityJava({ ...BASE_OPTIONS, externalAuthHosts: ['idp.example.org', 'sso.example.net'] });
  assert.ok(custom.includes('"idp.example.org"'));
  assert.ok(custom.includes('"sso.example.net"'));
  assert.ok(!custom.includes('"accounts.google.com"'), 'custom hosts replace the defaults');

  assert.match(JAVA, /promptExternalAuth\(url, host\)/);
  assert.match(JAVA, /browser cookies are separate from the app/);
  assert.match(JAVA, /Try inside app/);
  assert.match(JAVA, /looksLikeAuthEndpoint\(/);

  // Same-site navigation is untouched.
  const navigation = sliceBetween(JAVA, 'private boolean handleNavigation', 'private boolean looksLikeAuthEndpoint');
  assert.match(navigation, /if \(!isSameSite\(host\) &&/);

  // Deep links back into the app are validated.
  assert.match(JAVA, /protected void onNewIntent\(Intent intent\)/);
  assert.match(JAVA, /private boolean isTrustedCallbackUrl\(String value\)/);
  assert.match(JAVA, /"siteapp"\.equals\(scheme\)/);
  assert.match(JAVA, /Ignored a link that does not belong to this app/);
});

test('pull-to-refresh always resets, ignores subresource errors and survives crashes', () => {
  assert.match(JAVA, /request\.isForMainFrame\(\)/);
  assert.match(JAVA, /onReceivedError\(WebView view, WebResourceRequest request, WebResourceError error\)/);
  assert.match(JAVA, /onRenderProcessGone\(WebView view, RenderProcessGoneDetail detail\)/);
  assert.match(JAVA, /recreate\(\);/);
  assert.match(JAVA, /The page could not be loaded/);
  assert.match(JAVA, /The page stopped responding/);

  const refreshListener = sliceBetween(JAVA, 'swipeRefresh.setOnRefreshListener', 'setupWebViewClient');
  assert.match(refreshListener, /if \(loadingInProgress\) \{/, 'duplicate refreshes are ignored');

  const stops = (JAVA.match(/swipeRefresh\.setRefreshing\(false\);/g) || []).length;
  assert.ok(stops >= 4, `refresh indicator is stopped in ${stops} places, expected several failure paths`);
  assert.match(JAVA, /canScrollVertically\(-1\)/, 'scroll detection is preserved');
});

test('the splash hides only after its minimum duration and page readiness', () => {
  assert.match(JAVA, /private void maybeDismissSplash\(\)/);
  assert.match(JAVA, /SystemClock\.elapsedRealtime\(\) - splashShownAt/);
  assert.match(JAVA, /if \(elapsed < 2000\)/);
  assert.match(JAVA, /if \(!mainFrameReady\) \{/);
  assert.match(JAVA, /SPLASH_HARD_TIMEOUT_MS/);

  // One flag for "splash disabled", one single dismissal point: the timer and the
  // page-load callback both funnel through maybeDismissSplash().
  assert.equal((JAVA.match(/splashDismissed = true;/g) || []).length, 2);
  assert.ok(
    (JAVA.match(/maybeDismissSplash\(\);/g) || []).length >= 5,
    'every dismissal trigger must go through maybeDismissSplash()'
  );
  // Only one place animates the overlay away, so the timer cannot hide it early.
  assert.equal((JAVA.match(/\.alpha\(0f\)/g) || []).length, 1);
  assert.match(JAVA, /handler\.removeCallbacksAndMessages\(null\)/);
});

test('generated Java is template-clean and escapes interpolated values', () => {
  assert.ok(!JAVA.includes('${'), 'unresolved interpolation in generated Java');
  assert.ok(!JAVA.includes('granted()'), 'leftover placeholder method call');
  assert.equal((JAVA.match(/{/g) || []).length, (JAVA.match(/}/g) || []).length, 'unbalanced braces');
  assert.equal((JAVA.match(/\(/g) || []).length, (JAVA.match(/\)/g) || []).length, 'unbalanced parentheses');

  assert.ok(JAVA.includes('String initialUrl = "https://example.com/path?a=1&b=2";'));
  assert.ok(JAVA.includes(String.raw`final String customUA = "Mozilla/5.0 (X11; Linux) \"Quoted\" C:\\path";`));
  assert.ok(JAVA.startsWith('package com.example.cafe;'));
  assert.ok(JAVA.includes('private static final String BLOB_SCRIPT = """'), 'blob script should be a Java text block');
});

test('the loading bar reports real progress and never stays visible', () => {
  const chrome = sliceBetween(JAVA, 'private void setupWebChromeClient()', 'onGeolocationPermissionsShowPrompt');
  assert.match(chrome, /public void onProgressChanged\(WebView view, int newProgress\)/);
  assert.match(chrome, /progressBar\.setProgress\(newProgress\)/);
  assert.match(chrome, /if \(newProgress >= 100\) \{\s*progressBar\.setVisibility\(android\.view\.View\.GONE\)/);

  for (const failure of [
    sliceBetween(JAVA, 'public void onReceivedError', 'public void onReceivedHttpError'),
    sliceBetween(JAVA, 'public void onReceivedHttpError', 'public boolean onRenderProcessGone'),
    sliceBetween(JAVA, 'public boolean onRenderProcessGone', 'public boolean shouldOverrideUrlLoading')
  ]) {
    assert.match(failure, /progressBar\.setProgress\(0\)/);
    assert.match(failure, /progressBar\.setVisibility\(android\.view\.View\.GONE\)/);
  }
  assert.match(JAVA, /progressBar\.setMax\(100\)/);
});

test('the build UI reports honest stages instead of a fabricated percentage', () => {
  const previewScript = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'scripts', 'app.js'),
    'utf8'
  );
  assert.match(previewScript, /const BUILD_STAGE_COUNT = 4;/);
  assert.match(previewScript, /function buildStageProgress\(status\)/);
  assert.match(previewScript, /function renderBuildStage\(stage\)/);
  assert.match(previewScript, /status\.state === "finalizing"/);
  assert.match(previewScript, /Step \$\{stage\.index\} of \$\{BUILD_STAGE_COUNT\}/);
  assert.ok(
    !previewScript.includes('Math.min(20 + attempts'),
    'the build percentage must not be estimated from polling attempts'
  );
});

test('full screen uses window insets APIs, cutout safe areas and re-applies on resume', () => {
  assert.ok(!JAVA.includes('SYSTEM_UI_FLAG'), 'legacy system UI flags are gone');
  assert.match(JAVA, /WindowInsetsControllerCompat/);
  assert.match(JAVA, /BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE/);
  assert.match(JAVA, /controller\.hide\(WindowInsetsCompat\.Type\.systemBars\(\)\)/);
  assert.match(JAVA, /WindowInsetsCompat\.Type\.displayCutout\(\)/);

  const resume = sliceBetween(JAVA, 'protected void onResume()', 'protected void onPause()');
  assert.match(resume, /applyImmersiveMode\(\)/);
  assert.match(JAVA, /public void onConfigurationChanged\(android\.content\.res\.Configuration newConfig\)/);
  assert.match(JAVA, /WindowCompat\.setDecorFitsSystemWindows\(getWindow\(\), false\)/);
});

test('mixed content is blocked by default and never weakens TLS validation', () => {
  assert.match(JAVA, /setMixedContentMode\(WebSettings\.MIXED_CONTENT_NEVER_ALLOW\)/);
  assert.ok(!JAVA.includes('MIXED_CONTENT_ALWAYS_ALLOW'));

  const compat = buildMainActivityJava({ ...BASE_OPTIONS, allowMixedContent: true });
  assert.match(compat, /setMixedContentMode\(WebSettings\.MIXED_CONTENT_COMPATIBILITY_MODE\)/);

  // No SSL error bypass of any kind is generated.
  assert.ok(!JAVA.includes('onReceivedSslError'));
  assert.ok(!JAVA.includes('handler.proceed()'));
  assert.match(JAVA, /Insecure content from this site was blocked/);
});

test('WebView permissions use a strict allowlist and verify the page origin', () => {
  const request = sliceBetween(JAVA, 'public void onPermissionRequest', 'public void onGeolocationPermissionsShowPrompt');
  assert.match(request, /isTrustedPermissionOrigin\(request\)/);
  assert.match(request, /ALLOWED_PERMISSION_RESOURCES\.contains\(resource\)/);
  assert.match(request, /androidPermissionFor\(resource\)/);
  assert.match(request, /grantPermissionResources\(request, grantable\)/);
  assert.ok(!JAVA.includes('request.grant(request.getResources())'), 'must not grant every requested resource');

  const allowlist = sliceBetween(JAVA, 'ALLOWED_PERMISSION_RESOURCES =', '// Link schemes');
  assert.match(allowlist, /RESOURCE_VIDEO_CAPTURE/);
  assert.match(allowlist, /RESOURCE_AUDIO_CAPTURE/);
  assert.ok(!allowlist.includes('RESOURCE_PROTECTED_MEDIA_ID'), 'unlisted resources stay unsupported');

  assert.match(JAVA, /private String androidPermissionFor\(String resource\)/);
  assert.match(JAVA, /request\.deny\(\)/);
  assert.match(JAVA, /if \(isFinishing\(\) \|\| isDestroyed\(\)\) \{\s*return;/);
  assert.match(JAVA, /Camera or microphone access was denied/);
});

test('the WebView is paused, resumed and fully destroyed with the activity', () => {
  const resume = sliceBetween(JAVA, 'protected void onResume()', 'protected void onPause()');
  assert.match(resume, /webView\.onResume\(\)/);
  assert.match(resume, /webView\.resumeTimers\(\)/);

  const pause = sliceBetween(JAVA, 'protected void onPause()', 'protected void onDestroy()');
  assert.match(pause, /webView\.onPause\(\)/);
  assert.match(pause, /webView\.pauseTimers\(\)/);
  assert.match(pause, /CookieManager\.getInstance\(\)\.flush\(\)/);

  const destroy = sliceBetween(JAVA, 'protected void onDestroy()', 'protected void onSaveInstanceState');
  assert.match(destroy, /view\.stopLoading\(\)/);
  assert.match(destroy, /removeView\(view\)/);
  assert.match(destroy, /view\.destroy\(\)/);
  assert.match(destroy, /filePathCallback\.onReceiveValue\(null\)/);
  assert.match(destroy, /handler\.removeCallbacksAndMessages\(null\)/);
  assert.match(destroy, /denyPermissionRequest\(pendingPermissionRequest\)/);

  // The current page is restored after a genuine recreation.
  assert.match(JAVA, /outState\.putString\(STATE_LAST_URL/);
});

test('renderer crashes recover without an infinite restart loop', () => {
  const crash = sliceBetween(JAVA, 'public boolean onRenderProcessGone', 'public boolean shouldOverrideUrlLoading');
  assert.match(crash, /destroyBrokenWebView\(view\)/);
  assert.match(crash, /rendererCrashCount > RENDERER_CRASH_LIMIT/);
  assert.match(crash, /showRendererErrorState\(\)/);

  assert.match(JAVA, /private void destroyBrokenWebView\(WebView broken\)/);
  assert.match(JAVA, /Page keeps crashing/);
  assert.match(JAVA, /rendererCrashCount = 0;/, 'a successful load resets the recovery budget');
});

test('external links validate schemes and report when nothing can open them', () => {
  const external = sliceBetween(JAVA, 'private boolean openExternally', 'private String schemeOf');
  assert.match(external, /EXTERNAL_LINK_SCHEMES\.contains\(scheme\)/);
  assert.match(external, /ActivityNotFoundException/);
  assert.match(external, /No installed app can open this link/);
  assert.match(external, /Intent\.parseUri\(url, Intent\.URI_INTENT_SCHEME\)/);
  assert.match(external, /CATEGORY_BROWSABLE/);

  const navigation = sliceBetween(JAVA, 'private boolean handleNavigation', 'private boolean looksLikeAuthEndpoint');
  assert.match(navigation, /EXTERNAL_LINK_SCHEMES\.contains\(scheme\)/);
  assert.match(JAVA, /Blocked a link with an unsupported scheme/);
});

test('pull-to-refresh is optional and adds no forced layers or arbitrary settings', () => {
  assert.match(JAVA, /final boolean enablePullToRefresh = true;/);
  assert.match(JAVA, /swipeRefresh\.setEnabled\(enablePullToRefresh\)/);
  const withoutRefresh = buildMainActivityJava({ ...BASE_OPTIONS, pullToRefresh: false });
  assert.match(withoutRefresh, /final boolean enablePullToRefresh = false;/);

  // No hardware-layer forcing, no extra render-process tuning, no new WebView settings.
  assert.ok(!JAVA.includes('LAYER_TYPE_HARDWARE'));
  assert.ok(!JAVA.includes('setRenderProcessMode'));
});

test('the preview uses the same splash rule as the app', () => {
  const previewScript = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'scripts', 'app.js'),
    'utf8'
  );
  assert.match(previewScript, /const pageReadyAt = Math\.max\(duration, PREVIEW_PAGE_READY_MS\);/);
});

test('the manifest declares download permission and validated app links', async () => {
  const buildsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'android-manifest-'));
  try {
    const project = await generateAndroidProject({
      ...BASE_OPTIONS,
      appVersion: '1.0.0',
      buildId: 'manifest-test',
      buildsDir,
      icon: null,
      autoFetchIcon: false
    });
    const manifest = fs.readFileSync(path.join(project.buildDir, 'app/src/main/AndroidManifest.xml'), 'utf8');

    assert.match(manifest, /android\.permission\.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28"/);
    assert.match(manifest, /android:launchMode="singleTop"/);
    assert.match(manifest, /android:autoVerify="true"/);
    assert.match(manifest, /<data android:scheme="https" android:host="example\.com" \/>/);
    assert.match(manifest, /<data android:scheme="siteapp" android:host="example\.com" \/>/);
  } finally {
    fs.rmSync(buildsDir, { recursive: true, force: true });
  }
});
