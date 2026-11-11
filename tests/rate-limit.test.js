import test from 'node:test';
import assert from 'node:assert/strict';

import { checkRateLimit, createMemoryStore } from '../functions/_lib/rate-limit.js';
import { onRequestPost as postBuild } from '../functions/api/build/apk.js';

const VALID_BODY = {
  siteUrl: 'https://example.com',
  appName: 'My Web App',
  appId: 'com.example.app',
  appVersion: '1.0.0'
};

function installDispatchStub() {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response('{}', { status: 200 });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    }
  };
}

async function buildRequest(env, ip) {
  const request = new Request('https://app.pages.dev/api/build/apk', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(VALID_BODY)
  });
  const response = await postBuild({ request, env });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

test('the fixed window blocks after the limit and reports a retry delay', async () => {
  const store = createMemoryStore();
  const options = { windowSeconds: 60, max: 3 };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await checkRateLimit(store, 'client-1', options);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 2 - attempt);
  }

  const blocked = await checkRateLimit(store, 'client-1', options);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfter >= 1 && blocked.retryAfter <= 60, `retryAfter ${blocked.retryAfter}`);
});

test('windows expire and separate clients do not share a counter', async () => {
  const store = createMemoryStore();
  const options = { windowSeconds: 60, max: 1 };

  assert.equal((await checkRateLimit(store, 'client-a', options)).allowed, true);
  assert.equal((await checkRateLimit(store, 'client-a', options)).allowed, false);
  assert.equal((await checkRateLimit(store, 'client-b', options)).allowed, true);

  await store.put('client-a', JSON.stringify({ count: 5, resetAt: Date.now() - 1000 }), { expirationTtl: 60 });
  const afterWindow = await checkRateLimit(store, 'client-a', options);
  assert.equal(afterWindow.allowed, true);
  assert.equal(afterWindow.remaining, 0);
});

test('the build endpoint returns 429 with retry information once the limit is hit', async () => {
  const store = createMemoryStore();
  const env = { GITHUB_PAT: 'pat', BUILD_KV: store };
  const stub = installDispatchStub();

  try {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const response = await buildRequest(env, '203.0.113.7');
      assert.equal(response.status, 200, `request ${attempt} should be allowed`);
      assert.equal(response.headers.get('X-RateLimit-Limit'), '10');
    }
    assert.equal(stub.calls.length, 10, 'every allowed request should dispatch one build');

    const blocked = await buildRequest(env, '203.0.113.7');
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('Retry-After')) >= 1);
    assert.ok(blocked.body.retryAfter >= 1);
    assert.match(blocked.body.error, /too many build requests/i);
    assert.equal(stub.calls.length, 10, 'a blocked request must not dispatch a build');
  } finally {
    stub.restore();
  }
});

test('one client hitting the limit does not block another', async () => {
  const store = createMemoryStore();
  const env = { GITHUB_PAT: 'pat', BUILD_KV: store };
  const stub = installDispatchStub();

  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await buildRequest(env, '198.51.100.9');
    }
    assert.equal((await buildRequest(env, '198.51.100.9')).status, 429);

    const otherClient = await buildRequest(env, '198.51.100.10');
    assert.equal(otherClient.status, 200);
    assert.equal(otherClient.headers.get('X-RateLimit-Remaining'), '9');
  } finally {
    stub.restore();
  }
});

test('rejected input does not consume the build quota', async () => {
  const store = createMemoryStore();
  const env = { GITHUB_PAT: 'pat', BUILD_KV: store };
  const stub = installDispatchStub();

  try {
    const request = new Request('https://app.pages.dev/api/build/apk', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.5' },
      body: JSON.stringify({ ...VALID_BODY, appName: 'My App"; id; "' })
    });
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await postBuild({ request: request.clone(), env });
      assert.equal(response.status, 400);
    }

    assert.equal((await buildRequest(env, '192.0.2.5')).status, 200);
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});
