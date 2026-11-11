import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';

import { onRequestGet as getStatus } from '../functions/api/build/[id].js';
import { onRequestGet as getDownload } from '../functions/api/download/[id].js';
import { putBuildRecord } from '../functions/_lib/build-store.js';
import { createMemoryStore } from '../functions/_lib/rate-limit.js';

const BUILD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BUILD_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BUILD_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function installGitHubStub(state) {
  const original = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);

    if (url.pathname.endsWith('/actions/artifacts')) {
      const name = url.searchParams.get('name');
      const artifacts = (state.artifacts || []).filter((item) => item.name === name && !item.expired);
      return new Response(JSON.stringify({ artifacts }), { status: 200 });
    }

    const zipMatch = /\/actions\/artifacts\/(\d+)\/zip$/.exec(url.pathname);
    if (zipMatch) {
      const artifact = (state.artifacts || []).find((item) => String(item.id) === zipMatch[1]);
      if (!artifact) return new Response('missing', { status: 404 });
      const body = zipSync({ [artifact.entryName]: new TextEncoder().encode(artifact.entryBody) });
      return new Response(body, { status: 200 });
    }

    if (url.pathname.includes('/actions/workflows/') && url.pathname.endsWith('/runs')) {
      return new Response(JSON.stringify({ workflow_runs: state.runs || [] }), { status: 200 });
    }

    return new Response('{}', { status: 200 });
  };

  return {
    calls,
    restore() {
      globalThis.fetch = original;
    }
  };
}

async function status(env, buildId) {
  const response = await getStatus({ params: { id: buildId }, env });
  return { status: response.status, body: await response.json() };
}

test('concurrent builds report their own status and run', async () => {
  const store = createMemoryStore();
  const env = { GITHUB_PAT: 'pat', BUILD_KV: store };
  const stub = installGitHubStub({
    artifacts: [{ id: 101, name: `build-${BUILD_A}`, expired: false }],
    runs: [
      { id: 11, display_title: `Build APK ${BUILD_B}`, status: 'in_progress', conclusion: null },
      { id: 10, display_title: `Build APK ${BUILD_A}`, status: 'completed', conclusion: 'success' }
    ]
  });

  try {
    const [a, b] = await Promise.all([status(env, BUILD_A), status(env, BUILD_B)]);
    assert.equal(a.status, 200);
    assert.equal(a.body.status, 'completed');
    assert.equal(a.body.buildId, BUILD_A);

    assert.equal(b.status, 200);
    assert.equal(b.body.status, 'pending');
    assert.equal(b.body.state, 'in_progress');
    assert.equal(b.body.runId, 11);
    assert.equal(b.body.buildId, BUILD_B);
  } finally {
    stub.restore();
  }
});

test('failed and cancelled runs are reported with their state', async () => {
  const store = createMemoryStore();
  const env = { GITHUB_PAT: 'pat', BUILD_KV: store };
  const stub = installGitHubStub({
    runs: [
      { id: 20, display_title: `Build APK ${BUILD_B}`, status: 'completed', conclusion: 'failure' },
      { id: 21, display_title: `Build APK ${BUILD_C}`, status: 'completed', conclusion: 'cancelled' }
    ]
  });

  try {
    const failed = await status(env, BUILD_B);
    assert.equal(failed.body.status, 'error');
    assert.equal(failed.body.state, 'failure');
    assert.match(failed.body.error, /failed/i);

    const cancelled = await status(env, BUILD_C);
    assert.equal(cancelled.body.status, 'error');
    assert.equal(cancelled.body.state, 'cancelled');
    assert.match(cancelled.body.error, /cancelled/i);
  } finally {
    stub.restore();
  }
});

test('queued runs stay pending and completed-but-unindexed builds keep polling', async () => {
  const store = createMemoryStore();
  const env = { GITHUB_PAT: 'pat', BUILD_KV: store };
  const stub = installGitHubStub({
    runs: [
      { id: 30, display_title: `Build APK ${BUILD_A}`, status: 'queued', conclusion: null },
      { id: 31, display_title: `Build APK ${BUILD_B}`, status: 'completed', conclusion: 'success' }
    ]
  });

  try {
    const queued = await status(env, BUILD_A);
    assert.equal(queued.body.status, 'pending');
    assert.equal(queued.body.state, 'queued');

    const finalizing = await status(env, BUILD_B);
    assert.equal(finalizing.body.status, 'pending');
    assert.equal(finalizing.body.state, 'finalizing');
  } finally {
    stub.restore();
  }
});

test('a recently dispatched build with no run yet is queued, an unknown ID is a 404', async () => {
  const store = createMemoryStore();
  const env = { GITHUB_PAT: 'pat', BUILD_KV: store };
  const stub = installGitHubStub({ runs: [] });

  try {
    await putBuildRecord(env, BUILD_A, { status: 'pending', state: 'queued', createdAt: new Date().toISOString() });

    const queued = await status(env, BUILD_A);
    assert.equal(queued.status, 200);
    assert.equal(queued.body.status, 'pending');
    assert.equal(queued.body.state, 'queued');

    const unknown = await status(env, BUILD_B);
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.status, 'error');
  } finally {
    stub.restore();
  }
});

test('old builds whose run has disappeared fail instead of hanging', async () => {
  const store = createMemoryStore();
  const env = { GITHUB_PAT: 'pat', BUILD_KV: store };
  const stub = installGitHubStub({ runs: [] });

  try {
    await putBuildRecord(env, BUILD_A, {
      status: 'pending',
      state: 'queued',
      createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString()
    });
    const result = await status(env, BUILD_A);
    assert.equal(result.body.status, 'error');
    assert.equal(result.body.state, 'missing');
  } finally {
    stub.restore();
  }
});

test('invalid build IDs are rejected without contacting GitHub', async () => {
  const stub = installGitHubStub({});
  try {
    for (const badId of ['latest', '../../x', "' OR 1=1", `${BUILD_A};id`]) {
      const result = await status({ GITHUB_PAT: 'pat' }, badId);
      assert.equal(result.status, 400, `accepted build ID ${badId}`);
    }
    assert.equal(stub.calls.length, 0, 'a malformed ID reached GitHub');
  } finally {
    stub.restore();
  }
});

test('a finished build is served from its record instead of re-polling GitHub', async () => {
  const store = createMemoryStore();
  const env = { GITHUB_PAT: 'pat', BUILD_KV: store };
  const stub = installGitHubStub({
    artifacts: [{ id: 102, name: `build-${BUILD_A}`, expired: false }],
    runs: [{ id: 12, display_title: `Build APK ${BUILD_A}`, status: 'completed', conclusion: 'success' }]
  });

  try {
    const first = await status(env, BUILD_A);
    assert.equal(first.body.status, 'completed');
    const callsAfterFirst = stub.calls.length;

    const second = await status(env, BUILD_A);
    assert.equal(second.body.status, 'completed');
    assert.equal(stub.calls.length, callsAfterFirst, 'cached completion still called GitHub');
  } finally {
    stub.restore();
  }
});

test('downloads return the requested build artifact only, with a safe file name', async () => {
  const state = {
    artifacts: [
      { id: 201, name: `build-${BUILD_A}`, expired: false, entryName: 'build a/app.apk', entryBody: 'APK-A' },
      { id: 202, name: `build-${BUILD_B}`, expired: false, entryName: 'weird name".apk', entryBody: 'APK-B' }
    ]
  };
  const stub = installGitHubStub(state);

  try {
    const responseA = await getDownload({ params: { id: BUILD_A }, env: { GITHUB_PAT: 'pat' } });
    assert.equal(responseA.status, 200);
    assert.equal(await responseA.text(), 'APK-A');

    const responseB = await getDownload({ params: { id: BUILD_B }, env: { GITHUB_PAT: 'pat' } });
    assert.equal(responseB.status, 200);
    assert.equal(await responseB.text(), 'APK-B');
    assert.equal(responseB.headers.get('Content-Disposition'), 'attachment; filename="weird_name_.apk"');

    const missing = await getDownload({ params: { id: BUILD_C }, env: { GITHUB_PAT: 'pat' } });
    assert.equal(missing.status, 404);

    const invalid = await getDownload({ params: { id: '../../etc/passwd' }, env: { GITHUB_PAT: 'pat' } });
    assert.equal(invalid.status, 400);
  } finally {
    stub.restore();
  }
});
