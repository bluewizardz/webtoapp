# Setup and Deployment

## Requirements

- Node.js 22.12 or newer and npm.
- For a real local Android APK: JDK 17, Gradle 8.12, and the Android SDK. `builders/build-utils.js` looks for these tools and can attempt to obtain JDK/Gradle/SDK components, but that setup depends on the host and network.
- For local Windows EXE builds: a Windows host with the required build tools. Electron uses electron-builder; Tauri needs Rust and its Windows build prerequisites. When the host cannot produce the requested native artifact, the builder may return a source ZIP.
- Redis is optional for local Android queueing. Without Redis, the process uses an in-memory queue.

## Install and run locally

```bash
npm install
npm start
```

`npm start` runs `astro build` and then starts the Express server. Open `http://localhost:3000`. Express serves `dist/` and provides the local build API.

Available development/build commands:

```bash
npm run astro:dev   # Astro frontend dev server; does not provide the Express build API
npm run dev         # Build Astro, then run Express with Node watch mode
npm run build       # Generate the static site in dist/ only
```

Set `PORT` to change the Express port. Android queue configuration uses `REDIS_HOST`, `REDIS_PORT`, and `MAX_GRADLE_PARALLEL_BUILDS` (default `127.0.0.1`, `6379`, and `3`). The fallback queue is also limited by that concurrency setting.

## Build behavior

- **Android locally:** the Express API queues a build, writes an Android Gradle project, and attempts `assembleDebug`. If tool detection or compilation fails, the builder can package the project source as a ZIP. The local status endpoint reports the builder result as completed even when that result is a ZIP; check the returned filename/extension before treating it as an APK.
- **Windows locally:** the Express endpoint invokes Electron or Tauri. Tauri only produces a Windows EXE when run on Windows. Builders can return source ZIPs when native compilation is unavailable.
- **macOS and Linux locally:** corresponding builder modules and Express endpoints exist. They attempt native packaging where supported and may fall back to source ZIPs. These platforms are not currently offered as active builders in the public site UI.

Each local build is written under `builds/{buildId}/`. Build status metadata is kept in process memory, so a server restart loses the status/download mapping even if files remain. There is no automatic artifact cleanup in the current server.

## Cloudflare Pages deployment

The repository's `.github/workflows/deploy.yml` builds Astro and deploys `dist/` plus the Pages Functions in `functions/api/`. The deployed API does not run `server.js`: the Android and Windows Pages Functions trigger the `build-apk.yml` and `build-exe.yml` workflows in `bluewizardz/webtoapp`.

Configure these GitHub Actions secrets for deployment:

- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for Wrangler deployment.
- `GITHUB_PAT` as a Cloudflare Pages Function secret, with access to the configured build repository and permission to dispatch workflows and read artifacts. Windows draft release lookup/download also relies on appropriate repository contents access.
- `PUBLIC_BACKEND_URL` is passed to the Astro build as the frontend API base. If unset, the browser scripts use the current site origin.

The current Pages flow is same-origin, so it does not need a separate API host. If `PUBLIC_BACKEND_URL` points to another origin, that origin must also be allowed by the browser security policy in `public/_headers`, and the external API must allow the site origin through CORS.

The build endpoints are hard-coded to the `bluewizardz/webtoapp` repository and the `main` ref. Change those function settings and workflow references together if deploying against another repository. The Cloudflare path currently provides Android and Windows builds; the local Express macOS/Linux routes are not part of that Pages workflow.

## Generated outputs

- Local Express builds: `builds/{buildId}/`
- GitHub Actions builds: `builds-cli/{buildId}/`, uploaded as `build-{buildId}` artifacts
- Android workflow output must be an `.apk`; Windows workflow output must be an `.exe`. The CLI scripts fail the workflow when the builder falls back to a ZIP, so the Pages download path does not present that ZIP as a compiled installer.

For endpoint payloads, queue behavior, and limitations, see [BACKEND.md](BACKEND.md). For the full local and deployed request flows, see [HOW_IT_WORKS.md](HOW_IT_WORKS.md).
