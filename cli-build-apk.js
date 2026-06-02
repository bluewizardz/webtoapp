import { buildAPK } from './builders/android-builder.js';
import path from 'path';

// Parse command line arguments
const siteUrl = process.argv[2] || 'https://example.com';
const appName = process.argv[3] || 'My Web App';
const appId = process.argv[4] || 'com.example.app';
const appVersion = process.argv[5] || '1.0.0';
const pullToRefresh = process.argv[6] === 'true';
const showSpinner = process.argv[7] === 'true';
const showSplash = process.argv[8] === 'true';
const splashDuration = parseInt(process.argv[9] || '2000', 10);
const fullScreen = process.argv[10] === 'true';
const customUserAgent = process.argv[11] || null;

const buildsDir = path.resolve('./builds-cli');
const buildId = 'latest';

console.log('--- SiteToApp CLI Build ---');
console.log('Website URL:', siteUrl);
console.log('App Name:', appName);
console.log('App ID:', appId);
console.log('App Version:', appVersion);
console.log('Pull To Refresh:', pullToRefresh);
console.log('Show Progress Line:', showSpinner);
console.log('Show Splash Screen:', showSplash);
console.log('Splash Duration:', splashDuration, 'ms');
console.log('Full Screen Mode:', fullScreen);
console.log('Custom User Agent:', customUserAgent);
console.log('---------------------------');

buildAPK({
  siteUrl,
  appName,
  appId,
  appVersion,
  icon: null, // Auto-scraped favicon will be used
  autoFetchIcon: true,
  showSpinner,
  pullToRefresh,
  showSplash,
  splashDuration,
  fullScreen,
  customUserAgent,
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
