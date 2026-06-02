import { unzipSync } from 'fflate';

export async function onRequestGet(context) {
  const { params, env } = context;
  const buildId = params.id;

  const githubPat = env.GITHUB_PAT;
  if (!githubPat) {
    return new Response("Missing GITHUB_PAT secret", { status: 500 });
  }

  const owner = "bluewizardz";
  const repo = "webtoapp";

  // Step 1: Find the artifact matching the build ID
  const artifactsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/artifacts?name=build-${buildId}`;
  const artifactsRes = await fetch(artifactsUrl, {
    headers: {
      "Authorization": `Bearer ${githubPat}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "SiteToApp-Cloudflare-Bridge"
    }
  });

  if (!artifactsRes.ok) {
    return new Response(`Failed to search artifacts: ${await artifactsRes.text()}`, { status: 502 });
  }

  const artifactsData = await artifactsRes.json();
  const artifacts = artifactsData.artifacts || [];
  if (artifacts.length === 0) {
    return new Response("Artifact not found", { status: 404 });
  }

  const artifactId = artifacts[0].id;

  // Step 2: Download the artifact ZIP archive
  const downloadUrl = `https://api.github.com/repos/${owner}/${repo}/actions/artifacts/${artifactId}/zip`;
  const downloadRes = await fetch(downloadUrl, {
    headers: {
      "Authorization": `Bearer ${githubPat}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "SiteToApp-Cloudflare-Bridge"
    }
  });

  if (!downloadRes.ok) {
    return new Response(`Failed to download zip: ${await downloadRes.text()}`, { status: 502 });
  }

  // Read response as ArrayBuffer
  const zipBuffer = await downloadRes.arrayBuffer();

  // Step 3: Extract the APK from the ZIP using fflate
  let unzipped;
  try {
    unzipped = unzipSync(new Uint8Array(zipBuffer));
  } catch (err) {
    return new Response(`Failed to decompress ZIP artifact: ${err.message}`, { status: 500 });
  }

  const apkFilename = Object.keys(unzipped).find(name => name.endsWith('.apk'));
  if (!apkFilename) {
    return new Response("APK file not found inside downloaded ZIP archive", { status: 500 });
  }

  const apkData = unzipped[apkFilename];

  // Step 4: Stream the APK file back with correct headers
  return new Response(apkData, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": `attachment; filename="${apkFilename}"`,
      "Content-Length": String(apkData.length),
      "Access-Control-Allow-Origin": "*"
    }
  });
}
