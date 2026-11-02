// Films of turning Hive on, frame-exact, 30 frames a second, encoded to WebM by Chromium itself
// (MediaRecorder over a canvas; no ffmpeg here). From the repository's root:
//   env -u WAYLAND_DISPLAY node spikes/hive-redesign/film.mjs proto <out.webm>
//     the redesign: src/09-turn-on.html stopped at each frame's time (`frameAt`)
//   env -u WAYLAND_DISPLAY node spikes/hive-redesign/film.mjs live <out.webm> <http://127.0.0.1:port>
//     today's: a running `symbiote view` (Hive off), its question opened and turned on under
//     Playwright's clock, so the art and the arrival run 1/30 s a frame
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const [mode, out, base] = process.argv.slice(2);
const FRAME = 1000 / 30;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const frames = [];
const shot = async () => frames.push((await page.screenshot({ type: 'jpeg', quality: 92 })).toString('base64'));

if (mode === 'proto') {
  await page.goto(`file://${here}/src/09-turn-on.html`);
  for (const frame of page.frames()) await frame.evaluate(() => document.fonts.ready);
  // The question at rest for 0.8 s, then the turn-on, then 0.8 s of the page it leaves.
  const rest = await shot().then(() => frames.pop());
  for (let i = 0; i < 24; i++) frames.push(rest);
  for (let t = 0; t <= 1600; t += FRAME) {
    await page.evaluate((at) => window.frameAt(at), t);
    await shot();
  }
  const end = frames.at(-1);
  for (let i = 0; i < 24; i++) frames.push(end);
} else {
  await page.clock.install();
  await page.goto(`${base}/settings`);
  await page.clock.runFor(1500);
  await page.getByRole('button', { name: /Hive mode/ }).first().click();
  await page.clock.runFor(500);
  await page.getByRole('button', { name: 'Turn on Hive mode' }).first().click();
  // The question as it opens and joins, 2.4 s, then turned on, 3.2 s.
  for (let t = 0; t < 2400; t += FRAME) {
    await page.clock.runFor(FRAME);
    await shot();
  }
  await page.getByRole('alertdialog').getByRole('button', { name: 'Turn on Hive mode' }).click();
  for (let t = 0; t < 3200; t += FRAME) {
    await page.clock.runFor(FRAME);
    await shot();
  }
}

// Encode: each frame drawn on a canvas at its time while MediaRecorder records the canvas.
const encoder = await browser.newPage();
const webm = await encoder.evaluate(async ({ list, frameMs }) => {
  const bitmaps = [];
  for (const b64 of list) {
    const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
    bitmaps.push(await createImageBitmap(blob));
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1440;
  canvas.height = 900;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmaps[0], 0, 0);
  const recorder = new MediaRecorder(canvas.captureStream(30), {
    mimeType: 'video/webm;codecs=vp9',
    videoBitsPerSecond: 10_000_000,
  });
  const chunks = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise((resolve) => (recorder.onstop = resolve));
  recorder.start();
  const start = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const i = Math.floor((performance.now() - start) / frameMs);
      if (i >= bitmaps.length) return resolve();
      ctx.drawImage(bitmaps[i], 0, 0);
      requestAnimationFrame(tick);
    };
    tick();
  });
  recorder.stop();
  await done;
  const buffer = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}, { list: frames, frameMs: FRAME });
writeFileSync(out, Buffer.from(webm, 'base64'));
console.log(`${out}: ${frames.length} frames`);
await browser.close();
