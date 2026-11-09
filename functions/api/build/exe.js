export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: 'Invalid JSON request body' }, 400);
  }

  const githubPat = env.GITHUB_PAT;
  if (!githubPat) {
    return json({ error: 'Missing GITHUB_PAT environment secret in Cloudflare Pages settings' }, 500);
  }

  const buildId = crypto.randomUUID();

  let siteUrl = String(body.siteUrl || '').trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(siteUrl)) {
    siteUrl = 'https://' + siteUrl;
  }

  const width = clampInt(body.windowWidth, 800, 3840, 1200);
  const height = clampInt(body.windowHeight, 600, 2160, 800);
  const installerType = body.installerType === 'portable' ? 'portable' : 'nsis';

  const inputs = {
    siteUrl: siteUrl,
    appName: body.appName || 'My Web App',
    appId: body.appId || 'com.example.app',
    appVersion: body.appVersion || '1.0.0',
    installerType: installerType,
    windowWidth: String(width),
    windowHeight: String(height),
    fullScreen: String(body.fullScreen === true),
    customUserAgent: body.customUserAgent || '',
    buildId: buildId
  };

  const response = await fetch(
    'https://api.github.com/repos/bluewizardz/webtoapp/actions/workflows/build-exe.yml/dispatches',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${githubPat}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'SiteToApp-Cloudflare-Bridge'
      },
      body: JSON.stringify({ ref: 'main', inputs: inputs })
    }
  );

  if (!response.ok) {
    return json({ error: `GitHub API trigger failed: ${await response.text()}` }, 502);
  }

  return json({ buildId }, 200);
}

function clampInt(value, min, max, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
