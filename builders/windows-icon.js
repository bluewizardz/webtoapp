import sharp from 'sharp';
import { generatePngIcon } from './icon-generator.js';
import { extractPngOrBmpFromIco, fetchFaviconBuffer } from './android-builder.js';

const MAX_ICON_BYTES = 20 * 1024 * 1024; // 20 MB decoded ceiling

const sharpLimit = { limitInputPixels: 64 * 1024 * 1024 }; // ~4096x4096

/** Resolve a Windows app icon. `autoFetchIcon` gates the site-favicon fallback. */
export async function resolveWindowsIcon({ icon, siteUrl, appName, size, autoFetchIcon = true }) {
  if (icon) {
    try {
      const base64 = String(icon).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length > MAX_ICON_BYTES) {
        throw new Error(`Supplied icon exceeds ${MAX_ICON_BYTES} bytes`);
      }
      return await sharp(buffer, sharpLimit)
        .resize(size, size, { fit: 'cover' })
        .png()
        .toBuffer();
    } catch (error) {
      console.log(`[windows-icon] Supplied icon could not be decoded; trying site favicon: ${error.message}`);
    }
  }

  if (autoFetchIcon !== false && autoFetchIcon !== 'false' && siteUrl) {
    try {
      const favicon = await fetchFaviconBuffer(siteUrl);
      if (favicon && favicon.length <= MAX_ICON_BYTES) {
        return await sharp(extractPngOrBmpFromIco(favicon), sharpLimit)
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
