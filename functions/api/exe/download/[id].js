export async function onRequestGet(context) {
  const { params, env } = context;
  const buildId = params.id;

  const githubPat = env.GITHUB_PAT;
  if (!githubPat) {
    return new Response('Missing GITHUB_PAT secret', { status: 500 });
  }

  // Redirect to the public release asset instead of buffering a ~100MB
  // installer through the Worker, which would blow the memory limit.
  const releaseRes = await fetch(
    `https://api.github.com/repos/bluewizardz/webtoapp/releases/tags/build-${buildId}`,
    {
      headers: {
        'Authorization': `Bearer ${githubPat}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'SiteToApp-Cloudflare-Bridge'
      }
    }
  );

  if (!releaseRes.ok) {
    return new Response('Installer not found for this build', { status: 404 });
  }

  const release = await releaseRes.json();
  const asset = (release.assets || []).find((item) => item.name.toLowerCase().endsWith('.exe'));

  if (!asset) {
    return new Response('Installer asset missing from release', { status: 404 });
  }

  return new Response(null, {
    status: 302,
    headers: {
      'Location': asset.browser_download_url,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
