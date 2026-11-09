export async function onRequestGet(context) {
  const { params, env } = context;
  const buildId = params.id;

  const githubPat = env.GITHUB_PAT;
  if (!githubPat) {
    return json({ error: 'Missing GITHUB_PAT secret' }, 500);
  }

  const headers = {
    'Authorization': `Bearer ${githubPat}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SiteToApp-Cloudflare-Bridge'
  };

  const repo = 'https://api.github.com/repos/bluewizardz/webtoapp';

  // Completion is signalled by the release, not the artifact: the workflow
  // uploads the artifact first and publishes the release last, and the download
  // endpoint redirects to that release asset. Waiting on the release removes
  // the race where a build looks complete but has nothing to download yet.
  const releaseRes = await fetch(`${repo}/releases/tags/build-${buildId}`, { headers });
  if (releaseRes.ok) {
    return json({ status: 'completed' }, 200);
  }

  const runsRes = await fetch(
    `${repo}/actions/workflows/build-exe.yml/runs?event=workflow_dispatch&per_page=5`,
    { headers }
  );

  if (runsRes.ok) {
    const runsData = await runsRes.json();
    const recentRun = (runsData.workflow_runs || []).find((run) => {
      return Date.now() - new Date(run.created_at).getTime() < 12 * 60 * 1000;
    });

    if (recentRun) {
      if (recentRun.status === 'completed') {
        if (recentRun.conclusion === 'success') {
          // Artifact index propagation lag, keep polling.
          return json({ status: 'pending' }, 200);
        }
        return json({ status: 'error', error: 'Windows compilation failed. Check the Actions log.' }, 200);
      }
      return json({ status: 'pending' }, 200);
    }
  }

  return json({ status: 'pending' }, 200);
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
