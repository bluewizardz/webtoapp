# SiteToApp

SiteToApp is an Astro website with a Node.js/Express backend for generating downloadable website-to-app projects. The web interface and static pages live in `src/`; build APIs and platform builders live in `server.js` and `builders/`.

## Requirements

- Node.js 22.12 or newer
- npm
- Redis is optional; the build queue falls back to an in-memory queue when Redis is unavailable

## Run locally

```bash
npm install
npm run dev
```

The site is available at `http://localhost:3000`.

To create a production static build, run:

```bash
npm run build
```

To build and start the production server, run `npm start`.

## Project layout

- `src/pages/` and `src/layouts/`: Astro pages and shared layout
- `src/styles/` and `src/scripts/`: application styles and client-side behavior
- `public/`: static assets, `robots.txt`, and sitemap
- `server.js` and `builders/`: build API and app-generation modules
- `builds/`: generated build output
- `docs/`: setup, backend, workflow, and design documentation

See [docs/SETUP.md](docs/SETUP.md) for setup details and [docs/DESIGN.md](docs/DESIGN.md) for the UI reference.