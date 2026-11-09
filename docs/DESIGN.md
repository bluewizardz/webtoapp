# SiteToApp — Design System & UI Reference

This document describes the visual language, layout architecture, and interface design of SiteToApp. Tokens live in `src/styles/styles.css` and `src/styles/windows.css`, the shared shell lives in `src/layouts/Layout.astro`, and each page's markup lives in `src/pages/`.

---

## 1. Product & Voice

SiteToApp turns any website URL into downloadable native app projects (Android APK and Windows EXE). The interface is tailored for developers, creators, and business owners:

- **100% Free** — no subscriptions, no hidden fees, unlimited builds
- **No Login Required** — zero accounts, instant access
- **Full Ownership** — clean boilerplate native Java (Android) and Electron/Tauri (Windows) codebases with CI/CD included

Tone is confident, clear, and benefit-led. Headlines use short declarative sentences ("Your website. **As a native application.**"), supporting copy explains the architectural value, and micro-labels (badges, field labels, legends, status chips) are crisp and uppercase.

---

## 2. Design Principles

1. **Dark-first, developer-focused.** The default canvas is a deep navy-slate background (`#090d16`) with flat panels and hairline borders. A full light theme (`#f3f4f6`) is natively supported without flash-of-unstyled-content (FOUC).
2. **Clean, professional, and non-glowing.** No neon glowing effects, blur halos, or excessive drop shadows. Elevation is defined by hairline borders (`1px solid var(--accents-3)`), subtle solid elevation (`--shadow-sm`, `--shadow-md`), and clean 3px solid focus rings.
3. **Dedicated platform color themes:**
   - **Android Builder (`.android-page`):** Consistently styled with Android's official green (`#3ddc84` in dark, `#0d904f` in light), including primary buttons, secondary hover borders, inputs on focus, checkboxes, toggle switches, progress bars, and status pills.
   - **Windows Builder (`.windows-page`):** Consistently styled with Windows 11 system accent blue (`#0078d4` in dark, `#0067b8` in light), including primary buttons, secondary hover borders, inputs on focus, select dropdowns, radio option cards, checkboxes, toggle switches, progress bars, and status pills.
4. **Adaptive space utilization & responsive containers:**
   - The shell adapts fluidly up to `min(1520px, 95vw)` on large desktop monitors.
   - When more horizontal space is available, form fields and content expand into multi-column responsive grids (`.builder-fields-row`, `.features-checkbox-grid`, `.identity-fields-row`, `.faq-grid`, `.guide-grid`).
   - Sticky previews anchor on desktop viewports (`top: 84px`), eliminating awkward vertical gaps and dead space.
5. **Interactive and engaging reading layouts:**
   - Guides feature a two-column desktop layout with a sticky Table of Contents & Quick Summary sidebar, numbered stepper cards, terminal blocks, callouts, and comparison matrices.

---

## 3. Color Palette & Tokens

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
| `--glow-color` | `transparent` | No blur glows permitted |

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
| `--glow-color` | `transparent` |

### 3.3 Platform-Specific Color Themes

#### Android Official Green (`.android-page`)
- Brand Green: `#3ddc84` (Dark mode) / `#0d904f` (Light mode)
- Hover: `#32c574` / `#0b7d44`
- Active / Pressed: `#2bb868` / `#096838`
- Focus ring: `0 0 0 3px rgba(61, 220, 132, 0.22)` (Clean solid outline, no blur)
- Border tint: `rgba(61, 220, 132, 0.3)`
- Background tint: `rgba(61, 220, 132, 0.08)`

#### Windows Fluent Blue (`.windows-page`)
- Brand Blue: `#0078d4` (Dark mode) / `#0067b8` (Light mode)
- Hover: `#106ebe` / `#005da6`
- Active / Pressed: `#005a9e` / `#004f8c`
- Focus ring: `0 0 0 3px rgba(0, 120, 212, 0.22)` (Clean solid outline, no blur)
- Border tint: `rgba(0, 120, 212, 0.35)`
- Background tint: `rgba(0, 120, 212, 0.08)`

---

## 4. Typography

- **Family:** Geist (variable woff2, weights 300–800), self-hosted at `/fonts/geist-variable.woff2` and preloaded in `Layout.astro`.
- **Code font:** Geist Mono (`var(--font-mono)`).
- **Scale:**
  - Hero `h1`: clamp(2.4rem, 5vw, 4.2rem) / weight 900
  - Section heading `h2`: clamp(1.4rem, 3vw, 2.0rem) / weight 800
  - Card titles: 1.15rem–1.35rem / weight 800
  - Body copy: 0.95rem–1.05rem / line-height 1.6–1.8
  - Microcopy / tags / badges: 0.7rem–0.8rem / weight 800, uppercase

---

## 5. Layout Architecture & Breakpoints

### 5.1 Fluid Containers
- `.shell`: `max-width: min(1520px, 95vw); margin: 0 auto; padding: 36px clamp(16px, 3vw, 36px);`
- Content panels: `max-width: 100%;` expanding gracefully to fill available viewport space without artificial narrow bottlenecks.

### 5.2 Builder Workspace Grid
- **Wide Screens (≥ 992px):** Two-column split (`1.15fr 0.85fr`) with `position: sticky; top: 84px;` for the preview panel. Form fields adapt horizontally via `.builder-fields-row`, `.identity-fields-row`, and `.features-checkbox-grid`.
- **Mobile & Tablets (< 992px):** Single column stack with tight, balanced gaps (`24px`).

### 5.3 Responsive Content Pages
- **About (`/about`):** Metric cards grid (`.about-stats-grid`) + 2-column desktop layout (`minmax(0, 1.25fr) minmax(0, 0.75fr)`).
- **FAQ (`/faq`):** Responsive auto-fit 2-column / 3-column card grid (`minmax(440px, 1fr)`).
- **Privacy Policy (`/privacy`):** Responsive layout with sticky section jump-links + expansive policy section cards.
- **Guides Hub (`/guides`):** Responsive fluid grid (`repeat(auto-fill, minmax(360px, 1fr))`) expanding across wide screens.
- **Guide Detail Pages (`/guides/*`):** Responsive two-column desktop layout with sticky TOC & summary sidebar (`280px`) + step-by-step reading flow (`minmax(0, 1fr)`).

---

## 6. Component Library

### 6.1 Buttons
- `.btn-primary`: Full solid background (Android green or Windows blue), high-contrast text, 1px hover lift, non-glowing elevation.
- `.btn-secondary`: Hairline bordered well with subtle hover accent border.
- `.btn-small`: Compact 32px height for headers and sidebars.

### 6.2 Form Controls
- Inputs: 46px height, rounded 10px, subtle background `var(--accents-2)`. Focus brings crisp platform-colored border and non-glowing 3px ring.
- Checkmarks: 22×22px custom styled checkbox. Checked state uses solid platform accent without blur glow.
- Toggle switch: 44×24px pill switch with smooth sliding knob and solid platform background on active.

### 6.3 Callout Boxes
- `.callout-tip`: Green-tinted informational box with icon.
- `.callout-info`: Blue-tinted guidance box with icon.
- `.callout-warning`: Amber-tinted warning box with icon.

### 6.4 Terminal Snippets
- `.terminal-block`: macOS/Linux window header with traffic light dots, copyable mono text block, and clean dark syntax presentation.

### 6.5 Comparison Tables
- `.comparison-table-wrap`: Horizontally scrollable container with rounded border, uppercase header row, and striped cell borders.

---

## 7. SEO & Compliance Standards

- Complete Schema.org JSON-LD graphs on all routes (`Organization`, `WebSite`, `SoftwareApplication`, `FAQPage`, `HowTo`, `Article`, `BreadcrumbList`).
- Semantic HTML tags (`<main>`, `<header>`, `<article>`, `<aside>`, `<nav>`, `<dl>`, `<dt>`, `<dd>`).
- Accurate `sitemap.xml` and `robots.txt` reflecting all 12 static routes.
- Preloaded variable fonts and WebP brand graphics for fast Core Web Vitals (LCP < 1.2s, CLS 0).
