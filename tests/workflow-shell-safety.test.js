import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workflowPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.github',
  'workflows',
  'build-apk.yml'
);
const workflow = fs.readFileSync(workflowPath, 'utf8');

// Inputs the workflow accepts and the environment variable each one maps to.
const ENV_BY_INPUT = {
  siteUrl: 'SITE_URL',
  appName: 'APP_NAME',
  appId: 'APP_ID',
  appVersion: 'APP_VERSION',
  pullToRefresh: 'PULL_TO_REFRESH',
  showSpinner: 'SHOW_SPINNER',
  showSplash: 'SHOW_SPLASH',
  splashDuration: 'SPLASH_DURATION',
  fullScreen: 'FULL_SCREEN',
  customUserAgent: 'CUSTOM_USER_AGENT',
  allowZoom: 'ALLOW_ZOOM',
  buildId: 'BUILD_ID',
  autoFetchIcon: 'AUTO_FETCH_ICON',
  allowMixedContent: 'ALLOW_MIXED_CONTENT',
  icon: 'APP_ICON'
};

// Collect the body of every `run:` step, block style or inline.
function runBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[index]);
    if (!match) continue;

    const indent = match[1].length;
    const inline = match[2].trim();
    if (inline && inline !== '|' && inline !== '>') {
      blocks.push(inline);
      continue;
    }

    const body = [];
    for (let inner = index + 1; inner < lines.length; inner += 1) {
      const line = lines[inner];
      if (line.trim() === '') {
        body.push(line);
        continue;
      }
      const lineIndent = line.length - line.trimStart().length;
      if (lineIndent <= indent) break;
      body.push(line);
    }
    blocks.push(body.join('\n'));
  }
  return blocks;
}

function compileStep() {
  const start = workflow.indexOf('- name: Compile Android APK');
  assert.ok(start > 0, 'Compile Android APK step is missing');
  const next = workflow.indexOf('- name:', start + 1);
  return workflow.slice(start, next === -1 ? undefined : next);
}

test('no shell command text interpolates a GitHub expression', () => {
  const blocks = runBlocks(workflow);
  assert.ok(blocks.length > 0, 'no run blocks were found');
  for (const block of blocks) {
    assert.ok(
      !block.includes('${{'),
      `run block must not contain workflow expressions:\n${block}`
    );
  }
});

test('the compile step passes every input through env and reads no arguments', () => {
  const step = compileStep();
  for (const [inputName, envName] of Object.entries(ENV_BY_INPUT)) {
    assert.ok(
      step.includes(`${envName}: \${{ github.event.inputs.${inputName} }}`),
      `${inputName} is not passed to the CLI through ${envName}`
    );
  }
  assert.ok(step.includes('run: node cli-build-apk.js'), 'the CLI must be invoked without interpolated arguments');
  assert.ok(!step.includes('"${{'), 'the compile step still quotes an interpolated input');
});

test('every declared workflow input is forwarded to the CLI', () => {
  const inputsSection = workflow.slice(workflow.indexOf('inputs:'), workflow.indexOf('jobs:'));
  for (const inputName of Object.keys(ENV_BY_INPUT)) {
    const declared = new RegExp(`^ {6}${inputName}:`, 'm').test(inputsSection);
    assert.ok(declared, `workflow input ${inputName} is not declared`);
  }
  const declaredCount = (inputsSection.match(/^ {6}[a-zA-Z]+:/gm) || []).length;
  assert.equal(declaredCount, Object.keys(ENV_BY_INPUT).length);
});

test('artifact steps only reference the build ID, never run shell commands', () => {
  const artifactStep = workflow.slice(workflow.indexOf('Locate Built APK'));
  assert.ok(artifactStep.includes("name: 'build-${{ github.event.inputs.buildId }}'"));
  assert.ok(!artifactStep.includes('run:'), 'the artifact step must not execute shell commands');
});
