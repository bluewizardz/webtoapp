// Per-build records so a build ID can be matched to its own workflow run.
//
// Records live in the same KV namespace as the rate limiter (BUILD_KV). When no
// namespace is bound (local development) they fall back to a per-isolate map.

import { rateLimitStore } from "./rate-limit.js";

export const BUILD_RECORD_TTL_SECONDS = 60 * 60;

export function buildKey(buildId) {
  return `build:${buildId}`;
}

export async function getBuildRecord(env, buildId) {
  try {
    const raw = await rateLimitStore(env).get(buildKey(buildId));
    if (!raw) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (error) {
    return null;
  }
}

export async function putBuildRecord(env, buildId, record) {
  try {
    await rateLimitStore(env).put(
      buildKey(buildId),
      JSON.stringify({
        ...record,
        buildId,
        updatedAt: new Date().toISOString()
      }),
      { expirationTtl: BUILD_RECORD_TTL_SECONDS }
    );
  } catch (error) {
    // A failed write only means status falls back to GitHub polling.
  }
}
