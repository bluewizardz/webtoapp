import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBuildInputs, normalizeSiteUrl } from '../functions/_lib/build-inputs.js';
import { onRequestPost } from '../functions/api/build/apk.js';

const SAFE_USER_AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const VALID = {
  siteUrl: 'https://example.com',
  appName: 'My Web App',
  appId: 'com.example.app',
  appVersion: '1.0.0',
  pullToRefresh: true,
  showSpinner: true,
  showSplash: true,
  splashDuration: '2000',
  fullScreen: false,
  customUserAgent: SAFE_USER_AGENT,
  allowZoom: false,
  autoFetchIcon: true
};

const HOSTILE_APP_NAMES = [
  'My App"; touch /tmp/pwned; echo "',
  "My App'; touch /tmp/pwned; #",
  'My App $(touch /tmp/pwned)',
  'My App `touch /tmp/pwned`',
  'My App && touch /tmp/pwned',
  'My App || touch /tmp/pwned',
  'My App | cat /etc/passwd',
  'My App > /tmp/pwned',
  'My App\nrm -rf /tmp/pwned',
  'My App\r\ntouch /tmp/pwned',
  'My App & Co',
  'My App<script>',
  '../../etc/passwd',
  '${IFS}',
  '-rf'
];

const HOSTILE_APP_IDS = [
  'com.example;id',
  'com.example`id`',
  'com.example/app',
  'com.example && id',
  'com.Example.app',
  'com.example..app',
  'com.example app',
  'com.example\ncom.example',
  'com.example"x',
  'noDots'
];

const HOSTILE_URLS = [
  'https://example.com; touch /tmp/pwned',
  'https://example.com && id',
  'https://example.com | id',
  'https://example.com`id`',
  'https://example.com$(id)',
  'javascript:alert(1)',
  'file:///etc/passwd',
  'data:text/html,<script>alert(1)</script>',
  'https://user:pass@example.com',
  'https://exa mple.com',
  'https://exam<ple.com'
];

const HOSTILE_USER_AGENTS = [
  'Mozilla" ; touch /tmp/pwned; "',
  'Mozilla\\5c',
  'Mozilla\nAgent',
  'Mozilla\u0007bell',
  "Mozilla' || id"
];

test('accepts and normalises a normal build request', () => {
  const { error, inputs } = validateBuildInputs(VALID);
  assert.equal(error, undefined);
  assert.deepEqual(inputs, {
    siteUrl: 'https://example.com/',
    appName: 'My Web App',
    appId: 'com.example.app',
    appVersion: '1.0.0',
    pullToRefresh: true,
    allowZoom: false,
    showSpinner: true,
    showSplash: true,
    splashDuration: 2000,
    fullScreen: false,
    customUserAgent: SAFE_USER_AGENT,
    icon: '',
    autoFetchIcon: true,
    allowMixedContent: false
  });
});

test('mixed content is disabled unless explicitly requested', () => {
  assert.equal(validateBuildInputs({ siteUrl: 'example.com' }).inputs.allowMixedContent, false);
  assert.equal(validateBuildInputs({ ...VALID, allowMixedContent: 'true' }).inputs.allowMixedContent, true);
  assert.equal(validateBuildInputs({ ...VALID, allowMixedContent: true }).inputs.allowMixedContent, true);
  assert.match(validateBuildInputs({ ...VALID, allowMixedContent: 'maybe' }).error, /mixed content/i);
});

test('applies defaults when optional fields are omitted', () => {
  const { inputs } = validateBuildInputs({ siteUrl: 'example.com' });
  assert.equal(inputs.siteUrl, 'https://example.com/');
  assert.equal(inputs.appName, 'My Web App');
  assert.equal(inputs.appId, 'com.example.app');
  assert.equal(inputs.appVersion, '1.0.0');
  assert.equal(inputs.splashDuration, 2000);
  assert.equal(inputs.autoFetchIcon, true);
});

test('keeps friendly characters in app names', () => {
  for (const name of ['Ben and Jerrys Ice Cream 2', 'My App (Beta) - v2.0', 'Café Ünïcode App', 'company_name.app+plus', 'Docs 4.2 (Final)']) {
    const { error, inputs } = validateBuildInputs({ ...VALID, appName: name });
    assert.equal(error, undefined, `${name} was rejected: ${error}`);
    assert.equal(inputs.appName, name);
  }
});

test('accepts boolean and numeric inputs as strings, as GitHub sends them', () => {
  const { inputs } = validateBuildInputs({ ...VALID, pullToRefresh: 'false', allowZoom: 'true', splashDuration: '3500' });
  assert.equal(inputs.pullToRefresh, false);
  assert.equal(inputs.allowZoom, true);
  assert.equal(inputs.splashDuration, 3500);
});

test('rejects malformed booleans and durations instead of guessing', () => {
  assert.match(validateBuildInputs({ ...VALID, pullToRefresh: 'yes' }).error, /Pull to refresh/);
  assert.match(validateBuildInputs({ ...VALID, allowZoom: 1 }).error, /Allow zoom/);
  assert.match(validateBuildInputs({ ...VALID, splashDuration: '2000.5' }).error, /Splash duration/);
  assert.match(validateBuildInputs({ ...VALID, splashDuration: '999999' }).error, /Splash duration/);
  assert.match(validateBuildInputs({ ...VALID, splashDuration: 'abc' }).error, /Splash duration/);
});

test('rejects shell metacharacters in app names', () => {
  for (const appName of HOSTILE_APP_NAMES) {
    const result = validateBuildInputs({ ...VALID, appName });
    assert.ok(result.error, `accepted hostile app name: ${JSON.stringify(appName)}`);
    assert.match(result.error, /App name/);
    assert.equal(result.inputs, undefined);
  }
});

test('rejects invalid app IDs', () => {
  for (const appId of HOSTILE_APP_IDS) {
    const result = validateBuildInputs({ ...VALID, appId });
    assert.ok(result.error, `accepted hostile app id: ${JSON.stringify(appId)}`);
    assert.match(result.error, /App ID/);
  }
});

test('rejects dangerous or malformed URLs', () => {
  for (const siteUrl of HOSTILE_URLS) {
    const result = validateBuildInputs({ ...VALID, siteUrl });
    assert.ok(result.error, `accepted hostile url: ${JSON.stringify(siteUrl)}`);
    assert.match(result.error, /Website URL/);
  }
});

test('rejects quotes, backslashes and control characters in the user agent', () => {
  for (const customUserAgent of HOSTILE_USER_AGENTS) {
    const result = validateBuildInputs({ ...VALID, customUserAgent });
    assert.ok(result.error, `accepted hostile user agent: ${JSON.stringify(customUserAgent)}`);
    assert.match(result.error, /user agent/i);
  }
});

test('rejects invalid versions and oversized fields', () => {
  assert.match(validateBuildInputs({ ...VALID, appVersion: '1.0.0; id' }).error, /version/i);
  assert.match(validateBuildInputs({ ...VALID, appName: 'A'.repeat(65) }).error, /App name/);
  assert.match(validateBuildInputs({ ...VALID, customUserAgent: 'A'.repeat(257) }).error, /user agent/i);
});

test('rejects non-image and oversized icons', () => {
  assert.match(validateBuildInputs({ ...VALID, icon: 'not-an-image' }).error, /icon/i);
  assert.match(validateBuildInputs({ ...VALID, icon: 'javascript:alert(1)' }).error, /icon/i);
  assert.match(validateBuildInputs({ ...VALID, icon: `data:image/png;base64,${'A'.repeat(50000)}` }).error, /too large/);
});

test('normalizeSiteUrl adds a scheme and keeps query strings', () => {
  assert.equal(normalizeSiteUrl('example.com').value, 'https://example.com/');
  assert.equal(normalizeSiteUrl('http://example.com/path?a=1').value, 'http://example.com/path?a=1');
});

function stubDispatcher() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response('{}', { status: 200 });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    }
  };
}

async function postBuildRequest(body) {
  const request = new Request('https://app.pages.dev/api/build/apk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const response = await onRequestPost({ request, env: { GITHUB_PAT: 'test-pat' } });
  return { status: response.status, json: await response.json() };
}

test('endpoint rejects hostile values with 400 and never dispatches a build', async () => {
  const stub = stubDispatcher();
  try {
    const cases = [
      { appName: 'My App"; touch /tmp/pwned; echo "' },
      { appId: 'com.example; id' },
      { siteUrl: 'https://example.com && id' },
      { customUserAgent: 'Mozilla" ; id; "' }
    ];
    for (const overrides of cases) {
      const { status, json } = await postBuildRequest({ ...VALID, ...overrides });
      assert.equal(status, 400, `expected 400 for ${JSON.stringify(overrides)}`);
      assert.ok(json.error);
    }
    assert.equal(stub.calls.length, 0, 'hostile input reached GitHub');
  } finally {
    stub.restore();
  }
});

test('endpoint forwards safe values as plain JSON dispatch inputs', async () => {
  const stub = stubDispatcher();
  try {
    const { status, json } = await postBuildRequest({ ...VALID, siteUrl: 'example.com', appName: 'My Web App 2' });
    assert.equal(status, 200);
    assert.match(json.buildId, /^[0-9a-f-]{36}$/);
    assert.equal(stub.calls.length, 1);

    const { inputs } = stub.calls[0].body;
    assert.equal(inputs.siteUrl, 'https://example.com/');
    assert.equal(inputs.appName, 'My Web App 2');
    assert.equal(inputs.appId, 'com.example.app');
    assert.equal(inputs.pullToRefresh, 'true');
    assert.equal(inputs.allowZoom, 'false');
    assert.equal(inputs.splashDuration, '2000');
    assert.equal(inputs.customUserAgent, SAFE_USER_AGENT);
    assert.equal(inputs.buildId, json.buildId);
    assert.equal(inputs.autoFetchIcon, 'true');
    assert.equal(inputs.allowMixedContent, 'false');
    // Every dispatch value stays a string: nothing is passed to a shell.
    for (const value of Object.values(inputs)) {
      assert.equal(typeof value, 'string');
    }
  } finally {
    stub.restore();
  }
});
