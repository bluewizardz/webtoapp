import { escapeJavaString } from './codegen.js';

// Generates the MainActivity.java source for a wrapped website.
//
// This file is Java source embedded in a JavaScript template, so it deliberately
// contains no backslashes and no interpolation other than the escaped literals
// built below. User text only enters through escapeJavaString.

/** Default identity providers that refuse to run sign-in inside an embedded WebView. */
export const DEFAULT_AUTH_HOSTS = [
  'accounts.google.com',
  'accounts.youtube.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'login.live.com',
  'login.yahoo.com',
  'login.salesforce.com',
  'id.atlassian.com',
  'github.com',
  'gitlab.com',
  'www.facebook.com',
  'm.facebook.com',
  'www.linkedin.com',
  'auth0.com',
  'okta.com'
];

/** Largest generated (Blob/data) file the app will accept, in bytes. */
export const MAX_BLOB_BYTES = 20 * 1024 * 1024;

// Runs inside the page. It is dependency free, contains no backslashes (so it can
// live in a Java text block), and only talks to the single-purpose download bridge.
const BLOB_FETCH_SCRIPT = `
var bridge = window.AndroidDownloader;
if (!bridge) { return; }
var fileName = "";
var anchors = document.querySelectorAll("a[download]");
for (var index = 0; index < anchors.length; index += 1) {
  if (anchors[index].href === url) {
    fileName = anchors[index].getAttribute("download") || "";
    break;
  }
}
function reportFailure(reason) {
  try { bridge.failBlobDownload(token, String(reason)); } catch (ignored) {}
}
fetch(url).then(function (response) {
  if (!response.ok) { throw new Error("HTTP " + response.status); }
  var mime = response.headers.get("content-type") || "";
  return response.blob().then(function (blob) {
    if (blob.size > maxBytes) { throw new Error("too-large"); }
    bridge.startBlobDownload(token, fileName, mime, blob.size);
    function readChunk(start) {
      if (start >= blob.size) { bridge.finishBlobDownload(token); return; }
      var end = Math.min(start + chunkBytes, blob.size);
      var reader = new FileReader();
      reader.onload = function () {
        var bytes = new Uint8Array(reader.result);
        var binary = "";
        for (var offset = 0; offset < bytes.length; offset += 1) {
          binary += String.fromCharCode(bytes[offset]);
        }
        try {
          bridge.appendBlobChunk(token, btoa(binary));
        } catch (error) {
          reportFailure("bridge-error");
          return;
        }
        readChunk(end);
      };
      reader.onerror = function () { reportFailure("read-error"); };
      reader.readAsArrayBuffer(blob.slice(start, end));
    }
    readChunk(0);
  });
}).catch(function (error) {
  reportFailure(error && error.message ? error.message : "fetch-error");
});
`;

function javaArray(values) {
  return values.map((value) => `"${escapeJavaString(value)}"`).join(', ');
}

function javaTextBlock(source, indent = '        ') {
  return source
    .trim()
    .split('\n')
    .map((line) => indent + line.trim())
    .join('\n');
}

export function buildMainActivityJava(options = {}) {
  const {
    appId,
    siteUrl,
    customUserAgent = null,
    enableZoom = false,
    fullScreen = false,
    pullToRefresh = true,
    showSpinner = true,
    showSplash = true,
    splashDuration = 2000,
    allowMixedContent = false,
    externalAuthHosts = DEFAULT_AUTH_HOSTS
  } = options;

  const hosts = (Array.isArray(externalAuthHosts) ? externalAuthHosts : DEFAULT_AUTH_HOSTS)
    .map((host) => String(host || '').trim().toLowerCase().replace(/^\.+/, ''))
    .filter(Boolean);
  const duration = Math.min(10000, Math.max(0, Number(splashDuration) || 2000));
  const userAgentLiteral = customUserAgent ? `"${escapeJavaString(customUserAgent)}"` : 'null';
  // Insecure subresources are blocked unless a site explicitly opts in.
  const mixedContentConstant = allowMixedContent
    ? 'WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE'
    : 'WebSettings.MIXED_CONTENT_NEVER_ALLOW';
  const blobScript = javaTextBlock(BLOB_FETCH_SCRIPT);

  return `package ${appId};

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.ContentValues;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.Toast;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

public class MainActivity extends Activity {
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_PERMISSIONS = 1002;
    private static final int REQ_DOWNLOAD_PERMISSION = 1003;

    // Generated (Blob/data) downloads are streamed in small chunks and capped, so a
    // hostile page cannot exhaust memory or fill the device through the bridge.
    private static final long MAX_BLOB_BYTES = ${MAX_BLOB_BYTES}L;
    private static final long BLOB_CHUNK_BYTES = 192L * 1024L;
    private static final String DOWNLOAD_BRIDGE_NAME = "AndroidDownloader";

    // Identity providers that block embedded sign-in. Override with the
    // externalAuthHosts build option when a site uses a different provider.
    private static final String[] EXTERNAL_AUTH_HOSTS = { ${javaArray(hosts)} };

    private static final long SPLASH_HARD_TIMEOUT_MS = 15000L;
    private static final String STATE_LAST_URL = "last_url";

    // Mixed content is blocked by default; the build can opt into compatibility.
    private static final boolean MIXED_CONTENT_ALLOWED = ${allowMixedContent ? 'true' : 'false'};

    // WebView permission resources that may be granted, mapped to the Android
    // runtime permission that gates them. Everything else is denied.
    private static final Set<String> ALLOWED_PERMISSION_RESOURCES = new HashSet<String>(Arrays.asList(
        PermissionRequest.RESOURCE_VIDEO_CAPTURE,
        PermissionRequest.RESOURCE_AUDIO_CAPTURE
    ));

    // Link schemes that may leave the app through an external intent.
    private static final Set<String> EXTERNAL_LINK_SCHEMES = new HashSet<String>(Arrays.asList(
        "http", "https", "mailto", "tel", "sms", "smsto", "geo", "market", "intent"
    ));

    private static final int RENDERER_CRASH_LIMIT = 3;
    private static final long RENDERER_CRASH_WINDOW_MS = 60000L;
    private static int rendererCrashCount = 0;
    private static long lastRendererCrashAt = 0L;

    private static final String BLOB_SCRIPT = """
${blobScript}
        """;

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private WebView popupView;

    private String siteHost = "";
    private volatile String currentPageHost = "";

    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingPermissionRequest;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;

    private boolean loadingInProgress = false;
    private boolean mainFrameReady = false;
    private boolean splashDismissed = false;
    private long splashShownAt = 0L;
    private boolean fullScreenMode = false;
    private boolean showProgressBar = true;
    private String lastPageUrl = "";
    private boolean insecureContentNoticeShown = false;
    private java.util.List<String> pendingPermissionResources;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Set<String> promptedAuthHosts = new HashSet<String>();

    private BroadcastReceiver downloadReceiver;
    private PendingDownload pendingDownload;

    private String blobToken;
    private File blobTempFile;
    private FileOutputStream blobStream;
    private String blobFileName = "";
    private String blobMimeType = "application/octet-stream";
    private long blobReceived = 0L;

    private final Runnable splashMinTimer = new Runnable() {
        @Override
        public void run() {
            maybeDismissSplash();
        }
    };

    private final Runnable splashHardTimeout = new Runnable() {
        @Override
        public void run() {
            // The page never signalled readiness; never trap the user behind the splash.
            mainFrameReady = true;
            maybeDismissSplash();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final boolean fullScreen = ${fullScreen ? 'true' : 'false'};
        fullScreenMode = fullScreen;
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (fullScreen) {
            applyImmersiveMode();
        }

        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webView);
        swipeRefresh = findViewById(R.id.swipeRefresh);
        progressBar = findViewById(R.id.progressBar);

        // Safe areas always account for display cutouts; system bar insets are only
        // applied outside full-screen so immersive content can use the whole screen.
        final android.view.View contentRoot = findViewById(R.id.contentRoot);
        final int initialPaddingLeft = contentRoot.getPaddingLeft();
        final int initialPaddingTop = contentRoot.getPaddingTop();
        final int initialPaddingRight = contentRoot.getPaddingRight();
        final int initialPaddingBottom = contentRoot.getPaddingBottom();
        ViewCompat.setOnApplyWindowInsetsListener(contentRoot, (view, windowInsets) -> {
            Insets safeInsets = fullScreen
                ? windowInsets.getInsets(WindowInsetsCompat.Type.displayCutout())
                : windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
            view.setPadding(
                initialPaddingLeft + safeInsets.left,
                initialPaddingTop + safeInsets.top,
                initialPaddingRight + safeInsets.right,
                initialPaddingBottom + safeInsets.bottom
            );
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(contentRoot);

        webView.setBackgroundColor(0xFF09080F);

        final boolean enablePullToRefresh = ${pullToRefresh ? 'true' : 'false'};
        final boolean showSpinner = ${showSpinner ? 'true' : 'false'};
        final boolean showSplash = ${showSplash ? 'true' : 'false'};
        final int splashDuration = ${duration};
        showProgressBar = showSpinner;
        progressBar.setMax(100);
        progressBar.setProgress(0);
        progressBar.setVisibility(android.view.View.GONE);

        Uri siteUri = Uri.parse("${escapeJavaString(siteUrl)}");
        siteHost = siteUri.getHost() == null ? "" : siteUri.getHost().toLowerCase(Locale.US);
        currentPageHost = siteHost;

        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setDatabaseEnabled(true);
        webSettings.setLoadWithOverviewMode(true);
        webSettings.setUseWideViewPort(true);
        webSettings.setMixedContentMode(${mixedContentConstant});
        // Popups are routed through onCreateWindow instead of spawning visible windows.
        webSettings.setSupportMultipleWindows(true);
        webSettings.setJavaScriptCanOpenWindowsAutomatically(true);
        // The wrapper never needs local files, so file access stays disabled.
        webSettings.setAllowFileAccess(false);
        webSettings.setAllowContentAccess(true);
        webSettings.setAllowFileAccessFromFileURLs(false);
        webSettings.setAllowUniversalAccessFromFileURLs(false);

        final String customUA = ${userAgentLiteral};
        if (customUA != null && !customUA.trim().isEmpty()) {
            webSettings.setUserAgentString(customUA);
        }

        final boolean allowZoom = ${enableZoom ? 'true' : 'false'};
        webSettings.setSupportZoom(allowZoom);
        webSettings.setBuiltInZoomControls(allowZoom);
        webSettings.setDisplayZoomControls(false);

        // Third-party cookies are off by default for apps targeting Lollipop or newer
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        swipeRefresh.setEnabled(enablePullToRefresh);
        if (enablePullToRefresh) {
            swipeRefresh.setOnChildScrollUpCallback(new SwipeRefreshLayout.OnChildScrollUpCallback() {
                @Override
                public boolean canChildScrollUp(SwipeRefreshLayout parent, android.view.View child) {
                    return webView.canScrollVertically(-1);
                }
            });
            swipeRefresh.setOnRefreshListener(new SwipeRefreshLayout.OnRefreshListener() {
                @Override
                public void onRefresh() {
                    if (loadingInProgress) {
                        // A reload is already running; ignore the duplicate gesture.
                        swipeRefresh.setRefreshing(false);
                        return;
                    }
                    loadingInProgress = true;
                    mainFrameReady = false;
                    webView.reload();
                }
            });
        }

        setupWebViewClient(showSpinner);
        setupWebChromeClient();
        setupDownloadHandling();

        // Only the four download methods are exposed, and each one checks that the
        // caller is the wrapped site. No general-purpose JS bridge is registered.
        webView.addJavascriptInterface(new DownloadBridge(), DOWNLOAD_BRIDGE_NAME);

        if (showSplash) {
            splashShownAt = SystemClock.elapsedRealtime();
            handler.postDelayed(splashMinTimer, splashDuration);
            handler.postDelayed(splashHardTimeout, splashDuration + SPLASH_HARD_TIMEOUT_MS);
        } else {
            splashDismissed = true;
        }

        String initialUrl = "${escapeJavaString(siteUrl)}";
        if (savedInstanceState != null) {
            String restoredUrl = savedInstanceState.getString(STATE_LAST_URL);
            if (restoredUrl != null && isTrustedRestoreUrl(restoredUrl)) {
                initialUrl = restoredUrl;
            }
        }
        webView.loadUrl(initialUrl);
        handleIncomingIntent(getIntent());
    }

    private void applyImmersiveMode() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        // A swipe reveals the bars temporarily, then they hide themselves again.
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Rotation or a navigation-mode change can restore the bars; re-hide them.
        if (fullScreenMode) {
            applyImmersiveMode();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    private void setupWebViewClient(final boolean showSpinner) {
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                loadingInProgress = true;
                mainFrameReady = false;
                currentPageHost = hostOf(url);
                // A navigation cancels any in-flight generated download.
                cancelBlobDownload(false);
                if (showSpinner && !swipeRefresh.isRefreshing()) {
                    progressBar.setProgress(0);
                    progressBar.setVisibility(android.view.View.VISIBLE);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                loadingInProgress = false;
                mainFrameReady = true;
                currentPageHost = hostOf(url);
                lastPageUrl = url;
                // A successful load clears the renderer-crash recovery budget.
                rendererCrashCount = 0;
                lastRendererCrashAt = 0L;
                if (showSpinner) {
                    progressBar.setProgress(0);
                    progressBar.setVisibility(android.view.View.GONE);
                }
                swipeRefresh.setRefreshing(false);
                maybeDismissSplash();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // Subresource failures must not stop the main-frame refresh indicator,
                // but insecure content that the app blocked deserves an explanation.
                if (request != null && !request.isForMainFrame()) {
                    notifyIfMixedContentBlocked(request);
                    return;
                }
                progressBar.setProgress(0);
                loadingInProgress = false;
                mainFrameReady = true;
                if (showSpinner) {
                    progressBar.setVisibility(android.view.View.GONE);
                }
                swipeRefresh.setRefreshing(false);
                maybeDismissSplash();
                Toast.makeText(MainActivity.this, "The page could not be loaded. Check your connection and pull to refresh.", Toast.LENGTH_LONG).show();
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, android.webkit.WebResourceResponse response) {
                if (request != null && !request.isForMainFrame()) {
                    return;
                }
                // The error page itself still renders, so only the indicator resets.
                loadingInProgress = false;
                progressBar.setProgress(0);
                progressBar.setVisibility(android.view.View.GONE);
                swipeRefresh.setRefreshing(false);
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // The renderer crashed: reset every indicator before recovering.
                loadingInProgress = false;
                mainFrameReady = true;
                swipeRefresh.setRefreshing(false);
                progressBar.setProgress(0);
                progressBar.setVisibility(android.view.View.GONE);
                maybeDismissSplash();
                destroyBrokenWebView(view);

                long now = SystemClock.elapsedRealtime();
                if (now - lastRendererCrashAt > RENDERER_CRASH_WINDOW_MS) {
                    rendererCrashCount = 0;
                }
                lastRendererCrashAt = now;
                rendererCrashCount += 1;

                if (rendererCrashCount > RENDERER_CRASH_LIMIT) {
                    // Repeated crashes: stop restarting and explain the state instead.
                    showRendererErrorState();
                    return true;
                }

                Toast.makeText(MainActivity.this, "The page stopped responding. Reloading…", Toast.LENGTH_LONG).show();
                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        if (!isFinishing() && !isDestroyed()) {
                            recreate();
                        }
                    }
                });
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl().toString());
            }
        });
    }

    private void setupWebChromeClient() {
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                // A hidden WebView captures the popup's first URL, then we decide
                // whether it belongs in the app or in the browser. It is destroyed
                // immediately, so no extra visible WebView is ever created.
                destroyPopup();
                final WebView hidden = new WebView(MainActivity.this);
                hidden.getSettings().setJavaScriptEnabled(true);
                hidden.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView popup, String url) {
                        return handlePopupUrl(url);
                    }

                    @Override
                    public boolean shouldOverrideUrlLoading(WebView popup, WebResourceRequest request) {
                        return handlePopupUrl(request.getUrl().toString());
                    }
                });
                hidden.setWebChromeClient(new WebChromeClient() {
                    @Override
                    public void onCloseWindow(WebView window) {
                        destroyPopup();
                    }
                });
                popupView = hidden;
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(hidden);
                resultMsg.sendToTarget();
                return true;
            }

            @Override
            public void onCloseWindow(WebView window) {
                destroyPopup();
            }

            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (!showProgressBar) {
                    return;
                }
                // Real page progress from the WebView, not an indeterminate animation.
                progressBar.setProgress(newProgress);
                if (newProgress >= 100) {
                    progressBar.setVisibility(android.view.View.GONE);
                } else if (progressBar.getVisibility() != android.view.View.VISIBLE) {
                    progressBar.setVisibility(android.view.View.VISIBLE);
                }
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE_CHOOSER);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                if (request == null) {
                    return;
                }
                // Only the wrapped site and its subdomains may ask for device access.
                if (!isTrustedPermissionOrigin(request)) {
                    denyPermissionRequest(request);
                    showToast("Blocked a permission request from an untrusted page.");
                    return;
                }
                final java.util.ArrayList<String> grantable = new java.util.ArrayList<>();
                final java.util.ArrayList<String> missing = new java.util.ArrayList<>();
                String[] requested;
                try {
                    requested = request.getResources();
                } catch (Exception error) {
                    denyPermissionRequest(request);
                    return;
                }
                for (String resource : requested) {
                    // Resource types outside the allowlist are never granted.
                    if (!ALLOWED_PERMISSION_RESOURCES.contains(resource)) {
                        continue;
                    }
                    String androidPermission = androidPermissionFor(resource);
                    if (androidPermission == null) {
                        continue;
                    }
                    if (checkSelfPermission(androidPermission) == PackageManager.PERMISSION_GRANTED) {
                        grantable.add(resource);
                    } else if (!missing.contains(androidPermission)) {
                        missing.add(androidPermission);
                    }
                }
                if (!missing.isEmpty()) {
                    pendingPermissionRequest = request;
                    pendingPermissionResources = new java.util.ArrayList<>(grantable);
                    requestPermissions(missing.toArray(new String[0]), REQ_PERMISSIONS);
                    return;
                }
                if (grantable.isEmpty()) {
                    denyPermissionRequest(request);
                    return;
                }
                grantPermissionResources(request, grantable);
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                } else {
                    pendingGeoCallback = callback;
                    pendingGeoOrigin = origin;
                    requestPermissions(new String[]{android.Manifest.permission.ACCESS_FINE_LOCATION}, REQ_PERMISSIONS);
                }
            }
        });
    }

    // === Downloads (HTTP and HTTPS) ===

    private void setupDownloadHandling() {
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                handleDownloadStart(url, userAgent, contentDisposition, mimeType, contentLength);
            }
        });
    }

    private void handleDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
        if (url == null || url.isEmpty()) {
            showToast("This download link is not valid.");
            return;
        }
        String scheme = schemeOf(url);
        if ("blob".equals(scheme) || "data".equals(scheme)) {
            requestGeneratedDownload(url);
            return;
        }
        if (!"http".equals(scheme) && !"https".equals(scheme)) {
            if ("intent".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme)) {
                openExternally(url);
            } else {
                showToast("This download type is not supported by the app.");
            }
            return;
        }
        enqueueHttpDownload(new PendingDownload(url, userAgent, contentDisposition, mimeType, contentLength));
    }

    private void enqueueHttpDownload(PendingDownload download) {
        if (download == null) {
            return;
        }
        if (Build.VERSION.SDK_INT < 29
                && checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            // Only needed before Android 10; ask once and retry on the result.
            pendingDownload = download;
            requestPermissions(new String[]{android.Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_DOWNLOAD_PERMISSION);
            return;
        }
        try {
            String fileName = resolveDownloadFileName(download.contentDisposition, download.url);
            String safeMimeType = resolveMimeType(download.mimeType, fileName);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(download.url));
            request.setMimeType(safeMimeType);
            request.setTitle(fileName);
            request.setDescription(siteHost);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.allowScanningByMediaScanner();

            // The page may be authenticated with cookies, so pass them to the
            // system downloader; without them the server returns a login page.
            String cookie = CookieManager.getInstance().getCookie(download.url);
            if (cookie != null && !cookie.isEmpty()) {
                request.addRequestHeader("Cookie", cookie);
            }
            if (download.userAgent != null && !download.userAgent.isEmpty()) {
                request.addRequestHeader("User-Agent", download.userAgent);
            }

            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) {
                showToast("Downloads are unavailable on this device.");
                return;
            }
            manager.enqueue(request);
            showToast("Downloading " + fileName + "…");
        } catch (Exception error) {
            // Downloaded files are never opened automatically, so a broken download
            // cannot launch an intent built from attacker-controlled data.
            showToast("The download could not be started. Try opening the link in your browser.");
        }
    }

    private void reportDownloadResult(long downloadId) {
        if (downloadId < 0) {
            return;
        }
        DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            return;
        }
        Cursor cursor = null;
        try {
            cursor = manager.query(new DownloadManager.Query().setFilterById(downloadId));
            if (cursor != null && cursor.moveToFirst()) {
                int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                if (status == DownloadManager.STATUS_FAILED) {
                    int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                    showToast("Download failed (code " + reason + "). Try again or open the link in your browser.");
                }
            }
        } catch (Exception error) {
            // A failed status query is not worth interrupting the user over.
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
    }

    private void registerDownloadReceiver() {
        if (downloadReceiver != null) {
            return;
        }
        downloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null || !DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) {
                    return;
                }
                reportDownloadResult(intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L));
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        ContextCompat.registerReceiver(this, downloadReceiver, filter, ContextCompat.RECEIVER_EXPORTED);
    }

    private void unregisterDownloadReceiver() {
        if (downloadReceiver == null) {
            return;
        }
        try {
            unregisterReceiver(downloadReceiver);
        } catch (IllegalArgumentException ignored) {
            // Already unregistered.
        }
        downloadReceiver = null;
    }

    private String resolveDownloadFileName(String contentDisposition, String url) {
        String candidate = extractFileName(contentDisposition);
        if (candidate == null || candidate.isEmpty()) {
            candidate = lastPathSegment(url);
        }
        String sanitized = sanitizeFileName(candidate);
        if (sanitized.isEmpty()) {
            sanitized = "download";
        }
        if (extensionOf(sanitized).isEmpty()) {
            String extension = extensionForMimeType(resolveMimeType(null, sanitized));
            if (!extension.isEmpty()) {
                sanitized = sanitized + "." + extension;
            }
        }
        return sanitized;
    }

    private String extractFileName(String contentDisposition) {
        if (contentDisposition == null) {
            return null;
        }
        String lower = contentDisposition.toLowerCase(Locale.US);
        int index = lower.indexOf("filename");
        if (index < 0) {
            return null;
        }
        int equals = contentDisposition.indexOf('=', index);
        if (equals < 0) {
            return null;
        }
        String value = contentDisposition.substring(equals + 1).trim();
        if (!value.isEmpty() && value.charAt(0) == '"') {
            int closing = value.indexOf('"', 1);
            value = closing > 0 ? value.substring(1, closing) : value.substring(1);
        } else {
            int semicolon = value.indexOf(';');
            if (semicolon >= 0) {
                value = value.substring(0, semicolon);
            }
        }
        value = value.trim();
        // RFC 5987 form: UTF-8''name.pdf
        int quoted = value.indexOf("''");
        if (quoted >= 0) {
            value = value.substring(quoted + 2);
        }
        return value;
    }

    private String lastPathSegment(String url) {
        if (url == null) {
            return "";
        }
        String withoutQuery = url;
        int query = withoutQuery.indexOf('?');
        if (query >= 0) {
            withoutQuery = withoutQuery.substring(0, query);
        }
        int hash = withoutQuery.indexOf('#');
        if (hash >= 0) {
            withoutQuery = withoutQuery.substring(0, hash);
        }
        int slash = withoutQuery.lastIndexOf('/');
        return slash >= 0 ? withoutQuery.substring(slash + 1) : "";
    }

    // Keeps names inside one directory and free of characters that break the
    // filesystem or HTTP headers.
    private String sanitizeFileName(String name) {
        if (name == null) {
            return "";
        }
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < name.length() && builder.length() < 120; index += 1) {
            char character = name.charAt(index);
            boolean allowed = Character.isLetterOrDigit(character)
                || character == '.' || character == '-' || character == '_'
                || character == ' ' || character == '(' || character == ')'
                || character == '+' || character == '=';
            builder.append(allowed ? character : '_');
        }
        String result = builder.toString().trim();
        while (result.startsWith(".")) {
            result = result.substring(1);
        }
        if (result.equals("..")) {
            return "";
        }
        return result;
    }

    private String extensionOf(String fileName) {
        if (fileName == null) {
            return "";
        }
        int dot = fileName.lastIndexOf('.');
        if (dot < 0 || dot == fileName.length() - 1) {
            return "";
        }
        return fileName.substring(dot + 1).toLowerCase(Locale.US);
    }

    private String extensionForMimeType(String mimeType) {
        if (mimeType == null) {
            return "";
        }
        String extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
        return extension == null ? "" : extension;
    }

    private String resolveMimeType(String rawMimeType, String fileName) {
        String mimeType = rawMimeType == null ? "" : rawMimeType.trim().toLowerCase(Locale.US);
        int semicolon = mimeType.indexOf(';');
        if (semicolon >= 0) {
            mimeType = mimeType.substring(0, semicolon).trim();
        }
        if (isSafeMimeType(mimeType)) {
            return mimeType;
        }
        String extension = extensionOf(fileName);
        if (!extension.isEmpty()) {
            String guessed = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
            if (guessed != null && isSafeMimeType(guessed)) {
                return guessed;
            }
        }
        return "application/octet-stream";
    }

    private boolean isSafeMimeType(String mimeType) {
        if (mimeType == null || mimeType.isEmpty()) {
            return false;
        }
        int slash = mimeType.indexOf('/');
        if (slash <= 0 || slash == mimeType.length() - 1) {
            return false;
        }
        for (int index = 0; index < mimeType.length(); index += 1) {
            char character = mimeType.charAt(index);
            boolean allowed = Character.isLetterOrDigit(character)
                || character == '/' || character == '+' || character == '-' || character == '.';
            if (!allowed) {
                return false;
            }
        }
        return true;
    }

    // === Downloads (generated Blob and data URLs) ===

    private void requestGeneratedDownload(String url) {
        if (!isTrustedPage()) {
            showToast("Blocked a download from an untrusted page.");
            return;
        }
        cancelBlobDownload(false);
        final String token = UUID.randomUUID().toString();
        String script = "(function () {"
            + "var url = " + javaScriptLiteral(url) + ";"
            + "var token = " + javaScriptLiteral(token) + ";"
            + "var maxBytes = " + MAX_BLOB_BYTES + ";"
            + "var chunkBytes = " + BLOB_CHUNK_BYTES + ";"
            + BLOB_SCRIPT
            + "})();";
        webView.evaluateJavascript(script, null);
        showToast("Preparing file…");
    }

    private class DownloadBridge {
        @JavascriptInterface
        public void startBlobDownload(String token, String fileName, String mimeType, double size) {
            if (!isTrustedPage()) {
                return;
            }
            if (size <= 0 || size > MAX_BLOB_BYTES) {
                showToast("This file is too large to save inside the app (limit " + (MAX_BLOB_BYTES / (1024 * 1024)) + " MB).");
                return;
            }
            beginBlobFile(token, fileName, mimeType, (long) size);
        }

        @JavascriptInterface
        public void appendBlobChunk(String token, String base64Chunk) {
            if (!isTrustedPage()) {
                return;
            }
            appendBlobFile(token, base64Chunk);
        }

        @JavascriptInterface
        public void finishBlobDownload(String token) {
            if (!isTrustedPage()) {
                return;
            }
            finishBlobFile(token);
        }

        @JavascriptInterface
        public void failBlobDownload(String token, String reason) {
            if (!isTrustedPage()) {
                return;
            }
            cancelBlobFile(token, reason);
        }
    }

    private synchronized void beginBlobFile(String token, String fileName, String mimeType, long size) {
        cancelBlobDownload(false);
        blobToken = token;
        blobReceived = 0L;
        blobMimeType = resolveMimeType(mimeType, fileName == null ? "" : fileName);
        blobFileName = resolveGeneratedFileName(fileName, blobMimeType);
        try {
            blobTempFile = new File(getCacheDir(), "download-" + token + ".part");
            blobStream = new FileOutputStream(blobTempFile);
        } catch (IOException error) {
            cancelBlobDownload(false);
            showToast("The file could not be saved.");
        }
    }

    private synchronized void appendBlobFile(String token, String base64Chunk) {
        if (blobStream == null || token == null || !token.equals(blobToken) || base64Chunk == null) {
            return;
        }
        byte[] data;
        try {
            data = Base64.decode(base64Chunk, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            cancelBlobFile(token, "invalid-data");
            return;
        }
        if (blobReceived + data.length > MAX_BLOB_BYTES) {
            cancelBlobFile(token, "too-large");
            return;
        }
        try {
            blobStream.write(data);
            blobReceived += data.length;
        } catch (IOException error) {
            cancelBlobFile(token, "write-error");
        }
    }

    private synchronized void finishBlobFile(String token) {
        if (blobStream == null || token == null || !token.equals(blobToken)) {
            return;
        }
        String fileName = blobFileName;
        String mimeType = blobMimeType;
        long size = blobReceived;
        File temp = blobTempFile;
        try {
            blobStream.flush();
            blobStream.close();
        } catch (IOException ignored) {
            // The size check below is the source of truth.
        }
        blobStream = null;
        blobTempFile = null;
        blobToken = null;
        blobReceived = 0L;

        if (size <= 0 || size > MAX_BLOB_BYTES) {
            if (temp != null) {
                temp.delete();
            }
            showToast("The file could not be saved.");
            return;
        }
        if (publishBlobFile(temp, fileName, mimeType)) {
            showToast("Saved " + fileName + " to your Downloads.");
        } else {
            if (temp != null) {
                temp.delete();
            }
            showToast("The file could not be saved. Try the site in your browser.");
        }
    }

    private synchronized void cancelBlobFile(String token, String reason) {
        if (blobToken == null || token == null || !token.equals(blobToken)) {
            return;
        }
        cancelBlobDownload(false);
        showToast(blobFailureMessage(reason));
    }

    private String blobFailureMessage(String reason) {
        if ("too-large".equals(reason)) {
            return "The file is too large to download (limit " + (MAX_BLOB_BYTES / (1024 * 1024)) + " MB).";
        }
        if ("read-error".equals(reason) || "invalid-data".equals(reason) || "write-error".equals(reason) || "bridge-error".equals(reason)) {
            return "The file could not be saved. Try again.";
        }
        return "Download failed. Try opening the page in your browser.";
    }

    private synchronized void cancelBlobDownload(boolean notifyUser) {
        if (blobStream != null) {
            try {
                blobStream.close();
            } catch (IOException ignored) {
                // Ignore.
            }
        }
        if (blobTempFile != null) {
            blobTempFile.delete();
        }
        blobStream = null;
        blobTempFile = null;
        blobToken = null;
        blobReceived = 0L;
        if (notifyUser) {
            showToast("Download cancelled.");
        }
    }

    private String resolveGeneratedFileName(String fileName, String mimeType) {
        String sanitized = sanitizeFileName(fileName);
        if (sanitized.isEmpty()) {
            sanitized = "download";
        }
        if (extensionOf(sanitized).isEmpty()) {
            String extension = extensionForMimeType(mimeType);
            if (!extension.isEmpty()) {
                sanitized = sanitized + "." + extension;
            }
        }
        return sanitized;
    }

    private boolean publishBlobFile(File source, String fileName, String mimeType) {
        if (source == null || !source.exists()) {
            return false;
        }
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri item = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (item != null) {
                    OutputStream output = getContentResolver().openOutputStream(item);
                    if (output != null) {
                        InputStream input = new FileInputStream(source);
                        copyStream(input, output);
                        values.clear();
                        values.put(MediaStore.Downloads.IS_PENDING, 0);
                        getContentResolver().update(item, values, null, null);
                        source.delete();
                        return true;
                    }
                }
            }
            File directory = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (directory == null) {
                directory = new File(getFilesDir(), "Downloads");
            }
            if (!directory.exists() && !directory.mkdirs()) {
                return false;
            }
            File destination = new File(directory, fileName);
            if (source.renameTo(destination)) {
                return true;
            }
            InputStream input = new FileInputStream(source);
            OutputStream output = new FileOutputStream(destination);
            copyStream(input, output);
            source.delete();
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    private void copyStream(InputStream input, OutputStream output) throws IOException {
        try {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) > 0) {
                output.write(buffer, 0, read);
            }
            output.flush();
        } finally {
            try {
                input.close();
            } catch (IOException ignored) {
                // Ignore.
            }
            try {
                output.close();
            } catch (IOException ignored) {
                // Ignore.
            }
        }
    }

    private boolean isTrustedPage() {
        String host = currentPageHost;
        return host != null && !host.isEmpty() && isSameSite(host);
    }

    private void showToast(final String message) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
            }
        });
    }

    // === Popups and new windows ===

    private boolean handlePopupUrl(String url) {
        if (url == null || url.startsWith("about:")) {
            destroyPopup();
            return true;
        }
        String scheme = schemeOf(url);
        if (!"http".equals(scheme) && !"https".equals(scheme)) {
            if ("intent".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme)) {
                openExternally(url);
            } else {
                showToast("Blocked an unsupported popup link.");
            }
            destroyPopup();
            return true;
        }
        String host = hostOf(url);
        if (isSameSite(host)) {
            // Approved same-site popups continue inside the app.
            destroyPopup();
            webView.loadUrl(url);
            return true;
        }
        destroyPopup();
        if (isExternalAuthHost(host) || looksLikeAuthEndpoint(Uri.parse(url))) {
            promptExternalAuth(url, host);
        } else {
            // Untrusted destinations never get a hidden WebView: open the browser.
            openExternally(url);
        }
        return true;
    }

    private void destroyPopup() {
        if (popupView == null) {
            return;
        }
        final WebView view = popupView;
        popupView = null;
        try {
            view.loadUrl("about:blank");
            view.removeAllViews();
            view.destroy();
        } catch (Exception ignored) {
            // The renderer may already be gone.
        }
    }

    // === Authentication ===

    private boolean handleNavigation(String url) {
        try {
            Uri uri = Uri.parse(url);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.US);
            if (!scheme.equals("http") && !scheme.equals("https")) {
                if (!EXTERNAL_LINK_SCHEMES.contains(scheme)) {
                    showToast("Blocked a link with an unsupported scheme.");
                    return true;
                }
                openExternally(url);
                return true;
            }
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.US);
            if (!isSameSite(host) && (isExternalAuthHost(host) || looksLikeAuthEndpoint(uri))) {
                promptExternalAuth(url, host);
                return true;
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    private boolean looksLikeAuthEndpoint(Uri uri) {
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.US);
        if (host.startsWith("login.") || host.startsWith("accounts.") || host.startsWith("signin.")
                || host.startsWith("sso.") || host.startsWith("auth.")) {
            return true;
        }
        String path = uri.getPath() == null ? "" : uri.getPath().toLowerCase(Locale.US);
        return path.contains("/oauth") || path.contains("/authorize") || path.contains("/saml")
            || path.contains("/openid") || path.contains("/signin-oidc");
    }

    private void promptExternalAuth(final String url, final String host) {
        if (promptedAuthHosts.contains(host)) {
            openExternally(url);
            return;
        }
        promptedAuthHosts.add(host);
        new AlertDialog.Builder(this)
            .setTitle("Continue sign-in")
            .setMessage("This sign-in provider blocks embedded browsers. You can continue in your browser, but browser cookies are separate from the app, so you may still need to sign in again here. You can also try signing in inside the app.")
            .setPositiveButton("Open browser", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    openExternally(url);
                }
            })
            .setNegativeButton("Try inside app", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    webView.loadUrl(url);
                }
            })
            .setNeutralButton("Cancel", null)
            .show();
    }

    // === Deep links (app links and site callbacks) ===

    private void handleIncomingIntent(Intent intent) {
        if (intent == null || intent.getData() == null) {
            return;
        }
        Uri data = intent.getData();
        String scheme = data.getScheme() == null ? "" : data.getScheme().toLowerCase(Locale.US);
        String target = null;

        if ("siteapp".equals(scheme)) {
            String callback = data.getQueryParameter("url");
            if (callback != null && isTrustedCallbackUrl(callback)) {
                target = callback;
            }
        } else if (("http".equals(scheme) || "https".equals(scheme)) && isSameSite(hostOf(data.toString()))) {
            target = data.toString();
        }

        if (target == null) {
            showToast("Ignored a link that does not belong to this app.");
            return;
        }
        if (webView != null) {
            webView.loadUrl(target);
        }
    }

    private boolean isTrustedCallbackUrl(String value) {
        try {
            Uri uri = Uri.parse(value);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.US);
            if (!scheme.equals("http") && !scheme.equals("https")) {
                return false;
            }
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.US);
            return isSameSite(host);
        } catch (Exception error) {
            return false;
        }
    }

    private boolean isSameSite(String host) {
        if (host == null || host.isEmpty() || siteHost.isEmpty()) {
            return false;
        }
        return host.equals(siteHost) || host.endsWith("." + siteHost);
    }

    private boolean isExternalAuthHost(String host) {
        if (host == null) {
            return false;
        }
        for (String authHost : EXTERNAL_AUTH_HOSTS) {
            if (host.equals(authHost) || host.endsWith("." + authHost)) {
                return true;
            }
        }
        return false;
    }

    private boolean openExternally(String url) {
        String scheme = schemeOf(url);
        if (!EXTERNAL_LINK_SCHEMES.contains(scheme)) {
            showToast("Blocked a link with an unsupported scheme.");
            return false;
        }
        try {
            Intent intent;
            if ("intent".equals(scheme)) {
                intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                // Only browserable targets may be launched, never private components.
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.setComponent(null);
            } else {
                intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            }
            startActivity(intent);
            return true;
        } catch (android.content.ActivityNotFoundException missingApp) {
            showToast("No installed app can open this link.");
            return false;
        } catch (Exception error) {
            showToast("This link could not be opened.");
            return false;
        }
    }

    private String schemeOf(String url) {
        try {
            String scheme = Uri.parse(url).getScheme();
            return scheme == null ? "" : scheme.toLowerCase(Locale.US);
        } catch (Exception error) {
            return "";
        }
    }

    private String hostOf(String url) {
        try {
            String host = Uri.parse(url).getHost();
            return host == null ? "" : host.toLowerCase(Locale.US);
        } catch (Exception error) {
            return "";
        }
    }

    // Builds a JavaScript string literal without relying on regex escaping.
    private String javaScriptLiteral(String value) {
        StringBuilder builder = new StringBuilder();
        builder.append('"');
        String text = value == null ? "" : value;
        for (int index = 0; index < text.length(); index += 1) {
            char character = text.charAt(index);
            if (character == 34) {
                builder.append((char) 92).append('"');
            } else if (character == 92) {
                builder.append((char) 92).append((char) 92);
            } else if (character == 10) {
                builder.append((char) 92).append('n');
            } else if (character == 13) {
                builder.append((char) 92).append('r');
            } else if (character == 60) {
                builder.append((char) 92).append('u').append('0').append('0').append('3').append('c');
            } else if (character < 32) {
                builder.append(' ');
            } else {
                builder.append(character);
            }
        }
        builder.append('"');
        return builder.toString();
    }

    // === External links, permissions and recovery helpers ===

    private boolean isTrustedRestoreUrl(String url) {
        if (url == null || url.isEmpty()) {
            return false;
        }
        String scheme = schemeOf(url);
        if (!scheme.equals("http") && !scheme.equals("https")) {
            return false;
        }
        return isSameSite(hostOf(url));
    }

    private boolean isTrustedPermissionOrigin(PermissionRequest request) {
        Uri origin;
        try {
            origin = request.getOrigin();
        } catch (Exception error) {
            return false;
        }
        if (origin == null) {
            return false;
        }
        String scheme = origin.getScheme() == null ? "" : origin.getScheme().toLowerCase(Locale.US);
        if (!scheme.equals("http") && !scheme.equals("https")) {
            return false;
        }
        return isSameSite(origin.getHost() == null ? "" : origin.getHost().toLowerCase(Locale.US));
    }

    private String androidPermissionFor(String resource) {
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
            return android.Manifest.permission.CAMERA;
        }
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
            return android.Manifest.permission.RECORD_AUDIO;
        }
        return null;
    }

    private void grantPermissionResources(PermissionRequest request, java.util.List<String> resources) {
        if (request == null || resources == null || resources.isEmpty()) {
            denyPermissionRequest(request);
            return;
        }
        if (isFinishing() || isDestroyed()) {
            return;
        }
        try {
            request.grant(resources.toArray(new String[0]));
        } catch (Exception error) {
            // The WebView may have been destroyed while the dialog was open.
        }
    }

    private void denyPermissionRequest(PermissionRequest request) {
        if (request == null) {
            return;
        }
        try {
            request.deny();
        } catch (Exception ignored) {
            // Denying a request from a destroyed WebView is a no-op.
        }
    }

    private void notifyIfMixedContentBlocked(WebResourceRequest request) {
        if (MIXED_CONTENT_ALLOWED || insecureContentNoticeShown || request == null || request.getUrl() == null) {
            return;
        }
        String pageUrl = webView == null ? "" : webView.getUrl();
        if (pageUrl == null || pageUrl.isEmpty()) {
            pageUrl = lastPageUrl;
        }
        if (pageUrl == null || !pageUrl.toLowerCase(Locale.US).startsWith("https:")) {
            return;
        }
        if (!"http".equalsIgnoreCase(request.getUrl().getScheme())) {
            return;
        }
        insecureContentNoticeShown = true;
        showToast("Insecure content from this site was blocked to protect your connection.");
    }

    private void destroyBrokenWebView(WebView broken) {
        if (broken == null) {
            return;
        }
        if (webView == broken) {
            webView = null;
        }
        try {
            broken.stopLoading();
            broken.loadUrl("about:blank");
            broken.removeJavascriptInterface(DOWNLOAD_BRIDGE_NAME);
            broken.setWebChromeClient(null);
            broken.setWebViewClient(null);
            android.view.ViewParent parent = broken.getParent();
            if (parent instanceof ViewGroup) {
                ((ViewGroup) parent).removeView(broken);
            }
            broken.removeAllViews();
            broken.destroy();
        } catch (Exception ignored) {
            // The renderer is already gone; nothing else can be cleaned up.
        }
    }

    private void showRendererErrorState() {
        new AlertDialog.Builder(this)
            .setTitle("Page keeps crashing")
            .setMessage("The page content stopped responding several times in a row. You can try loading it again, or close the app.")
            .setPositiveButton("Reload", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    rendererCrashCount = 0;
                    lastRendererCrashAt = 0L;
                    recreate();
                }
            })
            .setNegativeButton("Close", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    finish();
                }
            })
            .show();
    }

    // === Splash screen ===

    private void maybeDismissSplash() {
        if (splashDismissed) {
            return;
        }
        long elapsed = SystemClock.elapsedRealtime() - splashShownAt;
        if (elapsed < ${duration}) {
            // The minimum display time has not passed; check again when it has.
            handler.removeCallbacks(splashMinTimer);
            handler.postDelayed(splashMinTimer, ${duration} - elapsed);
            return;
        }
        if (!mainFrameReady) {
            // Waiting for the first page (or the hard timeout) before dismissing.
            return;
        }
        splashDismissed = true;
        handler.removeCallbacks(splashMinTimer);
        handler.removeCallbacks(splashHardTimeout);
        final android.view.View splash = findViewById(R.id.splashOverlay);
        if (splash != null && splash.getVisibility() == android.view.View.VISIBLE) {
            splash.animate()
                .alpha(0f)
                .setDuration(300)
                .setListener(new android.animation.AnimatorListenerAdapter() {
                    @Override
                    public void onAnimationEnd(android.animation.Animator animation) {
                        splash.setVisibility(android.view.View.GONE);
                    }
                });
        }
    }

    // === Activity plumbing ===

    @Override
    protected void onResume() {
        super.onResume();
        registerDownloadReceiver();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
        }
        if (fullScreenMode) {
            // The system may have restored the bars while the app was backgrounded.
            applyImmersiveMode();
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
            webView.pauseTimers();
        }
        // Persist cookies so a signed-in session survives the process being killed.
        CookieManager.getInstance().flush();
        unregisterDownloadReceiver();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        cancelBlobDownload(false);
        destroyPopup();
        unregisterDownloadReceiver();

        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        pendingDownload = null;
        denyPermissionRequest(pendingPermissionRequest);
        pendingPermissionRequest = null;
        pendingPermissionResources = null;
        pendingGeoCallback = null;
        pendingGeoOrigin = null;

        if (webView != null) {
            final WebView view = webView;
            webView = null;
            try {
                view.stopLoading();
                view.loadUrl("about:blank");
                view.removeJavascriptInterface(DOWNLOAD_BRIDGE_NAME);
                view.setWebChromeClient(null);
                view.setWebViewClient(null);
                android.view.ViewParent parent = view.getParent();
                if (parent instanceof ViewGroup) {
                    ((ViewGroup) parent).removeView(view);
                }
                view.removeAllViews();
                view.destroy();
            } catch (Exception ignored) {
                // The renderer may already be gone.
            }
        }
        super.onDestroy();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (lastPageUrl != null && isTrustedRestoreUrl(lastPageUrl)) {
            outState.putString(STATE_LAST_URL, lastPageUrl);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_DOWNLOAD_PERMISSION) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            PendingDownload download = pendingDownload;
            pendingDownload = null;
            if (granted && download != null) {
                enqueueHttpDownload(download);
            } else {
                showToast("Downloads need storage permission to save to your Downloads folder.");
            }
            return;
        }
        if (requestCode == REQ_PERMISSIONS) {
            PermissionRequest request = pendingPermissionRequest;
            pendingPermissionRequest = null;
            java.util.List<String> previouslyGrantable = pendingPermissionResources;
            pendingPermissionResources = null;
            if (request != null) {
                java.util.ArrayList<String> grantable = new java.util.ArrayList<>();
                if (previouslyGrantable != null) {
                    grantable.addAll(previouslyGrantable);
                }
                try {
                    for (String resource : request.getResources()) {
                        if (!ALLOWED_PERMISSION_RESOURCES.contains(resource) || grantable.contains(resource)) {
                            continue;
                        }
                        String androidPermission = androidPermissionFor(resource);
                        if (androidPermission != null
                                && checkSelfPermission(androidPermission) == PackageManager.PERMISSION_GRANTED) {
                            grantable.add(resource);
                        }
                    }
                } catch (Exception ignored) {
                    // The WebView was destroyed while the dialog was open.
                }
                if (grantable.isEmpty()) {
                    denyPermissionRequest(request);
                    showToast("Camera or microphone access was denied.");
                } else {
                    grantPermissionResources(request, grantable);
                }
            }
            if (pendingGeoCallback != null) {
                GeolocationPermissions.Callback callback = pendingGeoCallback;
                String origin = pendingGeoOrigin;
                pendingGeoCallback = null;
                pendingGeoOrigin = null;
                callback.invoke(origin, checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED, false);
            }
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private static class PendingDownload {
        final String url;
        final String userAgent;
        final String contentDisposition;
        final String mimeType;
        final long contentLength;

        PendingDownload(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
            this.url = url;
            this.userAgent = userAgent;
            this.contentDisposition = contentDisposition;
            this.mimeType = mimeType;
            this.contentLength = contentLength;
        }
    }
}
`;
}
