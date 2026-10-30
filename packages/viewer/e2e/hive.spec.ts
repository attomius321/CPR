import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveCommits, type RunningCommits } from './symbiote.js';

// Hive mode (V82): a dangerous switch in Settings, asked before it turns on, kept for the person in
// Symbiote's config folder (here a folder of the spec's own), and the ink and crimson look on
// every page while it is on, from the first paint.
let symbiote: RunningCommits | undefined;
let config: string;
const errors: string[] = [];

test.beforeEach(({ page }) => {
  config = mkdtempSync(join(tmpdir(), 'symbiote-e2e-config-'));
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  symbiote?.stop();
  symbiote = undefined;
  rmSync(config, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

const serve = async () => (symbiote = await serveCommits({ XDG_CONFIG_HOME: config }));
const record = () => join(config, 'symbiote', 'hive.json');
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

test('Hive mode: a danger to press, asked first, kept for the person, its look on every page', async ({
  page,
}) => {
  await serve();
  await hivePage(page);
  await expect(html(page)).not.toHaveAttribute('data-hive');
  expect(await colour(page, 'body', 'backgroundColor')).toBe('rgb(9, 11, 14)');

  // Under This machine, the open entry; what it would do, in the error's tint; a danger button.
  const machine = page
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('region', { name: 'This machine' });
  await expect(machine.getByRole('button', { name: 'Hive mode' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(editor(page).getByRole('heading', { level: 2 })).toHaveText('Hive mode Off');
  await expect(editor(page).getByRole('note')).toContainText(
    'Hive runs agents with full access to this machine.',
  );
  await expect(turnOn(page)).toHaveClass(/\bdanger\b/);

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
  await expect(machine.getByRole('button', { name: 'Hive mode on' })).toBeVisible();
  await expect(page.locator('.sidenav .hive-tendrils')).toBeAttached();
  await expect(page.locator('.sidenav-brand img')).toHaveAttribute('src', /mark-hive/);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /favicon-hive/);
  expect(JSON.parse(readFileSync(record(), 'utf8'))).toMatchObject({ on: true });

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
