import dns from 'dns';
import net from 'net';
import { isPrivateHost } from './input-validation.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Fetch a public http(s) resource with DNS-resolution checks, manual redirect
// validation, a timeout, and a hard cap on the buffered body size.
// Throws on any failure — callers should catch and fall back.
export async function fetchPublicBuffer(url, { timeoutMs = 8000, maxBytes = 2 * 1024 * 1024, maxRedirects = 3 } = {}) {
  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = assertFetchable(current);
    await assertPubliclyRoutable(parsed);

    const response = await fetch(current, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
      headers: { 'User-Agent': UA }
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      // Drain so the connection can be reused, then validate the redirect target.
      await response.arrayBuffer().catch(() => {});
      if (!location) throw new Error('Redirect without Location header');
      current = new URL(location, current).toString();
      continue;
    }

    if (!response.ok) throw new Error(`HTTP ${response.status} for ${current}`);

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`Response too large (content-length ${contentLength})`);
    }

    if (!response.body) {
      const buf = Buffer.from(await response.arrayBuffer());
      if (buf.length > maxBytes) throw new Error('Response too large');
      return buf;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('Response too large');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }

  throw new Error('Too many redirects');
}

function assertFetchable(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URLs with credentials are not allowed');
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error('Blocked private or internal host');
  }
  return parsed;
}

async function assertPubliclyRoutable(parsed) {
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(hostname) !== 0) return; // literal already checked by isPrivateHost
  let addresses;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('DNS lookup failed');
  }
  if (!addresses.length) throw new Error('DNS lookup returned no addresses');
  for (const { address } of addresses) {
    if (isPrivateHost(address)) {
      throw new Error('Host resolves to a private or internal address');
    }
  }
}
