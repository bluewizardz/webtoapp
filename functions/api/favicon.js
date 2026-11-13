// Favicon proxy used by the live icon preview.
// Mirrors the Express route in server.js so the preview also works on Cloudflare Pages.

import { saneSiteUrl, isPrivateHost } from './_lib.js';

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=86400',
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff'
};

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 1024 * 1024;   // 1 MB of page HTML is plenty to find <link rel=icon>
const MAX_IMAGE_BYTES = 512 * 1024;   // 512 KB is generous for a favicon
const MAX_REDIRECTS = 3;

// Content types we are willing to proxy. SVG is deliberately excluded: an SVG
// served from this origin with image/svg+xml is an active-content document.
const IMAGE_TYPES = /^(image\/(png|jpeg|webp|gif|x-icon|vnd\.microsoft\.icon|ico))$/i;

// Fetches a URL, following up to MAX_REDIRECTS redirects manually and
// re-validating scheme/host at every hop so a public origin cannot 302 us
// into the internal network.
async function fetchWithGuards(url) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(current, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SiteToAppFavicon/1.0)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'manual'
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (!location) return null;
      let next;
      try {
        next = new URL(location, current);
      } catch {
        return null;
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') return null;
      if (isPrivateHost(next.hostname)) return null;
      current = next.toString();
      continue;
    }
    return response;
  }
  return null; // too many redirects
}

// Reads a response body with a hard cap; aborts the stream past maxBytes.
async function readBodyCapped(response, maxBytes) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return null;
  if (!response.body) return new Uint8Array(0);

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch {}
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function findIconHref(html, baseUrl) {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
  const candidates = links
    .map((tag) => ({
      rel: (tag.match(/rel\s*=\s*["']([^"']+)["']/i) || [])[1] || '',
      href: (tag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1] || ''
    }))
    .filter((link) => link.href && /icon/i.test(link.rel));

  if (candidates.length === 0) return null;

  const preferred =
    candidates.find((link) => /apple-touch-icon/i.test(link.rel)) ||
    candidates.find((link) => /\.png(\?|$)/i.test(link.href)) ||
    candidates[0];

  try {
    const resolved = new URL(preferred.href, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    if (isPrivateHost(resolved.hostname)) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

const htmlOrNot = (type) => (type || '').toLowerCase().includes('html');

export async function onRequestGet(context) {
  const target = new URL(context.request.url).searchParams.get('url');
  if (!target) return new Response('Missing url parameter', { status: 400 });

  const siteUrl = saneSiteUrl(target);
  if (!siteUrl) {
    return new Response('A valid public http(s) url is required', { status: 400 });
  }

  const origin = new URL(siteUrl).origin;
  const sources = [];

  // 1. The icon declared in the page's HTML (largest/most appropriate first).
  try {
    const page = await fetchWithGuards(origin);
    const contentType = page ? (page.headers.get('content-type') || '') : '';
    if (page && page.ok && htmlOrNot(contentType)) {
      const htmlBytes = await readBodyCapped(page, MAX_HTML_BYTES);
      if (htmlBytes) {
        const html = new TextDecoder().decode(htmlBytes);
        const declaredIcon = findIconHref(html, origin);
        if (declaredIcon) sources.push(declaredIcon);
      }
    }
  } catch {
    // The site may block bots or be offline; fall back to the conventional locations.
  }

  // 2. Conventional /favicon.ico, then public icon services.
  sources.push(new URL('/favicon.ico', origin).toString());
  sources.push(`https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(new URL(origin).hostname)}`);
  sources.push(`https://icons.duckduckgo.com/ip3/${new URL(origin).hostname}.ico`);

  for (const source of sources) {
    try {
      const response = await fetchWithGuards(source);
      if (!response || !response.ok) continue;

      const type = (response.headers.get('content-type') || '').split(';')[0].trim();
      if (!IMAGE_TYPES.test(type)) continue;

      const body = await readBodyCapped(response, MAX_IMAGE_BYTES);
      if (!body || body.byteLength < 64) continue;

      return new Response(body, {
        status: 200,
        headers: { ...CACHE_HEADERS, 'Content-Type': type }
      });
    } catch {
      // Try the next source.
    }
  }

  return new Response('Favicon not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store' }
  });
}
