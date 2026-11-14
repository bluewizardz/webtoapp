import { buildEXE } from './builders/windows-builder.js';
import { buildTauri } from './builders/tauri-builder.js';
import path from 'path';

let siteUrl = process.argv[2] || 'https://example.com';
siteUrl = siteUrl.trim();
if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(siteUrl)) {
  siteUrl = 'https://' + siteUrl;
}

const appName = process.argv[3] || 'My Web App';
const appId = process.argv[4] || 'com.example.app';
const appVersion = process.argv[5] || '1.0.0';
const installerType = process.argv[6] === 'portable' ? 'portable' : 'nsis';
const windowWidth = parseInt(process.argv[7] || '1200', 10);
const windowHeight = parseInt(process.argv[8] || '800', 10);
const fullScreen = process.argv[9] === 'true';
const customUserAgent = process.argv[10] || null;
const buildId = process.argv[11] || 'latest';
const engine = (process.argv[12] || process.env.BUILD_ENGINE || 'electron').toLowerCase() === 'tauri'
  ? 'tauri'
  : 'electron';

const buildsDir = path.resolve('./builds-cli');
const icon = process.env.APP_ICON || null;
const autoFetchIcon = process.env.AUTO_FETCH_ICON === undefined
  ? true
  : process.env.AUTO_FETCH_ICON === 'true';

console.log('--- SiteToApp Windows CLI Build ---');
console.log('Website URL:', siteUrl);
console.log('App Name:', appName);
console.log('App ID:', appId);
console.log('App Version:', appVersion);
console.log('Installer Type:', installerType);
console.log('Engine:', engine);
console.log('Window Size:', windowWidth + 'x' + windowHeight);
console.log('Full Screen:', fullScreen);
console.log('Custom User Agent:', customUserAgent);
console.log('Custom Icon:', icon ? 'provided' : 'not provided');
console.log('Auto Fetch Icon:', autoFetchIcon);
console.log('Build ID:', buildId);
console.log('-----------------------------------');

const builder = engine === 'tauri' ? buildTauri : buildEXE;

builder({
  siteUrl,
  appName,
  appId,
  appVersion,
  icon,
  autoFetchIcon,
  installerType,
  windowWidth,
  windowHeight,
  fullScreen,
  customUserAgent,
  buildId,
  buildsDir
}).then((outputPath) => {
  if (outputPath && outputPath.endsWith('.exe')) {
    console.log('\nWindows EXE compilation successful!');
    console.log('Installer saved to:', outputPath);
    process.exit(0);
  }
  console.error('\nWindows EXE build fell back to a source ZIP:', outputPath);
  process.exit(1);
}).catch((err) => {
  console.error('\nError during Windows compilation:', err);
  process.exit(1);
});
