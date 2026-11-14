import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { generatePngIcon } from './icon-generator.js';
import { tryBuildAPK as attemptAPK } from './build-utils.js';
import {
  assertAppId,
  assertAppName,
  assertAppVersion,
  assertBuildId,
  assertSiteUrl,
  assertSplashDuration,
  coerceBoolean,
  escapeGradleSingleQuoted,
  escapeGroovyDoubleQuoted,
  escapeJavaString,
  escapeXml,
  safeFileName,
  safeJoin,
} from './input-validation.js';
import { fetchPublicBuffer } from './safe-fetch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildAPK(params) {
  if (params && params.siteUrl) {
    // Strip zero-width / bidi-invisible characters (e.g. U+2060) that break URLs pasted from chat apps
    let raw = String(params.siteUrl).replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '').trim();
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      raw = 'https://' + raw;
    }
    params.siteUrl = raw;
  }
  return await executeAndroidBuild(params);
}

async function executeAndroidBuild(rawParams) {
  const params = { ...rawParams };
  const appName = assertAppName(params.appName);
  const appId = assertAppId(params.appId);
  const appVersion = params.appVersion == null ? '1.0.0' : assertAppVersion(String(params.appVersion));
  const buildId = assertBuildId(params.buildId);
  const siteUrl = assertSiteUrl(params.siteUrl);
  const splashDuration = assertSplashDuration(params.splashDuration ?? 2000);
  const customUserAgent = params.customUserAgent == null ? null : String(params.customUserAgent).slice(0, 512);
  const pullToRefresh = coerceBoolean(params.pullToRefresh, true);
  const showSpinner = coerceBoolean(params.showSpinner, true);
  const showSplash = coerceBoolean(params.showSplash, true);
  const fullScreen = coerceBoolean(params.fullScreen, false);
  const allowZoom = coerceBoolean(params.allowZoom, false);
  const { icon, autoFetchIcon = true, buildsDir, appName: _a, appId: _i, appVersion: _v, buildId: _b, siteUrl: _s, splashDuration: _sd, customUserAgent: _u, pullToRefresh: _p, showSpinner: _sp, showSplash: _ss, fullScreen: _f, allowZoom: _z } = params;
  const enableZoom = allowZoom;
  const buildDir = safeJoin(buildsDir, buildId, 'android');
  
  // Clean up source files from any previous build to prevent compiling stale source files
  if (fs.existsSync(path.join(buildDir, 'app', 'src'))) {
    fs.rmSync(path.join(buildDir, 'app', 'src'), { recursive: true, force: true });
  }
  if (fs.existsSync(path.join(buildDir, 'app', 'build.gradle'))) {
    fs.rmSync(path.join(buildDir, 'app', 'build.gradle'), { force: true });
  }
  if (fs.existsSync(path.join(buildDir, 'settings.gradle'))) {
    fs.rmSync(path.join(buildDir, 'settings.gradle'), { force: true });
  }
  if (fs.existsSync(path.join(buildDir, 'build.gradle'))) {
    fs.rmSync(path.join(buildDir, 'build.gradle'), { force: true });
  }

  fs.mkdirSync(buildDir, { recursive: true });

  // Create Android project structure
  const appDir = path.join(buildDir, 'app');
  const srcDir = path.join(appDir, 'src', 'main');
  const resDir = path.join(srcDir, 'res');
  const valuesDir = path.join(resDir, 'values');
  const layoutDir = path.join(resDir, 'layout');
  const xmlDir = path.join(resDir, 'xml');
  const javaDir = safeJoin(srcDir, 'java', path.join(...appId.split('.')));
  const sanitizedThemeName = appName.replace(/[^a-zA-Z0-9]/g, '') || 'App';
  const xmlAppName = escapeXml(appName);
  const xmlSiteUrl = escapeXml(siteUrl);
  const xmlVersionName = escapeXml(appVersion);
  const javaSiteUrl = escapeJavaString(siteUrl);
  const javaUserAgent = customUserAgent == null ? null : `"${escapeJavaString(customUserAgent)}"`;
  const gradleSiteValue = escapeGradleSingleQuoted(appId);
  const groovyAppName = escapeGroovyDoubleQuoted(appName);
  const gradleVersion = escapeGradleSingleQuoted(appVersion);

  fs.mkdirSync(valuesDir, { recursive: true });
  fs.mkdirSync(layoutDir, { recursive: true });
  fs.mkdirSync(xmlDir, { recursive: true });
  fs.mkdirSync(javaDir, { recursive: true });
  fs.mkdirSync(path.join(buildDir, '.gradle'), { recursive: true });

  // Create mipmap directories with real icons at multiple densities
  const mipmapDensities = [
    { name: 'mipmap-mdpi', size: 48 },
    { name: 'mipmap-hdpi', size: 72 },
    { name: 'mipmap-xhdpi', size: 96 },
    { name: 'mipmap-xxhdpi', size: 144 },
    { name: 'mipmap-xxxhdpi', size: 192 },
  ];

  let customIconBuffer = null;
  if (icon && typeof icon === 'string' && icon.startsWith('data:')) {
    try {
      const separator = icon.indexOf(';base64,');
      if (separator < 0) throw new Error('Icon data URL is not Base64 encoded');
      const base64Data = icon.slice(separator + ';base64,'.length);
      const decoded = Buffer.from(base64Data, 'base64');
      if (!decoded.length) throw new Error('Icon data URL is empty');
      if (decoded.length > 20 * 1024 * 1024) throw new Error('Icon exceeds 20 MB');
      const candidate = extractPngOrBmpFromIco(decoded);
      await sharp(candidate, { limitInputPixels: 64 * 1024 * 1024 }).metadata();
      customIconBuffer = candidate;
    } catch (error) {
      console.log(`[android-builder] Custom icon could not be decoded; trying configured fallback: ${error.message}`);
    }
  }

  const shouldAutoFetchIcon = autoFetchIcon === true || autoFetchIcon === 'true';
  if (!customIconBuffer && shouldAutoFetchIcon && siteUrl) {
    try {
      const fetchedIcon = await fetchFaviconBuffer(siteUrl);
      if (fetchedIcon) {
        const candidate = extractPngOrBmpFromIco(fetchedIcon);
        await sharp(candidate, { limitInputPixels: 64 * 1024 * 1024 }).metadata();
        customIconBuffer = candidate;
      }
    } catch (error) {
      console.log(`[android-builder] Website icon could not be decoded; using generated initials: ${error.message}`);
    }
  }

  for (const { name, size } of mipmapDensities) {
    const mipmapDir = path.join(resDir, name);
    fs.mkdirSync(mipmapDir, { recursive: true });
    let iconBuffer;
    try {
      iconBuffer = customIconBuffer
        ? await sharp(customIconBuffer, { limitInputPixels: 64 * 1024 * 1024 }).resize(size, size).png().toBuffer()
        : await generatePngIcon(appName, size);
    } catch (error) {
      console.log(`[android-builder] Icon render failed for ${name}; falling back to initials: ${error.message}`);
      iconBuffer = await generatePngIcon(appName, size);
    }
    fs.writeFileSync(path.join(mipmapDir, 'ic_launcher.png'), iconBuffer);
    fs.writeFileSync(path.join(mipmapDir, 'ic_launcher_round.png'), iconBuffer);
  }

  // Create Gradle wrapper
  const wrapperDir = path.join(buildDir, 'gradle', 'wrapper');
  fs.mkdirSync(wrapperDir, { recursive: true });
  fs.writeFileSync(path.join(wrapperDir, 'gradle-wrapper.properties'), `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.12.1-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`);

  // Create required xml resource files (referenced in AndroidManifest)
  fs.writeFileSync(path.join(xmlDir, 'backup_rules.xml'), `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
    <exclude domain="sharedpref" path="." />
</full-backup-content>
`);

  fs.writeFileSync(path.join(xmlDir, 'data_extraction_rules.xml'), `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="sharedpref" path="." />
    </cloud-backup>
    <device-transfer>
        <exclude domain="sharedpref" path="." />
    </device-transfer>
</data-extraction-rules>
`);

  // Create root settings.gradle
  fs.writeFileSync(path.join(buildDir, 'settings.gradle'), `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "${groovyAppName}"
include ':app'
`);

  // Create root build.gradle
  fs.writeFileSync(path.join(buildDir, 'build.gradle'), `plugins {
    id 'com.android.application' version '8.9.1' apply false
}
`);

  // Create app/build.gradle
  const homeDir = (process.env.HOME || '/tmp').replace(/\\/g, '/');
  const buildGradleContent = `plugins {
    id 'com.android.application'
}

android {
    namespace '${gradleSiteValue}'
    compileSdk 35

    defaultConfig {
        applicationId '${gradleSiteValue}'
        minSdk 24
        targetSdk 35
        versionCode 1
        versionName '${gradleVersion}'
    }

    signingConfigs {
        debug {
            storeFile file('${homeDir}/.android/debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
        debug {
            debuggable true
            signingConfig signingConfigs.debug
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
}

dependencies {
    implementation 'androidx.core:core:1.15.0'
}
`;
  fs.writeFileSync(path.join(appDir, 'build.gradle'), buildGradleContent);

  // Create AndroidManifest.xml
  // Cleartext HTTP is only permitted when the wrapped site itself is served over HTTP.
  const allowCleartext = /^http:\/\//i.test(siteUrl);
  const manifestContent = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    android:versionCode="1"
    android:versionName="${xmlVersionName}">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />

    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.microphone" android:required="false" />
    <uses-feature android:name="android.hardware.location.gps" android:required="false" />

    <application
        android:allowBackup="true"
        android:usesCleartextTraffic="${allowCleartext}"
        android:dataExtractionRules="@xml/data_extraction_rules"
        android:fullBackupContent="@xml/backup_rules"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.${sanitizedThemeName}">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden"
            android:hardwareAccelerated="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>`;

  fs.writeFileSync(path.join(srcDir, 'AndroidManifest.xml'), manifestContent);

  // Create strings.xml
  const stringsContent = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${xmlAppName}</string>
    <string name="website_url">${xmlSiteUrl}</string>
</resources>`;

  fs.writeFileSync(path.join(valuesDir, 'strings.xml'), stringsContent);

  // Create colors.xml
  const colorsContent = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="black">#FF000000</color>
    <color name="white">#FFFFFFFF</color>
    <color name="primary">#3F51B5</color>
    <color name="primary_dark">#303F9F</color>
    <color name="accent">#FF4081</color>
</resources>`;

  fs.writeFileSync(path.join(valuesDir, 'colors.xml'), colorsContent);

  // Create styles.xml (using native Android theme - no AppCompat dependency needed)
  const stylesContent = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.${sanitizedThemeName}" parent="android:Theme.Material.Light.NoActionBar">
        <item name="android:windowNoTitle">true</item>
        <item name="android:windowActionBar">false</item>
        <item name="android:colorPrimary">@color/primary</item>
        <item name="android:colorPrimaryDark">@color/primary_dark</item>
        <item name="android:colorAccent">@color/accent</item>
        <item name="android:navigationBarColor">@android:color/white</item>
        <item name="android:windowLightNavigationBar">true</item>
        <item name="android:enforceNavigationBarContrast">false</item>
    </style>
</resources>`;

  // Night-mode variant: Android merges res/values-night when system night
  // mode is on, so the WebView's prefers-color-scheme follows the device.
  // Same style name and colors as day — pass-through, no force-dark.
  const valuesNightDir = path.join(resDir, 'values-night');
  fs.mkdirSync(valuesNightDir, { recursive: true });

  const stylesNightContent = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.${sanitizedThemeName}" parent="android:Theme.Material.NoActionBar">
        <item name="android:windowNoTitle">true</item>
        <item name="android:windowActionBar">false</item>
        <item name="android:colorPrimary">@color/primary</item>
        <item name="android:colorPrimaryDark">@color/primary_dark</item>
        <item name="android:colorAccent">@color/accent</item>
        <item name="android:navigationBarColor">#09080f</item>
        <item name="android:windowLightNavigationBar">false</item>
        <item name="android:enforceNavigationBarContrast">false</item>
    </style>
</resources>`;

  fs.writeFileSync(path.join(valuesNightDir, 'styles.xml'), stylesNightContent);

  fs.writeFileSync(path.join(valuesDir, 'styles.xml'), stylesContent);

  // Create activity_main.xml
  const splashVisibility = showSplash ? 'visible' : 'gone';
  const splashXml = `
        <!-- Splash Screen Overlay -->
        <LinearLayout
            android:id="@+id/splashOverlay"
            android:layout_width="match_parent"
            android:layout_height="match_parent"
            android:orientation="vertical"
            android:gravity="center"
            android:background="#09080f"
            android:visibility="${splashVisibility}">
            
            <ImageView
                android:layout_width="96dp"
                android:layout_height="96dp"
                android:layout_gravity="center"
                android:src="@mipmap/ic_launcher" />
                
            <TextView
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginTop="16dp"
                android:layout_gravity="center"
                android:text="${xmlAppName}"
                android:textColor="#ffffff"
                android:textSize="22sp"
                android:textStyle="bold" />
        </LinearLayout>`;

  const activityMainContent = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/contentRoot"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#09080f">

    <WebView
        android:id="@+id/webView"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:background="#09080f" />

    ${splashXml}

    <ProgressBar
        android:id="@+id/progressBar"
        style="?android:attr/progressBarStyleHorizontal"
        android:layout_width="match_parent"
        android:layout_height="4dp"
        android:layout_gravity="top"
        android:indeterminate="true"
        android:indeterminateTint="#10b981"
        android:visibility="gone" />

</FrameLayout>`;

  fs.writeFileSync(path.join(layoutDir, 'activity_main.xml'), activityMainContent);

  // Create MainActivity.java
  const mainActivityContent = `package ${appId};

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import android.widget.ProgressBar;

public class MainActivity extends Activity {
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_PERMISSIONS = 1002;
    // Identity providers that refuse to run their sign-in flow inside an embedded WebView
    private static final String[] EXTERNAL_AUTH_HOSTS = {
        "accounts.google.com",
        "accounts.youtube.com",
        "appleid.apple.com",
        "login.microsoftonline.com",
        "login.live.com",
        "id.atlassian.com"
    };

    private WebView webView;
    private ProgressBar progressBar;
    private String siteHost = "";
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingPermissionRequest;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;

    private static final String PULL_TO_REFRESH_SCRIPT = """
        (function () {
          if (window.top !== window) return;
          if (window.__siteToAppPullToRefreshInstalled) return;
          window.__siteToAppPullToRefreshInstalled = true;

          var threshold = 96;
          var startX = 0;
          var startY = 0;
          var active = false;
          var startTarget = null;
          var indicator = document.createElement('div');
          var spinner = document.createElement('div');
          var style = document.createElement('style');

          style.textContent = '@keyframes siteToAppRefreshSpin{to{transform:rotate(360deg)}}'
            + '.site-to-app-refresh-indicator{position:fixed;top:0;left:50%;z-index:2147483647;'
            + 'display:none;width:40px;height:40px;margin-left:-20px;border-radius:50%;'
            + 'align-items:center;justify-content:center;background:#fff;'
            + 'box-shadow:0 2px 10px rgba(0,0,0,.2);pointer-events:none;opacity:0;'
            + 'transition:opacity .12s ease,transform .08s ease}'
            + '.site-to-app-refresh-spinner{width:22px;height:22px;border:3px solid #d1d5db;'
            + 'border-top-color:#10b981;border-radius:50%}'
            + '.site-to-app-refresh-ready .site-to-app-refresh-spinner{'
            + 'animation:siteToAppRefreshSpin .8s linear infinite}';
          style.setAttribute('data-site-to-app-refresh-style', '');
          document.documentElement.appendChild(style);

          indicator.className = 'site-to-app-refresh-indicator';
          indicator.setAttribute('aria-hidden', 'true');
          spinner.className = 'site-to-app-refresh-spinner';
          indicator.appendChild(spinner);
          document.documentElement.appendChild(indicator);

          function canRefreshAt(target) {
            if (!target || !target.nodeType) return false;
            var element = target.nodeType === 1 ? target : target.parentElement;
            if (element && element.closest('input,textarea,select,button,[contenteditable="true"],iframe,video,audio')) {
              return false;
            }

            while (element && element.nodeType === 1) {
              var overflowY = window.getComputedStyle(element).overflowY;
              var scrollable = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
              if (scrollable && element.scrollHeight > element.clientHeight + 1 && element.scrollTop > 1) {
                return false;
              }
              element = element.parentElement;
            }

            var roots = [document.scrollingElement, document.documentElement, document.body];
            for (var i = 0; i < roots.length; i++) {
              if (roots[i] && roots[i].scrollTop > 1) return false;
            }
            return true;
          }

          function hideIndicator() {
            indicator.style.display = 'none';
            indicator.style.opacity = '0';
            indicator.classList.remove('site-to-app-refresh-ready');
          }

          document.addEventListener('touchstart', function (event) {
            if (event.touches.length !== 1) {
              active = false;
              hideIndicator();
              return;
            }
            var touch = event.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            startTarget = event.target;
            active = canRefreshAt(startTarget);
            hideIndicator();
          }, { capture: true, passive: true });

          document.addEventListener('touchmove', function (event) {
            if (!active || event.touches.length !== 1) return;
            var touch = event.touches[0];
            var deltaX = touch.clientX - startX;
            var deltaY = touch.clientY - startY;
            if (deltaY <= 0 || Math.abs(deltaX) > deltaY * 0.8) {
              if (Math.abs(deltaX) > deltaY * 0.8 || deltaY < 0) active = false;
              hideIndicator();
              return;
            }
            if (!canRefreshAt(startTarget)) {
              active = false;
              hideIndicator();
              return;
            }
            if (deltaY < 8) return;

            if (event.cancelable) event.preventDefault();
            indicator.style.display = 'flex';
            indicator.style.opacity = String(Math.min(1, deltaY / 40));
            indicator.style.transform = 'translateY(' + Math.min(68, deltaY * 0.55) + 'px)';
            if (deltaY >= threshold) {
              active = false;
              indicator.classList.add('site-to-app-refresh-ready');
              window.location.reload();
            }
          }, { capture: true, passive: false });

          document.addEventListener('touchend', function () {
            active = false;
            hideIndicator();
          }, { capture: true, passive: true });
          document.addEventListener('touchcancel', function () {
            active = false;
            hideIndicator();
          }, { capture: true, passive: true });
        })();
        """;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        final boolean fullScreen = ${fullScreen};
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (fullScreen) {
            getWindow().getDecorView().setSystemUiVisibility(
                android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
        }
        
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webView);
        progressBar = findViewById(R.id.progressBar);

        if (!fullScreen) {
            final android.view.View contentRoot = findViewById(R.id.contentRoot);
            final int initialPaddingLeft = contentRoot.getPaddingLeft();
            final int initialPaddingTop = contentRoot.getPaddingTop();
            final int initialPaddingRight = contentRoot.getPaddingRight();
            final int initialPaddingBottom = contentRoot.getPaddingBottom();
            ViewCompat.setOnApplyWindowInsetsListener(contentRoot, (view, windowInsets) -> {
                Insets safeInsets = windowInsets.getInsets(
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
        }
        
        webView.setBackgroundColor(0xFF09080F);
        
        final boolean enablePullToRefresh = ${pullToRefresh};
        final boolean showSpinner = ${showSpinner};
        final boolean showSplash = ${showSplash};
        final int splashDuration = ${splashDuration};

        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setDatabaseEnabled(true);
        webSettings.setLoadWithOverviewMode(true);
        webSettings.setUseWideViewPort(true);
        webSettings.setMixedContentMode(${allowCleartext ? 'WebSettings.MIXED_CONTENT_ALWAYS_ALLOW' : 'WebSettings.MIXED_CONTENT_NEVER_ALLOW'});
        
        final String customUA = ${javaUserAgent == null ? "null" : javaUserAgent};
        if (customUA != null && !customUA.trim().isEmpty()) {
            webSettings.setUserAgentString(customUA);
        }

        final boolean allowZoom = ${enableZoom};
        webSettings.setSupportZoom(allowZoom);
        webSettings.setBuiltInZoomControls(allowZoom);
        webSettings.setDisplayZoomControls(false);

        // Third-party cookies are off by default for apps targeting Lollipop or newer
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        Uri siteUri = Uri.parse("${javaSiteUrl}");
        siteHost = siteUri.getHost() == null ? "" : siteUri.getHost().toLowerCase();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (showSpinner) {
                    progressBar.setVisibility(android.view.View.VISIBLE);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (showSpinner) {
                    progressBar.setVisibility(android.view.View.GONE);
                }
                if (enablePullToRefresh) {
                    view.evaluateJavascript(PULL_TO_REFRESH_SCRIPT, null);
                }
                
                if (showSplash) {
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
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                return handleNavigation(request.getUrl().toString());
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
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
                java.util.ArrayList<String> missing = new java.util.ArrayList<>();
                for (String resource : request.getResources()) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                            && checkSelfPermission(android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                        missing.add(android.Manifest.permission.CAMERA);
                    } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                            && checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                        missing.add(android.Manifest.permission.RECORD_AUDIO);
                    }
                }
                if (!missing.isEmpty()) {
                    pendingPermissionRequest = request;
                    requestPermissions(missing.toArray(new String[0]), REQ_PERMISSIONS);
                    return;
                }
                request.grant(request.getResources());
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

        webView.loadUrl("${javaSiteUrl}");
        
        if (showSplash) {
            new android.os.Handler().postDelayed(new Runnable() {
                @Override
                public void run() {
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
            }, splashDuration);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_PERMISSIONS) {
            if (pendingPermissionRequest != null) {
                PermissionRequest request = pendingPermissionRequest;
                pendingPermissionRequest = null;
                java.util.ArrayList<String> granted = new java.util.ArrayList<>();
                for (String resource : request.getResources()) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                            && checkSelfPermission(android.Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        granted.add(resource);
                    } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                            && checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        granted.add(resource);
                    }
                }
                if (granted.isEmpty()) {
                    request.deny();
                } else {
                    request.grant(granted.toArray(new String[0]));
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

    private void openExternally(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception e) {
            // No installed app can handle this link, so there is nothing to open.
        }
    }

    private boolean handleNavigation(String url) {
        try {
            Uri uri = Uri.parse(url);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
            if (!scheme.equals("http") && !scheme.equals("https")) {
                if (scheme.equals("intent")) {
                    try {
                        Intent intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                        Uri data = intent.getData();
                        String dataScheme = data == null || data.getScheme() == null ? "" : data.getScheme().toLowerCase();
                        // Only honor intent:// links wrapping http(s) URLs, and strip any
                        // explicit component the page tried to set.
                        if (dataScheme.equals("http") || dataScheme.equals("https")) {
                            intent.setComponent(null);
                            startActivity(intent);
                        }
                    } catch (Exception e) {
                        // Unresolvable intent link: drop it instead of crashing.
                    }
                    return true;
                }
                openExternally(url);
                return true;
            }
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
            if (!isSameSite(host) && isExternalAuthHost(host)) {
                // Google and other providers block OAuth inside embedded WebViews
                openExternally(url);
                return true;
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}`;

  fs.writeFileSync(path.join(javaDir, 'MainActivity.java'), mainActivityContent);

  // Create proguard-rules.pro
  fs.writeFileSync(path.join(appDir, 'proguard-rules.pro'), `# WebView
-keepclassmembers class * {
    public void onEvent*(**);
}

-keep class android.webkit.** { *; }
`);

  // Create .gitignore
  fs.writeFileSync(path.join(buildDir, '.gitignore'), `# Gradle
.gradle
build/
*.apk
*.aar
*.ap_
*.aab

# Android Studio
.idea/
.classpath
.project
.settings/
*.iml
local.properties

# OS
.DS_Store
thumbs.db
`);

  // Create gradle.properties (portable & optimized settings)
  fs.writeFileSync(path.join(buildDir, 'gradle.properties'), `org.gradle.jvmargs=-Xmx2048m --add-opens=java.base/java.lang=ALL-UNNAMED --add-opens=java.base/java.util=ALL-UNNAMED
org.gradle.parallel=true
org.gradle.daemon=true
org.gradle.configureondemand=true
org.gradle.configuration-cache=true
android.useAndroidX=true
android.suppressUnsupportedCompileSdk=35
`);

  // Create GitHub Actions workflow
  const githubWorkflowsDir = path.join(buildDir, '.github', 'workflows');
  fs.mkdirSync(githubWorkflowsDir, { recursive: true });
  fs.writeFileSync(path.join(githubWorkflowsDir, 'build.yml'), `name: Build Android APK
on: [push, pull_request]
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: set up JDK 17
      - name: Setup Java JDK
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
          cache: gradle
      - name: Build Android APK
        run: gradle assembleDebug
      - name: Upload APK Artifact
        uses: actions/upload-artifact@v4
        with:
          name: app-debug
          path: app/build/outputs/apk/debug/*.apk
`);

  // Create README.md
  fs.writeFileSync(path.join(buildDir, 'README.md'), `# ${appName}

Android app wrapping ${siteUrl}

## Build Locally

1. Install Gradle (or use Android Studio)
2. Run: gradle wrapper
3. Run: ./gradlew assembleDebug

The built APKs will be in \`app/build/outputs/apk/debug/\`

## Build via GitHub Actions (Zero Cost Setup)

This project has been pre-configured with a GitHub Actions workflow to build your APK for free:
1. Initialize a Git repository in this directory.
2. Push the files to a new GitHub repository.
3. The APK will be built automatically on every push. You can find the downloadable APK in the "Actions" tab of your GitHub repository under the latest run.
`);

  // === Try to build actual APK ===
  try {
    const apkPath = await attemptAPK(buildDir);
    if (apkPath) {
      // Copy the APK to the build output directory with a clean name
      const outputApk = safeJoin(buildsDir, buildId, `${safeFileName(appName)}-${safeFileName(appVersion)}.apk`);
      fs.mkdirSync(path.dirname(outputApk), { recursive: true }); // Ensure output folder exists
      fs.copyFileSync(apkPath, outputApk);
      console.log(`[android-builder] APK built: ${outputApk}`);
      return outputApk;
    }
  } catch (e) {
    console.log(`[android-builder] Compilation attempt failed: ${e.message}`);
  }

  // === Fallback: package as ZIP ===
  console.log('[android-builder] Falling back to source project ZIP');
  const zipPath = safeJoin(buildsDir, buildId, `${safeFileName(appName)}-android-${safeFileName(appVersion)}.zip`);
  fs.mkdirSync(path.dirname(zipPath), { recursive: true }); // Ensure output folder exists

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(zipPath));
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);

    // Archive only source files, excluding gradle caches and build directories
    archive.glob('**/*', {
      cwd: buildDir,
      ignore: ['.gradle/**', 'app/build/**', 'local.properties', '.git/**']
    }, { prefix: `${safeFileName(appName).replace(/\s+/g, '') || 'App'}-android-source` });

    archive.finalize().catch(reject);
  });
}

// === Favicon Scraper Helpers ===

async function getFaviconFromHtml(siteUrl) {
  try {
    const buf = await fetchPublicBuffer(siteUrl, { maxBytes: 1024 * 1024, timeoutMs: 8000 });
    const html = buf.toString('utf8');

    const linkRegex = /<link\s+[^>]*>/gi;
    let match;
    const icons = [];

    while ((match = linkRegex.exec(html)) !== null) {
      const tag = match[0];
      const relMatch = /rel=["']([^"']+)["']/i.exec(tag);
      const hrefMatch = /href=["']([^"']+)["']/i.exec(tag);
      
      if (relMatch && hrefMatch && hrefMatch[1]) {
        const rel = relMatch[1].toLowerCase();
        const href = hrefMatch[1];
        
        if (rel.includes('icon') || rel === 'apple-touch-icon') {
          icons.push({ rel, href });
        }
      }
    }

    if (icons.length > 0) {
      icons.sort((a, b) => {
        const aApple = a.rel === 'apple-touch-icon' ? 1 : 0;
        const bApple = b.rel === 'apple-touch-icon' ? 1 : 0;
        if (aApple !== bApple) return bApple - aApple;

        const aPng = a.href.toLowerCase().endsWith('.png') || a.href.toLowerCase().endsWith('.svg') ? 1 : 0;
        const bPng = b.href.toLowerCase().endsWith('.png') || b.href.toLowerCase().endsWith('.svg') ? 1 : 0;
        if (aPng !== bPng) return bPng - aPng;

        return 0;
      });

      const bestIcon = icons[0].href;
      return new URL(bestIcon, siteUrl).toString();
    }
  } catch (err) {
    // Ignore
  }
  return null;
}

export async function fetchFaviconBuffer(siteUrl) {
  const candidates = [];
  const collect = (buf) => {
    if (buf && Buffer.isBuffer(buf) && buf.length > 0) candidates.push(buf);
  };

  try {
    const parsedUrl = new URL(siteUrl);
    const domain = parsedUrl.hostname;

    // 1. Try HTML scraping
    try {
      const scrapedUrl = await getFaviconFromHtml(siteUrl);
      if (scrapedUrl) {
        collect(await fetchPublicBuffer(scrapedUrl, { maxBytes: 512 * 1024, timeoutMs: 8000 }));
      }
    } catch {}

    // 2. Fallback to /favicon.ico
    try {
      collect(await fetchPublicBuffer(`${parsedUrl.origin}/favicon.ico`, { maxBytes: 512 * 1024, timeoutMs: 8000 }));
    } catch {}

    // 3. Fallback to Google Favicon API (PNG, reliable)
    try {
      collect(await fetchPublicBuffer(`https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(domain)}`, { maxBytes: 512 * 1024, timeoutMs: 8000 }));
    } catch {}

    // 4. Fallback to DuckDuckGo
    try {
      collect(await fetchPublicBuffer(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`, { maxBytes: 512 * 1024, timeoutMs: 8000 }));
    } catch {}
  } catch (err) {
    console.log(`[favicon-helper] Failed to parse site URL: ${err.message}`);
  }

  // Return the first candidate that sharp can decode (extracted from ICO if needed)
  for (const buf of candidates) {
    try {
      const candidate = extractPngOrBmpFromIco(buf);
      await sharp(candidate).metadata();
      console.log(`[favicon-helper] Successfully resolved favicon for ${siteUrl}`);
      return candidate;
    } catch {}
  }

  // Nothing decodable; return null so caller falls back to initials
  if (candidates.length) {
    console.log(`[favicon-helper] Fetched ${candidates.length} favicon candidate(s) but none were decodable for ${siteUrl}`);
  } else {
    console.log(`[favicon-helper] Failed to fetch favicon for ${siteUrl}`);
  }
  return null;
}

export function extractPngOrBmpFromIco(icoBuffer) {
  try {
    if (!icoBuffer || icoBuffer.length < 6) return icoBuffer;
    
    const reserved = icoBuffer.readUInt16LE(0);
    const type = icoBuffer.readUInt16LE(2);
    const count = icoBuffer.readUInt16LE(4);
    
    if (reserved !== 0 || type !== 1 || count === 0) {
      return icoBuffer;
    }
    
    let largestSize = 0;
    let selectedOffset = 0;
    let selectedSize = 0;
    
    for (let i = 0; i < count; i++) {
      const entryOffset = 6 + i * 16;
      if (entryOffset + 16 > icoBuffer.length) break;
      
      let width = icoBuffer.readUInt8(entryOffset);
      let height = icoBuffer.readUInt8(entryOffset + 1);
      
      if (width === 0) width = 256;
      if (height === 0) height = 256;
      
      const size = width * height;
      const bytesInRes = icoBuffer.readUInt32LE(entryOffset + 8);
      const imageOffset = icoBuffer.readUInt32LE(entryOffset + 12);
      
      if (size > largestSize && imageOffset + bytesInRes <= icoBuffer.length) {
        largestSize = size;
        selectedOffset = imageOffset;
        selectedSize = bytesInRes;
      }
    }
    
    if (selectedSize > 0) {
      const imgBuffer = icoBuffer.subarray(selectedOffset, selectedOffset + selectedSize);
      
      if (imgBuffer[0] === 0x89 && imgBuffer[1] === 0x50 && imgBuffer[2] === 0x4E && imgBuffer[3] === 0x47) {
        return imgBuffer;
      }
      
      const dibHeaderSize = imgBuffer.readUInt32LE(0);
      if (dibHeaderSize === 40 || dibHeaderSize === 108 || dibHeaderSize === 124) {
        const bmpHeader = Buffer.alloc(14);
        bmpHeader.write('BM', 0);
        bmpHeader.writeUInt32LE(14 + imgBuffer.length, 2);
        bmpHeader.writeUInt16LE(0, 6);
        bmpHeader.writeUInt16LE(0, 8);
        // BMP 3+ may carry a colour table between the header and pixel data
        // (only for BI_RGB, ≤8 bpp). Include it so the pixel offset is right.
        let paletteBytes = 0;
        if (dibHeaderSize === 40) {
          const bitCount = imgBuffer.readUInt16LE(14);
          const compression = imgBuffer.readUInt32LE(16);
          const clrUsed = imgBuffer.readUInt32LE(32);
          if (compression === 0 && bitCount <= 8) {
            paletteBytes = (clrUsed || (1 << bitCount)) * 4;
          }
        }
        bmpHeader.writeUInt32LE(14 + dibHeaderSize + paletteBytes, 10);
        return Buffer.concat([bmpHeader, imgBuffer]);
      }
      
      return imgBuffer;
    }
  } catch (err) {
    console.log(`[ico-extractor] Error extracting from ICO: ${err.message}`);
  }
  return icoBuffer;
}
