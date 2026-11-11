import path from 'path';
import { buildAPK } from './builders/android-builder.js';
import { validateBuildInputs } from './functions/_lib/build-inputs.js';

// Inputs arrive as environment variables (CI) or as positional arguments (local
// runs). Environment variables are preferred because they never pass through a
// shell, so no input value can ever be evaluated as command text.
function input(envName, argIndex, fallback) {
  const fromEnv = process.env[envName];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv;
  const arg = process.argv[argIndex];
  return arg === undefined || arg === '' ? fallback : arg;
}

// Argument order matches the original CLI so existing local commands keep working.
const rawInputs = {
  siteUrl: input('SITE_URL', 2, 'https://example.com'),
  appName: input('APP_NAME', 3, 'My Web App'),
  appId: input('APP_ID', 4, 'com.example.app'),
  appVersion: input('APP_VERSION', 5, '1.0.0'),
  pullToRefresh: input('PULL_TO_REFRESH', 6, false),
  showSpinner: input('SHOW_SPINNER', 7, false),
  showSplash: input('SHOW_SPLASH', 8, false),
  splashDuration: input('SPLASH_DURATION', 9, '2000'),
  fullScreen: input('FULL_SCREEN', 10, false),
  customUserAgent: input('CUSTOM_USER_AGENT', 11, ''),
  allowZoom: input('ALLOW_ZOOM', 12, false),
  allowMixedContent: input('ALLOW_MIXED_CONTENT', 15, false),
  autoFetchIcon: input('AUTO_FETCH_ICON', 14, 'true'),
  // The custom icon is far too large for a shell argument.
  icon: process.env.APP_ICON || ''
};

const buildId = String(input('BUILD_ID', 13, 'latest')).trim();
// Optional comma-separated identity-provider hosts handled outside the WebView.
const externalAuthHosts = String(process.env.EXTERNAL_AUTH_HOSTS || '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);
const buildsDir = path.resolve('./builds-cli');

// Reject dangerous values before any of them reach the build.
const { error, inputs } = validateBuildInputs(rawInputs);
if (error) {
  console.error(`❌ Invalid input: ${error}`);
  process.exit(1);
}

// The build ID becomes a directory name inside the workspace.
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(buildId)) {
  console.error('❌ Invalid input: Build ID may only contain letters, numbers, dots, dashes and underscores');
  process.exit(1);
}

console.log('--- SiteToApp CLI Build ---');
console.log('Website URL:', inputs.siteUrl);
console.log('App Name:', inputs.appName);
console.log('App ID:', inputs.appId);
console.log('App Version:', inputs.appVersion);
console.log('Pull To Refresh:', inputs.pullToRefresh);
console.log('Show Progress Line:', inputs.showSpinner);
console.log('Show Splash Screen:', inputs.showSplash);
console.log('Splash Duration:', inputs.splashDuration, 'ms');
console.log('Full Screen Mode:', inputs.fullScreen);
console.log('Custom User Agent:', inputs.customUserAgent || null);
console.log('Allow Zoom:', inputs.allowZoom);
console.log('Allow Mixed Content:', inputs.allowMixedContent);
console.log('Build Variant:', process.env.BUILD_VARIANT || '(auto: release when signing secrets exist)');
console.log('Custom Icon:', inputs.icon ? `provided (${inputs.icon.length} chars)` : 'none');
console.log('Auto Fetch Icon:', inputs.autoFetchIcon);
console.log('External Auth Hosts:', externalAuthHosts.length > 0 ? externalAuthHosts.join(', ') : 'defaults');
console.log('---------------------------');

buildAPK({
  ...inputs,
  externalAuthHosts: externalAuthHosts.length > 0 ? externalAuthHosts : undefined,
  buildId,
  buildsDir
}).then((outputPath) => {
  if (outputPath && outputPath.endsWith('.apk')) {
    console.log('\n✅ APK compilation successful!');
    console.log('Compiled APK saved to:', outputPath);
    process.exit(0);
  } else {
    console.error('\n❌ Compilation failed or fell back to ZIP file. Output:', outputPath);
    process.exit(1);
  }
}).catch((err) => {
  console.error('\n❌ Error during project compilation:', err);
  process.exit(1);
});
