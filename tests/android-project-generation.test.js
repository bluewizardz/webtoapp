import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { generateAndroidProject } from '../builders/android-builder.js';
import {
  AGP_MIN_GRADLE_VERSION,
  AGP_VERSION,
  COMPILE_SDK,
  GRADLE_DISTRIBUTION_URL,
  GRADLE_VERSION,
  MIN_SDK,
  TARGET_SDK
} from '../builders/android-toolchain.js';

const APP_NAME = "Ben & Jerry's Café";
const SITE_URL = 'https://example.com/café?a=1&b=2';
const USER_AGENT = 'Mozilla/5.0 (X11; Linux) "Quoted" C:\\path';
const APP_VERSION = '1.0.0-beta+7';

function tempBuildsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'android-project-'));
}

async function generate(overrides = {}) {
  const buildsDir = tempBuildsDir();
  const buildId = 'test-build';
  const project = await generateAndroidProject({
    siteUrl: SITE_URL,
    appName: APP_NAME,
    appId: 'com.example.cafe',
    appVersion: APP_VERSION,
    icon: null,
    autoFetchIcon: false,
    customUserAgent: USER_AGENT,
    buildId,
    buildsDir,
    ...overrides
  });
  const read = (relative) => fs.readFileSync(path.join(project.buildDir, relative), 'utf8');
  return { project, buildsDir, read };
}

function readText(project, relative) {
  return fs.readFileSync(path.join(project.buildDir, relative), 'utf8');
}

function cleanup(buildsDir) {
  fs.rmSync(buildsDir, { recursive: true, force: true });
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

test('app name is escaped per file format', async () => {
  const { project, buildsDir } = await generate();
  try {
    const strings = readText(project, 'app/src/main/res/values/strings.xml');
    assert.ok(
      strings.includes(String.raw`<string name="app_name">Ben &amp; Jerry\'s Café</string>`),
      strings
    );
    assert.ok(
      strings.includes('<string name="website_url">https://example.com/caf%C3%A9?a=1&amp;b=2</string>'),
      strings
    );

    const layout = readText(project, 'app/src/main/res/layout/activity_main.xml');
    assert.ok(layout.includes(String.raw`android:text="Ben &amp; Jerry&apos;s Café"`), layout);

    const settings = readText(project, 'settings.gradle');
    assert.ok(settings.includes(String.raw`rootProject.name = "Ben & Jerry's Café"`), settings);
  } finally {
    cleanup(buildsDir);
  }
});

test('Java source escapes URLs and user agents', async () => {
  const { project, buildsDir } = await generate();
  try {
    const java = readText(project, 'app/src/main/java/com/example/cafe/MainActivity.java');

    assert.ok(java.includes('package com.example.cafe;'), 'package declaration');
    assert.ok(
      java.includes('String initialUrl = "https://example.com/caf%C3%A9?a=1&b=2";'),
      'site URL must be a valid Java string literal'
    );
    assert.ok(java.includes('webView.loadUrl(initialUrl);'), 'the validated URL is loaded');
    assert.ok(
      java.includes('Uri siteUri = Uri.parse("https://example.com/caf%C3%A9?a=1&b=2");'),
      'Uri.parse must receive an escaped literal'
    );
    assert.ok(
      java.includes(String.raw`final String customUA = "Mozilla/5.0 (X11; Linux) \"Quoted\" C:\\path";`),
      java
    );
    // A raw quote or line break inside the literal would break the compilation.
    const customUaLine = java.split('\n').find((line) => line.includes('final String customUA'));
    assert.equal((customUaLine.match(/(?<!\\)"/g) || []).length, 2);
  } finally {
    cleanup(buildsDir);
  }
});

test('manifest and Gradle files use the pinned, compatible toolchain', async () => {
  const { project, buildsDir } = await generate();
  try {
    const manifest = readText(project, 'app/src/main/AndroidManifest.xml');
    assert.ok(manifest.includes(`android:versionName="${APP_VERSION}"`), manifest);

    const appGradle = readText(project, 'app/build.gradle');
    assert.ok(appGradle.includes(`versionName '${APP_VERSION}'`), appGradle);
    assert.ok(appGradle.includes(`namespace 'com.example.cafe'`), appGradle);
    assert.ok(appGradle.includes(`compileSdk ${COMPILE_SDK}`), appGradle);
    assert.ok(appGradle.includes(`minSdk ${MIN_SDK}`), appGradle);
    assert.ok(appGradle.includes(`targetSdk ${TARGET_SDK}`), appGradle);

    const rootGradle = readText(project, 'build.gradle');
    assert.ok(rootGradle.includes(`id 'com.android.application' version '${AGP_VERSION}'`), rootGradle);

    const wrapper = readText(project, 'gradle/wrapper/gradle-wrapper.properties');
    const distributionUrl = /^distributionUrl=(.*)$/m.exec(wrapper)[1].replace(/\\:/g, ':');
    assert.equal(distributionUrl, GRADLE_DISTRIBUTION_URL);
    assert.ok(distributionUrl.includes(`gradle-${GRADLE_VERSION}-bin.zip`), distributionUrl);

    // The wrapper and the hosted compiler must be the same release, and that
    // release must be supported by the declared Android Gradle Plugin.
    assert.ok(
      compareVersions(GRADLE_VERSION, AGP_MIN_GRADLE_VERSION) >= 0,
      `Gradle ${GRADLE_VERSION} is older than the ${AGP_MIN_GRADLE_VERSION} AGP ${AGP_VERSION} needs`
    );
  } finally {
    cleanup(buildsDir);
  }
});

test('generated resources are well-formed XML', async (t) => {
  const { project, buildsDir } = await generate();
  try {
    const xmlFiles = [
      'app/src/main/AndroidManifest.xml',
      'app/src/main/res/values/strings.xml',
      'app/src/main/res/values/styles.xml',
      'app/src/main/res/values/colors.xml',
      'app/src/main/res/layout/activity_main.xml',
      'app/src/main/res/xml/backup_rules.xml',
      'app/src/main/res/xml/data_extraction_rules.xml'
    ].map((relative) => path.join(project.buildDir, relative));

    const result = spawnSync(
      'python3',
      ['-c', 'import sys, xml.etree.ElementTree as ET\nfor p in sys.argv[1:]: ET.parse(p)', ...xmlFiles],
      { encoding: 'utf8' }
    );

    if (result.error) {
      t.skip('python3 is not available to validate XML');
      return;
    }
    assert.equal(result.status, 0, result.stderr);
  } finally {
    cleanup(buildsDir);
  }
});

test('launcher icons are generated for markup-heavy names', async () => {
  const { project, buildsDir } = await generate();
  try {
    for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
      const icon = path.join(project.buildDir, `app/src/main/res/mipmap-${density}/ic_launcher.png`);
      assert.ok(fs.existsSync(icon), `${density} launcher icon missing`);
      assert.ok(fs.statSync(icon).size > 0, `${density} launcher icon is empty`);
    }
  } finally {
    cleanup(buildsDir);
  }
});

test('invalid app IDs, URLs and versions are rejected before files are written', async () => {
  const buildsDir = tempBuildsDir();
  try {
    const base = {
      siteUrl: 'https://example.com',
      appName: 'My App',
      appId: 'com.example.app',
      appVersion: '1.0.0',
      buildId: 'bad-input',
      buildsDir
    };
    await assert.rejects(
      () => generateAndroidProject({ ...base, appId: 'com.example; rm -rf /' }),
      /Invalid app ID/
    );
    await assert.rejects(
      () => generateAndroidProject({ ...base, appId: '../../etc/passwd' }),
      /Invalid app ID/
    );
    await assert.rejects(
      () => generateAndroidProject({ ...base, siteUrl: 'javascript:alert(1)' }),
      /Invalid website URL/
    );
    await assert.rejects(
      () => generateAndroidProject({ ...base, siteUrl: 'https://example.com"; rm -rf /' }),
      /Invalid website URL/
    );
    await assert.rejects(
      () => generateAndroidProject({ ...base, appVersion: "1.0.0'; rm -rf /" }),
      /Invalid app version/
    );
    assert.ok(!fs.existsSync(path.join(buildsDir, 'bad-input')), 'nothing should be written');
  } finally {
    cleanup(buildsDir);
  }
});

test('the progress bar shows real determinate page progress', async () => {
  const { project, buildsDir } = await generate();
  try {
    const layout = readText(project, 'app/src/main/res/layout/activity_main.xml');
    assert.match(layout, /android:indeterminate="false"/);
    assert.match(layout, /android:max="100"/);
    assert.match(layout, /android:progressTint="#10b981"/);
    assert.ok(!layout.includes('indeterminateTint'), 'the indeterminate animation is gone');
  } finally {
    cleanup(buildsDir);
  }
});

test('release signing comes from secrets and never reuses the debug key', async () => {
  const { project, buildsDir } = await generate();
  try {
    const gradle = readText(project, 'app/build.gradle');
    assert.match(gradle, /def hasReleaseSigning = /);
    assert.match(gradle, /System\.getenv\('SITEAPP_KEYSTORE_PATH'\)/);
    assert.match(gradle, /if \(hasReleaseSigning\) \{[^}]*signingConfig signingConfigs\.release/);
    assert.match(gradle, /minifyEnabled enableShrinking/);
    assert.match(gradle, /enableShrinking = System\.getenv\('SITEAPP_MINIFY'\) == 'true'/);

    // The release variant only ever uses the release config; the debug key stays debug-only.
    const releaseBlock = gradle.slice(gradle.indexOf('// Shrinking stays off'), gradle.indexOf('debug {\n            debuggable'));
    assert.ok(releaseBlock.length > 0, 'release build type block not found');
    assert.ok(!releaseBlock.includes('signingConfigs.debug'), 'release must not use the debug signing config');

    const proguard = readText(project, 'app/proguard-rules.pro');
    assert.match(proguard, /@android\.webkit\.JavascriptInterface/);

    const gitignore = readText(project, '.gitignore');
    assert.match(gitignore, /\*\.jks/);
    assert.match(gitignore, /\*\.keystore/);
  } finally {
    cleanup(buildsDir);
  }
});

test('configuration changes do not recreate the activity or its WebView', async () => {
  const { project, buildsDir } = await generate();
  try {
    const manifest = readText(project, 'app/src/main/AndroidManifest.xml');
    assert.match(manifest, /android:configChanges="orientation\|screenSize\|keyboardHidden"/);
  } finally {
    cleanup(buildsDir);
  }
});

test('a leading resource reference character is escaped, not interpreted', async () => {
  const { project, buildsDir } = await generate({ appName: '@string/app_name' });
  try {
    const strings = readText(project, 'app/src/main/res/values/strings.xml');
    assert.ok(strings.includes(String.raw`<string name="app_name">\@string/app_name</string>`), strings);
  } finally {
    cleanup(buildsDir);
  }
});
