# Site2App Builder - Node.js Backend Setup

## Installation

### Prerequisites
- Node.js 18+ and npm
- (Optional) Android SDK for building real APKs
- (Optional) macOS for building real DMGs
- (Optional) Windows or Wine for building real EXEs

### Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

The server will run on `http://localhost:3000`

### Development

For auto-reload during development:
```bash
npm run dev
```

## API Endpoints

### Build Endpoints

#### Android APK
```bash
POST /api/build/apk
Content-Type: application/json

{
  "siteUrl": "https://example.com",
  "appName": "My App",
  "appId": "com.example.myapp",
  "appVersion": "1.0.0",
  "icon": null
}

Response:
{
  "buildId": "uuid",
  "status": "queued"
}
```

#### macOS DMG
```bash
POST /api/build/dmg
```

#### Windows EXE
```bash
POST /api/build/exe
```

#### Linux AppImage
```bash
POST /api/build/appimage
```

#### Linux DEB
```bash
POST /api/build/deb
```

#### Batch Build (All Platforms)
```bash
POST /api/build/batch

{
  "siteUrl": "https://example.com",
  "appName": "My App",
  "appId": "com.example.myapp",
  "appVersion": "1.0.0",
  "platforms": ["android", "macos", "windows", "linux-appimage", "linux-deb"]
}

Response:
{
  "batchId": "uuid",
  "builds": {
    "android": "buildId1",
    "macos": "buildId2",
    "windows": "buildId3",
    "linux-appimage": "buildId4",
    "linux-deb": "buildId5"
  }
}
```

### Check Build Status
```bash
GET /api/build/{buildId}

Response:
{
  "status": "completed|pending|error",
  "platform": "android|macos|windows|linux",
  "file": "/path/to/file",
  "filename": "app-1.0.0.apk"
}
```

### Download Built File
```bash
GET /api/download/{buildId}
```

### Health Check
```bash
GET /api/health

Response:
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## File Structure

```
/home/anwin/Documents/VS Codes/websitetoapp/
├── index.html              # Frontend
├── app.js                  # Frontend logic (with backend integration)
├── styles.css              # Styling
├── server.js               # Express server
├── package.json            # Dependencies
├── builders/
│   ├── android-builder.js  # Android APK builder
│   ├── macos-builder.js    # macOS DMG builder
│   ├── windows-builder.js  # Windows EXE builder
│   └── linux-builder.js    # Linux AppImage & DEB builder
├── builds/                 # Output directory for built files
└── SETUP.md               # This file
```

## How It Works

1. **Frontend** (`index.html`, `app.js`, `styles.css`):
   - User enters website URL and app details
   - Chooses between:
     - Direct files (APK, DMG, EXE) from backend
     - GitHub Actions workflow ZIP for CI/CD

2. **Backend** (`server.js`):
   - Express server handles build requests
   - Routes requests to appropriate builder modules
   - Manages build queue and status tracking
   - Serves files for download

3. **Builders** (`builders/*.js`):
   - Generate project structures for each platform
   - Create configuration files
   - Prepare source code
   - (In production: Execute build tools)

## Current Status

The current implementation:
- ✅ Creates project structures for all platforms
- ✅ Generates mock files (for demonstration)
- ⏳ Ready for integration with actual build tools:
  - Android SDK + Gradle
  - Electron Builder (macOS, Windows, Linux)
  - Platform-specific build environments

## To Enable Real Builds

### Android APK
Install Android SDK and add this to `android-builder.js`:
```bash
execSync('gradle :app:assembleDebug :app:assembleRelease', { cwd: buildDir });
```

### macOS DMG
On macOS, install electron-builder:
```bash
execSync('npm install && npm run build', { cwd: buildDir });
```

### Windows EXE
On Windows, install electron-builder:
```bash
execSync('npm install && npm run build', { cwd: buildDir });
```

### Linux AppImage/DEB
```bash
execSync('npm install && npm run build', { cwd: buildDir });
```

## Environment Variables

```bash
PORT=3000                          # Server port (default: 3000)
NODE_ENV=development               # development or production
REDIS_HOST=127.0.0.1               # Redis hostname for task queueing
REDIS_PORT=6379                    # Redis port for task queueing
MAX_GRADLE_PARALLEL_BUILDS=3       # Max parallel Gradle builds (default: 3)
```

## Task Queueing & Concurrency

The compiler uses **BullMQ** + **Redis** to queue and limit the number of active Gradle builds running at once (concurrency limit configured via `MAX_GRADLE_PARALLEL_BUILDS`).
- **Prerequisites**: Ensure a Redis server is installed and running on `REDIS_HOST`:`REDIS_PORT`.
- **Graceful Fallback**: If Redis is not available or connection fails, the server will print a warning and dynamically fall back to a local, promise-based in-memory queue, maintaining concurrency control without crashing.

## Rate Limiting

To prevent API abuse and server exhaustion, rate limiting is applied to all build endpoints:
- Limits requests to **10 build requests per 15 minutes** per IP address.
- Returns `429 Too Many Requests` when the limit is exceeded, including standard `X-RateLimit-Limit` and `X-RateLimit-Remaining` response headers.

## Troubleshooting

**Port already in use:**
```bash
PORT=3001 npm start
```

**Builds not completing:**
- Check `/builds/` directory for generated files
- Check terminal logs for errors
- Ensure build tools are installed

**File download issues:**
- Browser security: Ensure using https for production
- CORS: Update `cors()` middleware if frontend is on different domain
