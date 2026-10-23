import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveCommits, type RunningCommits } from './symbiote.js';

// The first-time intro (V39): two koi form the S over the first page a person opens, once,
// recorded in Symbiote's config folder (here a folder of the spec's own); Settings plays it again.
let symbiote: RunningCommits | undefined;
let home: string;
const errors: string[] = [];

test.beforeEach(({ page }) => {
  home = mkdtempSync(join(tmpdir(), 'symbiote-e2e-home-'));
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  symbiote?.stop();
  symbiote = undefined;
  rmSync(home, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

/** `symbiote view` for someone who has not seen the intro: their config folder is `home`'s. */
const firstTime = () =>
  serveCommits({ SYMBIOTE_INTRO: 'on', HOME: home, XDG_CONFIG_HOME: join(home, '.config') });
const record = () => join(home, '.config', 'symbiote', 'intro.json');

const intro = (page: Page) => page.locator('.intro');
const rows = (page: Page) => page.locator('.commit');

/** Every audio context the page makes, kept where the spec can read their states. */
const watchAudio = (page: Page) =>
  page.addInitScript(() => {
    const made: AudioContext[] = [];
    Object.assign(window, { audioContexts: made });
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        made.push(this);
      }
    };
  });
const audioStates = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { audioContexts: AudioContext[] }).audioContexts.map((c) => c.state),
  );

test('plays over the first page, the page there beneath it, once: the next visit has none', async ({
  page,
}) => {
  symbiote = await firstTime();
  await watchAudio(page);
  await page.goto(symbiote.url);
  await expect(intro(page)).toBeVisible();
  const shown = Date.now();
  await expect(intro(page).locator('canvas')).toBeVisible();
  // History is drawn beneath while the koi swim.
  await expect(rows(page).first()).toBeAttached();
  // Seen as soon as it is shown: a reload in the middle does not start it again.
  await expect.poll(() => existsSync(record())).toBe(true);
  expect(JSON.parse(readFileSync(record(), 'utf8'))).toEqual({ seen: expect.any(String) });
  // Sound on from the start: its context is made with the intro.
  expect((await audioStates(page)).length).toBe(1);
  await expect(intro(page)).toHaveAttribute('data-state', 'formed', { timeout: 8_000 });
  const formed = Date.now() - shown;
  await expect(intro(page)).toHaveCount(0, { timeout: 4_000 });
  const gone = Date.now() - shown;
  // The S at 4.2 s, held 0.9 s, faded in 0.45 s.
  expect(formed).toBeGreaterThan(3_500);
  expect(gone - formed).toBeGreaterThan(800);
  expect(gone).toBeLessThan(8_000);
  await expect.poll(() => audioStates(page)).toEqual(['closed']);
  await expect(rows(page).first()).toBeVisible();

  await page.reload();
  await expect(rows(page).first()).toBeVisible();
  await page.waitForTimeout(300);
  await expect(intro(page)).toHaveCount(0);
});

test('Escape ends it at once, and the page has its keys again', async ({ page }) => {
  symbiote = await firstTime();
  await page.goto(symbiote.url);
  await expect(intro(page).locator('canvas')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(intro(page)).toHaveCount(0, { timeout: 1_500 });
  // Settings' key, taken by the page once the intro is gone.
  await page.keyboard.press('s');
  await expect(page).toHaveURL(`${symbiote.url}settings`);
});

test('a click ends it too', async ({ page }) => {
  symbiote = await firstTime();
  await page.goto(symbiote.url);
  await expect(intro(page).locator('canvas')).toBeVisible();
  await intro(page).click();
  await expect(intro(page)).toHaveCount(0, { timeout: 1_500 });
  expect(existsSync(record())).toBe(true);
});

test('Settings plays it again, and it keeps nothing when SYMBIOTE_INTRO=off', async ({ page }) => {
  symbiote = await serveCommits({ HOME: home, XDG_CONFIG_HOME: join(home, '.config') });
  await page.goto(`${symbiote.url}settings`);
  await expect(page.getByRole('button', { name: 'Play the intro' })).toBeVisible();
  await expect(intro(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Play the intro' }).click();
  await expect(intro(page).locator('canvas')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(intro(page)).toHaveCount(0, { timeout: 1_500 });
  await expect(page).toHaveURL(`${symbiote.url}settings`);
  expect(existsSync(record())).toBe(false);
});

test('without WebGL there is no intro, and it counts as seen', async ({ page }) => {
  symbiote = await firstTime();
  // A canvas without WebGL, its other contexts as they were.
  await page.addInitScript(() => {
    const { prototype } = HTMLCanvasElement;
    const real = Object.getOwnPropertyDescriptor(prototype, 'getContext')?.value as (
      this: HTMLCanvasElement,
      ...args: unknown[]
    ) => unknown;
    Object.defineProperty(prototype, 'getContext', {
      value(this: HTMLCanvasElement, id: string, ...rest: unknown[]) {
        return id === 'webgl' ? null : real.call(this, id, ...rest);
      },
    });
  });
  await page.goto(symbiote.url);
  await expect(rows(page).first()).toBeVisible();
  await expect(intro(page)).toHaveCount(0, { timeout: 1_500 });
  await expect.poll(() => existsSync(record())).toBe(true);
});

/**
 * The first WebGL context the page makes is lost at once and given back `restoreMs` later (if the
 * page took the loss), as Chromium does when its GPU process finds no GL and starts again in
 * software (Xvfb, a VM; measured: lost 70–110 ms after it is made, back 1,004 ms after that).
 */
const loseFirstContext = (page: Page, restoreMs: number | null) =>
  page.addInitScript((restoreMs) => {
    const { prototype } = HTMLCanvasElement;
    const real = Object.getOwnPropertyDescriptor(prototype, 'getContext')?.value as (
      this: HTMLCanvasElement,
      ...args: unknown[]
    ) => unknown;
    let lost = false;
    Object.defineProperty(prototype, 'getContext', {
      value(this: HTMLCanvasElement, id: string, ...rest: unknown[]) {
        const context = real.call(this, id, ...rest) as WebGLRenderingContext | null;
        if (id !== 'webgl' || !context || lost) return context;
        lost = true;
        const lose = context.getExtension('WEBGL_lose_context');
        if (restoreMs !== null) {
          this.addEventListener('webglcontextlost', () =>
            setTimeout(() => lose?.restoreContext(), restoreMs),
          );
        }
        setTimeout(() => lose?.loseContext());
        return context;
      },
    });
  }, restoreMs);

/** Whether the intro's canvas has a live WebGL context: one lost and never back draws nothing. */
const liveCanvases = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLCanvasElement>('.intro canvas')].map(
      (canvas) => canvas.getContext('webgl')?.isContextLost() === false,
    ),
  );

test('a WebGL context lost before the koi show and given back: the intro starts again, drawn', async ({
  page,
}) => {
  symbiote = await firstTime();
  await loseFirstContext(page, 300);
  await page.goto(symbiote.url);
  await expect(intro(page)).toHaveAttribute('data-state', 'formed', { timeout: 8_000 });
  expect(await liveCanvases(page)).toEqual([true]);
  await expect(intro(page)).toHaveCount(0, { timeout: 2_500 });
});

test('a WebGL context lost and never given back: the intro ends, the page is there', async ({
  page,
}) => {
  symbiote = await firstTime();
  await loseFirstContext(page, null);
  await page.goto(symbiote.url);
  await expect(rows(page).first()).toBeVisible();
  await expect(intro(page)).toHaveCount(0, { timeout: 3_500 });
});

test('with reduced motion: the finished S at once, held, then gone without a fade', async ({
  page,
}) => {
  symbiote = await firstTime();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(symbiote.url);
  await expect(intro(page)).toHaveAttribute('data-state', 'formed', { timeout: 1_500 });
  const formed = Date.now();
  await expect(intro(page)).toHaveCount(0, { timeout: 2_500 });
  expect(Date.now() - formed).toBeGreaterThan(600);
});

test('a ?graph= page never asks', async ({ page }) => {
  symbiote = await firstTime();
  const asked: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/intro') asked.push(request.method());
  });
  await page.goto(`${symbiote.url}?graph=missing.json`);
  await page.waitForLoadState('networkidle');
  expect(asked).toEqual([]);
  await expect(intro(page)).toHaveCount(0);
  expect(existsSync(record())).toBe(false);
});
