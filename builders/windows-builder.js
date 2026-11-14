import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import { pngToIco } from './icon-generator.js';
import { resolveWindowsIcon } from './windows-icon.js';
import { tryBuildElectron } from './build-utils.js';
import {
  assertBuildId,
  assertSiteUrl,
  assertAppName,
  assertAppId,
  assertAppVersion,
  coerceBoolean,
  safeFileName,
  safeJoin
} from './input-validation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Build a Windows Electron wrapper.
 *
 * `installerType` selects the electron-builder target: 'nsis' (installer) or
 * 'portable' (single runnable .exe). Everything else defaults to the values the
 * builder shipped with, so existing callers keep their behaviour.
 */
export async function buildEXE({
  siteUrl,
  appName,
  appId,
  appVersion,
  icon = null,
  autoFetchIcon = true,
  installerType = 'nsis',
  windowWidth = 1200,
  windowHeight = 800,
  fullScreen = false,
  customUserAgent = null,
  buildId,
  buildsDir
}) {
  assertBuildId(buildId);
  const validSiteUrl = assertSiteUrl(siteUrl);
  const validName = assertAppName(appName);
  assertAppId(appId);
  const validVersion = appVersion ? assertAppVersion(String(appVersion)) : '1.0.0';

  if (installerType !== 'nsis' && installerType !== 'portable') {
    throw new Error("Invalid installerType: must be 'nsis' or 'portable'");
  }
  const target = installerType;
  const width = clampNumber(windowWidth, 800, 3840, 1200);
  const height = clampNumber(windowHeight, 600, 2160, 800);
  const startFullScreen = coerceBoolean(fullScreen, false);
  const userAgent = typeof customUserAgent === 'string' && customUserAgent.trim()
    ? customUserAgent.trim().slice(0, 512)
    : null;

  const buildDir = safeJoin(buildsDir, buildId, 'windows');
  fs.mkdirSync(path.join(buildDir, 'src'), { recursive: true });

  // Create Electron main process
  const mainContent = `const { app, BrowserWindow, shell, session } = require('electron');
const path = require('path');

const APP_URL = ${JSON.stringify(validSiteUrl)};
const START_FULLSCREEN = ${startFullScreen};
let mainWindow = null;

function hostOf(value) {
  try {
    return new URL(value).hostname.replace(/^www\\./i, '');
  } catch (e) {
    return '';
  }
}

const APP_HOST = hostOf(APP_URL);

function isSameSite(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\\./i, '');
    return host === APP_HOST || host.endsWith('.' + APP_HOST);
  } catch (e) {
    return false;
  }
}

function openExternally(url) {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
      shell.openExternal(url).catch(function () {});
    }
  } catch (e) {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: ${width},
    height: ${height},
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0f16',
    icon: path.join(process.resourcesPath, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true
    }
  });

  ${userAgent ? `session.defaultSession.setUserAgent(${JSON.stringify(userAgent)});` : ''}

  if (START_FULLSCREEN) {
    mainWindow.setFullScreen(true);
  }

  mainWindow.loadURL(APP_URL);

  mainWindow.once('ready-to-show', function () {
    mainWindow.show();
  });

  // New windows and off-site navigation go to the user's default browser,
  // mirroring the APK WebView's external-link handling.
  mainWindow.webContents.setWindowOpenHandler(function (details) {
    openExternally(details.url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', function (event, url) {
    if (!isSameSite(url)) {
      event.preventDefault();
      openExternally(url);
    }
  });

  session.defaultSession.setPermissionRequestHandler(function (contents, permission, callback) {
    callback(['media', 'geolocation', 'notifications', 'clipboard-read'].indexOf(permission) !== -1);
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', function () {
  app.quit();
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});
`;

  fs.writeFileSync(path.join(buildDir, 'src', 'main.js'), mainContent);

  // Create preload script
  const preloadContent = `const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('api', {
  version: ${JSON.stringify(validVersion)},
  appName: ${JSON.stringify(validName)}
});
`;

  fs.writeFileSync(path.join(buildDir, 'src', 'preload.js'), preloadContent);

  const safeName = `${safeFileName(validName)}-${target === 'portable' ? 'Portable' : 'Setup'}-${validVersion}`
    .replace(/[\\/:*?"<>|$`{}]/g, '')
    .trim() || 'App';

  const packageJson = {
    name: appId.toLowerCase(),
    version: validVersion,
    description: `${validName} - Web app`,
    main: 'src/main.js',
    homepage: validSiteUrl,
    author: '',
    license: 'MIT',
    scripts: {
      start: 'electron .',
      build: 'electron-builder'
    },
    devDependencies: {
      electron: '^31.0.0',
      'electron-builder': '^25.1.8'
    },
    build: {
      appId: appId,
      productName: validName,
      artifactName: `${safeName}.exe`,
      files: ['src/**/*', 'package.json'],
      extraResources: [{ from: 'assets/icon.ico', to: 'icon.ico' }],
      // Ship only the source and the Electron runtime: no dev deps, no native
      // rebuild, and maximum compression keep the installer as small as possible.
      compression: 'maximum',
      asar: true,
      npmRebuild: false,
      nodeGypRebuild: false,
      // Bundling every Chromium locale adds ~10-15 MB for a WebView wrapper that
      // never shows Chromium UI. English is enough.
      electronLanguages: ['en-US'],
      directories: {
        output: 'dist',
        buildResources: 'assets'
      },
      win: {
        target: [target],
        icon: 'assets/icon.ico'
      },
      ...(target === 'nsis'
        ? {
            nsis: {
              oneClick: false,
              perMachine: false,
              allowElevation: true,
              allowToChangeInstallationDirectory: true,
              createDesktopShortcut: true,
              createStartMenuShortcut: true,
              shortcutName: validName
            }
          }
        : {})
    }
  };

  fs.writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify(packageJson, null, 2));

  fs.writeFileSync(path.join(buildDir, '.npmrc'), `legacy-peer-deps=true\n`);

  fs.writeFileSync(
    path.join(buildDir, '.gitignore'),
    `node_modules/\ndist/\n*.log\n.env\n.env.local\n`
  );

  // The generated project still ships with a workflow so a user who downloads
  // the source can rebuild it themselves.
  const githubWorkflowsDir = path.join(buildDir, '.github', 'workflows');
  fs.mkdirSync(githubWorkflowsDir, { recursive: true });
  fs.writeFileSync(
    path.join(githubWorkflowsDir, 'build.yml'),
    `name: Build Windows Application
on: [push, pull_request]
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci --legacy-peer-deps || npm install --legacy-peer-deps
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: windows-dist
          path: dist/*
`
  );

  const readmeAppName = validName.replace(/[\r\n]+/g, ' ');
  const readmeSiteUrl = validSiteUrl.replace(/[\r\n]+/g, ' ');
  fs.writeFileSync(
    path.join(buildDir, 'README.md'),
    `# ${readmeAppName}

Windows application wrapping ${readmeSiteUrl}

## Development

\`\`\`bash
npm install
npm start
\`\`\`

## Build locally

\`\`\`bash
npm run build
\`\`\`

Artifacts land in \`dist/\`.
`
  );

  fs.mkdirSync(path.join(buildDir, 'assets'), { recursive: true });

  const pngBuffer = await resolveWindowsIcon({ icon, siteUrl: validSiteUrl, appName: validName, size: 256, autoFetchIcon });
  fs.writeFileSync(path.join(buildDir, 'assets', 'icon.ico'), pngToIco(pngBuffer));
  fs.writeFileSync(path.join(buildDir, 'assets', 'icon.png'), pngBuffer);

  // === Try to build the real installer ===
  try {
    const artifactPath = await tryBuildElectron(buildDir, target, '--win', '.exe');
    if (artifactPath) {
      const outputPath = safeJoin(buildsDir, buildId, `${safeName}.exe`);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.copyFileSync(artifactPath, outputPath);
      console.log(`[windows-builder] EXE built: ${outputPath}`);
      return outputPath;
    }
  } catch (e) {
    console.log(`[windows-builder] EXE compilation failed: ${e.message}`);
  }

  // === Fallback: source project ZIP ===
  console.log('[windows-builder] Falling back to source project ZIP');
  const archiveName = safeFileName(validName);
  const zipPath = safeJoin(buildsDir, buildId, `${archiveName}-windows-${validVersion}.zip`);
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    output.on('error', reject);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(zipPath));
    archive.on('error', reject);
    archive.pipe(output);

    archive.glob(
      '**/*',
      {
        cwd: buildDir,
        ignore: ['node_modules/**', 'dist/**', '.git/**']
      },
      { prefix: `${archiveName}-windows-source` }
    );

    archive.finalize().catch(reject);
  });
}

function clampNumber(value, min, max, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
