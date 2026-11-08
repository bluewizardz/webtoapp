# SiteToApp — Design System & UI Reference

This document describes the visual language and interface of the SiteToApp website as it exists today. It is a reference for anyone extending the site: tokens live in `src/styles/styles.css`, the shared shell lives in `src/layouts/Layout.astro`, and each page's markup lives in `src/pages/`.

---

## 1. Product & Voice

SiteToApp turns a website URL into a downloadable native app project. The interface is aimed at pragmatic, non-designer users (indie devs, small-business owners) and is built around three promises that appear everywhere in the copy:

- **100% Free** — no subscriptions, no hidden fees
- **No Login Required** — no accounts, no friction
- **Android First** — Android is live; macOS, Windows, and Linux are shown as "Coming Soon"

Tone is confident, plain-spoken, and benefit-led. Headlines use short declarative sentences ("Your website. **As a native application.**"), supporting copy explains *why* in one or two sentences, and all micro-labels (badges, field labels, legends, status chips) are uppercase with wide letter-spacing.

---

## 2. Design Principles

1. **Dark-first, developer-flavored.** The default surface is a near-black navy canvas with flat panels and hairline borders — closer to a code editor or Vercel dashboard than a marketing site. A full light theme is available and equally deliberate.
2. **Flat, low-chrome surfaces.** No glossy gradients, glows, or drop-shadow stacks on large surfaces. Depth comes from a 1px border plus one shadow token; elevation increases only on hover.
3. **Two accent colors, strictly assigned.** Green (`#3ddc84`, "Android green") means *primary action / success / active*. Indigo (`#6366f1`) means *focus / brand / links*. Everything else is neutral gray-blue.
4. **Pills and cards.** Status, badges, progress, and navigation all use fully rounded (999px) capsules; content lives in 16px-radius cards.
5. **Information density without clutter.** The builder screen shows config, a live phone preview, and build metadata side by side, separated by borders rather than containers inside containers.

---

## 3. Color

### 3.1 Dark theme (default)

| Token | Value | Role |
| --- | --- | --- |
| `--background` | `#090d16` | Page canvas |
| `--foreground` | `#f8fafc` | Primary text |
| `--accents-1` | `#111827` | Card / panel surface |
| `--accents-2` | `#0b0f19` | Sunken wells, inputs, code blocks |
| `--accents-3` | `#1f2937` | Borders, dividers |
| `--accents-4` | `#374151` | Interactive / hover borders |
| `--accents-5` | `#9ca3af` | Muted text, labels, placeholders |
| `--accents-6` | `#d1d5db` | Secondary text, body copy |
| `--accents-7` | `#f8fafc` | Primary highlight |
| `--accents-8` | `#ffffff` | Pure white accents |

### 3.2 Light theme (`.light-theme` on `<html>`)

| Token | Value |
| --- | --- |
| `--background` | `#f3f4f6` |
| `--foreground` | `#0f172a` |
| `--accents-1` | `#ffffff` |
| `--accents-2` | `#f9fafb` |
| `--accents-3` | `#e5e7eb` |
| `--accents-4` | `#cbd5e1` |
| `--accents-5` | `#6b7280` |
| `--accents-6` | `#374151` |

Light theme is not just an inversion: shadows get much softer (`--shadow-lg` drops from a 25px to a 20px blur), the ambient glow weakens, and button surfaces become white cards.

### 3.3 Semantic & accent colors

| Token | Value | Use |
| --- | --- | --- |
| `--primary-color` | `#3ddc84` | Primary buttons, progress fill, checked states, active toggle |
| `--primary-gradient` | `linear-gradient(135deg,#3ddc84,#0ea5e9)` | Reserved for accents/brand moments |
| `--primary-btn-text` | `#090d16` (`#0f172a` in light) | Text on green |
| `--success` / `--success-light` | `#10b981` / `#34d399` | Active badge, success banner, completed status |
| `--warning` | `#f59e0b` | Warning banner icon, pending status dot |
| `--error` / `--error-light` | `#ef4444` / `#f87171` | Validation text, remove-icon button, error status |
| Indigo | `#6366f1`, `#4f46e5` (light), hover `#818cf8` | Brand logo, input focus ring, retry link |
| `--glow-color` | `rgba(99,102,241,.08)` (light `.05`) | Radial wash at top of page |

Platform tints used only in the Platform grid icons: Android `#3ddc84`, macOS `#a3aaae`, Windows `#0078d7`, Linux `#fcc729`. Feature icons: blue `#0070f3`, amber `#f5a623`, gray `#a3aaae`.

Gradients are used in exactly one announced place: the hero headline is `linear-gradient(135deg, foreground 30%, accents-5 100%)` clipped to text.

---

## 4. Typography

- **Family:** Geist (variable woff2, weights 300–800), self-hosted at `/fonts/geist-variable.woff2` and preloaded in `Layout.astro`. Fallbacks: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`. A `--font-mono: 'Geist Mono'` token exists but is not currently used.
- **Base size:** 16px, body line-height 1.5 (long-form copy 1.6–1.8).

| Role | Size / weight / tracking |
| --- | --- |
| Hero `h1` | 72px (4.5rem) / 900 / −0.04em, line-height 1.1 |
| Page title (`.content-panel h1`) | 38px (2.4rem) / 900 / −0.04em |
| Section heading `h2` | 35px (2.2rem) / 900 / −0.03em |
| Card title | 25.6px (1.6rem) / 800 / −0.02em |
| Panel heading | 22.4px (1.4rem) / 800 |
| Feature title | 20px (1.25rem) / 800 |
| Hero subtitle | 20px / 400, muted (`--accents-6`) |
| Body copy | 15–16px / 400 |
| Buttons | 15.2px (0.95rem) / 700; small 12.8px / 700 |
| Field labels, legends, badges | 12–13.6px / 700–800, uppercase, letter-spacing 0.05–0.1em |
| Helper text (`small`) | 12.8–13px, `--accents-5` |
| Footer / copyright | 13.6px, `--accents-5` |

Headlines lean on weight and negative tracking rather than size alone; nothing uses italics.

---

## 5. Space, Shape, Depth

- **Spacing:** 4px-based. Component padding 12–16px, card padding 40px (24/16px on mobile), section padding 80–100px vertical desktop, 40–60px mobile. Panels inside the builder use 40px padding.
- **Radii:** `--border-radius: 12px` for buttons; 10px for inputs, icon buttons, small cards; 16px for cards and panels; 20–24px for the phone mockup; 999px for pills and badges.
- **Shadows:** `--shadow-sm` (1px lift), `--shadow-md` (cards), `--shadow-lg` (panels, hover state). All are low-opacity neutrals.
- **Borders:** every surface gets a 1px `--accents-3` border; interaction changes border to `--accents-4`.
- **Motion:** `--transition: all .2s cubic-bezier(.4,0,.2,1)`. Primary buttons lift −2px on hover, secondary −1px; cards lift −4px; the logo, form, nav, and footer do not animate.

---

## 6. Shell & Navigation

- **Navbar** (`.navbar`): 64px tall, sticky, `rgba(9,13,22,.85)` in dark (`rgba(243,244,246,.85)` light) with a 12px backdrop blur, 1px bottom border, and a subtle shadow.
  - **Brand** left: 20px outline phone icon in indigo + "SiteToApp" at 20px/800, tracking −0.03em.
  - **Segmented nav** (`.nav-links`): an inset pill group on `--accents-2` containing *Overview* and *Android APK*, with the active item rendered as a raised card on `--accents-1`. A disabled "iOS (Soon)" item sits at the end.
  - **Actions** right: icon-only theme toggle (sun in dark, moon in light) and a small secondary "Buy Me a Coffee" button with cup icon.
- **Footer**: full-width card surface with top border, 48px padding; centered row of links (About Us, FAQ, Privacy Policy, Contact Support → mailto) above a muted copyright line. `margin-top: auto` keeps it pinned on short pages.
- **Page width:** content maxes at 1200px; long-form panels max at 800px; the hero column maxes at 900px.

---

## 7. Components

### Buttons
- `.btn-primary` — solid green with near-black text; hover brightens 5% and lifts; disabled becomes flat `--accents-3` with muted text.
- `.btn-secondary` — panel-colored surface, 1px border, secondary text; hover raises contrast with the surface and text.
- `.btn-small` — 8×16px padding, 8px radius (used in navbar and history header).
- `.icon-button` / `.icon-remove-btn` — square 36px control and red-tinted destructive chip with icon + label.

### Badges & status
- `.badge-success` / `.badge-neutral` — uppercase capsules with a 6px leading dot (green = Active, gray = Coming Soon). Hero uses three tinted badges for "Android Builder Live", "No Login Required", "100% Free".
- `.status-pill` — build metadata chip with `data-status` variants: `completed` (green dot), `pending` (amber, pulsing), `error` (red). Falls back to a neutral "Ready".

### Cards
- `.platform-card` — 16px radius, 40px padding, icon + badge header, title, description, footer CTA. Active cards are links that lift on hover; `.disabled-card` drops to 50% opacity on the sunken surface with `cursor: not-allowed`.
- `.feature-item` — flat 3-up card; deliberately does **not** animate on hover.
- `.content-panel` — 800px max, 48px padding, 16px radius, used by About / FAQ / Privacy; headings stack at 32px top margin.

### Forms (builder)
- `.field` — uppercase 13.6px label 8px above the input; inputs are 46px tall, 10px radius, sunken `--accents-2`, 16px horizontal padding. Focus turns the border indigo and adds a 3px indigo ring at 15% alpha.
- `.field-grid` — 1fr + 100px (App Name / Version); `.inline-control` — 1fr + auto (App ID + "Auto" button).
- `.check-row` — full-width tappable label card with custom 22px checkbox: `--accents-4` border, green fill with white check mark when checked, scale 1.05 pop, 8px green glow; focus-visible gets a 2px indigo outline.
- `.toggle-switch` — 44×24 pill, 20px knob, green when on; used for "Auto Fetch Website Icon" and disabled (45% opacity, non-interactive) once an icon is uploaded manually.
- File input — native control restyled via `::file-selector-button` into a bordered secondary button, paired with a red "Remove" chip.
- `.icon-fetch-container` — card holding the favicon toggle plus a 48px preview well that shows a neutral website glyph, a spinner while the favicon loads, or the fetched image. The favicon is refetched shortly after the URL stops changing, so editing the URL updates the icon without a reload.
- `.info-banner` (green, informational) and `.warning-banner` (amber, Play Protect notice) — icon + rich text, 12px radius, tinted 4–5% backgrounds.

### Feedback & progress
- `.build-progress` — sunken card with an 8px track and green fill, plus a bold status line; hidden until a build starts.
- `.build-success` — green-tinted confirmation card with check icon and "Build Successful! Your APK is downloading.", followed by `.build-retry` link.
- `.build-history` — list of `.history-item` rows (name, dot-separated meta, green "Download" link), newest first, with a "Clear" secondary button; empty state renders `.history-empty`. Persisted in `localStorage` under `sitetapp_build_history` (max entries enforced in `src/scripts/app.js`).
- `.validation` — `aria-live="polite"` red 13.6px line below the submit button for inline errors.

### Phone preview
A 220×360 Samsung-S24-style mockup (`aria-hidden`), built entirely in CSS: 3px `#3a3d45` frame on a dark gradient body, punch-hole camera, mini status bar with time and icons, and a bottom nav pill. Inside the 20px-radius screen the app icon (or a green tile with a neutral website glyph), app name, and URL are centered and ellipsized single-line. Simulated behaviors: a 2px green loading line (`#screenProgress`), a bouncing pull-to-refresh circle, a splash overlay with the app icon tile, and the status/nav bars collapsing in full-screen mode. Only the screen content is dynamic; the chrome is fixed.

---

## 8. Pages

| Route | Body class | Composition |
| --- | --- | --- |
| `/` | `landing-page` | Hero (badge row → 72px headline → muted subtitle → green primary + bordered secondary CTAs) · "Supported Platforms" 2×2 grid · 3-up feature row (Zero Server Costs, High Performance, Workspace Access) |
| `/android` | `builder-page` | 1.15fr / 0.85fr workspace. Left: "App Configuration" form — URL, name/version, package ID, icon upload + auto-fetch, Interface Settings (progress, pull-to-refresh, zoom), Visual & Launch Options (splash + duration, full screen), Advanced (user agent), build-time info banner, primary submit, success/retry, progress, validation. Right: phone preview, "Build Metadata" (name / ID / platform with status pill), Build History, and a "how it builds" list with the Play Protect warning |
| `/about` | `landing-page` | Content panel: mission, zero server costs, security, support |
| `/faq` | `landing-page` | Content panel with h2-per-question; page ships FAQPage JSON-LD |
| `/privacy` | `landing-page` | Content panel: no telemetry, zero injection, secure client data, local control |

Page titles/descriptions are set per page and passed into `Layout.astro`, which also emits canonical, Open Graph, Twitter, and SoftwareApplication/FAQ JSON-LD metadata plus the Google Analytics tag.

---

## 9. Theming

- Theme is a `light-theme` class on `<html>`; tokens are overridden wholesale, so components need no theme-specific rules beyond a handful of hard-coded tints (navbar blur, icon colors, logo indigo, remove-button tint).
- An inline head script resolves theme before first paint: saved `localStorage.theme` wins, otherwise the OS `prefers-color-scheme` decides; **dark is the default when neither is available**. This prevents a flash of the wrong theme.
- The navbar toggle swaps the class and persists `"light"` / `"dark"`; the sun icon shows in dark mode, the moon in light.

---

## 10. Responsive Behavior

| Breakpoint | Changes |
| --- | --- |
| ≤ 960px | Builder workspace and platform grid collapse to one column; features stack with 20px gaps; hero headline drops to 51px |
| ≤ 600px | Nav padding tightens, breadcrumbs and the navbar CTA hide, disabled nav item hides; hero padding and headline shrink (38px), CTAs become full-width stacked buttons; field grids, output meta, and panels stack; panel padding 24/16px; icon-fetch card stacks with a larger centered preview; phone stays 220×360 |
| ≤ 400px | Brand and nav links shrink further, hero headline 27px, subtitle 15px, platform/feature padding 16–20px, phone mockup scales to 175×290 with 42px icon tiles |

Every section uses `overflow-x: hidden` guards on `html`/`body`, and long names/URLs inside the phone use single-line ellipsis instead of wrapping.

---

## 11. Accessibility Notes

Implemented: semantic `header`/`main`/`footer`/`article`/`fieldset` structure, `aria-label` on nav and major regions, `aria-hidden` on the decorative mockup, `aria-live` validation, native inputs kept in the DOM (visually hidden) so custom checkbox/toggle styling preserves keyboard and screen-reader behavior, `focus-visible` outlines on custom controls, and ≥4.5:1 contrast for body copy in both themes.

Known gaps to address when extending: there is no `prefers-reduced-motion` block (the pulsing pending dot, spinner, pull-to-refresh bounce, and hover lifts all animate), muted `--accents-5` text on `--accents-2` sits near the contrast floor at small sizes, and the phone preview's simulated state has no text alternative for screen readers.

---

## 12. Working With the System

- Add or change visual values as tokens in `:root` (and mirror them in `.light-theme`) in `src/styles/styles.css` — components already reference `var(--…)`.
- Reuse existing classes before adding new ones; the stylesheet is organized by section comments (`/* === Navbar === */`, `/* === Builder Shell Workspace === */`, etc.).
- Any new page should render inside `Layout.astro` so it inherits the shell, theme script, fonts, and SEO metadata, and should pass a distinct `title`, `description`, and appropriate `structuredData`.
- Icons are inline stroke SVGs (Feather-style, `stroke-width` 2–2.5) rather than an icon font or sprite; match that style and size (14–20px in UI, 32px in cards).
