import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import sharp from 'sharp';
import { generatePngIcon, pngToIco } from './icon-generator.js';
import { tryBuildElectron } from './build-utils.js';

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
  installerType = 'nsis',
  windowWidth = 1200,
  windowHeight = 800,
  fullScreen = false,
  customUserAgent = null,
  buildId,
  buildsDir
}) {
  const target = installerType === 'portable' ? 'portable' : 'nsis';
  const width = clampNumber(windowWidth, 800, 3840, 1200);
  const height = clampNumber(windowHeight, 600, 2160, 800);
  const startFullScreen = fullScreen === true || fullScreen === 'true';
  const userAgent = typeof customUserAgent === 'string' && customUserAgent.trim() ? customUserAgent.trim() : null;

  const buildDir = path.join(buildsDir, buildId, 'windows');
  fs.mkdirSync(path.join(buildDir, 'src'), { recursive: true });

  // Create Electron main process
  const mainContent = `const { app, BrowserWindow, shell, session } = require('electron');
const path = require('path');

const APP_URL = '${siteUrl}';
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
  shell.openExternal(url).catch(function () {});
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
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
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
  version: '${appVersion}',
  appName: ${JSON.stringify(appName)}
});
`;

  fs.writeFileSync(path.join(buildDir, 'src', 'preload.js'), preloadContent);

  const safeName = `${appName}-${target === 'portable' ? 'Portable' : 'Setup'}-${appVersion}`
    .replace(/[\\/:*?"<>|]/g, '')
    .trim();

  const packageJson = {
    name: appId,
    version: appVersion,
    description: `${appName} - Web app`,
    main: 'src/main.js',
    homepage: siteUrl,
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
      productName: appName,
      artifactName: `${safeName}.exe`,
      files: ['src/**/*', 'package.json'],
      // Ship only the source and the Electron runtime: no dev deps, no native
      // rebuild, and maximum compression keep the installer as small as possible.
      compression: 'maximum',
      asar: true,
      npmRebuild: false,
      nodeGypRebuild: false,
      // Bundling every Chromium locale adds ~10-15 MB for a WebView wrapper that
      // never shows Chromium UI. English is enough.
      electronLanguages: ['en-US'],
      // Disable unused Electron capabilities; this removes a little size and
      // tightens security without affecting the wrapped website.
      electronFuses: {
        runAsNode: false,
        enableNodeOptionsEnvironmentVariable: false,
        enableNodeCliInspectArguments: false,
        onlyLoadAppFromAsar: true
      },
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
              shortcutName: appName
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

  fs.writeFileSync(
    path.join(buildDir, 'README.md'),
    `# ${appName}

Windows application wrapping ${siteUrl}

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

  // Icon: the uploaded image wins, otherwise initials on a gradient.
  let pngBuffer = null;
  if (icon) {
    try {
      const base64 = String(icon).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
      pngBuffer = await sharp(Buffer.from(base64, 'base64'))
        .resize(256, 256, { fit: 'cover' })
        .png()
        .toBuffer();
    } catch (e) {
      console.log(`[windows-builder] Uploaded icon could not be decoded: ${e.message}`);
    }
  }
  if (!pngBuffer) {
    pngBuffer = await generatePngIcon(appName, 256);
  }
  fs.writeFileSync(path.join(buildDir, 'assets', 'icon.ico'), pngToIco(pngBuffer));
  fs.writeFileSync(path.join(buildDir, 'assets', 'icon.png'), pngBuffer);

  // === Try to build the real installer ===
  try {
    const artifactPath = await tryBuildElectron(buildDir, target, '--win', '.exe');
    if (artifactPath) {
      const outputPath = path.join(buildsDir, buildId, `${safeName}.exe`);
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
  const zipPath = path.join(buildsDir, buildId, `${appName}-windows-${appVersion}.zip`);
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
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
      { prefix: `${appName.replace(/\s+/g, '')}-windows-source` }
    );

    archive.finalize();
  });
}

function clampNumber(value, min, max, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
