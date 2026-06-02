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
import { buildAppImage, buildDeb } from './builders/linux-builder.js';
import { queueGradleBuild } from './queue-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const BUILDS_DIR = path.join(__dirname, 'builds');

// Ensure builds directory exists
if (!fs.existsSync(BUILDS_DIR)) {
  fs.mkdirSync(BUILDS_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Rate limiting middleware to prevent abuse and API exhaustion
const rateLimits = new Map();

const rateLimiter = (options = { windowMs: 15 * 60 * 1000, max: 10 }) => {
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();
    
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

// Proxy endpoint to scrape the favicon the same way a browser fetches it (bypassing CORS)
app.get('/api/favicon', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    let buffer = await fetchFaviconBuffer(url);
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

  // 1x1 transparent GIF fallback if all fails
  res.setHeader('Content-Type', 'image/gif');
  return res.send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
});

// Generate APK
app.post('/api/build/apk', compilerLimiter, async (req, res) => {
  try {
    const { siteUrl, appName, appId, appVersion, icon, autoFetchIcon, showSpinner, pullToRefresh, showSplash, splashDuration, fullScreen, customUserAgent } = req.body;
    const buildId = uuidv4();

    if (!siteUrl || !appName || !appId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    buildQueue.set(buildId, { status: 'pending', platform: 'android' });

    res.json({ buildId, status: 'queued' });

    // Build asynchronously
    try {
      const resultPath = await queueGradleBuild({
        siteUrl,
        appName,
        appId,
        appVersion: appVersion || '1.0.0',
        icon,
        autoFetchIcon: autoFetchIcon !== false,
        showSpinner: showSpinner !== false,
        pullToRefresh: pullToRefresh !== false,
        showSplash: showSplash !== false,
        splashDuration: splashDuration || 2000,
        fullScreen: fullScreen === true,
        customUserAgent: customUserAgent || null,
        buildId,
        buildsDir: BUILDS_DIR
      });

      buildQueue.set(buildId, {
        status: 'completed',
        platform: 'android',
        file: resultPath,
        filename: path.basename(resultPath)
      });
    } catch (error) {
      buildQueue.set(buildId, {
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
    const { siteUrl, appName, appId, appVersion, icon } = req.body;
    const buildId = uuidv4();

    if (!siteUrl || !appName || !appId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    buildQueue.set(buildId, { status: 'pending', platform: 'macos' });

    res.json({ buildId, status: 'queued' });

    try {
      const resultPath = await buildDMG({
        siteUrl,
        appName,
        appId,
        appVersion: appVersion || '1.0.0',
        icon,
        buildId,
        buildsDir: BUILDS_DIR
      });

      buildQueue.set(buildId, {
        status: 'completed',
        platform: 'macos',
        file: resultPath,
        filename: path.basename(resultPath)
      });
    } catch (error) {
      buildQueue.set(buildId, {
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
    const { siteUrl, appName, appId, appVersion, icon } = req.body;
    const buildId = uuidv4();

    if (!siteUrl || !appName || !appId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    buildQueue.set(buildId, { status: 'pending', platform: 'windows' });

    res.json({ buildId, status: 'queued' });

    try {
      const resultPath = await buildEXE({
        siteUrl,
        appName,
        appId,
        appVersion: appVersion || '1.0.0',
        icon,
        buildId,
        buildsDir: BUILDS_DIR
      });

      buildQueue.set(buildId, {
        status: 'completed',
        platform: 'windows',
        file: resultPath,
        filename: path.basename(resultPath)
      });
    } catch (error) {
      buildQueue.set(buildId, {
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
    const { siteUrl, appName, appId, appVersion, icon } = req.body;
    const buildId = uuidv4();

    if (!siteUrl || !appName || !appId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    buildQueue.set(buildId, { status: 'pending', platform: 'linux' });

    res.json({ buildId, status: 'queued' });

    try {
      const resultPath = await buildAppImage({
        siteUrl,
        appName,
        appId,
        appVersion: appVersion || '1.0.0',
        icon,
        buildId,
        buildsDir: BUILDS_DIR
      });

      buildQueue.set(buildId, {
        status: 'completed',
        platform: 'linux',
        file: resultPath,
        filename: path.basename(resultPath)
      });
    } catch (error) {
      buildQueue.set(buildId, {
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
    const { siteUrl, appName, appId, appVersion, icon } = req.body;
    const buildId = uuidv4();

    if (!siteUrl || !appName || !appId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    buildQueue.set(buildId, { status: 'pending', platform: 'linux' });

    res.json({ buildId, status: 'queued' });

    try {
      const resultPath = await buildDeb({
        siteUrl,
        appName,
        appId,
        appVersion: appVersion || '1.0.0',
        icon,
        buildId,
        buildsDir: BUILDS_DIR
      });

      buildQueue.set(buildId, {
        status: 'completed',
        platform: 'linux',
        file: resultPath,
        filename: path.basename(resultPath)
      });
    } catch (error) {
      buildQueue.set(buildId, {
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
app.get('/api/build/:buildId', (req, res) => {
  const { buildId } = req.params;
  const buildStatus = buildQueue.get(buildId);

  if (!buildStatus) {
    return res.status(404).json({ error: 'Build not found' });
  }

  res.json(buildStatus);
});

// Download built file
app.get('/api/download/:buildId', (req, res) => {
  const { buildId } = req.params;
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
});

// Batch build endpoint (individual polling per platform)
app.post('/api/build/batch', compilerLimiter, async (req, res) => {
  try {
    const { siteUrl, appName, appId, appVersion, icon, platforms, showSpinner, pullToRefresh } = req.body;

    if (!siteUrl || !appName || !appId || !platforms || platforms.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const batchId = uuidv4();
    const builds = {};

    // Start all builds
    if (platforms.includes('android')) {
      const buildId = uuidv4();
      builds['android'] = buildId;
      queueGradleBuild({ 
        siteUrl, 
        appName, 
        appId, 
        appVersion, 
        icon, 
        showSpinner: showSpinner !== false, 
        pullToRefresh: pullToRefresh !== false, 
        buildId, 
        buildsDir: BUILDS_DIR 
      })
        .then((apkPath) => {
          buildQueue.set(buildId, {
            status: 'completed',
            platform: 'android',
            file: apkPath,
            filename: path.basename(apkPath)
          });
        })
        .catch((error) => {
          buildQueue.set(buildId, { status: 'error', platform: 'android', error: error.message });
        });
    }

    if (platforms.includes('macos')) {
      const buildId = uuidv4();
      builds['macos'] = buildId;
      buildDMG({ siteUrl, appName, appId, appVersion, icon, buildId, buildsDir: BUILDS_DIR })
        .then((dmgPath) => {
          buildQueue.set(buildId, {
            status: 'completed',
            platform: 'macos',
            file: dmgPath,
            filename: path.basename(dmgPath)
          });
        })
        .catch((error) => {
          buildQueue.set(buildId, { status: 'error', platform: 'macos', error: error.message });
        });
    }

    if (platforms.includes('windows')) {
      const buildId = uuidv4();
      builds['windows'] = buildId;
      buildEXE({ siteUrl, appName, appId, appVersion, icon, buildId, buildsDir: BUILDS_DIR })
        .then((exePath) => {
          buildQueue.set(buildId, {
            status: 'completed',
            platform: 'windows',
            file: exePath,
            filename: path.basename(exePath)
          });
        })
        .catch((error) => {
          buildQueue.set(buildId, { status: 'error', platform: 'windows', error: error.message });
        });
    }

    if (platforms.includes('linux-appimage')) {
      const buildId = uuidv4();
      builds['linux-appimage'] = buildId;
      buildAppImage({ siteUrl, appName, appId, appVersion, icon, buildId, buildsDir: BUILDS_DIR })
        .then((appImagePath) => {
          buildQueue.set(buildId, {
            status: 'completed',
            platform: 'linux',
            file: appImagePath,
            filename: path.basename(appImagePath)
          });
        })
        .catch((error) => {
          buildQueue.set(buildId, { status: 'error', platform: 'linux', error: error.message });
        });
    }

    if (platforms.includes('linux-deb')) {
      const buildId = uuidv4();
      builds['linux-deb'] = buildId;
      buildDeb({ siteUrl, appName, appId, appVersion, icon, buildId, buildsDir: BUILDS_DIR })
        .then((debPath) => {
          buildQueue.set(buildId, {
            status: 'completed',
            platform: 'linux',
            file: debPath,
            filename: path.basename(debPath)
          });
        })
        .catch((error) => {
          buildQueue.set(buildId, { status: 'error', platform: 'linux', error: error.message });
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
    const { siteUrl, appName, appId, appVersion, icon, platforms, showSpinner, pullToRefresh, showSplash, splashDuration, fullScreen, customUserAgent } = req.body;

    if (!siteUrl || !appName || !appId || !platforms || platforms.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const buildId = uuidv4();
    buildQueue.set(buildId, { status: 'pending', platform: 'combined' });

    res.json({ buildId, status: 'queued' });

    // Build all platforms and combine
    (async () => {
      try {
        const subBuilds = [];
        const baseConfig = {
          siteUrl, appName, appId,
          appVersion: appVersion || '1.0.0',
          icon, buildsDir: BUILDS_DIR
        };

        if (platforms.includes('android')) {
          const subId = uuidv4();
          subBuilds.push({
            label: 'android',
            promise: queueGradleBuild({ 
              ...baseConfig, 
              showSpinner: showSpinner !== false, 
              pullToRefresh: pullToRefresh !== false, 
              showSplash: showSplash !== false,
              splashDuration: splashDuration || 2000,
              fullScreen: fullScreen === true,
              customUserAgent: customUserAgent || null,
              buildId: subId 
            }),
            subId
          });
        }
        if (platforms.includes('macos')) {
          const subId = uuidv4();
          subBuilds.push({
            label: 'macos',
            promise: buildDMG({ ...baseConfig, buildId: subId }),
            subId
          });
        }
        if (platforms.includes('windows')) {
          const subId = uuidv4();
          subBuilds.push({
            label: 'windows',
            promise: buildEXE({ ...baseConfig, buildId: subId }),
            subId
          });
        }
        if (platforms.includes('linux-appimage')) {
          const subId = uuidv4();
          subBuilds.push({
            label: 'linux-appimage',
            promise: buildAppImage({ ...baseConfig, buildId: subId }),
            subId
          });
        }
        if (platforms.includes('linux-deb')) {
          const subId = uuidv4();
          subBuilds.push({
            label: 'linux-deb',
            promise: buildDeb({ ...baseConfig, buildId: subId }),
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
        const version = appVersion || '1.0.0';
        const safeName = appName.replace(/[^a-zA-Z0-9-_]/g, '-');
        const zipPath = path.join(BUILDS_DIR, buildId, `${safeName}-all-platforms-${version}.zip`);
        fs.mkdirSync(path.join(BUILDS_DIR, buildId), { recursive: true });

        await new Promise((resolve, reject) => {
          const output = fs.createWriteStream(zipPath);
          const archive = archiver('zip', { zlib: { level: 9 } });

          output.on('close', resolve);
          archive.on('error', reject);
          archive.pipe(output);

          for (const { label, dir } of successDirs) {
            archive.directory(dir, label);
          }

          for (const file of successFiles) {
            archive.file(file.path, { name: file.name });
          }

          archive.finalize();
        });

        const statusInfo = {
          status: 'completed',
          platform: 'combined',
          file: zipPath,
          filename: `${safeName}-all-platforms-${version}.zip`
        };
        if (errors.length > 0) {
          statusInfo.warnings = errors;
        }
        buildQueue.set(buildId, statusInfo);

      } catch (error) {
        buildQueue.set(buildId, {
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
    <link rel="preload" href="/fonts/geist-variable.woff2" as="font" type="font/woff2" crossorigin>
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
