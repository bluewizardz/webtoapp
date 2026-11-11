import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import archiver from 'archiver';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { generatePngIcon } from './icon-generator.js';
import { tryBuildAPK as attemptAPK, resolveAndroidBuildVariant } from './build-utils.js';
import { escapeAndroidString, escapeGradleString, escapeJavaString, escapeXmlAttribute } from './codegen.js';
import { buildMainActivityJava } from './android-main-activity.js';
import {
  AGP_VERSION,
  COMPILE_SDK,
  GRADLE_DISTRIBUTION_URL,
  JAVA_VERSION,
  MIN_SDK,
  TARGET_SDK
} from './android-toolchain.js';
// Shared with the Cloudflare Pages functions (kept inside functions/ so Pages can
// bundle it). Validating here protects every caller, including direct API use.
import { normalizeSiteUrl, validateAppId, validateAppVersion } from '../functions/_lib/build-inputs.js';

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

/**
 * Turn whatever the caller supplied (a data URI or bare base64) into a Buffer.
 * Returns null when the payload is not a recognisable image data URI.
 */
function decodeIconPayload(icon) {
  if (typeof icon !== 'string') return null;
  const raw = icon.trim();
  if (!raw) return null;

  const dataUri = /^data:([^;,]*)(;base64)?,([\s\S]*)$/i.exec(raw);
  if (dataUri) {
    const mime = (dataUri[1] || '').toLowerCase();
    const isBase64 = !!dataUri[2];
    const payload = dataUri[3];
    if (mime && mime !== 'application/octet-stream' && !/^image\//.test(mime)) return null;
    try {
      return isBase64
        ? Buffer.from(payload, 'base64')
        : Buffer.from(decodeURIComponent(payload), 'utf8');
    } catch (error) {
      return null;
    }
  }

  // Bare base64 (no data: prefix).
  if (/^[A-Za-z0-9+/\s]+={0,2}$/.test(raw)) {
    return Buffer.from(raw, 'base64');
  }
  return null;
}

async function isDecodableIcon(buffer) {
  if (!buffer || buffer.length === 0) return false;
  try {
    const meta = await sharp(buffer).metadata();
    return !!(meta.width && meta.height);
  } catch (error) {
    return false;
  }
}

async function renderLauncherIcon(buffer, size) {
  return sharp(buffer)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

// sharp cannot decode BMP-based .ico entries, so an unreadable favicon gets one
// more try from a PNG-producing favicon service before we give up.
async function fetchUsableFavicon(siteUrl) {
  const attempts = [
    async () => fetchFaviconBuffer(siteUrl),
    async () => {
      try {
        const domain = new URL(siteUrl).hostname;
        const response = await fetch(`https://www.google.com/s2/favicons?sz=128&domain=${domain}`);
        return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
      } catch (error) {
        console.log(`[android-builder] Google favicon fallback failed: ${error.message}`);
        return null;
      }
    }
  ];

  for (const attempt of attempts) {
    const raw = await attempt();
    if (!raw || raw.length === 0) continue;
    const candidate = extractPngOrBmpFromIco(raw);
    if (await isDecodableIcon(candidate)) return candidate;
  }
  return null;
}

/**
 * Pick the launcher icon image, in priority order:
 *   1. the icon the user uploaded,
 *   2. the website favicon (only when automatic icon fetching is enabled),
 *   3. null, which makes the caller draw the generated initials icon.
 */
async function resolveAppIcon({ icon, autoFetchIcon, siteUrl }) {
  if (icon) {
    const uploaded = decodeIconPayload(icon);
    if (uploaded) {
      const candidate = extractPngOrBmpFromIco(uploaded);
      if (await isDecodableIcon(candidate)) {
        console.log('[android-builder] Using the uploaded custom app icon.');
        return candidate;
      }
    }
    // The user chose an icon explicitly: never swap it for a scraped favicon.
    console.log('[android-builder] Uploaded icon could not be read; using the generated icon.');
    return null;
  }

  if (autoFetchIcon && siteUrl) {
    const favicon = await fetchUsableFavicon(siteUrl);
    if (favicon) {
      console.log('[android-builder] Using the website favicon as the app icon.');
      return favicon;
    }
    console.log('[android-builder] No usable favicon found; using the generated icon.');
    return null;
  }

  console.log('[android-builder] Automatic icon fetching disabled; using the generated icon.');
  return null;
}

export async function generateAndroidProject(params) {
  // Validate the values that become file paths, package names and Gradle
  // identifiers before a single file is written.
  const siteResult = normalizeSiteUrl(params.siteUrl);
  if (siteResult.error) {
    throw new Error(`Invalid website URL: ${siteResult.error}`);
  }
  const appIdResult = validateAppId(params.appId);
  if (appIdResult.error) {
    throw new Error(`Invalid app ID: ${appIdResult.error}`);
  }
  const versionResult = validateAppVersion(params.appVersion);
  if (versionResult.error) {
    throw new Error(`Invalid app version: ${versionResult.error}`);
  }

  const {
    icon,
    autoFetchIcon = true,
    showSpinner = true,
    pullToRefresh = true,
    allowZoom = false,
    showSplash = true,
    splashDuration = 2000,
    fullScreen = false,
    customUserAgent = null,
    buildId,
    buildsDir
  } = params;
  const siteUrl = siteResult.value;
  const appId = appIdResult.value;
  const appVersion = versionResult.value;
  // Markup and quotes in names are handled by the per-format escaping below;
  // control characters are never valid, so they become spaces.
  const appName = String(params.appName ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim() || 'My Web App';

  const enableZoom = allowZoom === true || allowZoom === 'true';
  const buildDir = path.join(buildsDir, buildId, 'android');
  const sanitizedThemeName = appName.replace(/[^a-zA-Z0-9]/g, '') || 'App';

  // Values pre-escaped for each output format this project uses.
  const androidStringAppName = escapeAndroidString(appName);
  const androidStringSiteUrl = escapeAndroidString(siteUrl);
  const attributeAppName = escapeXmlAttribute(appName);
  
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

  const customIconBuffer = await resolveAppIcon({ icon, autoFetchIcon, siteUrl });

  for (const { name, size } of mipmapDensities) {
    const mipmapDir = path.join(resDir, name);
    fs.mkdirSync(mipmapDir, { recursive: true });
    const iconBuffer = customIconBuffer
      ? await renderLauncherIcon(customIconBuffer, size)
      : await generatePngIcon(appName, size);
    fs.writeFileSync(path.join(mipmapDir, 'ic_launcher.png'), iconBuffer);
    fs.writeFileSync(path.join(mipmapDir, 'ic_launcher_round.png'), iconBuffer);
  }

  // Create Gradle wrapper
  const wrapperDir = path.join(buildDir, 'gradle', 'wrapper');
  fs.mkdirSync(wrapperDir, { recursive: true });
  fs.writeFileSync(path.join(wrapperDir, 'gradle-wrapper.properties'), `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=${GRADLE_DISTRIBUTION_URL.replace(/:/g, '\\:')}
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

rootProject.name = "${escapeGradleString(appName, '"')}"
include ':app'
`);

  // Create root build.gradle
  fs.writeFileSync(path.join(buildDir, 'build.gradle'), `plugins {
    id 'com.android.application' version '${AGP_VERSION}' apply false
}
`);

  // Create app/build.gradle
  const homeDir = (process.env.HOME || '/tmp').replace(/\\/g, '/');
  const buildGradleContent = `plugins {
    id 'com.android.application'
}

// Release signing material comes from the environment (CI secrets) and is never
// written into the project. Without it, only the debug variant is built.
def releaseKeystorePath = System.getenv('SITEAPP_KEYSTORE_PATH')
def releaseKeystorePassword = System.getenv('SITEAPP_KEYSTORE_PASSWORD')
def releaseKeyAlias = System.getenv('SITEAPP_KEY_ALIAS')
def releaseKeyPassword = System.getenv('SITEAPP_KEY_PASSWORD')
def hasReleaseSigning = releaseKeystorePath != null && releaseKeystorePath.length() > 0 \
    && releaseKeystorePassword != null && releaseKeyAlias != null && releaseKeyPassword != null \
    && file(releaseKeystorePath).exists()
def enableShrinking = System.getenv('SITEAPP_MINIFY') == 'true'

android {
    namespace '${escapeGradleString(appId)}'
    compileSdk ${COMPILE_SDK}

    defaultConfig {
        applicationId '${escapeGradleString(appId)}'
        minSdk ${MIN_SDK}
        targetSdk ${TARGET_SDK}
        versionCode 1
        versionName '${escapeGradleString(appVersion)}'
    }

    signingConfigs {
        debug {
            storeFile file('${escapeGradleString(homeDir)}/.android/debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        if (hasReleaseSigning) {
            release {
                storeFile file(releaseKeystorePath)
                storePassword releaseKeystorePassword
                keyAlias releaseKeyAlias
                keyPassword releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            // Shrinking stays off unless explicitly enabled after verifying the site.
            minifyEnabled enableShrinking
            shrinkResources enableShrinking
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
            if (hasReleaseSigning) {
                // A release build is never signed with the debug key.
                signingConfig signingConfigs.release
            }
        }
        debug {
            debuggable true
            signingConfig signingConfigs.debug
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_${JAVA_VERSION}
        targetCompatibility JavaVersion.VERSION_${JAVA_VERSION}
    }
}

dependencies {
    implementation 'androidx.core:core:1.15.0'
    implementation 'androidx.swiperefreshlayout:swiperefreshlayout:1.1.0'
}
`;
  fs.writeFileSync(path.join(appDir, 'build.gradle'), buildGradleContent);

  // Create AndroidManifest.xml
  // Cleartext HTTP is only permitted when the wrapped site itself is served over HTTP.
  const allowCleartext = /^http:\/\//i.test(siteUrl);
  const manifestSiteHost = escapeXmlAttribute(new URL(siteUrl).hostname);
  const manifestContent = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    android:versionCode="1"
    android:versionName="${escapeXmlAttribute(appVersion)}">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <!-- Only needed to save downloads to the public Downloads folder before Android 10. -->
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />

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
            android:launchMode="singleTop"
            android:configChanges="orientation|screenSize|keyboardHidden"
            android:hardwareAccelerated="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
            <!-- Lets the site return the user to the app after an OAuth flow. -->
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="${manifestSiteHost}" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="siteapp" android:host="${manifestSiteHost}" />
            </intent-filter>
        </activity>
    </application>

</manifest>`;

  fs.writeFileSync(path.join(srcDir, 'AndroidManifest.xml'), manifestContent);

  // Create strings.xml
  const stringsContent = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${androidStringAppName}</string>
    <string name="website_url">${androidStringSiteUrl}</string>
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
                android:text="${attributeAppName}"
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
            android:indeterminate="false"
            android:max="100"
            android:progress="0"
            android:progressTint="#10b981"
            android:visibility="gone" />

    </FrameLayout>

</androidx.swiperefreshlayout.widget.SwipeRefreshLayout>`;

  fs.writeFileSync(path.join(layoutDir, 'activity_main.xml'), activityMainContent);

  // Create MainActivity.java
  const javaPackagePath = appId.replace(/\./g, '/');
  const mainActivityContent = buildMainActivityJava({
    appId,
    siteUrl,
    customUserAgent,
    enableZoom,
    fullScreen,
    pullToRefresh,
    showSpinner,
    showSplash,
    splashDuration,
    allowMixedContent: params.allowMixedContent === true,
    externalAuthHosts: params.externalAuthHosts
  });
  fs.writeFileSync(path.join(javaDir, 'MainActivity.java'), mainActivityContent);

  // Create proguard-rules.pro
  fs.writeFileSync(path.join(appDir, 'proguard-rules.pro'), `# WebView
-keepclassmembers class * {
    public void onEvent*(**);
}

# The download bridge is called from JavaScript, so shrinking must keep it.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

-keep class android.webkit.** { *; }
`);

  // Create .gitignore
  fs.writeFileSync(path.join(buildDir, '.gitignore'), `# Gradle
.gradle
build/
*.apk
*.jks
*.keystore
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

## Build a Signed Release APK

Release signing reads environment variables and never files in this repository:

  export SITEAPP_KEYSTORE_PATH=/secure/path/release.jks
  export SITEAPP_KEYSTORE_PASSWORD=...
  export SITEAPP_KEY_ALIAS=...
  export SITEAPP_KEY_PASSWORD=...
  ./gradlew assembleRelease

Without those variables the release build stays unsigned, so a release APK is
never signed with the debug key. Code and resource shrinking stay disabled until
SITEAPP_MINIFY=true is set. Never commit a keystore or its passwords; *.jks and
*.keystore files are ignored by git.

## Build via GitHub Actions (Zero Cost Setup)

This project has been pre-configured with a GitHub Actions workflow to build your APK for free:
1. Initialize a Git repository in this directory.
2. Push the files to a new GitHub repository.
3. The APK will be built automatically on every push. You can find the downloadable APK in the "Actions" tab of your GitHub repository under the latest run.
`);

  return { buildDir, buildsDir, buildId, appId, appVersion, appName };
}

/**
 * Generate the Android project, then compile it (falling back to a source ZIP).
 * Returns the produced file path.
 */
async function executeAndroidBuild(params) {
  const { buildDir, buildsDir, buildId, appId, appVersion, appName } = await generateAndroidProject(params);

  // === Try to build actual APK ===
  try {
    const apkPath = await attemptAPK(buildDir);
    if (apkPath) {
      // Copy the APK to the build output directory with a clean name. The variant
      // is part of the filename so a debug APK is never mistaken for a release.
      const variant = resolveAndroidBuildVariant() || 'debug';
      const outputApk = path.join(buildsDir, buildId, `${appId}-${appVersion}-${variant}.apk`);
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
    }, { prefix: `${appName.replace(/[^\w.-]+/g, '') || 'app'}-android-source` });

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
