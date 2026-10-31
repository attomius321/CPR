import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveCommits, type RunningCommits } from './symbiote.js';

// Hive mode (V82): a dangerous switch in Settings, asked before it turns on, kept per repository in
// its `symbiote/` (decision 621), and the ink and crimson look on every page while it is on, from
// the first paint; the Hive Mind and a blackout take the page as it turns on (decision 632).
let symbiote: RunningCommits | undefined;
let other: RunningCommits | undefined;
let config: string;
const errors: string[] = [];

test.beforeEach(({ page }) => {
  config = mkdtempSync(join(tmpdir(), 'symbiote-e2e-config-'));
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  symbiote?.stop();
  other?.stop();
  symbiote = other = undefined;
  rmSync(config, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

/** A `symbiote view` with a git user (git's own variables): its reviews, so Hive, in `symbiote/`. */
const view = () =>
  serveCommits({
    XDG_CONFIG_HOME: config,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'user.email',
    GIT_CONFIG_VALUE_0: 'hive@example.com',
  });
const serve = async () => (symbiote = await view());
const record = () => join(symbiote!.repo, 'symbiote', 'hive.json');
/** Where V82 kept it for the whole machine: never read since. */
const machineRecord = () => join(config, 'symbiote', 'hive.json');
const hivePage = (page: Page) => page.goto(`${symbiote!.url}settings?prompt=hive-mode`);
const html = (page: Page) => page.locator('html');
const editor = (page: Page) => page.getByRole('region', { name: 'Hive mode' });
const question = (page: Page) => page.getByRole('alertdialog', { name: 'Turn on Hive mode?' });
const turnOn = (page: Page) => editor(page).getByRole('button', { name: 'Turn on Hive mode' });
/** A computed colour of what `selector` finds. */
const colour = (page: Page, selector: string, property: 'color' | 'backgroundColor') =>
  page
    .locator(selector)
    .first()
    .evaluate((element, property) => getComputedStyle(element)[property], property);

test('Hive mode: a danger to press, asked first, kept for the repository, its look on every page', async ({
  page,
}) => {
  // The machine's record of V82, on: neither Symbiote takes it.
  mkdirSync(join(config, 'symbiote'), { recursive: true });
  writeFileSync(machineRecord(), '{"on":true}');
  await serve();
  other = await view();
  await hivePage(page);
  await expect(html(page)).not.toHaveAttribute('data-hive');
  expect(await colour(page, 'body', 'backgroundColor')).toBe('rgb(9, 11, 14)');

  // Under This repository, the open entry; what it would do, in the error's tint; a danger button.
  const repository = page
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('region', { name: 'This repository' });
  await expect(repository.getByRole('button', { name: 'Hive mode' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(editor(page).getByRole('heading', { level: 2 })).toHaveText('Hive mode Off');
  await expect(editor(page).getByRole('note')).toContainText(
    "Hive runs agents and the project's check without asking you first.",
  );
  await expect(turnOn(page)).toHaveClass(/\bdanger\b/);
  await expect(editor(page)).toContainText(
    'For this repository: every window of its symbiote view. Kept with its reviews, never committed.',
  );

  // Escape and a click beside the question cancel; Cancel is where the focus is.
  await turnOn(page).click();
  await expect(question(page)).toBeVisible();
  await expect(question(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(question(page)).toBeHidden();
  await turnOn(page).click();
  await page.mouse.click(4, 4);
  await expect(question(page)).toBeHidden();
  await turnOn(page).click();
  await question(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(question(page)).toBeHidden();
  await expect(html(page)).not.toHaveAttribute('data-hive');
  expect(existsSync(record())).toBe(false);

  // On: the look at once, the S crimson, no tendrils in the sidenav; kept.
  await turnOn(page).click();
  await question(page).getByRole('button', { name: 'Turn on Hive mode' }).click();
  await expect(question(page)).toBeHidden();
  await expect(html(page)).toHaveAttribute('data-hive', 'on');
  expect(await colour(page, 'body', 'backgroundColor')).toBe('rgb(7, 5, 6)');
  await expect(editor(page).getByRole('heading', { level: 2 })).toHaveText('Hive mode On');
  await expect(repository.getByRole('button', { name: 'Hive mode on' })).toBeVisible();
  await expect(page.locator('.sidenav canvas')).toHaveCount(0);
  await expect(page.locator('.sidenav-brand img')).toHaveAttribute('src', /mark-hive/);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /favicon-hive/);
  expect(JSON.parse(readFileSync(record(), 'utf8'))).toMatchObject({ on: true });
  // Out of git; the machine's record as it was; another repository's Symbiote as it was.
  expect(
    execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: symbiote!.repo,
      encoding: 'utf8',
    }),
  ).toBe('');
  expect(readFileSync(machineRecord(), 'utf8')).toBe('{"on":true}');
  const elsewhere = await page.request.get(`${other.url}git`);
  expect(await elsewhere.text()).not.toContain('data-hive');

  // A reload, and every page: marked by the server, so from the first paint.
  const reloaded = await page.reload();
  expect(await reloaded?.text()).toContain('<html data-hive="on"');
  await expect(html(page)).toHaveAttribute('data-hive', 'on');
  for (const path of ['git', 'skills', 'monitor']) {
    const response = await page.goto(`${symbiote!.url}${path}`);
    expect(await response?.text()).toContain('<html data-hive="on"');
    expect(await colour(page, 'body', 'backgroundColor')).toBe('rgb(7, 5, 6)');
  }

  // Off is the safe way: no question; main's look again, and after a reload.
  await hivePage(page);
  await editor(page).getByRole('button', { name: 'Turn off Hive mode' }).click();
  await expect(html(page)).not.toHaveAttribute('data-hive');
  await expect(question(page)).toBeHidden();
  expect(await colour(page, 'body', 'backgroundColor')).toBe('rgb(9, 11, 14)');
  await expect(page.locator('.sidenav-brand img')).not.toHaveAttribute('src', /mark-hive/);
  await page.reload();
  await expect(turnOn(page)).toBeVisible();
  await expect(html(page)).not.toHaveAttribute('data-hive');
  expect(JSON.parse(readFileSync(record(), 'utf8'))).toEqual({ on: false });
});

test('light: the content stays white, the sidenav goes ink; the question is ink while off', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('symbiote.viewer.theme', 'light'));
  await serve();
  await hivePage(page);
  await turnOn(page).click();
  // The question in Hive's look though Hive is off and the theme light.
  await expect(question(page)).toBeVisible();
  expect(await colour(page, '[role="alertdialog"]', 'color')).toBe('rgb(247, 242, 242)');
  await question(page).getByRole('button', { name: 'Turn on Hive mode' }).click();
  await expect(html(page)).toHaveAttribute('data-hive', 'on');
  expect(await colour(page, 'body', 'backgroundColor')).toBe('rgb(255, 255, 255)');
  expect(await colour(page, 'body', 'color')).toBe('rgb(18, 10, 12)');
  expect(await colour(page, '.sidenav', 'backgroundColor')).toBe('rgb(13, 9, 10)');
  expect(await colour(page, '.sidenav', 'color')).toBe('rgb(247, 242, 242)');
});

/** A canvas's pixels, to tell whether it moved. */
const pixels = (page: Page, selector: string) =>
  page.locator(selector).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());

test('the tendrils grab the Hive Mind and live while the question is open, then stop; with reduced motion, one still frame', async ({
  page,
}) => {
  await serve();
  await hivePage(page);
  await turnOn(page).click();
  const art = question(page).locator('canvas.hive-joining');
  await expect(art).toBeVisible();
  // Still moving long after the join: the idle (decision 631).
  await page.waitForTimeout(2_500);
  await expect(art).toHaveAttribute('data-moving', '');
  const a = await pixels(page, '.hive-joining');
  await page.waitForTimeout(300);
  expect(await pixels(page, '.hive-joining')).not.toBe(a);
  // Closed, nothing of it runs.
  await question(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(question(page)).toBeHidden();
  await expect(page.locator('[data-moving]')).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await turnOn(page).click();
  await expect(art).toBeVisible();
  await expect(art).not.toHaveAttribute('data-moving');
  const still = await pixels(page, '.hive-joining');
  await page.waitForTimeout(400);
  expect(await pixels(page, '.hive-joining')).toBe(still);
  // The joined art, drawn once: not a blank canvas.
  expect(
    await art.evaluate((canvas: HTMLCanvasElement) => {
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let drawn = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 200) drawn++;
      return drawn / (data.length / 4);
    }),
  ).toBeGreaterThan(0.2);
});

/** The animations of Hive's arrival still running: the ink, the sheen. */
const arriving = (page: Page) =>
  page.evaluate(
    () =>
      document.getAnimations().filter((animation) => {
        const effect = animation.effect as KeyframeEffect | null;
        const target = effect?.target;
        return (
          animation.playState !== 'finished' &&
          !!target &&
          (!!target.closest('.hive-flood') ||
            (target.matches('.shell-main') && !!effect.pseudoElement))
        );
      }).length,
  );

test('turning on, the Hive Mind and a blackout cover the window, the look changes under it, then all is still', async ({
  page,
}) => {
  await serve();
  await hivePage(page);
  await turnOn(page).click();
  await expect(question(page).locator('canvas.hive-joining')).toBeVisible();
  // When the look changes, read the blackout's canvas: every sampled pixel opaque.
  await page.evaluate(() => {
    const w = window as unknown as { coveredAtSwap?: number | null };
    w.coveredAtSwap = null;
    new MutationObserver((_, observer) => {
      if (document.documentElement.dataset.hive !== 'on') return;
      observer.disconnect();
      const canvas = document.querySelector<HTMLCanvasElement>('.hive-flood');
      if (!canvas) return;
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let least = 255;
      for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 16; x++) {
          const px = Math.min(canvas.width - 1, Math.round(((x + 0.5) / 16) * canvas.width));
          const py = Math.min(canvas.height - 1, Math.round(((y + 0.5) / 9) * canvas.height));
          least = Math.min(least, data[(py * canvas.width + px) * 4 + 3]!);
        }
      }
      w.coveredAtSwap = least;
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-hive'] });
  });
  await question(page).getByRole('button', { name: 'Turn on Hive mode' }).click();
  await expect(page.locator('.hive-flood')).toBeAttached();
  await expect(html(page)).toHaveAttribute('data-hive', 'on');
  await expect(question(page)).toBeHidden();
  expect(
    await page.evaluate(() => (window as unknown as { coveredAtSwap?: number }).coveredAtSwap),
  ).toBe(255);
  // Then still, within 3 s: the blackout gone, nothing of the arrival running.
  await expect(page.locator('.hive-flood')).toHaveCount(0, { timeout: 3_000 });
  await expect(html(page)).not.toHaveAttribute('data-hive-arriving', { timeout: 3_000 });
  await expect(page.locator('[data-moving]')).toHaveCount(0, { timeout: 3_000 });
  expect(await arriving(page)).toBe(0);

  // Loaded with Hive on: still from the first paint.
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-hive', 'on');
  await expect(page.locator('.sidenav canvas')).toHaveCount(0);
  await expect(page.locator('[data-moving]')).toHaveCount(0);
  expect(await arriving(page)).toBe(0);
  await expect(page.locator('.hive-flood')).toHaveCount(0);
});

test('with reduced motion, Hive turns on at once: no ink, no growing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await serve();
  await hivePage(page);
  await turnOn(page).click();
  await question(page).getByRole('button', { name: 'Turn on Hive mode' }).click();
  await expect(html(page)).toHaveAttribute('data-hive', 'on');
  await expect(page.locator('.sidenav canvas')).toHaveCount(0);
  expect(await arriving(page)).toBe(0);
  await expect(page.locator('.hive-flood')).toHaveCount(0);
  await expect(page.locator('[data-moving]')).toHaveCount(0);
  await expect(html(page)).not.toHaveAttribute('data-hive-arriving');
});
