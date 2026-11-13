import { unzipSync } from 'fflate';
import {
  isBuildId, githubHeaders, REPO_API, findReleaseByTag, findArtifact, sanitizeDisposition
} from '../_lib.js';

const MAX_ARTIFACT_BYTES = 80 * 1024 * 1024; // Pages Functions are memory-limited

function textError(message, status) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function onRequestGet(context) {
  const { params, env } = context;
  const buildId = params && params.id;

  if (!isBuildId(buildId)) return textError('Invalid build id', 400);
  if (!env.GITHUB_PAT) return textError('Download service is not configured', 500);

  try {
    const headers = githubHeaders(env.GITHUB_PAT);

    // Preferred path: redirect to the signed URL of the draft release asset.
    const release = await findReleaseByTag(REPO_API, `build-${buildId}`, headers);
    if (release) {
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const asset = assets.find((item) => item.name && item.name.toLowerCase().endsWith('.apk'));
      if (asset) {
        const response = await assetResponse(asset, headers);
        if (response) return response;
      }
    }

    // Fallback: extract the .apk from the Actions artifact ZIP.
    return artifactDownload(REPO_API, buildId, headers);
  } catch {
    return textError('Download is temporarily unavailable', 502);
  }
}

async function assetResponse(asset, headers) {
  const assetHeaders = { ...headers, 'Accept': 'application/octet-stream' };
  const filename = sanitizeDisposition(asset.name);

  const manual = await fetch(asset.url, { headers: assetHeaders, redirect: 'manual' });
  const location = manual.headers.get('Location') || manual.headers.get('location');
  if (location) {
    return new Response(null, {
      status: 302,
      headers: {
        'Location': location,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  if (manual.ok && manual.body) return streamAsset(manual, filename, 'application/vnd.android.package-archive');

  const followed = await fetch(asset.url, { headers: assetHeaders });
  if (followed.ok && followed.body) return streamAsset(followed, filename, 'application/vnd.android.package-archive');

  return null;
}

function streamAsset(response, filename, contentType) {
  const headers = {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*'
  };
  const length = response.headers.get('Content-Length');
  if (length) headers['Content-Length'] = length;
  return new Response(response.body, { status: 200, headers });
}

async function artifactDownload(repo, buildId, headers) {
  const artifact = await findArtifact(repo, buildId, headers);
  if (!artifact) return textError('APK not found for this build', 404);
  if (artifact.size_in_bytes > MAX_ARTIFACT_BYTES) {
    return textError('Build artifact is too large to serve through this endpoint', 413);
  }

  const zipRes = await fetch(`${repo}/actions/artifacts/${artifact.id}/zip`, { headers });
  if (!zipRes.ok) return textError('Failed to fetch the build artifact', 502);

  let unzipped;
  try {
    unzipped = unzipSync(new Uint8Array(await zipRes.arrayBuffer()));
  } catch {
    return textError('Failed to decompress the build artifact', 500);
  }

  const apkName = Object.keys(unzipped).find((name) => name.toLowerCase().endsWith('.apk'));
  if (!apkName) return textError('APK not found inside the build artifact', 500);

  const apkData = unzipped[apkName];
  return new Response(apkData, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': `attachment; filename="${sanitizeDisposition(apkName)}"`,
      'Content-Length': String(apkData.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
