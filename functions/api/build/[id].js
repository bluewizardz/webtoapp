import { getBuildRecord, putBuildRecord } from "../../_lib/build-store.js";
import { hasSharedStore } from "../../_lib/rate-limit.js";

const OWNER = "bluewizardz";
const REPO = "webtoapp";
const WORKFLOW_ID = "build-apk.yml";

const BUILD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A dispatched run takes a few seconds to show up in the runs API.
const QUEUE_GRACE_MS = 3 * 60 * 1000;
const RUN_TITLE_PREFIX = "Build APK ";

export async function onRequestGet(context) {
  const { params, env } = context;
  const buildId = String((params && params.id) || "").trim();

  if (!BUILD_ID_PATTERN.test(buildId)) {
    return json({ status: "error", error: "Invalid build ID" }, 400);
  }

  const githubPat = env.GITHUB_PAT;
  if (!githubPat) {
    return json({ status: "error", error: "Missing GITHUB_PAT secret" }, 500);
  }

  const headers = githubHeaders(githubPat);
  const record = await getBuildRecord(env, buildId);

  // A finished build never needs to be looked up again.
  if (record && (record.status === "completed" || record.status === "error")) {
    return json(record, 200);
  }

  // 1. Artifacts are uploaded as build-<buildId>, so this can only match this build.
  const artifact = await findBuildArtifact(headers, buildId);
  if (artifact) {
    const result = { status: "completed", state: "completed", buildId, artifactId: artifact.id };
    await putBuildRecord(env, buildId, { ...result, createdAt: record && record.createdAt });
    return json(result, 200);
  }

  // 2. Otherwise use the workflow run whose title carries this exact build ID.
  const run = await findBuildRun(headers, buildId);
  if (run) {
    const state = describeRun(run);
    const result = { status: state.status, state: state.state, buildId, runId: run.id };
    if (state.error) {
      result.error = state.error;
    }

    if (state.status === "completed") {
      // Success, but GitHub may not have indexed the artifact yet.
      const indexed = await findBuildArtifact(headers, buildId);
      if (!indexed) {
        return json({ status: "pending", state: "finalizing", buildId, runId: run.id }, 200);
      }
      result.artifactId = indexed.id;
    }

    if (state.status !== "pending") {
      await putBuildRecord(env, buildId, { ...result, createdAt: record && record.createdAt });
    }
    return json(result, 200);
  }

  // 3. Nothing matched yet: a fresh dispatch is still queued, an older one is gone.
  if (record) {
    const age = Date.now() - Date.parse(record.createdAt || "");
    if (!Number.isFinite(age) || age < QUEUE_GRACE_MS) {
      return json({ status: "pending", state: "queued", buildId }, 200);
    }
    return json(
      {
        status: "error",
        state: "missing",
        buildId,
        error: "Build run not found. It may have been cancelled before it started."
      },
      200
    );
  }

  // With a shared store we know every dispatched build, so an unknown ID is a 404.
  if (hasSharedStore(env)) {
    return json({ status: "error", error: "Unknown build ID" }, 404);
  }

  return json({ status: "pending", state: "queued", buildId }, 200);
}

function describeRun(run) {
  if (run.status === "completed") {
    switch (run.conclusion) {
      case "success":
        return { status: "completed", state: "completed" };
      case "cancelled":
        return { status: "error", state: "cancelled", error: "Build was cancelled" };
      case "timed_out":
        return { status: "error", state: "timed_out", error: "Build timed out" };
      case "skipped":
        return { status: "error", state: "skipped", error: "Build was skipped" };
      default:
        return {
          status: "error",
          state: run.conclusion || "failed",
          error: `Build failed (${run.conclusion || "unknown reason"})`
        };
    }
  }

  if (["queued", "requested", "waiting", "pending"].includes(run.status)) {
    return { status: "pending", state: "queued" };
  }

  return { status: "pending", state: "in_progress" };
}

function runBelongsToBuild(run, buildId) {
  const title = String(run.display_title || run.name || "");
  return title === `${RUN_TITLE_PREFIX}${buildId}` || title.includes(buildId);
}

async function findBuildArtifact(headers, buildId) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/artifacts?name=build-${buildId}&per_page=100`;
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return null;
    const data = await response.json();
    const artifacts = data.artifacts || [];
    return artifacts.find((item) => item.name === `build-${buildId}` && !item.expired) || null;
  } catch (error) {
    return null;
  }
}

async function findBuildRun(headers, buildId) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=50`;
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return null;
    const data = await response.json();
    const runs = data.workflow_runs || [];
    return runs.find((run) => runBelongsToBuild(run, buildId)) || null;
  } catch (error) {
    return null;
  }
}

function githubHeaders(githubPat) {
  return {
    "Authorization": `Bearer ${githubPat}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "SiteToApp-Cloudflare-Bridge"
  };
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
