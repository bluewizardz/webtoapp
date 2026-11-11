import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli-build-apk.js');

const BASE_ENV = {
  SITE_URL: 'https://example.com',
  APP_NAME: 'My Web App',
  APP_ID: 'com.example.app',
  APP_VERSION: '1.0.0',
  PULL_TO_REFRESH: 'true',
  SHOW_SPINNER: 'true',
  SHOW_SPLASH: 'true',
  SPLASH_DURATION: '2000',
  FULL_SCREEN: 'false',
  CUSTOM_USER_AGENT: '',
  ALLOW_ZOOM: 'false',
  BUILD_ID: 'test-build',
  AUTO_FETCH_ICON: 'false',
  APP_ICON: ''
};

function buildEnv(overrides) {
  const env = { ...process.env };
  for (const key of Object.keys(BASE_ENV)) {
    delete env[key];
  }
  return { ...env, ...BASE_ENV, ...overrides };
}

function tempCwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apk-cli-test-'));
}

function runCli(overrides) {
  const cwd = tempCwd();
  const result = spawnSync(process.execPath, [CLI], {
    cwd,
    env: buildEnv(overrides),
    encoding: 'utf8',
    timeout: 60000
  });
  return { ...result, cwd };
}

function assertRejected(overrides, expectedMessage, marker) {
  const { status, stderr, stdout, cwd } = runCli(overrides);
  try {
    assert.equal(status, 1, `expected exit 1, got ${status}. stdout: ${stdout}`);
    assert.match(stderr, /Invalid input/);
    assert.match(stderr, expectedMessage);
    assert.equal(fs.existsSync(path.join(cwd, marker)), false, 'a shell metacharacter was executed');
    return cwd;
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test('rejects shell metacharacters in the app name without executing them', () => {
  assertRejected({ APP_NAME: 'My App"; touch cli-marker-appname; echo "' }, /App name/, 'cli-marker-appname');
  assertRejected({ APP_NAME: 'My App $(touch cli-marker-subshell)' }, /App name/, 'cli-marker-subshell');
  assertRejected({ APP_NAME: 'My App && touch cli-marker-and' }, /App name/, 'cli-marker-and');
  assertRejected({ APP_NAME: 'My App; touch cli-marker-semicolon' }, /App name/, 'cli-marker-semicolon');
  assertRejected({ APP_NAME: 'My App | tee cli-marker-pipe' }, /App name/, 'cli-marker-pipe');
  assertRejected({ APP_NAME: 'My App`touch cli-marker-backtick`' }, /App name/, 'cli-marker-backtick');
});

test('rejects shell metacharacters in the URL and app ID', () => {
  assertRejected({ SITE_URL: 'https://example.com; touch cli-marker-url' }, /Website URL/, 'cli-marker-url');
  assertRejected({ APP_ID: 'com.example; touch cli-marker-appid' }, /App ID/, 'cli-marker-appid');
});

test('rejects quotes in the user agent, which would break the generated Java', () => {
  assertRejected({ CUSTOM_USER_AGENT: 'Mozilla" ; touch cli-marker-ua; "' }, /user agent/i, 'cli-marker-ua');
});

test('rejects build IDs that would escape the workspace', () => {
  const { status, stderr, cwd } = runCli({ BUILD_ID: '../../escaped-build' });
  try {
    assert.equal(status, 1);
    assert.match(stderr, /Invalid input: Build ID/);
    assert.equal(fs.existsSync(path.resolve(cwd, '../../escaped-build')), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('a normal build with spaces and punctuation in the name starts successfully', async () => {
  const cwd = tempCwd();
  const child = spawn(process.execPath, [CLI], {
    cwd,
    env: buildEnv({ APP_NAME: 'My Web App (Beta 2)' })
  });

  let output = '';
  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), 30000);
    const finish = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    child.stdout.on('data', (chunk) => {
      output += chunk;
      // The banner ends the validation phase and the build starts right after it.
      if (output.includes('---------------------------')) finish('started');
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('exit', () => finish('exited'));
  });

  child.kill('SIGKILL');
  try {
    assert.equal(outcome, 'started', `the build did not start. Output:\n${output}`);
    assert.doesNotMatch(output, /Invalid input/);
    assert.match(output, /App Name: My Web App \(Beta 2\)/);
    assert.match(output, /App ID: com\.example\.app/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
