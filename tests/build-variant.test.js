import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveAndroidBuildVariant } from '../builders/build-utils.js';

const VARIANTS = ['BUILD_VARIANT'];
const SIGNING = [
  'SITEAPP_KEYSTORE_PATH',
  'SITEAPP_KEYSTORE_PASSWORD',
  'SITEAPP_KEY_ALIAS',
  'SITEAPP_KEY_PASSWORD'
];
const ALL_KEYS = [...VARIANTS, ...SIGNING];

function withEnv(values, run) {
  const saved = new Map(ALL_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ALL_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('build variant defaults to debug unless complete release signing is configured', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'variant-'));
  const keystore = path.join(dir, 'release.jks');
  fs.writeFileSync(keystore, 'placeholder');
  const signing = {
    SITEAPP_KEYSTORE_PATH: keystore,
    SITEAPP_KEYSTORE_PASSWORD: 'store-password',
    SITEAPP_KEY_ALIAS: 'upload',
    SITEAPP_KEY_PASSWORD: 'key-password'
  };

  try {
    // No BUILD_VARIANT and no secrets: local builds stay debug.
    assert.equal(withEnv({}, () => resolveAndroidBuildVariant()), 'debug');

    // Secrets alone are enough to produce a signed release build.
    assert.equal(withEnv(signing, () => resolveAndroidBuildVariant()), 'release');

    // An explicit debug request always wins, so testing stays available.
    assert.equal(withEnv({ ...signing, BUILD_VARIANT: 'debug' }, () => resolveAndroidBuildVariant()), 'debug');

    // A release request without secrets must fail instead of shipping a debug-signed APK.
    assert.equal(withEnv({ BUILD_VARIANT: 'release' }, () => resolveAndroidBuildVariant()), null);
    assert.equal(
      withEnv({ ...signing, SITEAPP_KEY_PASSWORD: '' }, () => resolveAndroidBuildVariant()),
      'debug',
      'incomplete secrets must not be treated as a signing setup'
    );

    // A keystore path that does not exist is not a signing setup either.
    assert.equal(
      withEnv(
        { ...signing, SITEAPP_KEYSTORE_PATH: path.join(dir, 'missing.jks') },
        () => resolveAndroidBuildVariant()
      ),
      'debug'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
