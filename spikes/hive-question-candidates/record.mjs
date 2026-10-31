// The candidates in the real Hive question: stills (both themes, the page and the dialog) and
// films (frame by frame, the prototype stepped 1/30 s). A `symbiote view` with Hive off at <url>.
// Usage: node record.mjs <url> <out> <stills|film> circuit|conduits|swarm...
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const [url, out, mode, ...kinds] = process.argv.slice(2);
const proto = new URL('./proto.js', import.meta.url).pathname;
const browser = await chromium.launch();
async function open(theme, scale = 1) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript((t) => localStorage.setItem('symbiote.viewer.theme', t), theme);
  await page.goto(`${url}settings?prompt=hive-mode`);
  await page.getByRole('region', { name: 'Hive mode' }).getByRole('button', { name: 'Turn on Hive mode' }).click();
  await page.getByRole('alertdialog').waitFor();
  await page.waitForTimeout(600);
  await page.addScriptTag({ path: proto });
  return { page, errors };
}
const clipOf = async (page) => {
  const b = await page.getByRole('alertdialog').boundingBox();
  return { x: Math.round(b.x) - 24, y: Math.round(b.y) - 24, width: Math.round(b.width) + 48, height: Math.round(b.height) + 48 };
};
for (const kind of kinds) {
  if (mode === 'stills') {
    for (const theme of ['dark', 'light']) {
      const { page, errors } = await open(theme);
      await page.evaluate((k) => { window.__d = HiveProto.mount(k).draw; window.__d(3.2); }, kind);
      await page.screenshot({ path: `${out}/${kind}-${theme}-page.png` });
      await page.screenshot({ path: `${out}/${kind}-${theme}-dialog.png`, clip: await clipOf(page) });
      for (const t of [0.35, 0.7, 1.0, 1.4]) {
        await page.evaluate((t) => window.__d(t), t);
        await page.screenshot({ path: `${out}/${kind}-${theme}-t${t}.png`, clip: await clipOf(page) });
      }
      console.log(kind, theme, errors);
      await page.close();
    }
  } else {
    const dir = `${out}/${kind}-frames`;
    mkdirSync(dir, { recursive: true });
    const { page, errors } = await open('dark');
    await page.evaluate((k) => { window.__d = HiveProto.mount(k).draw; }, kind);
    const clip = await clipOf(page);
    const frames = Number(process.env.FRAMES ?? 210);
    for (let f = 0; f < frames; f++) {
      await page.evaluate((t) => window.__d(t), f / 30);
      await page.screenshot({ path: `${dir}/f${String(f).padStart(4, '0')}.png`, clip });
    }
    const ms = await page.evaluate((k) => [HiveProto.timing(k, 0.2), HiveProto.timing(k, 4)], kind);
    console.log(kind, 'frames', frames, 'ms/frame join, idle', ms.map((m) => m.toFixed(2)), errors);
    await page.close();
  }
}
await browser.close();
