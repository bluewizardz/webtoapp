# Site2App Builder - Backend System

## Overview

This is a complete Node.js backend system that converts websites into native applications for multiple platforms:

- **Android** (APK) - Native WebView wrapper
- **macOS** (DMG, ZIP) - Electron-based desktop app
- **Windows** (EXE, Portable) - Electron-based installer
- **Linux** (AppImage, DEB) - Electron-based packages

## Quick Start

### 1. Start the Server

```bash
cd /home/anwin/Documents/VS\ Codes/websitetoapp
npm start
```

Server runs on **http://localhost:3000**

### 2. Open the Frontend

Visit `http://localhost:3000` in your browser

### 3. Build Apps

**Option A: Download GitHub Actions ZIP** (CI/CD workflow)
1. Enter website URL and app details
2. Click "Download ZIP"
3. Push to GitHub for automated builds

**Option B: Download Files Directly** (New!)
1. Enter website URL and app details
2. Select target platforms
3. Click platform buttons (APK, DMG, EXE, etc.)
4. Files download directly when ready

## Architecture

### Frontend (`index.html`, `app.js`, `styles.css`)
- Web UI for entering app configuration
- Supports both GitHub Actions workflow ZIP download
- Direct API calls to backend for instant file generation
- Real-time validation and preview

### Backend Server (`server.js`)
```
Express.js HTTP Server
│
├── POST /api/build/apk          → buildAPK()
├── POST /api/build/dmg          → buildDMG()
├── POST /api/build/exe          → buildEXE()
├── POST /api/build/appimage     → buildAppImage()
├── POST /api/build/deb          → buildDeb()
├── POST /api/build/batch        → All platforms
├── GET  /api/build/:id          → Check status
├── GET  /api/download/:id       → Download file
└── GET  /api/health             → Health check
```

### Builders (`builders/` directory)

#### `android-builder.js`
- Generates Android Gradle project structure
- Creates MainActivity.java with WebView
- Generates AndroidManifest.xml
- Creates build.gradle configuration
- Output: Mock APK file (ready for real Gradle build)

**To enable real APKs:**
```javascript
execSync('gradle :app:assembleDebug :app:assembleRelease', { cwd: buildDir });
```
Requires: Android SDK, Gradle, Java 11+

#### `macos-builder.js`
- Creates Electron main.js entry point
- Generates package.json with electron-builder config
- Sets up DMG distribution packaging
- Output: Mock DMG file

**To enable real DMGs:**
```javascript
execSync('npm install && npm run build', { cwd: buildDir });
```
Requires: macOS, Node.js, Electron, electron-builder

#### `windows-builder.js`
- Creates Electron main.js for Windows
- Generates NSIS installer configuration
- Sets up portable EXE generation
- Output: Mock EXE file

**To enable real EXEs:**
```javascript
execSync('npm install && npm run build', { cwd: buildDir });
```
Requires: Windows or Wine, Node.js, electron-builder

#### `linux-builder.js`
- Generates AppImage configuration
- Creates Debian package metadata
- Sets up system integration files
- Output: Mock AppImage and DEB files

**To enable real Linux packages:**
```javascript
execSync('npm install && npm run build', { cwd: buildDir });
```
Requires: Linux, Node.js, electron-builder, AppImage tools

## File Structure

```
websitetoapp/
├── index.html              Frontend UI
├── app.js                  Frontend JS (updated with API calls)
├── styles.css              Frontend CSS
├── server.js               Express backend
├── package.json            Node.js dependencies
├── builders/
│   ├── android-builder.js  APK generation
│   ├── macos-builder.js    DMG generation
│   ├── windows-builder.js  EXE generation
│   └── linux-builder.js    AppImage/DEB generation
├── builds/                 Generated app files (output)
├── SETUP.md               Setup guide
└── BACKEND.md             This file
```

## API Examples

### Build Single File

**Request:**
```bash
curl -X POST http://localhost:3000/api/build/apk \
  -H "Content-Type: application/json" \
  -d '{
    "siteUrl": "https://example.com",
    "appName": "Example App",
    "appId": "com.example.app",
    "appVersion": "1.0.0",
    "icon": null
  }'
```

**Response:**
```json
{
  "buildId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "queued"
}
```

### Check Build Status

**Request:**
```bash
curl http://localhost:3000/api/build/f47ac10b-58cc-4372-a567-0e02b2c3d479
```

**Response (Pending):**
```json
{
  "status": "pending",
  "platform": "android"
}
```

**Response (Completed):**
```json
{
  "status": "completed",
  "platform": "android",
  "file": "/path/to/app/com.example.app-1.0.0.apk",
  "filename": "com.example.app-1.0.0.apk"
}
```

### Download File

**Request:**
```bash
curl -O http://localhost:3000/api/download/f47ac10b-58cc-4372-a567-0e02b2c3d479
```

### Batch Build All Platforms

**Request:**
```bash
curl -X POST http://localhost:3000/api/build/batch \
  -H "Content-Type: application/json" \
  -d '{
    "siteUrl": "https://example.com",
    "appName": "My App",
    "appId": "com.mycompany.myapp",
    "appVersion": "1.0.0",
    "platforms": ["android", "macos", "windows", "linux-appimage", "linux-deb"]
  }'
```

**Response:**
```json
{
  "batchId": "batch-uuid",
  "builds": {
    "android": "build-id-1",
    "macos": "build-id-2",
    "windows": "build-id-3",
    "linux-appimage": "build-id-4",
    "linux-deb": "build-id-5"
  }
}
```

## Configuration

### Environment Variables

```bash
PORT=3000              # Server port (default: 3000)
NODE_ENV=development   # development or production
```

### Start Modes

**Production:**
```bash
npm start
```

**Development (with auto-reload):**
```bash
npm run dev
```

## Output Files

Generated files are stored in: `/builds/{buildId}/`

```
builds/
├── f47ac10b-58cc/
│   ├── android/           # Android project source
│   │   ├── app/
│   │   ├── build.gradle
│   │   └── settings.gradle
│   ├── macos/             # macOS/Electron source
│   │   ├── src/
│   │   └── package.json
│   ├── windows/           # Windows/Electron source
│   └── com.example.app-1.0.0.apk      # Final APK
│   └── MyApp-1.0.0.dmg               # Final DMG
│   └── MyApp-Setup-1.0.0.exe         # Final EXE
```

## Feature Comparison

| Feature | GitHub Actions ZIP | Direct Build |
|---------|-------------------|--------------|
| Setup time | 1 minute | Instant |
| Build time | 5-10 minutes | Real-time |
| Cost | Free (GitHub) | Server costs |
| Offline | No | Yes |
| CI/CD | Yes | No |
| Custom workflows | Yes | No |
| Direct download | No | Yes |

## Deployment Options

### Option 1: Local Server (Development)
```bash
npm start
```
- Runs on `localhost:3000`
- Perfect for testing
- Single user only

### Option 2: VPS/Cloud Server (Production)
```bash
# Requires: Node.js, all build tools
npm install --production
npm start
```

Recommended providers:
- AWS EC2
- DigitalOcean
- Linode
- Google Cloud
- Azure

### Option 3: Docker (Recommended)
```dockerfile
FROM node:20
WORKDIR /app
COPY . .
RUN npm install
EXPOSE 3000
CMD ["npm", "start"]
```

Build: `docker build -t site2app .`
Run: `docker run -p 3000:3000 site2app`

### Option 4: Serverless (Limited)
- AWS Lambda
- Google Cloud Functions
- Requires timeouts configured for build time

## Build Time Estimates

- **Android APK**: 2-5 minutes (with real Gradle)
- **macOS DMG**: 3-7 minutes (macOS only)
- **Windows EXE**: 3-7 minutes (Windows only)
- **Linux AppImage**: 2-4 minutes
- **Linux DEB**: 1-2 minutes

## Troubleshooting

### Port 3000 Already in Use
```bash
PORT=3001 npm start
```

### Build Files Not Generating
1. Check `/builds/` directory exists
2. Check terminal logs for errors
3. Verify disk space available
4. Check file permissions

### Downloads Not Working
```bash
# Rebuild the download linkage
npm install
```

### Memory Issues During Builds
Increase Node.js heap:
```bash
NODE_OPTIONS=--max-old-space-size=4096 npm start
```

## Security Considerations

1. **Input Validation**: All URLs and app IDs are validated
2. **File Permissions**: Generated files are user-readable only
3. **Isolation**: Each build uses unique UUID directories
4. **Cleanup**: Implement periodic cleanup of old builds
5. **Rate Limiting**: Add rate limiting middleware for production

## Performance Optimization

1. **Caching**: Cache project templates
2. **Async Builds**: Use worker threads for CPU-intensive tasks
3. **Compression**: Compress response files
4. **CDN**: Use CDN for static frontend files
5. **Load Balancing**: Use reverse proxy for multiple servers

## Next Steps

1. ✅ Backend server working
2. ⏳ Integrate real build tools (Gradle, Electron Builder, etc.)
3. ⏳ Add database for build history
4. ⏳ Implement user authentication
5. ⏳ Add build status dashboard
6. ⏳ Deploy to production server

## Support

For issues or questions, check:
- Terminal logs for error messages
- `/builds/` directory for generated artifacts
- Network tab in browser DevTools
- API endpoints in `server.js`
