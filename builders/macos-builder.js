import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import { resolveWindowsIcon as resolveDesktopIcon } from './windows-icon.js';
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

export async function buildDMG({ siteUrl, appName, appId, appVersion, icon = null, buildId, buildsDir, windowWidth = 1200, windowHeight = 800, fullScreen = false, customUserAgent = null }) {
  assertBuildId(buildId);
  const validSiteUrl = assertSiteUrl(siteUrl);
  const validName = assertAppName(appName);
  assertAppId(appId);
  const validVersion = appVersion ? assertAppVersion(String(appVersion)) : '1.0.0';
  const width = clampNumber(windowWidth, 400, 3840, 1200);
  const height = clampNumber(windowHeight, 300, 2160, 800);
  const startFullScreen = coerceBoolean(fullScreen, false);
  const userAgent = typeof customUserAgent === 'string' && customUserAgent.trim()
    ? customUserAgent.trim().slice(0, 512)
    : null;

  const buildDir = safeJoin(buildsDir, buildId, 'macos');
  fs.mkdirSync(buildDir, { recursive: true });

  // Create src directory
  fs.mkdirSync(path.join(buildDir, 'src'), { recursive: true });

  // Create Electron main process
  const mainContent = `const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow = null;

function hostOf(value) {
  try {
    return new URL(value).hostname.replace(/^www\\./i, '');
  } catch (e) {
    return '';
  }
}

const APP_HOST = hostOf(${JSON.stringify(validSiteUrl)});

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
      require('electron').shell.openExternal(url).catch(function () {});
    }
  } catch (e) {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: ${width},
    height: ${height},
    minWidth: 400,
    minHeight: 300,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    },
    icon: path.join(__dirname, '../assets/icon.png')
  });

  ${userAgent ? `require('electron').session.defaultSession.setUserAgent(${JSON.stringify(userAgent)});` : ''}

  if (${startFullScreen}) {
    mainWindow.setFullScreen(true);
  }

  mainWindow.loadURL(${JSON.stringify(validSiteUrl)});

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isSameSite(url)) {
      event.preventDefault();
      openExternally(url);
    }
  });

  require('electron').session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(['media', 'geolocation', 'notifications', 'clipboard-read'].indexOf(permission) !== -1);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
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

  // Create package.json for Electron
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
      files: ['src/**/*', 'package.json'],
      compression: 'maximum',
      asar: true,
      npmRebuild: false,
      nodeGypRebuild: false,
      electronLanguages: ['en-US'],
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
      mac: {
        target: ['dmg'],
        category: 'public.app-category.productivity',
        // Only force ad-hoc identity when no signing certificate is configured;
        // otherwise let electron-builder use the provided CSC_* credentials.
        ...((process.env.CSC_LINK || process.env.CSC_NAME || process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'true')
          ? {}
          : { identity: null })
      },
      dmg: {
        contents: [
          {
            x: 110,
            y: 150,
            type: 'file'
          },
          {
            x: 240,
            y: 150,
            type: 'link',
            path: '/Applications'
          }
        ]
      }
    }
  };

  fs.writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify(packageJson, null, 2));

  // Create .npmrc
  fs.writeFileSync(path.join(buildDir, '.npmrc'), `legacy-peer-deps=true
`);

  // Create .gitignore
  const gitignoreContent = `node_modules/
dist/
*.log
.DS_Store
.env
.env.local
`;

  fs.writeFileSync(path.join(buildDir, '.gitignore'), gitignoreContent);

  // Create GitHub Actions workflow
  const githubWorkflowsDir = path.join(buildDir, '.github', 'workflows');
  fs.mkdirSync(githubWorkflowsDir, { recursive: true });
  fs.writeFileSync(path.join(githubWorkflowsDir, 'build.yml'), `name: Build macOS Application
on: [push, pull_request]
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: false
jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - name: Install dependencies
        run: npm ci --legacy-peer-deps || npm install --legacy-peer-deps
      - name: Build DMG and ZIP
        run: npm run build
      - name: Upload Artifacts
        uses: actions/upload-artifact@v4
        with:
          name: macos-dist
          path: dist/*
`);

  // Create README.md
  const readmeAppName = validName.replace(/[\r\n]+/g, ' ');
  const readmeSiteUrl = validSiteUrl.replace(/[\r\n]+/g, ' ');
  const readmeContent = `# ${readmeAppName}

macOS application wrapping ${readmeSiteUrl}

## Installation

\`\`\`bash
npm install
\`\`\`

## Development

\`\`\`bash
npm start
\`\`\`

## Build DMG Locally

\`\`\`bash
npm run build
\`\`\`

The built DMG will be in the \`dist/\` directory.

## Build via GitHub Actions (Zero Cost Setup)

This project has been pre-configured with a GitHub Actions workflow to build your DMG and ZIP for free:
1. Initialize a Git repository in this directory.
2. Push the files to a new GitHub repository.
3. The DMG/ZIP will be built automatically on every push. You can download it from the "Actions" tab of your GitHub repository under the latest run.
`;

  fs.writeFileSync(path.join(buildDir, 'README.md'), readmeContent);

  // Create assets directory structure
  fs.mkdirSync(path.join(buildDir, 'assets'), { recursive: true });

  // Icons: user-supplied or site favicon if available, else generated initials.
  const icon512 = await resolveDesktopIcon({ icon, siteUrl: validSiteUrl, appName: validName, size: 512 });
  const icon1024 = await resolveDesktopIcon({ icon, siteUrl: validSiteUrl, appName: validName, size: 1024 });
  fs.writeFileSync(path.join(buildDir, 'assets', 'icon.png'), icon512);
  fs.writeFileSync(path.join(buildDir, 'assets', 'icon@2x.png'), icon1024);

  // === Try to build actual DMG ===
  try {
    const artifactPath = await tryBuildElectron(buildDir, 'dmg', '--mac', '.dmg');
    if (artifactPath) {
      const outputPath = safeJoin(buildsDir, buildId, `${safeFileName(validName)}-${validVersion}.dmg`);
      fs.copyFileSync(artifactPath, outputPath);
      console.log(`[macos-builder] DMG built: ${outputPath}`);
      return outputPath;
    }
  } catch (e) {
    console.log(`[macos-builder] DMG compilation failed: ${e.message}`);
  }

  // === Fallback: package as ZIP ===
  console.log('[macos-builder] Falling back to source project ZIP');
  const archiveName = safeFileName(validName);
  const zipPath = safeJoin(buildsDir, buildId, `${archiveName}-macos-${validVersion}.zip`);
  fs.mkdirSync(path.dirname(zipPath), { recursive: true }); // Ensure output folder exists

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    output.on('error', reject);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(zipPath));
    archive.on('error', reject);
    archive.pipe(output);

    // Archive only source files, excluding node_modules, dist, and git metadata
    archive.glob('**/*', {
      cwd: buildDir,
      ignore: ['node_modules/**', 'dist/**', '.git/**']
    }, { prefix: `${archiveName}-macos-source` });

    archive.finalize().catch(reject);
  });
}

function clampNumber(value, min, max, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
