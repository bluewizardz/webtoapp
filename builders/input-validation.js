import path from 'path';
import net from 'net';

// ---------- format validators (throw on invalid input) ----------

const BUILD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const APP_ID_SEGMENT_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const APP_VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{0,32})?$/;

export function isBuildId(id) {
  return typeof id === 'string' && BUILD_ID_RE.test(id);
}

export function assertBuildId(id) {
  if (!isBuildId(id)) throw new Error('Invalid build id');
  return id;
}

export function isAppId(id) {
  if (typeof id !== 'string' || id.length < 3 || id.length > 128) return false;
  const segments = id.split('.');
  if (segments.length < 2) return false;
  return segments.every((s) => APP_ID_SEGMENT_RE.test(s) && s.length <= 40);
}

export function assertAppId(id) {
  if (!isAppId(id)) throw new Error('Invalid appId: must look like com.example.app');
  return id;
}

export function isAppVersion(v) {
  return typeof v === 'string' && APP_VERSION_RE.test(v);
}

export function assertAppVersion(v) {
  if (!isAppVersion(v)) throw new Error('Invalid appVersion: must be semver-like (e.g. 1.0.0)');
  return v;
}

export function isAppName(name) {
  return typeof name === 'string' && name.trim().length >= 1 && name.length <= 100;
}

export function assertAppName(name) {
  if (!isAppName(name)) throw new Error('Invalid appName: 1-100 characters required');
  return name.trim();
}

export function isSiteUrl(url) {
  if (typeof url !== 'string' || url.length > 2048) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  return !isPrivateHost(parsed.hostname);
}

export function assertSiteUrl(url) {
  if (!isSiteUrl(url)) throw new Error('Invalid siteUrl: must be a public http(s) URL');
  return url;
}

export function isPrivateHost(hostname) {
  if (!hostname) return true;
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h === '0' || h.endsWith('.local') || h.endsWith('.internal')) return true;

  // IPv6 literal (URL keeps brackets stripped in hostname? new URL('http://[::1]/').hostname === '[::1]')
  const bare = h.replace(/^\[|\]$/g, '');
  if (net.isIP(bare) === 6) {
    if (bare === '::' || bare === '::1') return true;
    const first = parseInt(bare.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    if (bare.startsWith('::ffff:')) return isPrivateHost(bare.slice(7));
    return false;
  }

  // Integer / hex / octal IPv4 (e.g. 2130706433, 0x7f.1, 0177.1)
  const asNumber = Number(h);
  if (/^(0x[0-9a-f]+|0[0-7]*|[0-9]+)(\.(0x[0-9a-f]+|0[0-7]*|[0-9]+)){0,3}$/i.test(h)) {
    if (Number.isFinite(asNumber)) return isPrivateIPv4(numberToIPv4(asNumber));
    return true;
  }

  if (net.isIP(h) === 4) return isPrivateIPv4(h);
  return false;
}

function numberToIPv4(n) {
  n = n >>> 0;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast/reserved
  return false;
}

export function assertSplashDuration(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('Invalid splashDuration');
  const clamped = Math.min(10000, Math.max(500, Math.round(n)));
  return clamped;
}

export function coerceBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

// ---------- escaping helpers ----------

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function escapeJavaString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\u2028/g, ' ')
    .replace(/\u2029/g, ' ');
}

export function escapeGradleSingleQuoted(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, ' ').replace(/\n/g, ' ');
}

export function escapeGroovyDoubleQuoted(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, ' ').replace(/\n/g, ' ');
}

export function safeFileName(name) {
  const cleaned = String(name)
    .replace(/[/\\:*?"<>|$`]/g, '')
    .replace(/\.\.+/g, '.')
    .trim()
    .slice(0, 80);
  return cleaned || 'App';
}

// Resolve `segments` against `base` and ensure the result stays inside `base`.
export function safeJoin(base, ...segments) {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(resolvedBase, ...segments);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    throw new Error('Path escapes build directory');
  }
  return resolved;
}
