// The spike's Playwright helpers: a page at the person's screen (2560×1440 at 1x), a theme, and
// a walker that counts what a reviewer does (clicks, keys, wheel zooms, drag pans, typed
// characters, page switches) and times what the app makes them wait for.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url));
export const root = join(here, '../../..');
export const shots = join(here, '../shots');
const { chromium } = createRequire(join(root, 'package.json'))('@playwright/test');

/** The person's screen: 27" 1440p at 100 %. */
export const SCREEN = { width: 2560, height: 1440 };

export async function openBrowser() {
  return chromium.launch({ headless: true });
}

/** A page with the theme set before the first paint, as the app's own inline script reads it. */
export async function newPage(browser, theme = 'dark', size = SCREEN) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  await context.addInitScript((t) => {
    try {
      localStorage.setItem('symbiote.viewer.theme', t);
    } catch {}
  }, theme);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.errors = errors;
  return page;
}

/** Sets the theme on a page that is already open (both themes, one walk). */
export async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem('symbiote.viewer.theme', t);
    document.documentElement.dataset.theme = t;
  }, theme);
  await page.waitForTimeout(150);
}

/** A screenshot at 1x into shots/, in the theme the page is in; `clip` in page px. */
export async function shot(page, name, clip) {
  mkdirSync(shots, { recursive: true });
  const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? 'dark');
  const path = join(shots, `${name}-${theme}.png`);
  await page.screenshot({ path, ...(clip ? { clip } : {}) });
  return path;
}

/** Both themes of one view: dark, then light, then back to where it was. */
export async function shotBoth(page, name, clip) {
  const was = await page.evaluate(() => document.documentElement.dataset.theme ?? 'dark');
  const out = [];
  for (const t of ['dark', 'light']) {
    await setTheme(page, t);
    out.push(await shot(page, name, clip));
  }
  await setTheme(page, was);
  return out;
}

/**
 * Counts a task's operations and times its waits. Each `op` is one thing a person does; `wait`
 * measures from the last op until the app shows what was asked. `note` records where the screen
 * did not say what to do next (a guess, a search, getting lost).
 */
export class Walker {
  constructor(page, change) {
    this.page = page;
    this.change = change;
    this.tasks = [];
    this.task = null;
  }
  start(name) {
    this.task = {
      name,
      ops: { click: 0, key: 0, type: 0, wheel: 0, pan: 0, switch: 0, read: 0 },
      waits: [],
      notes: [],
      started: Date.now(),
    };
    this.tasks.push(this.task);
    return this.task;
  }
  count(kind, n = 1) {
    this.task.ops[kind] += n;
  }
  async click(locator, opts) {
    this.count('click');
    await locator.click(opts);
  }
  async key(key) {
    this.count('key');
    await this.page.keyboard.press(key);
  }
  async type(text) {
    this.count('type', text.length);
    await this.page.keyboard.type(text);
  }
  /** One wheel notch at (x, y), as a zoom (with Ctrl, React Flow's pinch) or a scroll. */
  async wheel(x, y, dy, ctrl = false) {
    this.count('wheel');
    await this.page.mouse.move(x, y);
    if (ctrl) await this.page.keyboard.down('Control');
    await this.page.mouse.wheel(0, dy);
    if (ctrl) await this.page.keyboard.up('Control');
    await this.page.waitForTimeout(60);
  }
  /** A drag on the canvas: one pan. */
  async pan(from, to) {
    this.count('pan');
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await this.page.mouse.move(to.x, to.y, { steps: 12 });
    await this.page.mouse.up();
  }
  /** Something the person must read before acting (a list, a message): KLM's mental step. */
  read(what) {
    this.count('read');
    this.task.notes.push({ read: what });
  }
  note(text) {
    this.task.notes.push({ lost: text });
  }
  /** Waits for `until` (a promise factory) and records how long the app took. */
  async wait(label, until) {
    const t0 = performance.now();
    await until();
    const ms = Math.round(performance.now() - t0);
    this.task.waits.push({ label, ms });
    return ms;
  }
  end(extra = {}) {
    Object.assign(this.task, extra, { wallMs: Date.now() - this.task.started });
    delete this.task.started;
    this.task = null;
  }
  save(file) {
    writeFileSync(file, JSON.stringify({ change: this.change, tasks: this.tasks }, null, 1));
  }
}

/**
 * Keystroke-level model (Card, Moran & Newell): a person's time for the counted operations —
 * point and click 1.1 + 0.2 s, a key 0.28 s, a typed character 0.28 s, a wheel notch 0.3 s (a
 * hand already on the mouse), a drag 1.1 + 0.4 s, a page switch counted as its key or click, a
 * read or decision 1.35 s — plus the app's measured waits.
 */
export function klm(task) {
  const o = task.ops;
  const seconds =
    o.click * 1.3 +
    o.key * 0.28 +
    o.type * 0.28 +
    o.wheel * 0.3 +
    o.pan * 1.5 +
    o.read * 1.35 +
    task.waits.reduce((s, w) => s + w.ms, 0) / 1000;
  return Math.round(seconds * 10) / 10;
}
