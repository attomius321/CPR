// Renders the redesign's screens to proofs: `node spikes/hive-redesign/shoot.mjs [--scale 2]
// [--png] [name…]` from the repository's root, after `pnpm install` (Geist comes from the
// viewer's node_modules, Playwright from the root's). Each screen is `src/<name>.html`; a
// `@light` suffix renders it in the light theme. Writes `proofs/<name>[-light].webp`, lossless
// (Chromium's encoder; no image tools needed), or PNG with `--png`. On WSL, run it with
// `env -u WAYLAND_DISPLAY`, or headless Chromium draws no frames.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const scaleAt = args.indexOf('--scale');
const scale = scaleAt >= 0 ? Number(args[scaleAt + 1]) : 1;
const named = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--scale');
const screens = named.length
  ? named
  : [
      '01-overview',
      '02-run-live',
      '03-run-landed',
      '04-settings',
      '05-new-goal',
      '06-kit',
      '07-run-stopped',
      '01-overview@light',
      '03-run-landed@light',
      '08-terminal',
      '08-terminal@light',
    ];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: scale,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('requestfailed', (r) => errors.push(`${r.url()}: ${r.failure()?.errorText}`));
for (const screen of screens) {
  const [name, theme] = screen.split('@');
  await page.goto(`file://${here}/src/${name}.html${theme ? `?theme=${theme}` : ''}`);
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ fullPage: name.endsWith('kit') });
  const base = `${here}/proofs/${name}${theme ? `-${theme}` : ''}${scale === 1 ? '' : `@${scale}x`}`;
  if (flag('--png')) {
    writeFileSync(`${base}.png`, png);
    console.log(`${base}.png`);
    continue;
  }
  // Quality 1 is WebP's lossless mode in Chromium: the proof keeps every pixel.
  const webp = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/webp', 1).split(',')[1];
  }, png.toString('base64'));
  writeFileSync(`${base}.webp`, Buffer.from(webp, 'base64'));
  console.log(`${base}.webp`);
}
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
