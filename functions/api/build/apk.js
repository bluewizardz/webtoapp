import {
  readBodyWithLimit, parseJsonBody, json, saneSiteUrl,
  isAppId, isAppVersion, isAppName, clampInt
} from '../_lib.js';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_ICON_LENGTH = 48 * 1024;
const ICON_DATA_URL = /^data:image\/(png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/i;

export async function onRequestPost(context) {
  const { request, env } = context;

  const { body: rawBody, error: bodyError } = await readBodyWithLimit(request, MAX_BODY_BYTES);
  if (bodyError) return json({ error: 'Build request is too large' }, { status: 413 });

  const body = parseJsonBody(rawBody);
  if (!body) return json({ error: 'Invalid JSON request body' }, { status: 400 });

  const githubPat = env.GITHUB_PAT;
  if (!githubPat) return json({ error: 'Build service is not configured' }, { status: 500 });

  // --- Icon: a PNG/JPEG/WebP data URL, or nothing. ---
  const icon = body.icon == null || body.icon === '' ? '' : body.icon;
  if (icon !== '') {
    if (typeof icon !== 'string') return json({ error: 'Icon must be a Base64 image data URL' }, { status: 400 });
    if (icon.length > MAX_ICON_LENGTH) return json({ error: 'Icon is too large. Choose a smaller image.' }, { status: 413 });
    const comma = icon.indexOf(',');
    if (comma === -1 || !ICON_DATA_URL.test(icon)) {
      return json({ error: 'Icon must be a PNG, JPEG, or WebP Base64 data URL' }, { status: 400 });
    }
  }
  const autoFetchIcon = body.autoFetchIcon == null
    ? true
    : body.autoFetchIcon === true || body.autoFetchIcon === 'true';

  // --- Required site URL: http/https only, no userinfo, no private hosts. ---
  const siteUrl = saneSiteUrl(body.siteUrl);
  if (!siteUrl) {
    return json({ error: 'A valid public http(s) siteUrl is required (private hosts are not allowed).' }, { status: 400 });
  }

  const appName = isAppName(body.appName) ? String(body.appName).trim() : 'My Web App';
  const appId = isAppId(body.appId) ? body.appId : 'com.example.app';
  const appVersion = isAppVersion(body.appVersion) ? body.appVersion : '1.0.0';
  const splashDuration = String(clampInt(body.splashDuration, 500, 10000, 2000));
  const customUserAgent = typeof body.customUserAgent === 'string'
    ? body.customUserAgent.trim().slice(0, 512)
    : '';

  const buildId = crypto.randomUUID();

  const inputs = {
    siteUrl,
    appName,
    appId,
    appVersion,
    pullToRefresh: String(body.pullToRefresh !== false),
    allowZoom: String(body.allowZoom === true),
    showSpinner: String(body.showSpinner !== false),
    showSplash: String(body.showSplash !== false),
    splashDuration,
    fullScreen: String(body.fullScreen === true),
    customUserAgent,
    icon,
    autoFetchIcon: String(autoFetchIcon),
    buildId
  };

  let response;
  try {
    response = await fetch(
      'https://api.github.com/repos/bluewizardz/webtoapp/actions/workflows/build-apk.yml/dispatches',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${githubPat}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'SiteToApp-Cloudflare-Bridge'
        },
        body: JSON.stringify({ ref: 'main', inputs })
      }
    );
  } catch {
    return json({ error: 'Could not reach GitHub. Please try again later.' }, { status: 502 });
  }

  if (!response.ok) {
    console.error('GitHub dispatch failed:', response.status, await response.text());
    return json({ error: 'Could not start the build. Please try again later.' }, { status: 502 });
  }

  return json({ buildId }, { status: 200 });
}
