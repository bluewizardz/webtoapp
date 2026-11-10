# SiteToApp

SiteToApp is an Astro website and app-wrapper builder. It creates Android WebView apps and Windows desktop wrappers from a website URL. The Windows builder supports Electron and Tauri; macOS and Linux builder modules are present in the local Express backend but are not currently exposed as active site builders.

## Requirements

- Node.js 22.12 or newer and npm
- For local Android APK compilation: JDK 17, Gradle 8.12, and an Android SDK. The build helper can attempt to download some tools, but a real APK is not guaranteed on every machine.
- For local Windows compilation: a Windows build environment and the dependencies/toolchains used by Electron or Tauri. Tauri builds require Rust. Other operating systems may produce a source ZIP instead.
- Redis is optional. Android builds use BullMQ/Redis when available and otherwise use an in-memory queue.

## Run locally

```bash
npm install
npm start
```

This builds the Astro site and starts the Express server at `http://localhost:3000`. The server serves the generated `dist/` site and handles local build API requests.

For the Astro development server, use:

```bash
npm run astro:dev
```

This serves the frontend without the Express compilation API. For automatic restart of the Express server after source changes, use `npm run dev`; it rebuilds Astro and starts `server.js` with Node's watch mode.

Create a static site build with `npm run build`. This produces `dist/`; it does not start the Express build backend.

## Deployment model

The Cloudflare Pages deployment serves the Astro output and runs the functions in `functions/api/`. Its Android and Windows build endpoints dispatch workflows in the configured GitHub repository. GitHub Actions compiles the artifacts, and Pages functions poll and provide downloads. Deployment therefore needs Cloudflare credentials and a `GITHUB_PAT` secret with access to the build repository. The deployment workflow also accepts `PUBLIC_BACKEND_URL` as a build secret for configuring the browser API base.

This differs from local execution: local requests go to Express and use the local machine's build tools; the deployed Pages flow uses GitHub Actions. See [SETUP](docs/SETUP.md) for commands and deployment requirements, [BACKEND](docs/BACKEND.md) for routes and builder behavior, [HOW_IT_WORKS](docs/HOW_IT_WORKS.md) for the request flows, and [DESIGN](docs/DESIGN.md) for the UI reference.

## Project layout

- `src/pages/`, `src/layouts/`, `src/components/`: Astro pages and shared UI
- `src/styles/`, `src/scripts/`: frontend styles and builder behavior
- `public/`: static assets, headers, robots file, and sitemap
- `functions/api/`: Cloudflare Pages Functions for health, favicon, and GitHub Actions build/status/download proxying
- `server.js`, `queue-manager.js`, `builders/`: local Express API, Android queue, and platform project builders
- `.github/workflows/`: Cloudflare deployment and Android/Windows build workflows
- `cli-build-apk.js`, `cli-build-exe.js`: workflow command-line build entry points
- `docs/`: setup, backend, architecture, and design documentation

Generated build artifacts are written under `builds/` locally and `builds-cli/` in GitHub Actions. These directories are ignored by Git.
