import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import { generatePngIcon } from './icon-generator.js';
import { tryBuildElectron } from './build-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildAppImage({ siteUrl, appName, appId, appVersion, icon, buildId, buildsDir }) {
  const buildDir = path.join(buildsDir, buildId, 'linux-appimage');
  fs.mkdirSync(buildDir, { recursive: true });

  // Create src directory
  fs.mkdirSync(path.join(buildDir, 'src'), { recursive: true });

  // Create Electron main process
  const mainContent = `const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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

  mainWindow.loadURL('${siteUrl}');
  
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
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
  version: '${appVersion}',
  appName: '${appName}'
});
`;

  fs.writeFileSync(path.join(buildDir, 'src', 'preload.js'), preloadContent);

  // Create package.json for Electron
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
      files: ['src/**/*', 'package.json'],
      directories: {
        output: 'dist',
        buildResources: 'assets'
      },
      linux: {
        target: ['AppImage', 'deb'],
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
  const readmeContent = `# ${appName}

Linux application wrapping ${siteUrl}

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
  const iconBuffer = await generatePngIcon(appName, 256);
  fs.writeFileSync(path.join(buildDir, 'assets', 'icon.png'), iconBuffer);

  // Create .desktop file for AppImage
  fs.writeFileSync(path.join(buildDir, `${appId}.desktop`), `[Desktop Entry]
Name=${appName}
Exec=AppRun
Icon=icon
Type=Application
Categories=Utility;
`);

  // === Try to build actual AppImage ===
  try {
    const artifactPath = await tryBuildElectron(buildDir, 'AppImage', '--linux', '.AppImage');
    if (artifactPath) {
      const outputPath = path.join(buildsDir, buildId, `${appName}-${appVersion}.AppImage`);
      fs.copyFileSync(artifactPath, outputPath);
      console.log(`[linux-builder] AppImage built: ${outputPath}`);
      return outputPath;
    }
  } catch (e) {
    console.log(`[linux-builder] AppImage compilation failed: ${e.message}`);
  }

  // === Fallback: package as ZIP ===
  console.log('[linux-builder] Falling back to source project ZIP');
  const zipPath = path.join(buildsDir, buildId, `${appName}-linux-appimage-${appVersion}.zip`);
  fs.mkdirSync(path.dirname(zipPath), { recursive: true }); // Ensure output folder exists
  
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(zipPath));
    archive.on('error', reject);
    archive.pipe(output);
    
    // Archive only source files, excluding node_modules, dist, and git metadata
    archive.glob('**/*', {
      cwd: buildDir,
      ignore: ['node_modules/**', 'dist/**', '.git/**']
    }, { prefix: `${appName.replace(/\s+/g, '')}-linux-source` });

    archive.finalize();
  });
}

export async function buildDeb({ siteUrl, appName, appId, appVersion, icon, buildId, buildsDir }) {
  const buildDir = path.join(buildsDir, buildId, 'linux-deb');
  fs.mkdirSync(buildDir, { recursive: true });

  // Create src directory
  fs.mkdirSync(path.join(buildDir, 'src'), { recursive: true });

  // Create Electron main process
  const mainContent = `const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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

  mainWindow.loadURL('${siteUrl}');
  
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
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
  version: '${appVersion}',
  appName: '${appName}'
});
`;

  fs.writeFileSync(path.join(buildDir, 'src', 'preload.js'), preloadContent);

  // Create package.json for Electron
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
      electron: '^latest',
      'electron-builder': '^latest'
    },
    build: {
      appId: appId,
      productName: appName,
      files: ['src/**/*', 'package.json'],
      directories: {
        output: 'dist',
        buildResources: 'assets'
      },
      linux: {
        target: ['deb', 'AppImage'],
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
  const readmeContent = `# ${appName}

Debian Linux package wrapping ${siteUrl}

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
  const iconBuffer = await generatePngIcon(appName, 256);
  fs.writeFileSync(path.join(buildDir, 'assets', 'icon.png'), iconBuffer);

  // === Try to build actual DEB ===
  try {
    const artifactPath = await tryBuildElectron(buildDir, 'deb', '--linux', '.deb');
    if (artifactPath) {
      const outputPath = path.join(buildsDir, buildId, `${appId}-${appVersion}.deb`);
      fs.copyFileSync(artifactPath, outputPath);
      console.log(`[linux-builder] DEB built: ${outputPath}`);
      return outputPath;
    }
  } catch (e) {
    console.log(`[linux-builder] DEB compilation failed: ${e.message}`);
  }

  // === Fallback: package as ZIP ===
  console.log('[linux-builder] Falling back to source project ZIP');
  const zipPath = path.join(buildsDir, buildId, `${appName}-linux-deb-${appVersion}.zip`);
  fs.mkdirSync(path.dirname(zipPath), { recursive: true }); // Ensure output folder exists
  
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(zipPath));
    archive.on('error', reject);
    archive.pipe(output);
    
    // Archive only source files, excluding node_modules, dist, and git metadata
    archive.glob('**/*', {
      cwd: buildDir,
      ignore: ['node_modules/**', 'dist/**', '.git/**']
    }, { prefix: `${appName.replace(/\s+/g, '')}-linux-source` });

    archive.finalize();
  });
}
