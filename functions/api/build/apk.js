export async function onRequestPost(context) {
  const { request, env } = context;

  // Read request body
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid JSON request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Generate unique build ID
  const buildId = crypto.randomUUID();

  // Trigger GitHub Actions workflow_dispatch
  const githubPat = env.GITHUB_PAT;
  if (!githubPat) {
    return new Response(JSON.stringify({ error: "Missing GITHUB_PAT environment secret in Cloudflare Pages settings" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  const owner = "bluewizardz";
  const repo = "webtoapp";
  const workflowId = "build-apk.yml";

  const githubUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`;

  // Map request body fields to string values (GitHub API expects inputs as strings)
  const inputs = {
    siteUrl: body.siteUrl || "https://example.com",
    appName: body.appName || "My Web App",
    appId: body.appId || "com.example.app",
    appVersion: body.appVersion || "1.0.0",
    pullToRefresh: String(body.pullToRefresh !== false),
    showSpinner: String(body.showSpinner !== false),
    showSplash: String(body.showSplash !== false),
    splashDuration: String(body.splashDuration || "2000"),
    fullScreen: String(body.fullScreen === true),
    customUserAgent: body.customUserAgent || "",
    buildId: buildId
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
    return new Response(JSON.stringify({ error: `GitHub API trigger failed: ${errorText}` }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Return the build ID for polling
  return new Response(JSON.stringify({ buildId }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
