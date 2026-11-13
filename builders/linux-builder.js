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

export async function buildAppImage({ siteUrl, appName, appId, appVersion, icon = null, buildId, buildsDir, windowWidth = 1200, windowHeight = 800, fullScreen = false, customUserAgent = null }) {
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
  const buildDir = safeJoin(buildsDir, buildId, 'linux-appimage');
  fs.mkdirSync(buildDir, { recursive: true });

  // Create src directory
  fs.mkdirSync(path.join(buildDir, 'src'), { recursive: true });

  // Create Electron main process
  const mainContent = `const { app, BrowserWindow, shell, session } = require('electron');
const path = require('path');

let mainWindow = null;

function hostOf(value) {
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch (e) {
    return '';
  }
}

const APP_HOST = hostOf(${JSON.stringify(validSiteUrl)});

function isSameSite(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./i, '');
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

  ${userAgent ? `session.defaultSession.setUserAgent(${JSON.stringify(userAgent)});` : ''}

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

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
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
      linux: {
        target: ['AppImage'],
        category: 'Utility',
        icon: 'assets/icon.png'
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
.env
.env.local
`;

  fs.writeFileSync(path.join(buildDir, '.gitignore'), gitignoreContent);

  // Create GitHub Actions workflow
  const githubWorkflowsDir = path.join(buildDir, '.github', 'workflows');
  fs.mkdirSync(githubWorkflowsDir, { recursive: true });
  fs.writeFileSync(path.join(githubWorkflowsDir, 'build.yml'), `name: Build Linux Application
on: [push, pull_request]
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - name: Install dependencies
        run: npm ci --legacy-peer-deps || npm install --legacy-peer-deps
      - name: Build AppImage and DEB
        run: npm run build
      - name: Upload Artifacts
        uses: actions/upload-artifact@v4
        with:
          name: linux-dist
          path: dist/*
`);

  // Create README.md
  const readmeAppName = validName.replace(/[\r\n]+/g, ' ');
  const readmeSiteUrl = validSiteUrl.replace(/[\r\n]+/g, ' ');
  const readmeContent = `# ${readmeAppName}

Linux application wrapping ${readmeSiteUrl}

## Installation

\`\`\`bash
npm install
\`\`\`

## Development

\`\`\`bash
npm start
\`\`\`

## Build AppImage Locally

\`\`\`bash
npm run build
\`\`\`

The built AppImage will be in the \`dist/\` directory.

## Build via GitHub Actions (Zero Cost Setup)

This project has been pre-configured with a GitHub Actions workflow to build your AppImage and DEB for free:
1. Initialize a Git repository in this directory.
2. Push the files to a new GitHub repository.
3. The AppImage/DEB will be built automatically on every push. You can download it from the "Actions" tab of your GitHub repository under the latest run.
`;

  fs.writeFileSync(path.join(buildDir, 'README.md'), readmeContent);

  // Create assets directory structure
  fs.mkdirSync(path.join(buildDir, 'assets'), { recursive: true });

  // Generate real icon using sharp
  const iconBuffer = await resolveDesktopIcon({ icon, siteUrl: validSiteUrl, appName: validName, size: 512 });
  fs.writeFileSync(path.join(buildDir, 'assets', 'icon.png'), iconBuffer);

  // === Try to build actual AppImage ===
  try {
    const artifactPath = await tryBuildElectron(buildDir, 'AppImage', '--linux', '.AppImage');
    if (artifactPath) {
      const outputPath = safeJoin(buildsDir, buildId, `${safeFileName(validName)}-${validVersion}.AppImage`);
      fs.copyFileSync(artifactPath, outputPath);
      console.log(`[linux-builder] AppImage built: ${outputPath}`);
      return outputPath;
    }
  } catch (e) {
    console.log(`[linux-builder] AppImage compilation failed: ${e.message}`);
  }

  // === Fallback: package as ZIP ===
  console.log('[linux-builder] Falling back to source project ZIP');
  const zipPath = safeJoin(buildsDir, buildId, `${safeFileName(validName)}-linux-appimage-${validVersion}.zip`);
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
    }, { prefix: `${safeFileName(validName)}-linux-source` });

    archive.finalize().catch(reject);
  });
}

export async function buildDeb({ siteUrl, appName, appId, appVersion, icon = null, buildId, buildsDir, windowWidth = 1200, windowHeight = 800, fullScreen = false, customUserAgent = null }) {
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
  const buildDir = safeJoin(buildsDir, buildId, 'linux-deb');
  fs.mkdirSync(buildDir, { recursive: true });

  // Create src directory
  fs.mkdirSync(path.join(buildDir, 'src'), { recursive: true });

  // Create Electron main process
  const mainContent = `const { app, BrowserWindow, shell, session } = require('electron');
const path = require('path');

let mainWindow = null;

function hostOf(value) {
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch (e) {
    return '';
  }
}

const APP_HOST = hostOf(${JSON.stringify(validSiteUrl)});

function isSameSite(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./i, '');
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

  ${userAgent ? `session.defaultSession.setUserAgent(${JSON.stringify(userAgent)});` : ''}

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

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
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
      linux: {
        target: ['deb'],
        category: 'Utility',
        icon: 'assets/icon.png'
      },
      deb: {
        depends: ['libappindicator1', 'libnotify4'],
        category: 'Utility'
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
.env
.env.local
`;

  fs.writeFileSync(path.join(buildDir, '.gitignore'), gitignoreContent);

  // Create GitHub Actions workflow
  const githubWorkflowsDir = path.join(buildDir, '.github', 'workflows');
  fs.mkdirSync(githubWorkflowsDir, { recursive: true });
  fs.writeFileSync(path.join(githubWorkflowsDir, 'build.yml'), `name: Build Linux Application
on: [push, pull_request]
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - name: Install dependencies
        run: npm ci --legacy-peer-deps || npm install --legacy-peer-deps
      - name: Build AppImage and DEB
        run: npm run build
      - name: Upload Artifacts
        uses: actions/upload-artifact@v4
        with:
          name: linux-dist
          path: dist/*
`);

  // Create README.md
  const readmeAppName = validName.replace(/[\r\n]+/g, ' ');
  const readmeSiteUrl = validSiteUrl.replace(/[\r\n]+/g, ' ');
  const readmeContent = `# ${readmeAppName}

Debian Linux package wrapping ${readmeSiteUrl}

## Installation

\`\`\`bash
npm install
\`\`\`

## Development

\`\`\`bash
npm start
\`\`\`

## Build DEB Package Locally

\`\`\`bash
npm run build
\`\`\`

The built DEB package will be in the \`dist/\` directory.

## Install DEB

\`\`\`bash
sudo dpkg -i dist/*.deb
\`\`\`

## Build via GitHub Actions (Zero Cost Setup)

This project has been pre-configured with a GitHub Actions workflow to build your DEB and AppImage for free:
1. Initialize a Git repository in this directory.
2. Push the files to a new GitHub repository.
3. The DEB/AppImage will be built automatically on every push. You can download it from the "Actions" tab of your GitHub repository under the latest run.
`;

  fs.writeFileSync(path.join(buildDir, 'README.md'), readmeContent);

  // Create assets directory structure
  fs.mkdirSync(path.join(buildDir, 'assets'), { recursive: true });

  // Generate real icon using sharp
  const iconBuffer = await resolveDesktopIcon({ icon, siteUrl: validSiteUrl, appName: validName, size: 512 });
  fs.writeFileSync(path.join(buildDir, 'assets', 'icon.png'), iconBuffer);

  // === Try to build actual DEB ===
  try {
    const artifactPath = await tryBuildElectron(buildDir, 'deb', '--linux', '.deb');
    if (artifactPath) {
      const outputPath = safeJoin(buildsDir, buildId, `${safeFileName(validName)}-${validVersion}.deb`);
      fs.copyFileSync(artifactPath, outputPath);
      console.log(`[linux-builder] DEB built: ${outputPath}`);
      return outputPath;
    }
  } catch (e) {
    console.log(`[linux-builder] DEB compilation failed: ${e.message}`);
  }

  // === Fallback: package as ZIP ===
  console.log('[linux-builder] Falling back to source project ZIP');
  const zipPath = safeJoin(buildsDir, buildId, `${safeFileName(validName)}-linux-deb-${validVersion}.zip`);
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
    }, { prefix: `${safeFileName(validName)}-linux-source` });

    archive.finalize().catch(reject);
  });
}

function clampNumber(value, min, max, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
