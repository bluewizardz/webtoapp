export async function onRequestPost(context) {
  const { request, env } = context;

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
    return new Response(JSON.stringify({ error: "Build request is too large" }), {
      status: 413,
      headers: { "Content-Type": "application/json" }
    });
  }

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

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return new Response(JSON.stringify({ error: "Request body must be a JSON object" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const icon = body.icon == null || body.icon === "" ? "" : body.icon;
  const maxIconLength = 48 * 1024;
  if (typeof icon !== "string") {
    return new Response(JSON.stringify({ error: "Icon must be a Base64 image data URL" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (icon.length > maxIconLength) {
    return new Response(JSON.stringify({ error: "Icon is too large. Choose a smaller image." }), {
      status: 413,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (icon && (
    !/^data:image\/(?:png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/i.test(icon)
    || !icon.slice(icon.indexOf(",") + 1)
  )) {
    return new Response(JSON.stringify({ error: "Icon must be a PNG, JPEG, or WebP Base64 data URL" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
  const autoFetchIcon = body.autoFetchIcon == null
    ? true
    : body.autoFetchIcon === true || body.autoFetchIcon === "true";

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
  let siteUrl = body.siteUrl || "https://example.com";
  siteUrl = String(siteUrl).trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(siteUrl)) {
    siteUrl = "https://" + siteUrl;
  }

  const inputs = {
    siteUrl: siteUrl,
    appName: body.appName || "My Web App",
    appId: body.appId || "com.example.app",
    appVersion: body.appVersion || "1.0.0",
    pullToRefresh: String(body.pullToRefresh !== false),
    allowZoom: String(body.allowZoom === true),
    showSpinner: String(body.showSpinner !== false),
    showSplash: String(body.showSplash !== false),
    splashDuration: String(body.splashDuration || "2000"),
    fullScreen: String(body.fullScreen === true),
    customUserAgent: body.customUserAgent || "",
    icon: icon,
    autoFetchIcon: String(autoFetchIcon),
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
