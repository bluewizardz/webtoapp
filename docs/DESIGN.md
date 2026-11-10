# SiteToApp Design Reference

This document describes the UI currently implemented by the Astro pages. The source of truth for styling is `src/styles/styles.css`, with platform-specific additions in `src/styles/android.css` and `src/styles/windows.css`. Shared page structure and theme behavior live in `src/layouts/Layout.astro`.

## Product and visual direction

The site presents website-to-app building for Android and Windows. Its current interface uses a developer-focused, dark-first visual style, a system light theme, self-hosted Geist typography, flat bordered panels, and platform-colored builder accents. macOS and Linux appear as coming-soon platforms on the home page; their local backend builders are not active site flows.

The UI copy describes the product as free and login-free. Avoid interpreting those product claims as guarantees about third-party build services, runner availability, or platform publishing fees.

## Themes and colors

The primary dark tokens are defined near the beginning of `src/styles/styles.css`:

| Token | Dark value | Use |
| --- | --- | --- |
| `--background` | `#090d16` | Main canvas |
| `--foreground` | `#f8fafc` | Primary text |
| `--accents-1` | `#111827` | Panels |
| `--accents-2` | `#0b0f19` | Inputs and recessed surfaces |
| `--accents-3` | `#1f2937` | Borders and dividers |
| `--accents-4` | `#374151` | Stronger interactive borders |
| `--accents-5` | `#9ca3af` | Muted text |
| `--accents-6` | `#d1d5db` | Secondary text |

The initial light-theme values include `--background: #f3f4f6`, `--foreground: #0f172a`, white panels, and `--accents-3: #c6cbd1`. Later theme-specific sections in the stylesheet override some values for particular UI regions; check the stylesheet before treating this table as a complete token inventory.

The Android builder uses Android green accents, including `#3ddc84` in dark mode and `#0d904f` in light mode. The Windows builder uses blue accents, including `#0078d4` in dark mode and `#0067b8` in light mode. Exact hover, focus, and component colors are defined in their respective CSS rules.

## Typography and layout

- Geist is self-hosted at `/fonts/geist-variable.woff2`; the shared layout preloads it. The Buy Me a Coffee button uses a separate self-hosted font.
- Main shells use a fluid width capped around `min(1520px, 95vw)`.
- The stylesheet uses multiple responsive breakpoints. The primary builder workspace switches to a wider two-column layout at 992px; other page sections use their own breakpoints, including 960px, 810px, 641px, and 560px. Treat component CSS as authoritative rather than assuming every section shares one breakpoint.
- Builder previews are designed to accompany the forms on desktop and stack with the content on smaller screens.
- Guides, FAQ, privacy, and editorial pages each have page-specific layouts; there is no single universal two-column rule across all content pages.

## Shared components and builder UI

`Layout.astro` supplies the header, navigation, theme toggle, footer, canonical/OG/Twitter metadata, and site-wide Organization, WebSite, and SoftwareApplication JSON-LD. Builder pages provide URL and app identity fields, a live preview, optional icon controls, advanced options, status/progress feedback, and platform-specific styling.

The CSS includes shared button, field, checkbox/toggle, panel, callout, terminal snippet, table, card, and responsive grid patterns. Available controls differ by builder: Android has WebView and splash settings; Windows has engine, installer, window size, fullscreen, and user-agent settings. Keep documented components consistent with the actual markup in `src/pages/android.astro` and `src/pages/windows.astro`.

## Page inventory

The current Astro route inventory is 12 pages:

- `/`, `/android`, and `/windows`
- `/about`, `/faq`, `/privacy`, and `/updates`
- `/guides` and four guide detail pages

`sitemap.xml` and `public/sitemap.xml` list these 12 routes. The shared layout adds site-wide structured data to every page; page-specific structured data varies. For example, FAQ has FAQ schema, guide pages use Article/HowTo/BreadcrumbList as appropriate, and updates use Blog/BlogPosting. Do not describe every schema type as present on every page.

## Maintenance notes

- Verify colors, breakpoints, and component claims against the CSS and page markup when updating this reference; the large stylesheet contains later theme overrides.
- Update the route list and sitemap claim when Astro pages are added or removed.
- Keep product availability statements aligned with the home page and builder navigation. A backend module alone does not mean a platform is exposed in the site UI.
- Security headers and static asset cache rules are configured in `public/_headers`; they are deployment settings rather than visual design tokens.
