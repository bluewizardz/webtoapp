import {
  isBuildId, json, githubHeaders, REPO_API, findReleaseByTag, findArtifact, findRunByBuildId
} from '../_lib.js';

export async function onRequestGet(context) {
  const { params, env } = context;
  const buildId = params && params.id;

  if (!isBuildId(buildId)) {
    return json({ error: 'Invalid build id' }, { status: 400 });
  }
  if (!env.GITHUB_PAT) {
    return json({ error: 'Build service is not configured' }, { status: 500 });
  }

  try {
    const headers = githubHeaders(env.GITHUB_PAT);
    const tag = `build-${buildId}`;

    // A draft release for this tag means the asset is ready to download.
    const release = await findReleaseByTag(REPO_API, tag, headers);
    if (release) return json({ status: 'completed' });

    // Otherwise correlate the exact workflow run by its run-name.
    const run = await findRunByBuildId(REPO_API, 'build-exe.yml', buildId, headers);
    if (run) {
      if (run.status === 'completed') {
        if (run.conclusion === 'success') {
          const artifact = await findArtifact(REPO_API, buildId, headers);
          return json({ status: artifact ? 'completed' : 'pending' });
        }
        return json({ status: 'error', error: 'Windows build failed. Check the GitHub Actions log for details.' });
      }
      return json({ status: 'pending' });
    }

    const artifact = await findArtifact(REPO_API, buildId, headers);
    if (artifact) return json({ status: 'completed' });

    return json({ status: 'pending' });
  } catch {
    return json({ error: 'Build status is temporarily unavailable' }, { status: 502 });
  }
}
