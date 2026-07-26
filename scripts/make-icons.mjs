// Generates PWA icons from an inline SVG using sharp.
import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

// tangerine rounded tile with a compass/route glyph + "TRIP"
// ("TripOrganizer" in full is unreadable at 192px, so the wordmark is clipped
// to a monogram; the compass carries the rest of the identity.)
const svg = (size, maskable) => {
  const pad = maskable ? size * 0.12 : 0;
  const r = maskable ? size * 0.5 : size * 0.22;
  const inner = size - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${maskable ? 0 : r}" fill="#ff8c00"/>
  <g transform="translate(${pad},${pad})">
    <circle cx="${inner / 2}" cy="${inner * 0.42}" r="${inner * 0.22}" fill="none" stroke="#ffffff" stroke-width="${inner * 0.045}"/>
    <path d="M ${inner / 2} ${inner * 0.30} L ${inner * 0.58} ${inner * 0.46} L ${inner / 2} ${inner * 0.42} L ${inner * 0.42} ${inner * 0.46} Z" fill="#ffffff"/>
    <text x="${inner / 2}" y="${inner * 0.80}" font-family="sans-serif" font-size="${inner * 0.19}" font-weight="800" fill="#ffffff" text-anchor="middle" letter-spacing="${inner * 0.01}">TRIP</text>
  </g>
</svg>`;
};

async function png(name, size, maskable = false) {
  await sharp(Buffer.from(svg(size, maskable))).png().toFile(join(OUT, name));
  console.log('wrote', name);
}

await png('icon-192.png', 192);
await png('icon-512.png', 512);
await png('maskable-512.png', 512, true);
await png('apple-touch-icon.png', 180);
