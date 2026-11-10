import sharp from 'sharp';
import { generatePngIcon } from './icon-generator.js';
import { extractPngOrBmpFromIco, fetchFaviconBuffer } from './android-builder.js';

/** Resolve a Windows app icon, retrying the site's favicon if the client icon is missing or invalid. */
export async function resolveWindowsIcon({ icon, siteUrl, appName, size }) {
  if (icon) {
    try {
      const base64 = String(icon).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
      return await sharp(Buffer.from(base64, 'base64'))
        .resize(size, size, { fit: 'cover' })
        .png()
        .toBuffer();
    } catch (error) {
      console.log(`[windows-icon] Supplied icon could not be decoded; trying site favicon: ${error.message}`);
    }
  }

  if (siteUrl) {
    try {
      const favicon = await fetchFaviconBuffer(siteUrl);
      if (favicon) {
        return await sharp(extractPngOrBmpFromIco(favicon))
          .resize(size, size, { fit: 'cover' })
          .png()
          .toBuffer();
      }
    } catch (error) {
      console.log(`[windows-icon] Site favicon could not be decoded: ${error.message}`);
    }
  }

  return generatePngIcon(appName, size);
}
