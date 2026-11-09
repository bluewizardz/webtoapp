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
  const tag = `build-${buildId}`;

  // The installer is published to a DRAFT release so it never appears in the
  // public Releases section. Check that first: a found release means the asset
  // is ready for download. Drafts are only visible to tokens with Contents
  // (push) access.
  const release = await findReleaseByTag(repo, tag, headers);
  if (release) {
    return json({ status: 'completed' }, 200);
  }

  // If the draft is not visible to this token, fall back to the workflow run:
  // the release is the final step, so a successful run means the asset exists.
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
          // Confirm this specific build's artifact exists before reporting
          // completion, so concurrent builds are not confused with each other.
          const artifact = await findArtifact(repo, buildId, headers);
          return json({ status: artifact ? 'completed' : 'pending' }, 200);
        }
        return json({ status: 'error', error: 'Windows compilation failed. Check the Actions log.' }, 200);
      }
      return json({ status: 'pending' }, 200);
    }
  }

  return json({ status: 'pending' }, 200);
}

async function findArtifact(repo, buildId, headers) {
  const res = await fetch(
    `${repo}/actions/artifacts?name=build-${buildId}`,
    { headers }
  );
  if (!res.ok) return false;
  const data = await res.json();
  return (data.artifacts || []).length > 0;
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

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
