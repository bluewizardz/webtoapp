import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { GRADLE_VERSION, GRADLE_DISTRIBUTION_URL } from './android-toolchain.js';

// Ensure locally installed tools are in PATH
const localBin = path.join(process.env.HOME || '', '.local', 'bin');
if (!process.env.PATH.includes(localBin)) {
  process.env.PATH = `${localBin}:${process.env.PATH}`;
}

/**
 * Try to run a shell command. Returns true if successful, false if not.
 */
export function tryExec(cmd, options = {}) {
  try {
    execSync(cmd, {
      stdio: 'pipe',
      timeout: options.timeout || 300000,
      ...options
    });
    return true;
  } catch (e) {
    console.log(`[build-utils] Command failed: ${cmd}`);
    console.log(`[build-utils] Error: ${e.message}`);
    if (e.stdout) console.log(`[build-utils] stdout:\n${e.stdout.toString().trim()}`);
    if (e.stderr) console.log(`[build-utils] stderr:\n${e.stderr.toString().trim()}`);
    return false;
  }
}

/**
 * Check if a command exists on the system.
 */
export function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find files matching a pattern (extension) in a directory recursively.
 */
export function findFiles(dir, extension) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, extension));
    } else if (entry.name.endsWith(extension)) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Try to build an Android APK. Returns the APK path or null.
 */
/**
 * Decide which APK variant to build.
 *
 * `BUILD_VARIANT` selects it explicitly; otherwise a release build is used when
 * release signing secrets are present, and the debug variant when they are not.
 * Returns 'release', 'debug', or null when a release build was requested without
 * signing material (a release APK must never be signed with the debug key).
 */
export function resolveAndroidBuildVariant() {
  const requested = String(process.env.BUILD_VARIANT || '').trim().toLowerCase();
  const keystorePath = String(process.env.SITEAPP_KEYSTORE_PATH || '').trim();
  const hasSigning = Boolean(
    keystorePath &&
    fs.existsSync(keystorePath) &&
    String(process.env.SITEAPP_KEYSTORE_PASSWORD || '').trim() &&
    String(process.env.SITEAPP_KEY_ALIAS || '').trim() &&
    String(process.env.SITEAPP_KEY_PASSWORD || '').trim()
  );

  if (requested === 'release') return hasSigning ? 'release' : null;
  if (requested === 'debug') return 'debug';
  return hasSigning ? 'release' : 'debug';
}

export async function tryBuildAPK(buildDir) {
  console.log('[build-utils] Attempting Android APK build...');

  // Check for Android SDK
  let androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!androidHome) {
    const commonPaths = [
      path.join(process.env.HOME || '', 'Android/Sdk'),
      '/opt/android-sdk',
      '/usr/lib/android-sdk',
      '/usr/local/lib/android/sdk'
    ];
    const found = commonPaths.find(p => fs.existsSync(p));
    if (found) {
      androidHome = found;
    } else {
      console.log('[build-utils] Android SDK not found, trying to install...');
      const installed = await tryInstallAndroidSdk();
      if (!installed) {
        console.log('[build-utils] Could not set up Android SDK, skipping APK compilation');
        return null;
      }
      androidHome = process.env.ANDROID_HOME;
    }
  }

  // AGP requires JDK 17 (not 26). Download JDK 17 if needed.
  const jdk17Home = await ensureJdk17();
  if (!jdk17Home) {
    console.log('[build-utils] JDK 17 not available, skipping APK compilation');
    return null;
  }
  try {
    // Write local.properties with SDK path
    fs.writeFileSync(
      path.join(buildDir, 'local.properties'),
      `sdk.dir=${androidHome.replace(/\\/g, '/')}\n`
    );

    // Write a clean, portable gradle.properties with optimized compilation features enabled
    fs.writeFileSync(
      path.join(buildDir, 'gradle.properties'),
      `org.gradle.jvmargs=-Xmx2048m --add-opens=java.base/java.lang=ALL-UNNAMED --add-opens=java.base/java.util=ALL-UNNAMED\n` +
      `org.gradle.daemon=true\n` +
      `org.gradle.parallel=true\n` +
      `org.gradle.configureondemand=true\n` +
      `org.gradle.configuration-cache=true\n` +
      `android.useAndroidX=true\n` +
      `android.suppressUnsupportedCompileSdk=35\n`
    );

    // Build directly with the pinned Gradle release from android-toolchain.js, so
    // the hosted compiler matches the wrapper written into generated projects.
    console.log('[build-utils] Building APK with JDK 17...');
    const gradleBin = await ensureGradle8();
    if (!gradleBin) {
      console.log(`[build-utils] Gradle ${GRADLE_VERSION} not available, skipping APK compilation`);
      return null;
    }

    const env = {
      ...process.env,
      JAVA_HOME: jdk17Home,
      ANDROID_HOME: androidHome,
      ANDROID_SDK_ROOT: androidHome,
      PATH: `${jdk17Home}/bin:${process.env.PATH}`
    };

    // Create debug keystore if it doesn't exist
    const debugKeystorePath = path.join(process.env.HOME || '/tmp', '.android', 'debug.keystore');
    if (!fs.existsSync(debugKeystorePath)) {
      console.log('[build-utils] Creating debug keystore...');
      fs.mkdirSync(path.join(process.env.HOME || '/tmp', '.android'), { recursive: true });
      tryExec(
        `${jdk17Home}/bin/keytool -genkey -v -keystore "${debugKeystorePath}" -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US"`,
        { timeout: 30000, env }
      );
    }

    // Regenerate the project wrapper with the same Gradle release used below, so an
    // exported project builds with ./gradlew at the version its AGP expects.
    console.log(`[build-utils] Generating Gradle ${GRADLE_VERSION} wrapper...`);
    if (tryExec(`${gradleBin} wrapper --gradle-version ${GRADLE_VERSION} --distribution-type bin --quiet`, { cwd: buildDir, timeout: 180000, env })) {
      const wrapperProps = path.join(buildDir, 'gradle', 'wrapper', 'gradle-wrapper.properties');
      if (fs.existsSync(wrapperProps)) {
        const pinnedUrl = GRADLE_DISTRIBUTION_URL.replace(/:/g, '\\:');
        const contents = fs.readFileSync(wrapperProps, 'utf8')
          .replace(/^distributionUrl=.*$/m, `distributionUrl=${pinnedUrl}`);
        fs.writeFileSync(wrapperProps, contents);
      }
    } else {
      console.log('[build-utils] Wrapper generation failed; continuing with the installed Gradle');
    }

    const variant = resolveAndroidBuildVariant();
    if (!variant) {
      console.log('[build-utils] Release build requested, but release signing is not configured. Add ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS and ANDROID_KEY_PASSWORD secrets, or run a debug build. Refusing to sign a release APK with the debug key.');
      return null;
    }
    const assembleTask = variant === 'release' ? 'assembleRelease' : 'assembleDebug';
    console.log(`[build-utils] Building the ${variant} variant with ${assembleTask}...`);

    // Compile using parallel execution, build cache, and configuration cache (makes compilation blazing fast on repeat runs)
    // Pass Java Home explicitly via system property to guarantee it uses JDK 17 without polluting gradle.properties
    if (!tryExec(`${gradleBin} ${assembleTask} --parallel --build-cache --configuration-cache -Dorg.gradle.java.home=${jdk17Home}`, { cwd: buildDir, timeout: 600000, env })) {
      console.log(`[build-utils] ${assembleTask} failed. Check the Gradle output above for the failing task.`);
      return null;
    }

    // Find the APK
    const apkDir = path.join(buildDir, 'app', 'build', 'outputs', 'apk', variant);
    const apks = findFiles(apkDir, '.apk');
    if (apks.length > 0) {
      console.log(`[build-utils] APK built successfully: ${apks[0]}`);
      return apks[0];
    }
  } catch (e) {
    console.log(`[build-utils] APK build error: ${e.message}`);
  }
  return null;
}

/**
 * Ensure JDK 17 is available. Downloads if needed. Returns JAVA_HOME path or null.
 */
async function ensureJdk17() {
  // 1. Check if process.env.JAVA_HOME is already configured with JDK 17
  if (process.env.JAVA_HOME && fs.existsSync(path.join(process.env.JAVA_HOME, 'bin', 'java'))) {
    try {
      const versionOutput = execSync(`"${path.join(process.env.JAVA_HOME, 'bin', 'java')}" -version 2>&1`).toString();
      if (versionOutput.includes('version "17') || versionOutput.includes(' 17.')) {
        console.log('[build-utils] Using system JAVA_HOME: ' + process.env.JAVA_HOME);
        return process.env.JAVA_HOME;
      }
    } catch (e) {
      console.log('[build-utils] Error checking system JAVA_HOME version:', e.message);
    }
  }

  const jdk17Dir = path.join(process.env.HOME || '/tmp', '.jdk', 'jdk-17');

  // Check if already downloaded
  if (fs.existsSync(path.join(jdk17Dir, 'bin', 'java'))) {
    console.log('[build-utils] JDK 17 found at ' + jdk17Dir);
    return jdk17Dir;
  }

  console.log('[build-utils] Downloading JDK 17 for Android builds...');
  const jdkUrl = 'https://download.java.net/java/GA/jdk17.0.2/dfd4a8d0985749f896bed50d7138ee7f/8/GPL/openjdk-17.0.2_linux-x64_bin.tar.gz';
  const tarPath = '/tmp/jdk17.tar.gz';

  try {
    if (!tryExec(`curl -fsSL "${jdkUrl}" -o "${tarPath}"`, { timeout: 120000 })) {
      return null;
    }

    fs.mkdirSync(path.join(process.env.HOME || '/tmp', '.jdk'), { recursive: true });
    if (!tryExec(`tar -xzf "${tarPath}" -C "${path.join(process.env.HOME || '/tmp', '.jdk')}"`, { timeout: 60000 })) {
      return null;
    }

    // The extracted dir is named jdk-17.0.2 — rename to jdk-17
    const parentDir = path.join(process.env.HOME || '/tmp', '.jdk');
    const entries = fs.readdirSync(parentDir).filter(e => e.startsWith('jdk-17'));
    if (entries.length > 0 && entries[0] !== 'jdk-17') {
      fs.renameSync(path.join(parentDir, entries[0]), jdk17Dir);
    }

    tryExec(`rm -f "${tarPath}"`, { timeout: 5000 });

    const javaBin = path.join(jdk17Dir, 'bin', 'java');
    if (fs.existsSync(javaBin)) {
      tryExec(`chmod +x "${javaBin}"`);
      console.log('[build-utils] JDK 17 installed at ' + jdk17Dir);
      return jdk17Dir;
    }
  } catch (e) {
    console.log(`[build-utils] JDK 17 download failed: ${e.message}`);
  }
  return null;
}

/**
 * Ensure Gradle 8.12.1 is available for Android builds. Returns gradle binary path or null.
 */
async function ensureGradle8() {
  const gradleDir = path.join(process.env.HOME || '/tmp', '.gradle-android', `gradle-${GRADLE_VERSION}`);
  const gradleBin = path.join(gradleDir, 'bin', 'gradle');

  if (fs.existsSync(gradleBin)) {
    console.log(`[build-utils] Gradle ${GRADLE_VERSION} found`);
    return gradleBin;
  }

  console.log(`[build-utils] Downloading Gradle ${GRADLE_VERSION} for Android builds...`);
  const gradleUrl = GRADLE_DISTRIBUTION_URL;
  const zipPath = `/tmp/gradle-${GRADLE_VERSION}.zip`;

  try {
    if (!tryExec(`curl -fsSL --retry 5 --retry-delay 5 --retry-max-time 600 --connect-timeout 30 "${gradleUrl}" -o "${zipPath}"`, { timeout: 660000 })) {
      return null;
    }

    fs.mkdirSync(path.join(process.env.HOME || '/tmp', '.gradle-android'), { recursive: true });
    if (!tryExec(`unzip -qo "${zipPath}" -d "${path.join(process.env.HOME || '/tmp', '.gradle-android')}"`, { timeout: 60000 })) {
      return null;
    }

    tryExec(`rm -f "${zipPath}"`, { timeout: 5000 });

    if (fs.existsSync(gradleBin)) {
      tryExec(`chmod +x "${gradleBin}"`);
      console.log(`[build-utils] Gradle ${GRADLE_VERSION} installed`);
      return gradleBin;
    }
  } catch (e) {
    console.log(`[build-utils] Gradle 8.12.1 download failed: ${e.message}`);
  }
  return null;
}

/**
 * Try to install Android SDK command-line tools.
 */
async function tryInstallAndroidSdk() {
  const sdkRoot = path.join(process.env.HOME || '/tmp', 'android-sdk');
  try {
    if (!fs.existsSync(sdkRoot)) {
      fs.mkdirSync(sdkRoot, { recursive: true });
    }

    // Download command-line tools
    const toolsUrl = 'https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip';
    const toolsZip = '/tmp/android-cmdline-tools.zip';

    if (!fs.existsSync(path.join(sdkRoot, 'cmdline-tools'))) {
      console.log('[build-utils] Downloading Android command-line tools...');
      if (!tryExec(`curl -fsSL "${toolsUrl}" -o "${toolsZip}"`, { timeout: 120000 })) {
        return false;
      }
      if (!tryExec(`unzip -qo "${toolsZip}" -d "${sdkRoot}/cmdline-tools-tmp"`, { timeout: 30000 })) {
        return false;
      }
      fs.mkdirSync(path.join(sdkRoot, 'cmdline-tools', 'latest'), { recursive: true });
      if (!tryExec(`mv ${sdkRoot}/cmdline-tools-tmp/cmdline-tools/* ${sdkRoot}/cmdline-tools/latest/`, { timeout: 10000 })) {
        return false;
      }
      tryExec(`rm -rf "${toolsZip}" "${sdkRoot}/cmdline-tools-tmp"`, { timeout: 10000 });
    }

    const sdkmanager = path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager');
    if (!fs.existsSync(sdkmanager)) {
      return false;
    }

    // Accept licenses and install required packages
    console.log('[build-utils] Installing Android SDK packages...');
    tryExec(`yes | ${sdkmanager} --sdk_root="${sdkRoot}" --licenses`, { timeout: 60000 });
    if (!tryExec(`${sdkmanager} --sdk_root="${sdkRoot}" "platforms;android-35" "build-tools;35.0.0"`, { timeout: 300000 })) {
      return false;
    }

    process.env.ANDROID_HOME = sdkRoot;
    process.env.ANDROID_SDK_ROOT = sdkRoot;
    console.log(`[build-utils] Android SDK installed at ${sdkRoot}`);
    return true;
  } catch (e) {
    console.log(`[build-utils] Android SDK install failed: ${e.message}`);
    return false;
  }
}

/**
 * Try to build an Electron app. Returns the artifact path or null.
 * @param {string} buildDir - The project directory
 * @param {string} target - e.g. 'AppImage', 'deb', 'dmg', 'nsis'
 * @param {string} platform - e.g. '--linux', '--mac', '--win'
 * @param {string} extension - e.g. '.AppImage', '.deb', '.dmg', '.exe'
 */
export async function tryBuildElectron(buildDir, target, platform, extension) {
  console.log(`[build-utils] Attempting Electron ${target} build...`);

  try {
    // Set up shared cache directory for Electron packages to bypass npm install on every single build
    const buildsDir = path.dirname(path.dirname(buildDir)); 
    const cacheDir = path.join(buildsDir, 'cache');
    const sharedElectronDir = path.join(cacheDir, 'electron-shared');
    const sharedNodeModules = path.join(sharedElectronDir, 'node_modules');

    fs.mkdirSync(sharedElectronDir, { recursive: true });

    // Copy package.json from buildDir to shared cache dir
    const sourcePkg = path.join(buildDir, 'package.json');
    const destPkg = path.join(sharedElectronDir, 'package.json');
    if (fs.existsSync(sourcePkg)) {
      fs.copyFileSync(sourcePkg, destPkg);
    }

    // Install shared node_modules if not already cached
    if (!fs.existsSync(sharedNodeModules)) {
      console.log('[build-utils] Shared Electron cache missing. Fetching packages once...');
      tryExec('npm install --prefer-offline --no-audit --no-fund --quiet', { cwd: sharedElectronDir, timeout: 240000 });
    }

    // Create symbolic link to the shared node_modules folder
    const projectNodeModules = path.join(buildDir, 'node_modules');
    if (fs.existsSync(sharedNodeModules) && !fs.existsSync(projectNodeModules)) {
      console.log('[build-utils] Linking shared node_modules folder...');
      try {
        fs.symlinkSync(sharedNodeModules, projectNodeModules, 'dir');
      } catch (symlinkErr) {
        console.log(`[build-utils] Symbolic link failed: ${symlinkErr.message}. Falling back to fresh install...`);
        if (!tryExec('npm install --prefer-offline --no-audit --no-fund --quiet', { cwd: buildDir, timeout: 180000 })) {
          return null;
        }
      }
    }

    // Build
    console.log(`[build-utils] Running electron-builder ${platform} ${target}...`);
    const localBuilder = path.join(buildDir, 'node_modules', '.bin', 'electron-builder');
    const builderCmd = fs.existsSync(localBuilder)
      ? `"${localBuilder}"`
      : 'npx --no-install electron-builder';
    if (!tryExec(`${builderCmd} ${platform} ${target} --publish never`, { cwd: buildDir, timeout: 600000 })) {
      return null;
    }

    // Find the artifact
    const distDir = path.join(buildDir, 'dist');
    const artifacts = findFiles(distDir, extension);
    if (artifacts.length > 0) {
      console.log(`[build-utils] Built successfully: ${artifacts[0]}`);
      return artifacts[0];
    }
  } catch (e) {
    console.log(`[build-utils] Electron build error: ${e.message}`);
  }
  return null;
}
