// Renders the app's icon (V39): the first-time intro's last frame — the two koi at rest in the S,
// the water still — drawn by the intro's own engine (packages/viewer/src/intro/) in Chromium.
// Writes packages/desktop/icons/symbiote.png (512 px: the window, the taskbar, `symbiote app
// install`'s launcher entry) and the viewer's favicon, packages/viewer/src/shell/favicon.png
// (64 px): `node scripts/desktop/icon.mjs` (after `pnpm install`).
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const intro = new URL('../../packages/viewer/src/intro/', import.meta.url);
const outputs = [
  { size: 512, file: new URL('../../packages/desktop/icons/symbiote.png', import.meta.url) },
  { size: 64, file: new URL('../../packages/viewer/src/shell/favicon.png', import.meta.url) },
];

const engine = ts.transpileModule(readFileSync(new URL('koi-intro.ts', intro), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
// Reduced motion: the engine draws its last frame at once.
await page.emulateMedia({ reducedMotion: 'reduce' });
// The intro's files, from disk, at an address of the script's own.
const origin = 'http://icon.symbiote';
await page.route(`${origin}/**`, (route) => {
  const name = new URL(route.request().url()).pathname.slice(1);
  if (name === '') return route.fulfill({ contentType: 'text/html', body: '<body></body>' });
  if (name === 'koi-intro.js')
    return route.fulfill({ contentType: 'text/javascript', body: engine });
  return route.fulfill({ path: new URL(name, intro).pathname });
});
await page.goto(`${origin}/`);

for (const { size, file } of outputs) {
  const png = await page.evaluate(async (size) => {
    const { KoiIntro } = await import('./koi-intro.js');
    const rig = await (await fetch('./koi-rig.json')).json();
    const { document } = globalThis;
    const canvas = document.createElement('canvas');
    canvas.style.width = `${size}px`;
    document.body.append(canvas);
    const assets = ['bg', 'white', 'black', 'aux', 'caustics'].map((n) => [n, `./koi-${n}.webp`]);
    const koi = await KoiIntro.create(canvas, rig, Object.fromEntries(assets));
    await koi.play();
    // Read in the task that drew it: WebGL keeps no buffer once the frame is shown.
    const url = canvas.toDataURL('image/png');
    koi.destroy();
    canvas.remove();
    return url;
  }, size);
  writeFileSync(file, Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
  console.log(`${file.pathname} (${size} px)`);
}
await browser.close();
