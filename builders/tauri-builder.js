import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import sharp from 'sharp';
import { generatePngIcon, pngToIco } from './icon-generator.js';
import { tryExec } from './build-utils.js';

/**
 * Build a Windows app with Tauri instead of Electron.
 *
 * Tauri does not bundle a browser: it renders through the WebView2 runtime that
 * ships with Windows 10/11, so the resulting binary is ~4-10 MB instead of
 * ~70-90 MB. `installerType` maps to Tauri's bundler targets:
 *
 *   - 'nsis'     -> NSIS setup executable (installed app)
 *   - 'portable' -> the raw release .exe (no installer, needs WebView2)
 *
 * Tauri cannot cross-compile to Windows from Linux/macOS easily, so when the
 * host is not Windows the build falls back to a source ZIP that the user can
 * build on Windows (or through the bundled GitHub workflow).
 */
export async function buildTauri({
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

  const buildDir = path.join(buildsDir, buildId, 'windows-tauri');
  const srcTauriDir = path.join(buildDir, 'src-tauri');
  const srcDir = path.join(srcTauriDir, 'src');
  const iconsDir = path.join(srcTauriDir, 'icons');
  const frontendDir = path.join(buildDir, 'frontend');

  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(iconsDir, { recursive: true });
  fs.mkdirSync(frontendDir, { recursive: true });

  const crateName = toCrateName(appName);

  // === Rust sources ===
  const libContent = `const APP_URL: &str = ${JSON.stringify(siteUrl)};
const APP_TITLE: &str = ${JSON.stringify(appName)};
const WINDOW_WIDTH: f64 = ${width}.0;
const WINDOW_HEIGHT: f64 = ${height}.0;
const START_FULLSCREEN: bool = ${startFullScreen};
const USER_AGENT: Option<&str> = ${userAgent ? `Some(${JSON.stringify(userAgent)})` : 'None'};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let url = APP_URL.parse().expect("invalid APP_URL");
            let mut builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(url),
            )
            .title(APP_TITLE)
            .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
            .min_inner_size(800.0, 600.0)
            .fullscreen(START_FULLSCREEN);

            if let Some(ua) = USER_AGENT {
                builder = builder.user_agent(ua);
            }

            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
`;

  const mainContent = `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ${crateName}_lib::run();
}
`;

  fs.writeFileSync(path.join(srcDir, 'lib.rs'), libContent);
  fs.writeFileSync(path.join(srcDir, 'main.rs'), mainContent);

  const cargoToml = `[package]
name = "${crateName}"
version = "${appVersion}"
description = ${JSON.stringify(`${appName} - Web app`)}
authors = []
edition = "2021"

[lib]
name = "${crateName}_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
`;
  fs.writeFileSync(path.join(srcTauriDir, 'Cargo.toml'), cargoToml);

  fs.writeFileSync(
    path.join(srcTauriDir, 'build.rs'),
    `fn main() {\n    tauri_build::build()\n}\n`
  );

  const tauriConfig = {
    $schema: 'https://schema.tauri.app/config/2',
    productName: appName,
    version: appVersion,
    identifier: appId,
    build: {
      frontendDist: '../frontend'
    },
    app: {
      windows: [],
      security: {
        csp: null
      }
    },
    bundle: {
      active: target === 'nsis',
      targets: ['nsis'],
      icon: [
        'icons/32x32.png',
        'icons/128x128.png',
        'icons/128x128@2x.png',
        'icons/icon.ico',
        'icons/icon.png'
      ],
      windows: {
        nsis: {
          installMode: 'currentUser'
        }
      }
    }
  };
  fs.writeFileSync(
    path.join(srcTauriDir, 'tauri.conf.json'),
    JSON.stringify(tauriConfig, null, 2)
  );

  // Tauri requires a frontend directory even though the window points at a
  // remote URL. Keep it as a tiny placeholder so the bundler is satisfied.
  fs.writeFileSync(
    path.join(frontendDir, 'index.html'),
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(appName)}</title></head><body></body></html>`
  );

  // === Node project for the Tauri CLI ===
  const packageJson = {
    name: appId,
    version: appVersion,
    private: true,
    description: `${appName} - Web app`,
    scripts: {
      tauri: 'tauri'
    },
    devDependencies: {
      '@tauri-apps/cli': '^2.0.0'
    }
  };
  fs.writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify(packageJson, null, 2));
  fs.writeFileSync(path.join(buildDir, '.npmrc'), `legacy-peer-deps=true\n`);
  fs.writeFileSync(
    path.join(buildDir, '.gitignore'),
    `node_modules/\nsrc-tauri/target/\n*.log\n.env\n.env.local\n`
  );

  // === Icons ===
  let pngBuffer = null;
  if (icon) {
    try {
      const base64 = String(icon).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
      pngBuffer = await sharp(Buffer.from(base64, 'base64'))
        .resize(512, 512, { fit: 'cover' })
        .png()
        .toBuffer();
    } catch (e) {
      console.log(`[tauri-builder] Uploaded icon could not be decoded: ${e.message}`);
    }
  }
  if (!pngBuffer) {
    pngBuffer = await generatePngIcon(appName, 512);
  }

  await writePngSize(pngBuffer, path.join(iconsDir, '32x32.png'), 32);
  await writePngSize(pngBuffer, path.join(iconsDir, '128x128.png'), 128);
  await writePngSize(pngBuffer, path.join(iconsDir, '128x128@2x.png'), 256);
  fs.writeFileSync(path.join(iconsDir, 'icon.png'), await sharp(pngBuffer).resize(512, 512).png().toBuffer());
  fs.writeFileSync(path.join(iconsDir, 'icon.ico'), pngToIco(await sharp(pngBuffer).resize(256, 256).png().toBuffer()));

  // === Build ===
  const safeName = `${appName}-${target === 'portable' ? 'Portable' : 'Setup'}-${appVersion}`
    .replace(/[\\/:*?"<>|]/g, '')
    .trim();

  if (process.platform === 'win32') {
    try {
      console.log('[tauri-builder] Installing Tauri CLI...');
      if (!tryExec('npm install --no-audit --no-fund --prefer-offline', { cwd: buildDir, timeout: 300000 })) {
        throw new Error('npm install failed');
      }

      const localCli = path.join(buildDir, 'node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri');
      const cli = fs.existsSync(localCli) ? `"${localCli}"` : 'npx --no-install tauri';
      const bundleFlag = target === 'portable' ? '--no-bundle' : '--bundles nsis';

      console.log(`[tauri-builder] Running tauri build (${target})...`);
      if (!tryExec(`${cli} build ${bundleFlag}`, { cwd: buildDir, timeout: 1800000 })) {
        throw new Error('tauri build failed');
      }

      const artifact = target === 'portable'
        ? path.join(srcTauriDir, 'target', 'release', `${crateName}.exe`)
        : firstMatch(path.join(srcTauriDir, 'target', 'release', 'bundle', 'nsis'), '.exe');

      if (artifact && fs.existsSync(artifact)) {
        const outputPath = path.join(buildsDir, buildId, `${safeName}.exe`);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.copyFileSync(artifact, outputPath);
        console.log(`[tauri-builder] EXE built: ${outputPath}`);
        return outputPath;
      }

      console.log('[tauri-builder] Build finished but no .exe artifact was found');
    } catch (e) {
      console.log(`[tauri-builder] EXE compilation failed: ${e.message}`);
    }
  } else {
    console.log('[tauri-builder] Host is not Windows; Tauri cannot cross-compile here. Packaging source instead.');
  }

  return zipSourceProject(buildDir, buildsDir, buildId, appName, appVersion);
}

async function writePngSize(source, destination, size) {
  const buffer = await sharp(source).resize(size, size).png().toBuffer();
  fs.writeFileSync(destination, buffer);
}

function firstMatch(dir, extension) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = firstMatch(full, extension);
      if (nested) return nested;
    } else if (entry.name.toLowerCase().endsWith(extension)) {
      return full;
    }
  }
  return null;
}

function toCrateName(value) {
  let name = String(value || 'app')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!name) name = 'app';
  if (!/^[a-z_]/.test(name)) name = 'app_' + name;
  return name.slice(0, 50);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function zipSourceProject(buildDir, buildsDir, buildId, appName, appVersion) {
  const zipPath = path.join(buildsDir, buildId, `${appName}-tauri-windows-source-${appVersion}.zip`);
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
        ignore: ['node_modules/**', 'src-tauri/target/**', '.git/**']
      },
      { prefix: `${appName.replace(/\s+/g, '')}-tauri-windows-source` }
    );

    archive.finalize();
  });
}

function clampNumber(value, min, max, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
