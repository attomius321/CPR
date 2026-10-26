// Cuts Symbiote's icons (V61) from the person's mark, scripts/desktop/logo.png (1254 px: the S on
// black, as given), in Chromium's canvas. Writes the app's icon, packages/desktop/icons/symbiote.png
// (512 px: the window, the taskbar, `symbiote app install`'s launcher entry), and the viewer's
// favicon, packages/viewer/src/shell/favicon.png (64 px), both a rounded tile; the mark in the
// pages, packages/viewer/src/ui/mark.png (64 px, 32 on screen), Start a workspace's,
// packages/viewer/src/ui/mark-96.png (96 px, 48 on screen; V63), and the desktop start page's,
// packages/desktop/start/mark.png (80 px, 40 on screen), all round.
// `node scripts/desktop/icon.mjs` (after `pnpm install`).
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const at = (path) => new URL(`../../${path}`, import.meta.url);
const outputs = [
  { size: 512, shape: 'tile', file: at('packages/desktop/icons/symbiote.png') },
  { size: 64, shape: 'tile', file: at('packages/viewer/src/shell/favicon.png') },
  { size: 64, shape: 'round', file: at('packages/viewer/src/ui/mark.png') },
  { size: 96, shape: 'round', file: at('packages/viewer/src/ui/mark-96.png') },
  { size: 80, shape: 'round', file: at('packages/desktop/start/mark.png') },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
// The logo, from disk, at an address of the script's own.
const origin = 'http://icon.symbiote';
await page.route(`${origin}/**`, (route) => {
  const name = new URL(route.request().url()).pathname.slice(1);
  if (name === 'logo.png')
    return route.fulfill({ path: new URL('logo.png', import.meta.url).pathname });
  return route.fulfill({ contentType: 'text/html', body: '<body></body>' });
});
await page.goto(`${origin}/`);

for (const { size, shape, file } of outputs) {
  const png = await page.evaluate(
    async ({ size, shape }) => {
      const { document } = globalThis;
      const logo = new globalThis.Image();
      logo.src = './logo.png';
      await logo.decode();
      // The S spans 900 px of the 1254, centred at (627, 624) (measured): it fills 80 % of a tile
      // and 86 % of a circle, the rest the image's own black.
      const SPAN = 900;
      const CENTRE = { x: 627, y: 624 };
      const margin = shape === 'tile' ? Math.round(size / 16) : 0;
      const inner = size - 2 * margin;
      const crop = SPAN / (shape === 'tile' ? 0.8 : 0.86);
      // Halved step by step to twice the size, then drawn: one 15× step aliases the thin swirls.
      let from = document.createElement('canvas');
      from.width = from.height = Math.round(crop);
      from
        .getContext('2d')
        .drawImage(logo, CENTRE.x - crop / 2, CENTRE.y - crop / 2, crop, crop, 0, 0, crop, crop);
      while (from.width / 2 >= inner * 2) {
        const half = document.createElement('canvas');
        half.width = half.height = Math.round(from.width / 2);
        const context = half.getContext('2d');
        context.imageSmoothingQuality = 'high';
        context.drawImage(from, 0, 0, half.width, half.height);
        from = half;
      }
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      context.imageSmoothingQuality = 'high';
      const outline = new globalThis.Path2D();
      if (shape === 'tile') outline.roundRect(margin, margin, inner, inner, inner * 0.225);
      else outline.arc(size / 2, size / 2, size / 2, 0, 2 * Math.PI);
      context.save();
      context.clip(outline);
      context.fillStyle = '#000000';
      context.fillRect(0, 0, size, size);
      context.drawImage(from, margin, margin, inner, inner);
      context.restore();
      // The tile's lit rim, light from above, as the old icon's: it keeps the tile on a dark
      // taskbar. Too thin to show at 64 px.
      if (shape === 'tile' && size >= 256) {
        const rim = context.createLinearGradient(0, margin, 0, size - margin);
        rim.addColorStop(0, 'rgb(160 150 255 / 45%)');
        rim.addColorStop(1, 'rgb(160 150 255 / 10%)');
        context.strokeStyle = rim;
        context.lineWidth = size / 256;
        const edge = new globalThis.Path2D();
        const half = context.lineWidth / 2;
        edge.roundRect(
          margin + half,
          margin + half,
          inner - 2 * half,
          inner - 2 * half,
          inner * 0.225,
        );
        context.stroke(edge);
      }
      return canvas.toDataURL('image/png');
    },
    { size, shape },
  );
  writeFileSync(file, Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
  console.log(`${file.pathname} (${size} px, ${shape})`);
}
await browser.close();
