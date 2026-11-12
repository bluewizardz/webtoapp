import { unzipSync } from 'fflate';

export async function onRequestGet(context) {
  const { params, env } = context;
  const buildId = params.id;

  const githubPat = env.GITHUB_PAT;
  if (!githubPat) {
    return new Response('Missing GITHUB_PAT secret', { status: 500 });
  }

  const headers = {
    'Authorization': `Bearer ${githubPat}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SiteToApp-Cloudflare-Bridge'
  };

  const repo = 'https://api.github.com/repos/bluewizardz/webtoapp';
  const tag = `build-${buildId}`;

  // Preferred path: redirect to the signed URL of the draft release asset. This
  // streams the APK from GitHub's CDN instead of proxying it through Cloudflare.
  const release = await findReleaseByTag(repo, tag, headers);
  if (release) {
    const asset = (release.assets || []).find((item) => item.name.toLowerCase().endsWith('.apk'));
    if (asset) {
      const response = await assetResponse(asset, headers);
      if (response) return response;
    }
  }

  // Fallback: extract the .apk from the Actions artifact ZIP.
  return artifactDownload(repo, buildId, headers);
}

async function findReleaseByTag(repo, tag, headers) {
  const direct = await fetch(`${repo}/releases/tags/${tag}`, { headers });
  if (direct.ok) {
    return direct.json();
  }

  const listRes = await fetch(`${repo}/releases?per_page=30`, { headers });
  if (!listRes.ok) return null;

  const releases = await listRes.json();
  if (!Array.isArray(releases)) return null;
  return releases.find((release) => release.tag_name === tag) || null;
}

async function assetResponse(asset, headers) {
  const assetHeaders = { ...headers, 'Accept': 'application/octet-stream' };

  const manual = await fetch(asset.url, { headers: assetHeaders, redirect: 'manual' });
  const location = manual.headers.get('Location') || manual.headers.get('location');
  if (location) {
    return new Response(null, {
      status: 302,
      headers: {
        'Location': location,
        'Content-Disposition': `attachment; filename="${asset.name}"`,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  if (manual.ok && manual.body) {
    return streamAsset(manual, asset);
  }

  const followed = await fetch(asset.url, { headers: assetHeaders });
  if (followed.ok && followed.body) {
    return streamAsset(followed, asset);
  }

  return null;
}

function streamAsset(response, asset) {
  const headers = {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': `attachment; filename="${asset.name}"`,
    'Access-Control-Allow-Origin': '*'
  };

  const length = response.headers.get('Content-Length');
  if (length) headers['Content-Length'] = length;

  return new Response(response.body, { status: 200, headers });
}

async function artifactDownload(repo, buildId, headers) {
  const artifactsRes = await fetch(
    `${repo}/actions/artifacts?name=build-${buildId}`,
    { headers }
  );

  if (!artifactsRes.ok) {
    return new Response(`Failed to search artifacts: ${await artifactsRes.text()}`, { status: 502 });
  }

  const artifacts = (await artifactsRes.json()).artifacts || [];
  if (artifacts.length === 0) {
    return new Response('APK not found for this build', { status: 404 });
  }

  const zipRes = await fetch(
    `${repo}/actions/artifacts/${artifacts[0].id}/zip`,
    { headers }
  );

  if (!zipRes.ok) {
    return new Response(`Failed to download zip: ${await zipRes.text()}`, { status: 502 });
  }

  let unzipped;
  try {
    unzipped = unzipSync(new Uint8Array(await zipRes.arrayBuffer()));
  } catch (err) {
    return new Response(`Failed to decompress ZIP artifact: ${err.message}`, { status: 500 });
  }

  const apkName = Object.keys(unzipped).find((name) => name.toLowerCase().endsWith('.apk'));
  if (!apkName) {
    return new Response('APK file not found inside downloaded ZIP archive', { status: 500 });
  }

  const apkData = unzipped[apkName];
  return new Response(apkData, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': `attachment; filename="${apkName.split('/').pop()}"`,
      'Content-Length': String(apkData.length),
      'Access-Control-Allow-Origin': '*'
    }
  });
}