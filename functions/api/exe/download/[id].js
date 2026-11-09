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
  // streams the installer from GitHub's CDN instead of proxying it through the
  // Worker, and drafts keep the builds out of the public Releases section.
  const release = await findReleaseByTag(repo, tag, headers);
  if (release) {
    const asset = (release.assets || []).find((item) => item.name.toLowerCase().endsWith('.exe'));
    if (asset) {
      const response = await assetResponse(asset, headers);
      if (response) return response;
    }
  }

  // Fallback: extract the .exe from the Actions artifact ZIP. This keeps
  // downloads working even if the token cannot see the draft release.
  return artifactDownload(repo, buildId, headers);
}

async function findReleaseByTag(repo, tag, headers) {
  // Published releases can be resolved by tag directly.
  const direct = await fetch(`${repo}/releases/tags/${tag}`, { headers });
  if (direct.ok) {
    return direct.json();
  }

  // Draft releases are only returned by the list endpoint, and only for tokens
  // with push (Contents read/write) access to the repository.
  const listRes = await fetch(`${repo}/releases?per_page=30`, { headers });
  if (!listRes.ok) return null;

  const releases = await listRes.json();
  if (!Array.isArray(releases)) return null;
  return releases.find((release) => release.tag_name === tag) || null;
}

async function assetResponse(asset, headers) {
  const assetHeaders = { ...headers, 'Accept': 'application/octet-stream' };

  // Prefer a redirect to GitHub's signed CDN URL: the browser downloads the
  // installer directly and the Worker never buffers the ~100 MB file.
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

  // Some runtimes return an opaque response for manual redirects; follow the
  // redirect and stream the bytes through instead of giving up.
  const followed = await fetch(asset.url, { headers: assetHeaders });
  if (followed.ok && followed.body) {
    return streamAsset(followed, asset);
  }

  return null;
}

function streamAsset(response, asset) {
  const headers = {
    'Content-Type': 'application/octet-stream',
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
    return new Response('Installer not found for this build', { status: 404 });
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

  const inventory = Object.keys(unzipped);
  const exeName = inventory.find((name) => name.toLowerCase().endsWith('.exe'));
  if (!exeName) {
    return new Response('EXE file not found inside downloaded ZIP archive', { status: 500 });
  }

  const exeData = unzipped[exeName];
  return new Response(exeData, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.microsoft.portable-executable',
      'Content-Disposition': `attachment; filename="${exeName.split('/').pop()}"`,
      'Content-Length': String(exeData.length),
      'Access-Control-Allow-Origin': '*'
    }
  });
}
