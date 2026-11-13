import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import archiver from 'archiver';
import { fetchFaviconBuffer, extractPngOrBmpFromIco } from './builders/android-builder.js';
import sharp from 'sharp';
import { buildDMG } from './builders/macos-builder.js';
import { buildEXE } from './builders/windows-builder.js';
import { buildTauri } from './builders/tauri-builder.js';
import { buildAppImage, buildDeb } from './builders/linux-builder.js';
import { queueGradleBuild } from './queue-manager.js';
import { assertSiteUrl, assertAppName, assertAppId, assertAppVersion, assertSplashDuration, coerceBoolean, isBuildId, safeFileName, safeJoin } from './builders/input-validation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}
const PORT = process.env.PORT || 3000;
const BUILDS_DIR = path.join(__dirname, 'builds');

// Ensure builds directory exists
if (!fs.existsSync(BUILDS_DIR)) {
  fs.mkdirSync(BUILDS_DIR, { recursive: true });
}

// Middleware
const corsOptions = process.env.CORS_ORIGIN
  ? { origin: process.env.CORS_ORIGIN.split(',').map(s => s.trim()) }
  : {};
app.use(cors(corsOptions));
app.use(bodyParser.json({ limit: '15mb' }));
app.use(bodyParser.urlencoded({ limit: '15mb', extended: true }));

// Global siteUrl normalization middleware to ensure URLs have a scheme
app.use((req, res, next) => {
  if (req.body && req.body.siteUrl) {
    let raw = String(req.body.siteUrl).trim();
    if (raw && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      req.body.siteUrl = 'https://' + raw;
    }
  }
  next();
});

// Rate limiting middleware to prevent abuse and API exhaustion
const rateLimits = new Map();
const MAX_RATE_LIMIT_ENTRIES = 10000;

const rateLimiter = (options = { windowMs: 15 * 60 * 1000, max: 10 }) => {
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    if (rateLimits.size > MAX_RATE_LIMIT_ENTRIES) {
      for (const [key, stamps] of rateLimits) {
        const active = stamps.filter(t => now - t < options.windowMs);
        if (active.length === 0) rateLimits.delete(key);
      }
      while (rateLimits.size > MAX_RATE_LIMIT_ENTRIES) {
        const firstKey = rateLimits.keys().next().value;
        rateLimits.delete(firstKey);
      }
    }
    
    if (!rateLimits.has(ip)) {
      rateLimits.set(ip, []);
    }
    
    const timestamps = rateLimits.get(ip);
    const activeTimestamps = timestamps.filter(time => now - time < options.windowMs);
    
    if (activeTimestamps.length >= options.max) {
      const remainingTime = Math.ceil((options.windowMs - (now - activeTimestamps[0])) / 1000);
      return res.status(429).json({
        error: `Too many requests. Please try again in ${remainingTime} seconds.`
      });
    }
    
    activeTimestamps.push(now);
    rateLimits.set(ip, activeTimestamps);
    
    res.setHeader('X-RateLimit-Limit', options.max);
    res.setHeader('X-RateLimit-Remaining', options.max - activeTimestamps.length);
    
    next();
  };
};

const compilerLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10 // Limit each IP to 10 builds per 15 minutes
});

// Clean URLs redirect middleware
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    const newPath = req.path.slice(0, -5);
    if (newPath === '/index') {
      return res.redirect(301, '/');
    }
    return res.redirect(301, newPath);
  }
  next();
});

// Explicit routes for clean URL pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.get('/android', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'android', 'index.html'));
});

app.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'about', 'index.html'));
});

app.get('/faq', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'faq', 'index.html'));
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'privacy', 'index.html'));
});

// Explicit routes for SEO crawlers
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'dist', 'robots.txt'));
});

app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.sendFile(path.join(__dirname, 'dist', 'sitemap.xml'));
});

// Fallback middleware to serve styles, scripts and other static files
app.use(express.static('dist'));

// Build request queue
const buildQueue = new Map();
const BUILD_QUEUE_TTL_MS = 60 * 60 * 1000; // prune non-pending entries older than 1h
const MAX_BUILD_QUEUE_ENTRIES = 5000;
function queueSet(id, entry) {
  if (!entry.createdAt) entry.createdAt = Date.now();
  queueSet(id, entry);
}
const buildQueuePrune = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of buildQueue) {
    if (entry.status !== 'pending' && entry.createdAt && now - entry.createdAt > BUILD_QUEUE_TTL_MS) {
      buildQueue.delete(id);
    }
  }
  while (buildQueue.size > MAX_BUILD_QUEUE_ENTRIES) {
    let oldestId = null;
    let oldest = Infinity;
    for (const [id, entry] of buildQueue) {
      if (entry.status === 'pending') continue;
      if ((entry.createdAt || 0) < oldest) { oldest = entry.createdAt || 0; oldestId = id; }
    }
    if (!oldestId) break;
    buildQueue.delete(oldestId);
  }
}, 10 * 60 * 1000);
buildQueuePrune.unref();


// Shared request validation for all build endpoints
const ALLOWED_PLATFORMS = ['android', 'macos', 'windows', 'linux-appimage', 'linux-deb'];

function validateBuildRequest(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid request body');
  }
  const siteUrl = assertSiteUrl(body.siteUrl);
  const appName = assertAppName(body.appName);
  const appId = assertAppId(body.appId);
  const appVersion = (body.appVersion == null || body.appVersion === '')
    ? '1.0.0'
    : assertAppVersion(String(body.appVersion));

  let icon = null;
  if (body.icon != null) {
    if (typeof body.icon !== 'string' || body.icon.length > 14_000_000) {
      throw new Error('Invalid icon: expected a data URL under ~10 MB');
    }
    if (!/^data:image\//i.test(body.icon)) {
      throw new Error('Invalid icon: expected a data:image/ URL');
    }
    icon = body.icon;
  }

  const splashDuration = body.splashDuration == null ? 2000 : assertSplashDuration(body.splashDuration);

  let customUserAgent = null;
  if (typeof body.customUserAgent === 'string' && body.customUserAgent.trim()) {
    customUserAgent = body.customUserAgent.trim().slice(0, 512);
  }

  let windowWidth;
  let windowHeight;
  const w = Number(body.windowWidth);
  if (Number.isFinite(w)) windowWidth = Math.min(3840, Math.max(800, Math.floor(w)));
  const h = Number(body.windowHeight);
  if (Number.isFinite(h)) windowHeight = Math.min(2160, Math.max(600, Math.floor(h)));

  let installerType;
  if (body.installerType !== undefined) {
    installerType = String(body.installerType).toLowerCase();
    if (!['nsis', 'portable'].includes(installerType)) {
      throw new Error('installerType must be nsis or portable');
    }
  }

  let engine;
  if (body.engine !== undefined) {
    engine = String(body.engine).toLowerCase();
    if (!['electron', 'tauri'].includes(engine)) {
      throw new Error('engine must be electron or tauri');
    }
  }

  return {
    siteUrl,
    appName,
    appId,
    appVersion,
    icon,
    splashDuration,
    customUserAgent,
    windowWidth,
    windowHeight,
    installerType,
    engine,
    showSpinner: coerceBoolean(body.showSpinner, true),
    pullToRefresh: coerceBoolean(body.pullToRefresh, true),
    allowZoom: coerceBoolean(body.allowZoom, false),
    showSplash: coerceBoolean(body.showSplash, true),
    fullScreen: coerceBoolean(body.fullScreen, false),
    autoFetchIcon: coerceBoolean(body.autoFetchIcon, true)
  };
}

function validatePlatforms(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(p => typeof p === 'string' && ALLOWED_PLATFORMS.includes(p)))];
}

// Proxy endpoint to scrape the favicon the same way a browser fetches it (bypassing CORS)
app.get('/api/favicon', async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).send('Missing url parameter');
  }
  let safeUrl;
  try {
    safeUrl = assertSiteUrl(url);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    let buffer = await fetchFaviconBuffer(safeUrl);
    if (buffer) {
      try {
        buffer = extractPngOrBmpFromIco(buffer);
        const pngBuffer = await sharp(buffer).png().toBuffer();
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(pngBuffer);
      } catch (sharpError) {
        console.error(`Sharp conversion failed in favicon proxy: ${sharpError.message}`);
        res.setHeader('Content-Type', 'image/x-icon');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(buffer); // Fallback to raw buffer
      }
    }
  } catch (err) {
    console.error(`Error in /api/favicon proxy: ${err.message}`);
  }

  // No usable icon: answer 404 so the client can show its own placeholder
  return res.status(404).send('Favicon not found');
});

// Generate APK
app.post('/api/build/apk', compilerLimiter, async (req, res) => {
  try {
    let valid;
    try {
      valid = validateBuildRequest(req.body);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const buildId = uuidv4();

    queueSet(buildId, { status: 'pending', platform: 'android' });

    res.json({ buildId, status: 'queued' });

    // Build asynchronously
    try {
      const resultPath = await queueGradleBuild({
        siteUrl: valid.siteUrl,
        appName: valid.appName,
        appId: valid.appId,
        appVersion: valid.appVersion,
        icon: valid.icon,
        autoFetchIcon: valid.autoFetchIcon,
        showSpinner: valid.showSpinner,
        pullToRefresh: valid.pullToRefresh,
        allowZoom: valid.allowZoom,
        showSplash: valid.showSplash,
        splashDuration: valid.splashDuration,
        fullScreen: valid.fullScreen,
        customUserAgent: valid.customUserAgent,
        buildId,
        buildsDir: BUILDS_DIR
      });

      queueSet(buildId, {
        status: 'completed',
        platform: 'android',
        file: resultPath,
        filename: path.basename(resultPath)
      });
    } catch (error) {
      queueSet(buildId, {
        status: 'error',
        platform: 'android',
        error: error.message
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate DMG (macOS)
app.post('/api/build/dmg', compilerLimiter, async (req, res) => {
  try {
    let valid;
    try {
      valid = validateBuildRequest(req.body);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const buildId = uuidv4();

    queueSet(buildId, { status: 'pending', platform: 'macos' });

    res.json({ buildId, status: 'queued' });

    try {
      const resultPath = await buildDMG({
        siteUrl: valid.siteUrl,
        appName: valid.appName,
        appId: valid.appId,
        appVersion: valid.appVersion,
        icon: valid.icon,
        windowWidth: valid.windowWidth,
        windowHeight: valid.windowHeight,
        fullScreen: valid.fullScreen,
        customUserAgent: valid.customUserAgent,
        buildId,
        buildsDir: BUILDS_DIR
      });

      queueSet(buildId, {
        status: 'completed',
        platform: 'macos',
        file: resultPath,
        filename: path.basename(resultPath)
      });
    } catch (error) {
      queueSet(buildId, {
        status: 'error',
        platform: 'macos',
        error: error.message
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate EXE (Windows)
app.post('/api/build/exe', compilerLimiter, async (req, res) => {
  try {
    let valid;
    try {
      valid = validateBuildRequest(req.body);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const buildId = uuidv4();

    queueSet(buildId, { status: 'pending', platform: 'windows' });

    res.json({ buildId, status: 'queued' });

    try {
      const builder = valid.engine === 'tauri' ? buildTauri : buildEXE;
      const resultPath = await builder({
        siteUrl: valid.siteUrl,
        appName: valid.appName,
        appId: valid.appId,
        appVersion: valid.appVersion,
        icon: valid.icon,
        installerType: valid.installerType,
        windowWidth: valid.windowWidth,
        windowHeight: valid.windowHeight,
        fullScreen: valid.fullScreen,
        customUserAgent: valid.customUserAgent,
        buildId,
        buildsDir: BUILDS_DIR
      });

      queueSet(buildId, {
        status: 'completed',
        platform: 'windows',
        file: resultPath,
        filename: path.basename(resultPath)
      });
    } catch (error) {
      queueSet(buildId, {
        status: 'error',
        platform: 'windows',
        error: error.message
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate AppImage (Linux)
app.post('/api/build/appimage', compilerLimiter, async (req, res) => {
  try {
    let valid;
    try {
      valid = validateBuildRequest(req.body);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const buildId = uuidv4();

    queueSet(buildId, { status: 'pending', platform: 'linux' });

    res.json({ buildId, status: 'queued' });

    try {
      const resultPath = await buildAppImage({
        siteUrl: valid.siteUrl,
        appName: valid.appName,
        appId: valid.appId,
        appVersion: valid.appVersion,
        icon: valid.icon,
        windowWidth: valid.windowWidth,
        windowHeight: valid.windowHeight,
        fullScreen: valid.fullScreen,
        customUserAgent: valid.customUserAgent,
        buildId,
        buildsDir: BUILDS_DIR
      });

      queueSet(buildId, {
        status: 'completed',
        platform: 'linux',
        file: resultPath,
        filename: path.basename(resultPath)
      });
    } catch (error) {
      queueSet(buildId, {
        status: 'error',
        platform: 'linux',
        error: error.message
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate DEB (Linux Debian)
app.post('/api/build/deb', compilerLimiter, async (req, res) => {
  try {
    let valid;
    try {
      valid = validateBuildRequest(req.body);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const buildId = uuidv4();

    queueSet(buildId, { status: 'pending', platform: 'linux' });

    res.json({ buildId, status: 'queued' });

    try {
      const resultPath = await buildDeb({
        siteUrl: valid.siteUrl,
        appName: valid.appName,
        appId: valid.appId,
        appVersion: valid.appVersion,
        icon: valid.icon,
        windowWidth: valid.windowWidth,
        windowHeight: valid.windowHeight,
        fullScreen: valid.fullScreen,
        customUserAgent: valid.customUserAgent,
        buildId,
        buildsDir: BUILDS_DIR
      });

      queueSet(buildId, {
        status: 'completed',
        platform: 'linux',
        file: resultPath,
        filename: path.basename(resultPath)
      });
    } catch (error) {
      queueSet(buildId, {
        status: 'error',
        platform: 'linux',
        error: error.message
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check build status
app.get('/api/build/:buildId', getBuildStatus);
app.get('/api/exe/:buildId', getBuildStatus);

function getBuildStatus(req, res) {
  const { buildId } = req.params;
  if (!isBuildId(buildId)) {
    return res.status(400).json({ error: 'Invalid build id' });
  }
  const buildStatus = buildQueue.get(buildId);

  if (!buildStatus) {
    return res.status(404).json({ error: 'Build not found' });
  }

  res.json(buildStatus);
}

// Download built file
app.get('/api/download/:buildId', downloadBuild);
app.get('/api/exe/download/:buildId', downloadBuild);

function downloadBuild(req, res) {
  const { buildId } = req.params;
  if (!isBuildId(buildId)) {
    return res.status(400).json({ error: 'Invalid build id' });
  }
  const buildStatus = buildQueue.get(buildId);

  if (!buildStatus || buildStatus.status !== 'completed') {
    return res.status(404).json({ error: 'Build not ready or not found' });
  }

  const filePath = buildStatus.file;
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.download(filePath, buildStatus.filename, (err) => {
    if (err) console.error('Download error:', err);
  });
}

// Batch build endpoint (individual polling per platform)
app.post('/api/build/batch', compilerLimiter, async (req, res) => {
  try {
    let valid;
    try {
      valid = validateBuildRequest(req.body);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const platforms = validatePlatforms(req.body.platforms);
    if (platforms.length === 0) {
      return res.status(400).json({ error: 'platforms must be a non-empty array of supported platforms' });
    }

    const batchId = uuidv4();
    const builds = {};
    const base = {
      siteUrl: valid.siteUrl,
      appName: valid.appName,
      appId: valid.appId,
      appVersion: valid.appVersion,
      icon: valid.icon,
      windowWidth: valid.windowWidth,
      windowHeight: valid.windowHeight,
      fullScreen: valid.fullScreen,
      customUserAgent: valid.customUserAgent
    };

    // Start all builds
    if (platforms.includes('android')) {
      const buildId = uuidv4();
      builds['android'] = buildId;
      queueSet(buildId, { status: 'pending', platform: 'android' });
      queueGradleBuild({
        ...base,
        showSpinner: valid.showSpinner,
        pullToRefresh: valid.pullToRefresh,
        allowZoom: valid.allowZoom,
        showSplash: valid.showSplash,
        splashDuration: valid.splashDuration,
        buildId,
        buildsDir: BUILDS_DIR
      })
        .then((apkPath) => {
          queueSet(buildId, {
            status: 'completed',
            platform: 'android',
            file: apkPath,
            filename: path.basename(apkPath)
          });
        })
        .catch((error) => {
          queueSet(buildId, { status: 'error', platform: 'android', error: error.message });
        });
    }

    if (platforms.includes('macos')) {
      const buildId = uuidv4();
      builds['macos'] = buildId;
      queueSet(buildId, { status: 'pending', platform: 'macos' });
      buildDMG({ ...base, buildId, buildsDir: BUILDS_DIR })
        .then((dmgPath) => {
          queueSet(buildId, {
            status: 'completed',
            platform: 'macos',
            file: dmgPath,
            filename: path.basename(dmgPath)
          });
        })
        .catch((error) => {
          queueSet(buildId, { status: 'error', platform: 'macos', error: error.message });
        });
    }

    if (platforms.includes('windows')) {
      const buildId = uuidv4();
      builds['windows'] = buildId;
      queueSet(buildId, { status: 'pending', platform: 'windows' });
      buildEXE({ ...base, buildId, buildsDir: BUILDS_DIR })
        .then((exePath) => {
          queueSet(buildId, {
            status: 'completed',
            platform: 'windows',
            file: exePath,
            filename: path.basename(exePath)
          });
        })
        .catch((error) => {
          queueSet(buildId, { status: 'error', platform: 'windows', error: error.message });
        });
    }

    if (platforms.includes('linux-appimage')) {
      const buildId = uuidv4();
      builds['linux-appimage'] = buildId;
      queueSet(buildId, { status: 'pending', platform: 'linux' });
      buildAppImage({ ...base, buildId, buildsDir: BUILDS_DIR })
        .then((appImagePath) => {
          queueSet(buildId, {
            status: 'completed',
            platform: 'linux',
            file: appImagePath,
            filename: path.basename(appImagePath)
          });
        })
        .catch((error) => {
          queueSet(buildId, { status: 'error', platform: 'linux', error: error.message });
        });
    }

    if (platforms.includes('linux-deb')) {
      const buildId = uuidv4();
      builds['linux-deb'] = buildId;
      queueSet(buildId, { status: 'pending', platform: 'linux' });
      buildDeb({ ...base, buildId, buildsDir: BUILDS_DIR })
        .then((debPath) => {
          queueSet(buildId, {
            status: 'completed',
            platform: 'linux',
            file: debPath,
            filename: path.basename(debPath)
          });
        })
        .catch((error) => {
          queueSet(buildId, { status: 'error', platform: 'linux', error: error.message });
        });
    }

    res.json({ batchId, builds });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Combined build endpoint — builds all selected platforms into one ZIP
app.post('/api/build/combined', compilerLimiter, async (req, res) => {
  try {
    let valid;
    try {
      valid = validateBuildRequest(req.body);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const platforms = validatePlatforms(req.body.platforms);
    if (platforms.length === 0) {
      return res.status(400).json({ error: 'platforms must be a non-empty array of supported platforms' });
    }

    const buildId = uuidv4();
    queueSet(buildId, { status: 'pending', platform: 'combined' });

    res.json({ buildId, status: 'queued' });

    // Build all platforms and combine
    (async () => {
      try {
        const subBuilds = [];
        const baseConfig = {
          siteUrl: valid.siteUrl, appName: valid.appName, appId: valid.appId,
          appVersion: valid.appVersion,
          icon: valid.icon, buildsDir: BUILDS_DIR
        };

        if (platforms.includes('android')) {
          const subId = uuidv4();
          subBuilds.push({
            label: 'android',
            promise: queueGradleBuild({ 
              ...baseConfig, 
              showSpinner: valid.showSpinner,
              pullToRefresh: valid.pullToRefresh,
              allowZoom: valid.allowZoom,
              showSplash: valid.showSplash,
              splashDuration: valid.splashDuration,
              fullScreen: valid.fullScreen,
              customUserAgent: valid.customUserAgent,
              buildId: subId 
            }),
            subId
          });
        }
        if (platforms.includes('macos')) {
          const subId = uuidv4();
          subBuilds.push({
            label: 'macos',
            promise: buildDMG({ ...baseConfig, windowWidth: valid.windowWidth, windowHeight: valid.windowHeight, fullScreen: valid.fullScreen, customUserAgent: valid.customUserAgent, buildId: subId }),
            subId
          });
        }
        if (platforms.includes('windows')) {
          const subId = uuidv4();
          subBuilds.push({
            label: 'windows',
            promise: buildEXE({ ...baseConfig, installerType: valid.installerType, windowWidth: valid.windowWidth, windowHeight: valid.windowHeight, fullScreen: valid.fullScreen, customUserAgent: valid.customUserAgent, buildId: subId }),
            subId
          });
        }
        if (platforms.includes('linux-appimage')) {
          const subId = uuidv4();
          subBuilds.push({
            label: 'linux-appimage',
            promise: buildAppImage({ ...baseConfig, windowWidth: valid.windowWidth, windowHeight: valid.windowHeight, fullScreen: valid.fullScreen, customUserAgent: valid.customUserAgent, buildId: subId }),
            subId
          });
        }
        if (platforms.includes('linux-deb')) {
          const subId = uuidv4();
          subBuilds.push({
            label: 'linux-deb',
            promise: buildDeb({ ...baseConfig, windowWidth: valid.windowWidth, windowHeight: valid.windowHeight, fullScreen: valid.fullScreen, customUserAgent: valid.customUserAgent, buildId: subId }),
            subId
          });
        }

        // Wait for all builds
        const results = await Promise.allSettled(
          subBuilds.map(b => b.promise)
        );

        // Collect successful build directories and files
        const successDirs = [];
        const successFiles = [];
        const errors = [];
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          const sub = subBuilds[i];
          if (r.status === 'fulfilled') {
            const filePath = r.value;
            if (filePath && fs.existsSync(filePath)) {
              const ext = path.extname(filePath).toLowerCase();
              if (ext !== '.zip') {
                successFiles.push({ name: path.basename(filePath), path: filePath });
              }
            }

            // Each builder creates its directory at BUILDS_DIR/subId/<platform>/
            const dirName = sub.label;
            const buildDir = path.join(BUILDS_DIR, sub.subId, dirName);
            if (fs.existsSync(buildDir)) {
              successDirs.push({ label: dirName, dir: buildDir });
            } else {
              // Some builders use different directory names; find the first directory
              const subDir = path.join(BUILDS_DIR, sub.subId);
              const entries = fs.readdirSync(subDir, { withFileTypes: true });
              const firstDir = entries.find(e => e.isDirectory());
              if (firstDir) {
                successDirs.push({ label: dirName, dir: path.join(subDir, firstDir.name) });
              }
            }
          } else {
            errors.push(`${sub.label}: ${r.reason?.message || 'unknown error'}`);
          }
        }

        if (successDirs.length === 0 && successFiles.length === 0) {
          throw new Error('All builds failed: ' + errors.join('; '));
        }

        // Create combined ZIP
        const version = valid.appVersion;
        const safeName = safeFileName(valid.appName);
        const zipName = `${safeName}-all-platforms-${version}.zip`;
        const zipPath = safeJoin(BUILDS_DIR, buildId, zipName);
        fs.mkdirSync(path.dirname(zipPath), { recursive: true });

        await new Promise((resolve, reject) => {
          const output = fs.createWriteStream(zipPath);
          const archive = archiver('zip', { zlib: { level: 9 } });

          output.on('close', resolve);
          output.on('error', reject);
          archive.on('error', reject);
          archive.pipe(output);

          for (const { label, dir } of successDirs) {
            archive.directory(dir, label);
          }

          for (const file of successFiles) {
            archive.file(file.path, { name: safeFileName(file.name) });
          }

          archive.finalize().catch(reject);
        });

        const statusInfo = {
          status: 'completed',
          platform: 'combined',
          file: zipPath,
          filename: zipName
        };
        if (errors.length > 0) {
          statusInfo.warnings = errors;
        }
        queueSet(buildId, statusInfo);

      } catch (error) {
        queueSet(buildId, {
          status: 'error',
          platform: 'combined',
          error: error.message
        });
      }
    })();

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Custom 404 Page (Vercel-styled Theme)
app.use((req, res) => {
  res.status(404).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>404 - Page Not Found</title>
    <link rel="icon" type="image/png" href="/favicon.png">
    <link rel="preload" href="/fonts/geist-variable.woff2" as="font" type="font/woff2" crossorigin="anonymous">
    <link rel="stylesheet" href="/styles.css">
    <script src="/theme.js"></script>
    <style>
      @font-face {
        font-family: 'Geist';
        font-style: normal;
        font-weight: 300 800;
        font-display: swap;
        src: url('/fonts/geist-variable.woff2') format('woff2');
      }
      .error-container {
        max-width: 600px;
        margin: 120px auto;
        text-align: center;
        padding: 0 24px;
      }
      .error-code {
        font-size: 6rem;
        font-weight: 800;
        margin-bottom: 12px;
        letter-spacing: -0.05em;
        line-height: 1;
        color: var(--foreground);
        text-shadow: 0 4px 30px var(--title-shadow);
      }
      .error-message {
        font-size: 1.25rem;
        color: var(--accents-6);
        margin-bottom: 32px;
        font-weight: 500;
      }
    </style>
  </head>
  <body class="landing-page">
    <header class="navbar" aria-label="Main navigation">
      <div class="navbar-container">
        <a href="/" class="brand" aria-label="SiteToApp Homepage">
          <svg class="brand-logo" viewBox="0 0 24 24" style="width: 20px; height: 20px;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
            <path d="M12 18h.01"></path>
            <path d="M9 6h6"></path>
          </svg>
          <span class="brand-text">SiteToApp</span>
        </a>
        <div class="nav-actions" style="display: flex; align-items: center;">
          <button id="themeToggle" class="theme-toggle" aria-label="Toggle theme">
            <!-- Sun Icon (shown in dark theme) -->
            <svg class="sun-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="5"></circle>
              <line x1="12" y1="1" x2="12" y2="3"></line>
              <line x1="12" y1="21" x2="12" y2="23"></line>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
              <line x1="1" y1="12" x2="3" y2="12"></line>
              <line x1="21" y1="12" x2="23" y2="12"></line>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
            <!-- Moon Icon (shown in light theme) -->
            <svg class="moon-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
          </button>
          <a href="/" class="btn btn-secondary btn-small">Back Home</a>
        </div>
      </div>
    </header>
    <main class="error-container">
      <h1 class="error-code">404</h1>
      <p class="error-message">The page you are looking for does not exist.</p>
      <a href="/" class="btn btn-primary">Back Home</a>
    </main>
  </body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`SiteToApp Builder server running on http://localhost:${PORT}`);
});
