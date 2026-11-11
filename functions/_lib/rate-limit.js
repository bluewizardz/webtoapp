// Shared rate limiting for the Cloudflare Pages build endpoints.
//
// Counters live in Cloudflare KV so every edge isolate sees the same window; an
// in-memory map is only a development fallback when the binding is absent, and is
// per-isolate. KV reads/writes are not atomic, so a burst arriving at the same
// instant can slightly overshoot the limit - acceptable for abuse protection.
// Bind a KV namespace as BUILD_KV to enable the shared store.

export const DEFAULT_WINDOW_SECONDS = 15 * 60;
export const DEFAULT_MAX_REQUESTS = 10;

/** Best-effort client identity, matching how the Express server keys its limiter. */
export function clientKey(request) {
  const connectingIp = request.headers.get("cf-connecting-ip");
  if (connectingIp && connectingIp.trim()) return connectingIp.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }

  return "unknown";
}

/** In-memory store with the same async surface as a KV namespace. */
export function createMemoryStore() {
  const entries = new Map();
  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    },
    async put(key, value, options = {}) {
      const ttlSeconds = Number(options.expirationTtl) || 0;
      entries.set(key, {
        value,
        expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : Infinity
      });
    },
    async delete(key) {
      entries.delete(key);
    }
  };
}

const fallbackStore = createMemoryStore();

/**
 * Return the KV namespace when the endpoint is bound to one, otherwise the
 * in-memory development fallback.
 */
export function rateLimitStore(env) {
  const namespace = env && (env.BUILD_KV || env.BUILD_RATE_LIMIT);
  if (namespace && typeof namespace.get === "function" && typeof namespace.put === "function") {
    return namespace;
  }
  return fallbackStore;
}

export function hasSharedStore(env) {
  return rateLimitStore(env) !== fallbackStore;
}

/**
 * Fixed-window counter.
 * @returns {Promise<{allowed: boolean, limit: number, remaining: number, retryAfter: number, resetAt: number}>}
 */
export async function checkRateLimit(store, key, options = {}) {
  const windowSeconds = options.windowSeconds || DEFAULT_WINDOW_SECONDS;
  const limit = options.max || DEFAULT_MAX_REQUESTS;
  const now = Date.now();

  let record = null;
  try {
    const raw = await store.get(key);
    if (raw) {
      record = typeof raw === "string" ? JSON.parse(raw) : raw;
    }
  } catch (error) {
    record = null;
  }

  if (!record || !Number.isFinite(record.resetAt) || record.resetAt <= now) {
    const resetAt = now + windowSeconds * 1000;
    await writeRecord(store, key, { count: 1, resetAt }, windowSeconds);
    return { allowed: true, limit, remaining: limit - 1, retryAfter: 0, resetAt };
  }

  const retryAfter = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
  if (record.count >= limit) {
    return { allowed: false, limit, remaining: 0, retryAfter, resetAt: record.resetAt };
  }

  await writeRecord(store, key, { count: record.count + 1, resetAt: record.resetAt }, retryAfter);
  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - (record.count + 1)),
    retryAfter: 0,
    resetAt: record.resetAt
  };
}

async function writeRecord(store, key, record, ttlSeconds) {
  try {
    await store.put(key, JSON.stringify(record), {
      expirationTtl: Math.max(60, Math.ceil(ttlSeconds) + 60)
    });
  } catch (error) {
    // A failed write must never turn into a failed build request.
  }
}

/** Rate-limit response headers for allowed and rejected requests alike. */
export function rateLimitHeaders(result) {
  const headers = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000))
  };
  if (!result.allowed) {
    headers["Retry-After"] = String(result.retryAfter);
  }
  return headers;
}
