export async function onRequestGet(context) {
  const { params, env } = context;
  const buildId = params.id;

  const githubPat = env.GITHUB_PAT;
  if (!githubPat) {
    return new Response(JSON.stringify({ error: "Missing GITHUB_PAT secret" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  const owner = "bluewizardz";
  const repo = "webtoapp";

  // Step 1: Check if the artifact named build-${buildId} exists
  const artifactsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/artifacts?name=build-${buildId}`;
  const artifactsRes = await fetch(artifactsUrl, {
    headers: {
      "Authorization": `Bearer ${githubPat}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "SiteToApp-Cloudflare-Bridge"
    }
  });

  if (artifactsRes.ok) {
    const artifactsData = await artifactsRes.json();
    if (artifactsData.artifacts && artifactsData.artifacts.length > 0) {
      // Artifact exists! Build is completed successfully
      return new Response(JSON.stringify({ status: "completed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  // Step 2: Artifact doesn't exist yet, check workflow runs to see if a run is currently active
  const runsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/build-apk.yml/runs?event=workflow_dispatch&per_page=5`;
  const runsRes = await fetch(runsUrl, {
    headers: {
      "Authorization": `Bearer ${githubPat}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "SiteToApp-Cloudflare-Bridge"
    }
  });

  if (runsRes.ok) {
    const runsData = await runsRes.json();
    const runs = runsData.workflow_runs || [];

    // Find if there is a run that was started recently (last 8 minutes)
    const recentRun = runs.find(run => {
      const createdTime = new Date(run.created_at).getTime();
      const now = Date.now();
      return (now - createdTime) < 8 * 60 * 1000; // Triggered in the last 8 minutes
    });

    if (recentRun) {
      if (recentRun.status === "completed") {
        if (recentRun.conclusion === "success") {
          // If the run succeeded but we didn't find the artifact yet, it might be in the process of index propagation
          return new Response(JSON.stringify({ status: "pending" }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        } else {
          // Run failed
          return new Response(JSON.stringify({ status: "error", error: "Workflow compilation failed" }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
      } else {
        // Run is queued, in_progress, etc.
        return new Response(JSON.stringify({ status: "pending" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
  }

  // Default fallback is pending (assume it is starting up or in queue)
  return new Response(JSON.stringify({ status: "pending" }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
