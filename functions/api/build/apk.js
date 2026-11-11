import { validateBuildInputs } from "../../_lib/build-inputs.js";
import { putBuildRecord } from "../../_lib/build-store.js";
import {
  DEFAULT_MAX_REQUESTS,
  DEFAULT_WINDOW_SECONDS,
  checkRateLimit,
  clientKey,
  rateLimitHeaders,
  rateLimitStore
} from "../../_lib/rate-limit.js";

const OWNER = "bluewizardz";
const REPO = "webtoapp";
const WORKFLOW_ID = "build-apk.yml";

// Mirrors the Express limiter in server.js: 10 builds per 15 minutes per client.
const BUILD_RATE_LIMIT = {
  windowSeconds: DEFAULT_WINDOW_SECONDS,
  max: DEFAULT_MAX_REQUESTS
};

export async function onRequestPost(context) {
  const { request, env } = context;

  // Read request body
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "Invalid JSON request body" }, 400);
  }

  // Reject dangerous values before anything reaches the build runner.
  const { error, inputs: buildInputs } = validateBuildInputs(body);
  if (error) {
    return json({ error }, 400);
  }

  // Each build occupies a GitHub Actions runner, so requests are limited per
  // client through KV (shared by every edge isolate), not an in-memory counter.
  const limit = await checkRateLimit(
    rateLimitStore(env),
    `apk-build:${clientKey(request)}`,
    BUILD_RATE_LIMIT
  );
  const limitHeaders = rateLimitHeaders(limit);

  if (!limit.allowed) {
    return json(
      {
        error: `Too many build requests. Please try again in ${limit.retryAfter} seconds.`,
        retryAfter: limit.retryAfter,
        limit: limit.limit
      },
      429,
      limitHeaders
    );
  }

  // Trigger GitHub Actions workflow_dispatch
  const githubPat = env.GITHUB_PAT;
  if (!githubPat) {
    return json(
      { error: "Missing GITHUB_PAT environment secret in Cloudflare Pages settings" },
      500,
      limitHeaders
    );
  }

  // Generate unique build ID
  const buildId = crypto.randomUUID();

  const githubUrl = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`;

  // GitHub API expects every input as a string. The values are validated above
  // and travel to the runner as JSON, never as shell command text.
  const inputs = {
    siteUrl: buildInputs.siteUrl,
    appName: buildInputs.appName,
    appId: buildInputs.appId,
    appVersion: buildInputs.appVersion,
    pullToRefresh: String(buildInputs.pullToRefresh),
    allowZoom: String(buildInputs.allowZoom),
    showSpinner: String(buildInputs.showSpinner),
    showSplash: String(buildInputs.showSplash),
    splashDuration: String(buildInputs.splashDuration),
    fullScreen: String(buildInputs.fullScreen),
    customUserAgent: buildInputs.customUserAgent,
    buildId: buildId,
    icon: buildInputs.icon,
    autoFetchIcon: String(buildInputs.autoFetchIcon),
    allowMixedContent: String(buildInputs.allowMixedContent)
  };

  const response = await fetch(githubUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${githubPat}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "SiteToApp-Cloudflare-Bridge"
    },
    body: JSON.stringify({
      ref: "main",
      inputs: inputs
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    return json({ error: `GitHub API trigger failed: ${errorText}` }, 502, limitHeaders);
  }

  // Record the build so status polling can match this exact ID to its run.
  await putBuildRecord(env, buildId, {
    status: "pending",
    state: "queued",
    createdAt: new Date().toISOString(),
    siteUrl: buildInputs.siteUrl,
    appName: buildInputs.appName
  });

  // Return the build ID for polling
  return json({ buildId, status: "queued" }, 200, limitHeaders);
}

function json(payload, status, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders }
  });
}
