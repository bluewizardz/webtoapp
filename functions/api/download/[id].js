import { unzipSync } from 'fflate';

const OWNER = 'bluewizardz';
const REPO = 'webtoapp';
const BUILD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestGet(context) {
  const { params, env } = context;
  const buildId = String((params && params.id) || '').trim();

  if (!BUILD_ID_PATTERN.test(buildId)) {
    return new Response('Invalid build ID', { status: 400 });
  }

  const githubPat = env.GITHUB_PAT;
  if (!githubPat) {
    return new Response("Missing GITHUB_PAT secret", { status: 500 });
  }

  const headers = {
    "Authorization": `Bearer ${githubPat}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "SiteToApp-Cloudflare-Bridge"
  };

  // Step 1: Find the artifact belonging to this build ID only.
  const artifactsUrl = `https://api.github.com/repos/${OWNER}/${REPO}/actions/artifacts?name=build-${buildId}&per_page=100`;
  const artifactsRes = await fetch(artifactsUrl, { headers });

  if (!artifactsRes.ok) {
    return new Response(`Failed to search artifacts: ${await artifactsRes.text()}`, { status: 502 });
  }

  const artifactsData = await artifactsRes.json();
  const artifact = (artifactsData.artifacts || []).find(
    (item) => item.name === `build-${buildId}` && !item.expired
  );
  if (!artifact) {
    return new Response("Artifact not found", { status: 404 });
  }

  // Step 2: Download the artifact ZIP archive
  const downloadUrl = `https://api.github.com/repos/${OWNER}/${REPO}/actions/artifacts/${artifact.id}/zip`;
  const downloadRes = await fetch(downloadUrl, { headers });

  if (!downloadRes.ok) {
    return new Response(`Failed to download zip: ${await downloadRes.text()}`, { status: 502 });
  }

  const zipBuffer = await downloadRes.arrayBuffer();

  // Step 3: Extract the APK from the ZIP using fflate
  let unzipped;
  try {
    unzipped = unzipSync(new Uint8Array(zipBuffer));
  } catch (err) {
    return new Response(`Failed to decompress ZIP artifact: ${err.message}`, { status: 500 });
  }

  const apkFilename = Object.keys(unzipped).find((name) => name.endsWith('.apk'));
  if (!apkFilename) {
    return new Response("APK file not found inside downloaded ZIP archive", { status: 500 });
  }

  const apkData = unzipped[apkFilename];

  // The file name comes from an archive, so it is reduced to a safe header value.
  const safeFilename = apkFilename.split(/[\\/]/).pop().replace(/[^A-Za-z0-9._-]/g, '_') || 'app.apk';

  // Step 4: Stream the APK file back with correct headers
  return new Response(apkData, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Content-Length": String(apkData.length),
      "Access-Control-Allow-Origin": "*"
    }
  });
}
