import sharp from 'sharp';

/**
 * Generate a PNG icon with app initials on a teal background.
 * @param {string} appName - The app name to derive initials from
 * @param {number} size - Icon size in pixels (default 192)
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function generatePngIcon(appName, size = 192) {
  const words = String(appName || 'App').trim().split(/\s+/);
  const init = words.length > 1
    ? (words[0][0] + words[1][0]).toUpperCase()
    : (words[0][0] + (words[0][1] || '')).toUpperCase();

  const fontSize = Math.round(size * 0.4);
  const cornerRadius = Math.round(size * 0.15);

  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="violet-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e1b33" />
      <stop offset="100%" stop-color="#0b0914" />
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${cornerRadius}" fill="url(#violet-grad)" stroke="#2b2640" stroke-width="${Math.round(size * 0.03)}"/>
  <text x="50%" y="54%" font-family="system-ui, -apple-system, BlinkMacSystemFont, Arial, sans-serif" font-size="${fontSize}" font-weight="900" fill="#10b981" text-anchor="middle" dominant-baseline="middle">${init}</text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Generate an ICO file from a PNG buffer (wraps PNG in ICO container).
 * @param {Buffer} pngBuffer - The PNG image data
 * @returns {Buffer} ICO file buffer
 */
export function pngToIco(pngBuffer) {
  // ICO header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);    // Reserved
  header.writeUInt16LE(1, 2);    // Type: 1 = ICO
  header.writeUInt16LE(1, 4);    // Image count: 1

  // ICO directory entry: 16 bytes
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);        // Width (0 = 256)
  entry.writeUInt8(0, 1);        // Height (0 = 256)
  entry.writeUInt8(0, 2);        // Color palette count
  entry.writeUInt8(0, 3);        // Reserved
  entry.writeUInt16LE(1, 4);     // Color planes
  entry.writeUInt16LE(32, 6);    // Bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8);  // Image data size
  entry.writeUInt32LE(22, 12);   // Offset to image data (6 + 16)

  return Buffer.concat([header, entry, pngBuffer]);
}
