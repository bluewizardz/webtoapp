# Backend and Build APIs

## Two backend paths

The project has two distinct execution paths:

- **Local:** `server.js` runs Express, serves the Astro output from `dist/`, and invokes builder modules on the same machine. Android jobs are submitted through `queue-manager.js`.
- **Cloudflare Pages:** `functions/api/` provides edge functions. Android and Windows build requests dispatch GitHub Actions workflows in `bluewizardz/webtoapp`; those workflows run the CLI build scripts and upload artifacts. Pages functions poll GitHub and proxy or redirect downloads.

The Pages path is currently configured for Android and Windows only. Express also has local macOS and Linux endpoints, but those platforms are marked as coming soon in the site UI. The Cloudflare functions do not call the Express backend.

## Local Express API

All JSON build requests require `siteUrl`, `appName`, and `appId` unless otherwise stated. The server adds `https://` when a submitted URL has no scheme. Build endpoints are limited to 10 requests per IP in 15 minutes by an in-memory limiter.

| Method and route | Purpose |
| --- | --- |
| `GET /api/health` | Health response with status and timestamp |
| `GET /api/favicon?url=...` | Fetch and convert a remote favicon for previews/builds |
| `POST /api/build/apk` | Queue Android build; supports icon and WebView options |
| `POST /api/build/exe` | Build Windows wrapper; accepts `engine` (`electron` or `tauri`), installer type, window size, fullscreen, and user agent |
| `POST /api/build/dmg` | Attempt local macOS Electron packaging |
| `POST /api/build/appimage` | Attempt local Linux AppImage packaging |
| `POST /api/build/deb` | Attempt local Debian package generation |
| `POST /api/build/batch` | Start selected local builds and return platform build IDs |
| `POST /api/build/combined` | Build selected local platforms and package outputs/source directories into one ZIP |
| `GET /api/build/:buildId` | Read build status; also available as `GET /api/exe/:buildId` |
| `GET /api/download/:buildId` | Download completed local output; also available as `/api/exe/download/:buildId` |

Single-build endpoints return a `buildId` and `status: "queued"`. Poll the corresponding status endpoint until it returns `completed` or `error`, then download the output. The filename determines whether the result is an installer/APK or a source ZIP.

The Android request accepts `appVersion`, `icon` (data URL), `autoFetchIcon`, `showSpinner`, `pullToRefresh`, `allowZoom`, `showSplash`, `splashDuration`, `fullScreen`, and `customUserAgent`. The Windows request accepts `appVersion`, `icon`, `engine`, `installerType`, `windowWidth`, `windowHeight`, `fullScreen`, and `customUserAgent`. Batch endpoints expose a narrower option set than the single-build routes.

Example Android request:

```bash
curl -X POST http://localhost:3000/api/build/apk \
  -H 'Content-Type: application/json' \
  -d '{"siteUrl":"https://example.com","appName":"Example App","appId":"com.example.app","appVersion":"1.0.0"}'
```

Example response:

```json
{"buildId":"<uuid>","status":"queued"}
```

## Cloudflare Pages API

Pages Functions use `GITHUB_PAT` to access the repository configured in their source. Current routes include:

| Method and route | Purpose |
| --- | --- |
| `GET /api/health` | Health response |
| `GET /api/favicon?url=...` | Edge favicon proxy with timeout and private-host checks |
| `POST /api/build/apk` | Dispatch `build-apk.yml` and return a build ID |
| `POST /api/build/exe` | Dispatch `build-exe.yml` and return a build ID |
| `GET /api/build/:id` | Poll Android workflow/artifact state |
| `GET /api/download/:id` | Retrieve APK from the matching Actions artifact |
| `GET /api/exe/:id` | Poll Windows release/artifact state |
| `GET /api/exe/download/:id` | Redirect to a Windows draft-release asset or extract its Actions artifact |

Cloudflare build requests are not subject to the Express in-memory rate limiter. Build status and artifact state are obtained from GitHub Actions rather than stored by the Pages function. The Windows release path creates draft releases so installers do not appear in the public release listing.

## Builder behavior and outputs

- `builders/android-builder.js` generates a native Java WebView project and attempts a debug APK build with JDK 17, Gradle 8.12, and the Android SDK. If compilation is unavailable, it returns a ZIP of the Android project source.
- `builders/windows-builder.js` generates an Electron WebView wrapper. `builders/tauri-builder.js` generates a Rust/Tauri wrapper; it compiles Windows EXEs on Windows and returns source on unsupported hosts.
- `builders/macos-builder.js` and `builders/linux-builder.js` generate Electron wrappers and try their respective native packaging targets. Where compilation is unavailable, they return project-source ZIPs.
- Icons may be uploaded or fetched from a target site. Sharp resizes them for platform resource formats; generated initials are used when no usable icon is available.

In GitHub Actions, `cli-build-apk.js` and `cli-build-exe.js` treat a source-ZIP fallback as a failed compiled build. Workflows upload only the requested `.apk` or `.exe`, so Pages downloads are intended to deliver compiled artifacts.

## Queue, persistence, and limitations

Android local builds use BullMQ with Redis when Redis connects during server startup. Otherwise, `queue-manager.js` uses an in-memory queue. `MAX_GRADLE_PARALLEL_BUILDS` controls concurrency (default 3); Redis settings use `REDIS_HOST` and `REDIS_PORT`.

Express stores build status in a process-local `Map` and files under `builds/{buildId}/`. A server restart loses status records, and no automatic build-file cleanup is configured. The local rate limiter is also process-local. Batch mode returns per-platform IDs but does not register a pending status before each build completes, so early polling can return 404. The Cloudflare Android status function checks the build artifact and then recent workflow runs; because the fallback run lookup is not keyed to the specific build ID, simultaneous or failed runs can result in ambiguous/persistently pending status.

See [SETUP.md](SETUP.md) for local prerequisites and deployment secrets, and [HOW_IT_WORKS.md](HOW_IT_WORKS.md) for sequence details.
