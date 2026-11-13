// Shared helpers for Cloudflare Pages Functions.
// Underscore-prefixed file: not routed by Pages (only files without a leading _ become routes).
// No Node.js imports — this module must stay compatible with the Workers runtime.

export const REPO_API = 'https://api.github.com/repos/bluewizardz/webtoapp';

export const isBuildId = (id) =>
  typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id);

export function json(data, { status = 200, cache = 'no-store' } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

// Reads the request body with a hard byte cap. Unlike the Content-Length check,
// this also stops chunked/absent-length uploads that would otherwise bypass it.
export async function readBodyWithLimit(request, maxBytes) {
  const len = Number(request.headers.get('content-length'));
  if (Number.isFinite(len) && len > maxBytes) return { error: 'too_large' };
  if (!request.body) return { body: new Uint8Array(0) };

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch {}
      return { error: 'too_large' };
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body };
}

// Parses JSON from raw bytes; requires a plain object, returns null otherwise.
export function parseJsonBody(bytes) {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    return null;
  } catch {
    return null;
  }
}

// ---------- Host / IP checks (Workers have no DNS API, literal checks only) ----------

function parseIpv4(host) {
  const parts = host.split('.');
  if (parts.length < 1 || parts.length > 4) return null;
  const nums = [];
  for (const part of parts) {
    if (!/^(0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(part)) return null;
    let n;
    if (/^0x/i.test(part)) n = parseInt(part, 16);
    else if (/^0[0-7]+$/.test(part)) n = parseInt(part, 8);
    else n = parseInt(part, 10);
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }
  const last = nums[nums.length - 1];
  // Fewer than 4 segments: the final segment spans the remaining bytes.
  if (last >= 256 ** (5 - nums.length)) return null;
  const bytes = [];
  for (let i = 0; i < nums.length - 1; i++) {
    if (nums[i] > 255) return null;
    bytes.push(nums[i]);
  }
  let rest = last;
  const tail = 4 - (nums.length - 1);
  for (let i = tail - 1; i >= 0; i--) {
    bytes[nums.length - 1 + i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return [bytes[0], bytes[1], bytes[2], bytes[3]];
}

export function isPrivateHost(hostname) {
  let host = String(hostname || '').trim().toLowerCase();
  if (!host) return true;
  if (host.endsWith('.')) host = host.slice(0, -1);

  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;

  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    const inner = (end === -1 ? host.slice(1) : host.slice(1, end)).toLowerCase();
    const mapped = inner.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateHost(mapped[1]);
    if (inner === '::' || inner === '::1') return true;
    const firstGroup = parseInt(inner.split(':')[0] || '0', 16);
    if (!Number.isNaN(firstGroup)) {
      if ((firstGroup & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)
      if ((firstGroup & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
    }
    return false;
  }

  const v4 = parseIpv4(host);
  if (v4) {
    const [a, b] = v4;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;               // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;     // CGNAT 100.64.0.0/10
    if (a === 198 && (b === 18 || b === 19)) return true;  // benchmarking
    if (a >= 224) return true;                             // multicast / reserved
    return false;
  }

  return false;
}

// Validates a site URL for server-side fetching: http/https only, no userinfo,
// no private/internal literal hosts, sane length. Returns the normalized URL or null.
export function saneSiteUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 2048) return null;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (isPrivateHost(url.hostname)) return null;
  return url.toString();
}

// Validates appId as a Java-style package (at least two segments).
export function isAppId(id) {
  return typeof id === 'string'
    && id.length <= 128
    && /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(id);
}

// Validates appVersion as a semver-ish string.
export function isAppVersion(v) {
  return typeof v === 'string'
    && /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{0,32})?$/.test(v);
}

// Validates appName: 1-100 chars after trimming.
export function isAppName(name) {
  return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 100;
}

export function clampInt(value, min, max, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

// ---------- GitHub helpers ----------

export function githubHeaders(githubPat, accept = 'application/vnd.github+json') {
  return {
    'Authorization': `Bearer ${githubPat}`,
    'Accept': accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SiteToApp-Cloudflare-Bridge'
  };
}

export async function githubJson(response) {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

// Finds the draft/published release for a buildId tag. Drafts are only visible
// to tokens with push access; falls back to scanning the 30 most recent releases.
export async function findReleaseByTag(repo, tag, headers) {
  try {
    const direct = await fetch(`${repo}/releases/tags/${tag}`, { headers });
    if (direct.ok) return await githubJson(direct);

    const listRes = await fetch(`${repo}/releases?per_page=30`, { headers });
    if (!listRes.ok) return null;
    const releases = await githubJson(listRes);
    if (!Array.isArray(releases)) return null;
    return releases.find((release) => release.tag_name === tag) || null;
  } catch {
    return null;
  }
}

// Returns the newest non-expired artifact for this build, or null.
// GitHub returns artifacts newest-first.
export async function findArtifact(repo, buildId, headers) {
  try {
    const res = await fetch(`${repo}/actions/artifacts?name=build-${buildId}`, { headers });
    if (!res.ok) return null;
    const data = await githubJson(res);
    const artifacts = ((data && data.artifacts) || []).filter((a) => !a.expired);
    if (artifacts.length === 0) return null;
    const first = artifacts[0];
    return { id: first.id, size_in_bytes: Number(first.size_in_bytes) || 0 };
  } catch {
    return null;
  }
}

// Finds the workflow run whose run-name is exactly `app-build-<buildId>`.
// Deterministic correlation — unlike the old "any run in an 8/12 minute window"
// heuristic, this never attributes another user's build to this one.
export async function findRunByBuildId(repo, workflowFile, buildId, headers) {
  try {
    const res = await fetch(
      `${repo}/actions/workflows/${workflowFile}/runs?event=workflow_dispatch&branch=main&per_page=20`,
      { headers }
    );
    if (!res.ok) return null;
    const data = await githubJson(res);
    const runs = (data && data.workflow_runs) || [];
    const wanted = `app-build-${buildId}`;
    return runs.find((run) => (run.display_title || run.name) === wanted) || null;
  } catch {
    return null;
  }
}

// Strips CR/LF/quotes/backslashes so an asset name cannot inject or break a
// Content-Disposition header.
export function sanitizeDisposition(name) {
  const base = String(name || 'file').split('/').pop();
  const cleaned = base.replace(/[\r\n"\\]/g, '_').trim();
  return (cleaned || 'file').slice(0, 120);
}
