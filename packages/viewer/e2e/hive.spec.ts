import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveCommits, type RunningCommits } from './symbiote.js';

// Hive mode (V82): a dangerous switch in Settings, asked before it turns on, kept per repository in
// its `symbiote/` (decision 621), and the ink and crimson look on every page while it is on, from
// the first paint; the ink takes the page as it turns on (decision 624).
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
    'Hive runs agents with full access to this machine.',
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

  // On: the look at once, the S crimson, the tendrils at the sidenav's foot; kept.
  await turnOn(page).click();
  await question(page).getByRole('button', { name: 'Turn on Hive mode' }).click();
  await expect(question(page)).toBeHidden();
  await expect(html(page)).toHaveAttribute('data-hive', 'on');
  expect(await colour(page, 'body', 'backgroundColor')).toBe('rgb(7, 5, 6)');
  await expect(editor(page).getByRole('heading', { level: 2 })).toHaveText('Hive mode On');
  await expect(repository.getByRole('button', { name: 'Hive mode on' })).toBeVisible();
  await expect(page.locator('.sidenav .hive-tendrils')).toBeAttached();
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
  await expect(page.locator('.sidenav .hive-tendrils')).toHaveCount(0);
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

test('the tendrils join, then all is still; with reduced motion, at once', async ({ page }) => {
  await serve();
  await hivePage(page);
  await turnOn(page).click();
  await expect(question(page).locator('.hive-joining')).toBeVisible();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.hive-joining *')].flatMap((e) => e.getAnimations()).length >
        0 &&
      [...document.querySelectorAll('.hive-joining *')]
        .flatMap((e) => e.getAnimations())
        .every((animation) => animation.playState === 'finished'),
    undefined,
    { timeout: 5_000 },
  );
  await question(page).getByRole('button', { name: 'Cancel' }).click();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await turnOn(page).click();
  await expect(question(page).locator('.hive-joining')).toBeVisible();
  // None in the art (the page's own may run: a spinner, the dialog's fade is its own rule).
  expect(
    await page.evaluate(
      () =>
        document
          .getAnimations()
          .map((animation) => (animation.effect as KeyframeEffect | null)?.target)
          .filter((target) => target?.closest('.hive-joining')).length,
    ),
  ).toBe(0);
  expect(
    await question(page)
      .locator('.hive-hex-fill')
      .evaluate((e) => getComputedStyle(e).opacity),
  ).toBe('1');
});

test('the tendrils rise from above Settings: its row stays on plain ground', async ({ page }) => {
  await serve();
  await hivePage(page);
  await turnOn(page).click();
  await question(page).getByRole('button', { name: 'Turn on Hive mode' }).click();
  await expect(html(page)).toHaveAttribute('data-hive', 'on');
  const tendrils = await page.locator('.sidenav .hive-tendrils').boundingBox();
  const foot = await page.locator('.sidenav-foot').boundingBox();
  expect(tendrils!.y + tendrils!.height).toBeLessThanOrEqual(foot!.y + 0.5);
});

/** The animations of Hive's arrival still running: the ink, the tendrils, the sheen. */
const arriving = (page: Page) =>
  page.evaluate(
    () =>
      document.getAnimations().filter((animation) => {
        const effect = animation.effect as KeyframeEffect | null;
        const target = effect?.target;
        return (
          animation.playState !== 'finished' &&
          !!target &&
          (!!target.closest('.hive-flood, .hive-tendrils') ||
            (target.matches('.shell-main') && !!effect.pseudoElement))
        );
      }).length,
  );

test('turning on, the ink takes the page from the hexagon, the tendrils grow, then all is still', async ({
  page,
}) => {
  await serve();
  await hivePage(page);
  await turnOn(page).click();
  await question(page).getByRole('button', { name: 'Turn on Hive mode' }).click();
  // The ink over the page; the look changes under it, the question gone.
  await expect(page.locator('.hive-flood')).toBeAttached();
  await expect(html(page)).toHaveAttribute('data-hive', 'on');
  await expect(question(page)).toBeHidden();
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .some((animation) =>
          (animation.effect as KeyframeEffect | null)?.target?.closest('.hive-tendrils'),
        ),
    undefined,
    { timeout: 3_000 },
  );
  // Then still, within 3 s: the ink gone, nothing of the arrival running.
  await expect(page.locator('.hive-flood')).toHaveCount(0, { timeout: 3_000 });
  await expect(html(page)).not.toHaveAttribute('data-hive-arriving', { timeout: 3_000 });
  expect(await arriving(page)).toBe(0);

  // Loaded with Hive on: still from the first paint.
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-hive', 'on');
  await expect(page.locator('.sidenav .hive-tendrils')).toBeAttached();
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
  await expect(page.locator('.sidenav .hive-tendrils')).toBeAttached();
  expect(await arriving(page)).toBe(0);
  await expect(page.locator('.hive-flood')).toHaveCount(0);
  await expect(html(page)).not.toHaveAttribute('data-hive-arriving');
});
