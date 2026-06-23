import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import archiver from 'archiver';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { generatePngIcon } from './icon-generator.js';
import { tryBuildAPK as attemptAPK } from './build-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildAPK(params) {
  if (params && params.siteUrl) {
    let raw = String(params.siteUrl).trim();
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      raw = 'https://' + raw;
    }
    params.siteUrl = raw;
  }
  return await executeAndroidBuild(params);
}

async function executeAndroidBuild({ siteUrl, appName, appId, appVersion, icon, autoFetchIcon = true, showSpinner = true, pullToRefresh = true, showSplash = true, splashDuration = 2000, fullScreen = false, customUserAgent = null, buildId, buildsDir }) {
  const buildDir = path.join(buildsDir, buildId, 'android');
  const sanitizedThemeName = appName.replace(/[^a-zA-Z0-9]/g, '') || 'App';
  
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
  const javaDir = path.join(srcDir, 'java', appId.replace(/\./g, '/'));

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
      const base64Data = icon.split(';base64,').pop();
      customIconBuffer = Buffer.from(base64Data, 'base64');
      customIconBuffer = extractPngOrBmpFromIco(customIconBuffer);
    } catch (e) {
      console.log(`[android-builder] Custom icon parsing failed: ${e.message}`);
    }
  } else if (autoFetchIcon && siteUrl) {
    customIconBuffer = await fetchFaviconBuffer(siteUrl);
    if (customIconBuffer) {
      customIconBuffer = extractPngOrBmpFromIco(customIconBuffer);
    }
  }

  // Self-correcting check: Test if sharp can successfully decode the buffer
  if (customIconBuffer && customIconBuffer.length > 0) {
    try {
      await sharp(customIconBuffer).metadata();
    } catch (sharpError) {
      console.log(`[android-builder] Icon format unsupported by sharp, falling back to Google Favicon API wrapper: ${sharpError.message}`);
      try {
        let domain = siteUrl;
        try {
          domain = new URL(siteUrl).hostname || siteUrl;
        } catch (_) {}
        const googleUrl = `https://www.google.com/s2/favicons?sz=128&domain=${domain}`;
        const res = await fetch(googleUrl);
        if (res.ok) {
          const arrBuf = await res.arrayBuffer();
          if (arrBuf && arrBuf.byteLength > 0) {
            customIconBuffer = Buffer.from(arrBuf);
            // Confirm the fallback is readable
            try {
              await sharp(customIconBuffer).metadata();
            } catch (_) {
              customIconBuffer = null;
            }
          } else {
            customIconBuffer = null;
          }
        } else {
          customIconBuffer = null;
        }
      } catch (fallbackError) {
        console.log(`[android-builder] Google Favicon API fallback failed: ${fallbackError.message}`);
        customIconBuffer = null; // Fall back to initials if everything fails
      }
    }
  } else {
    customIconBuffer = null;
  }

  for (const { name, size } of mipmapDensities) {
    const mipmapDir = path.join(resDir, name);
    fs.mkdirSync(mipmapDir, { recursive: true });
    const iconBuffer = customIconBuffer
      ? await sharp(customIconBuffer).resize(size, size).png().toBuffer()
      : await generatePngIcon(appName, size);
    fs.writeFileSync(path.join(mipmapDir, 'ic_launcher.png'), iconBuffer);
    fs.writeFileSync(path.join(mipmapDir, 'ic_launcher_round.png'), iconBuffer);
  }

  // Create Gradle wrapper
  const wrapperDir = path.join(buildDir, 'gradle', 'wrapper');
  fs.mkdirSync(wrapperDir, { recursive: true });
  fs.writeFileSync(path.join(wrapperDir, 'gradle-wrapper.properties'), `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-9.5.1-bin.zip
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

rootProject.name = "${appName}"
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
    namespace '${appId}'
    compileSdk 35

    defaultConfig {
        applicationId '${appId}'
        minSdk 24
        targetSdk 35
        versionCode 1
        versionName '${appVersion}'
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
    implementation 'androidx.swiperefreshlayout:swiperefreshlayout:1.1.0'
}
`;
  fs.writeFileSync(path.join(appDir, 'build.gradle'), buildGradleContent);

  // Create AndroidManifest.xml
  const manifestContent = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    android:versionCode="1"
    android:versionName="${appVersion}">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />

    <application
        android:allowBackup="true"
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
    <string name="app_name">${appName}</string>
    <string name="website_url">${siteUrl}</string>
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
    </style>
</resources>`;

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
                android:text="${appName}"
                android:textColor="#ffffff"
                android:textSize="22sp"
                android:textStyle="bold" />
        </LinearLayout>`;

  const activityMainContent = `<?xml version="1.0" encoding="utf-8"?>
<androidx.swiperefreshlayout.widget.SwipeRefreshLayout 
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/swipeRefresh"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <FrameLayout
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

    </FrameLayout>

</androidx.swiperefreshlayout.widget.SwipeRefreshLayout>`;

  fs.writeFileSync(path.join(layoutDir, 'activity_main.xml'), activityMainContent);

  // Create MainActivity.java
  const javaPackagePath = appId.replace(/\./g, '/');
  const mainActivityContent = `package ${appId};

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import android.widget.ProgressBar;

public class MainActivity extends Activity {
    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        final boolean fullScreen = ${fullScreen};
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
        swipeRefresh = findViewById(R.id.swipeRefresh);
        progressBar = findViewById(R.id.progressBar);
        
        webView.setBackgroundColor(0xFF09080F);
        
        final boolean enablePullToRefresh = ${pullToRefresh};
        final boolean showSpinner = ${showSpinner};
        final boolean showSplash = ${showSplash};
        final int splashDuration = ${splashDuration};

        swipeRefresh.setEnabled(enablePullToRefresh);
        if (enablePullToRefresh) {
            swipeRefresh.setOnRefreshListener(new SwipeRefreshLayout.OnRefreshListener() {
                @Override
                public void onRefresh() {
                    webView.reload();
                }
            });
        }

        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setDatabaseEnabled(true);
        webSettings.setLoadWithOverviewMode(true);
        webSettings.setUseWideViewPort(true);
        webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        
        final String customUA = ${customUserAgent ? `"${customUserAgent}"` : "null"};
        if (customUA != null && !customUA.trim().isEmpty()) {
            webSettings.setUserAgentString(customUA);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (showSpinner && !swipeRefresh.isRefreshing()) {
                    progressBar.setVisibility(android.view.View.VISIBLE);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (showSpinner) {
                    progressBar.setVisibility(android.view.View.GONE);
                }
                swipeRefresh.setRefreshing(false);
                
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
                view.loadUrl(url);
                return true;
            }
        });

        webView.loadUrl("${siteUrl}");
        
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
      const outputApk = path.join(buildsDir, buildId, `${appId}-${appVersion}.apk`);
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
  const zipPath = path.join(buildsDir, buildId, `${appId}-android-${appVersion}.zip`);
  fs.mkdirSync(path.dirname(zipPath), { recursive: true }); // Ensure output folder exists
  
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(zipPath));
    archive.on('error', reject);
    archive.pipe(output);
    
    // Archive only source files, excluding gradle caches and build directories
    archive.glob('**/*', {
      cwd: buildDir,
      ignore: ['.gradle/**', 'app/build/**', 'local.properties', '.git/**']
    }, { prefix: `${appName.replace(/\s+/g, '')}-android-source` });

    archive.finalize();
  });
}

// === Favicon Scraper Helpers ===

async function getFaviconFromHtml(siteUrl) {
  try {
    const response = await fetch(siteUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!response.ok) return null;
    const html = await response.text();

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
  try {
    // 1. Try HTML scraping
    let faviconUrl = await getFaviconFromHtml(siteUrl);

    // 2. Fallback to /favicon.ico
    if (!faviconUrl) {
      const parsedUrl = new URL(siteUrl);
      faviconUrl = `${parsedUrl.origin}/favicon.ico`;
    }

    let response = await fetch(faviconUrl);
    if (!response.ok && !faviconUrl.endsWith('/favicon.ico')) {
      const parsedUrl = new URL(siteUrl);
      faviconUrl = `${parsedUrl.origin}/favicon.ico`;
      response = await fetch(faviconUrl);
    }

    // 3. Fallback to Google Favicon API
    if (!response.ok) {
      const domain = new URL(siteUrl).hostname;
      faviconUrl = `https://www.google.com/s2/favicons?sz=128&domain=${domain}`;
      response = await fetch(faviconUrl);
    }

    // 4. Fallback to DuckDuckGo
    if (!response.ok) {
      const domain = new URL(siteUrl).hostname;
      faviconUrl = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
      response = await fetch(faviconUrl);
    }

    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      console.log(`[favicon-helper] Successfully fetched favicon from ${faviconUrl}`);
      return Buffer.from(arrayBuffer);
    }
  } catch (err) {
    console.log(`[favicon-helper] Failed to fetch favicon: ${err.message}`);
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
        bmpHeader.writeUInt32LE(14 + dibHeaderSize, 10);
        return Buffer.concat([bmpHeader, imgBuffer]);
      }
      
      return imgBuffer;
    }
  } catch (err) {
    console.log(`[ico-extractor] Error extracting from ICO: ${err.message}`);
  }
  return icoBuffer;
}
