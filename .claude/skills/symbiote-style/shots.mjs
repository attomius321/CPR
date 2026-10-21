// Screenshots of a running `symbiote view`'s pages, dark and light, for a restyle's before and after.
// Usage:
//   node packages/cli/dist/bin.js view [<base> [head]] --no-open --port 47311 &
//   node .claude/skills/symbiote-style/shots.mjs http://127.0.0.1:47311 <out dir> /history /settings …
// Options: --width 1440 (repeatable) --height 900 --theme dark|light (repeatable; default both).
// Writes <out>/<page>-<width>-<theme>.png; the theme is the one Settings keeps (symbiote.viewer.theme).
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { chromium } = createRequire(join(root, 'packages/viewer/package.json'))('@playwright/test');
const preinstalled = '/opt/pw-browsers/chromium';

const args = process.argv.slice(2);
const option = (name) =>
  args.flatMap((arg, i) => (arg === `--${name}` && args[i + 1] ? [args[i + 1]] : []));
const plain = args.filter((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
const [base, out, ...pages] = plain;
if (!base || !out || pages.length === 0) {
  console.error('usage: shots.mjs <base url> <out dir> <page>… [--width n] [--theme dark|light]');
  process.exit(2);
}
const widths = option('width').map(Number);
const height = Number(option('height')[0] ?? 900);
const themes = option('theme');

mkdirSync(out, { recursive: true });
const browser = await chromium.launch(
  existsSync(preinstalled) ? { executablePath: preinstalled } : {},
);
for (const theme of themes.length ? themes : ['dark', 'light']) {
  for (const width of widths.length ? widths : [1440]) {
    const context = await browser.newContext({ viewport: { width, height } });
    // These functions run in the page: its globals are reached through globalThis.
    await context.addInitScript((value) => {
      try {
        globalThis.localStorage.setItem('symbiote.viewer.theme', value);
      } catch {
        // Storage blocked: the page stays dark.
      }
    }, theme);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const path of pages) {
      await page.goto(new URL(path, base).href, { waitUntil: 'networkidle' });
      await page.evaluate(() => globalThis.document.fonts.ready);
      await page.waitForTimeout(500);
      const name = path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';
      const file = join(out, `${name}-${width}-${theme}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
    if (errors.length) console.error(`page errors (${theme}, ${width}):`, errors);
    await context.close();
  }
}
await browser.close();
