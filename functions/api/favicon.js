// Favicon proxy used by the live icon preview.
// Mirrors the Express route in server.js so the preview also works on Cloudflare Pages,
// where the site is served by functions/ rather than the Node backend.

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=86400",
  "Access-Control-Allow-Origin": "*"
};

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 200000;

function isPrivateHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host === "0.0.0.0" || host === "[::1]") return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  return false;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

function findIconHref(html, baseUrl) {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
  const candidates = links
    .map((tag) => ({
      rel: (tag.match(/rel\s*=\s*["']([^"']+)["']/i) || [])[1] || "",
      href: (tag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1] || ""
    }))
    .filter((link) => link.href && /icon/i.test(link.rel));

  if (candidates.length === 0) return null;

  const preferred =
    candidates.find((link) => /apple-touch-icon/i.test(link.rel)) ||
    candidates.find((link) => /\.png(\?|$)/i.test(link.href)) ||
    candidates[0];

  try {
    const resolved = new URL(preferred.href, baseUrl);
    if (!["http:", "https:"].includes(resolved.protocol)) return null;
    return resolved.toString();
  } catch (error) {
    return null;
  }
}

export async function onRequestGet(context) {
  const target = new URL(context.request.url).searchParams.get("url");
  if (!target) {
    return new Response("Missing url parameter", { status: 400 });
  }

  let siteUrl;
  try {
    siteUrl = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? target : `https://${target}`);
  } catch (error) {
    return new Response("Invalid url", { status: 400 });
  }

  if (!["http:", "https:"].includes(siteUrl.protocol) || isPrivateHost(siteUrl.hostname)) {
    return new Response("Unsupported url", { status: 400 });
  }

  const origin = siteUrl.origin;
  const sources = [];

  // 1. The icon declared in the page's HTML (largest/most appropriate first).
  try {
    const page = await fetchWithTimeout(origin, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SiteToAppFavicon/1.0)" }
    });
    const contentType = page.headers.get("content-type") || "";
    if (page.ok && contentType.includes("html")) {
      const html = (await page.text()).slice(0, MAX_HTML_BYTES);
      const declaredIcon = findIconHref(html, origin);
      if (declaredIcon) sources.push(declaredIcon);
    }
  } catch (error) {
    // The site may block bots or be offline; the fallbacks below still apply.
  }

  // 2. Conventional /favicon.ico, then public icon services.
  sources.push(new URL("/favicon.ico", origin).toString());
  sources.push(`https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(siteUrl.hostname)}`);
  sources.push(`https://icons.duckduckgo.com/ip3/${siteUrl.hostname}.ico`);

  for (const source of sources) {
    try {
      const response = await fetchWithTimeout(source, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!response.ok) continue;

      const type = response.headers.get("content-type") || "";
      if (!/image|icon/i.test(type)) continue;

      const body = await response.arrayBuffer();
      if (body.byteLength < 64) continue;

      return new Response(body, {
        status: 200,
        headers: {
          ...CACHE_HEADERS,
          "Content-Type": /^image\//i.test(type) ? type : "image/x-icon"
        }
      });
    } catch (error) {
      // Try the next source.
    }
  }

  return new Response("Favicon not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" }
  });
}
