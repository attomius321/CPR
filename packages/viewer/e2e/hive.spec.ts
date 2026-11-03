import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveCommits, type RunningCommits } from './symbiote.js';

// Hive mode (V82): a dangerous switch in Settings, asked before it turns on, kept per repository in
// its `symbiote/` (decision 621), and the ink and crimson look on every page while it is on, from
// the first paint; Hive's look opens from the question's Mind as it turns on (V92, decision 874).
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
/**
 * A Symbiote whose repository has a check, committed (V92, decision 872: Hive turns on only with
 * one), so the repository stays clean for the record's checks.
 */
const serve = async () => {
  symbiote = await view();
  const repo = symbiote.repo;
  mkdirSync(join(repo, 'symbiote'), { recursive: true });
  writeFileSync(join(repo, 'symbiote', 'config.json'), '{"merge":{"checks":["true"]}}\n');
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Hive', '-c', 'user.email=hive@example.com', ...args], {
      cwd: repo,
    });
  git('add', 'symbiote/config.json');
  git('commit', '--quiet', '--message', 'A check');
  return symbiote;
};
const record = () => join(symbiote!.repo, 'symbiote', 'hive.json');
/** Where V82 kept it for the whole machine: never read since. */
const machineRecord = () => join(config, 'symbiote', 'hive.json');
const hivePage = (page: Page) => page.goto(`${symbiote!.url}settings?prompt=hive-mode`);
const html = (page: Page) => page.locator('html');
const editor = (page: Page) => page.getByRole('region', { name: 'Hive mode' });
const question = (page: Page) => page.getByRole('alertdialog', { name: 'Turn on Hive mode' });
/** The question's own button (V92): Turn on Hive. */
const confirm = (page: Page) =>
  question(page).getByRole('button', { name: 'Turn on Hive', exact: true });
const turnOn = (page: Page) => editor(page).getByRole('button', { name: 'Turn on Hive mode' });
/** The honeycomb V85 laid behind the page while Hive was on: gone since V88 (decision 815). */
const comb = (page: Page) => page.locator('svg.hive-comb');
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
  expect(await colour(page, 'body', 'backgroundColor')).toBe('rgb(9, 10, 13)');

  // Under This repository, the open entry; what it would do, in a note; Hive's crimson button (V88).
  const repository = page
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('region', { name: 'This repository' });
  await expect(repository.getByRole('button', { name: 'Hive mode' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(editor(page).getByRole('heading', { level: 2 })).toContainText('Hive mode Off');
  await expect(editor(page).getByRole('note')).toContainText(
    'Hive drives every workspace you start, from its brief to landed.',
  );
  await expect(turnOn(page)).toHaveClass(/\bhive\b/);
  await expect(editor(page)).toContainText('symbiote/hive.json, never committed.');

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
  await confirm(page).click();
  await expect(question(page)).toBeHidden();
  await expect(html(page)).toHaveAttribute('data-hive', 'on');
  expect(await colour(page, 'body', 'backgroundColor')).toBe('rgb(9, 9, 11)');
  await expect(editor(page).getByRole('heading', { level: 2 })).toContainText('Hive mode On');
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
    expect(await colour(page, 'body', 'backgroundColor')).toBe('rgb(9, 9, 11)');
  }

  // Off is the safe way: no question; main's look again, and after a reload.
  await hivePage(page);
  await editor(page).getByRole('button', { name: 'Turn off Hive' }).click();
  await expect(html(page)).not.toHaveAttribute('data-hive');
  await expect(question(page)).toBeHidden();
  expect(await colour(page, 'body', 'backgroundColor')).toBe('rgb(9, 10, 13)');
  await expect(page.locator('.sidenav-brand img')).not.toHaveAttribute('src', /mark-hive/);
  await page.reload();
  await expect(turnOn(page)).toBeVisible();
  await expect(html(page)).not.toHaveAttribute('data-hive');
  expect(JSON.parse(readFileSync(record(), 'utf8'))).toEqual({ on: false });
});

test("light: the kit's warm grey ground, the sidenav light; the question is ink while off", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('symbiote.viewer.theme', 'light'));
  await serve();
  await hivePage(page);
  await turnOn(page).click();
  // The question in Hive's dark ink though Hive is off and the theme light.
  await expect(question(page)).toBeVisible();
  expect(await colour(page, '[role="alertdialog"]', 'color')).toBe('rgb(243, 242, 245)');
  await confirm(page).click();
  await expect(html(page)).toHaveAttribute('data-hive', 'on');
  // V88 (decision 812): Hive Control's light set, no red in it.
  expect(await colour(page, 'body', 'backgroundColor')).toBe('rgb(243, 243, 245)');
  expect(await colour(page, 'body', 'color')).toBe('rgb(18, 18, 22)');
  await expect(html(page)).not.toHaveAttribute('data-hive-arrival', { timeout: 3_000 });
  expect(await colour(page, '.sidenav', 'backgroundColor')).toBe('rgb(249, 249, 250)');
  expect(await colour(page, '.sidenav', 'color')).toBe('rgb(18, 18, 22)');
  await expect(comb(page)).toHaveCount(0);
});

/** A canvas's pixels, to tell whether it moved. */
const pixels = (page: Page, selector: string) =>
  page.locator(selector).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());

test('the circuit routes into the Hive Mind and lives while the question is open, then stops; with reduced motion, one still frame', async ({
  page,
}) => {
  await serve();
  await hivePage(page);
  await turnOn(page).click();
  const art = question(page).locator('canvas.hive-joining');
  await expect(art).toBeVisible();
  // Still moving long after the join: packets and orders (decisions 631, 665).
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
  // The joined board, drawn once: the Mind solid in the middle, traces reaching both edges.
  const board = await art.evaluate((canvas: HTMLCanvasElement) => {
    const { width, height } = canvas;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, height);
    const at = (x: number, y: number) => data[(y * width + x) * 4 + 3]!;
    const column = (x: number) =>
      Math.max(...Array.from({ length: height }, (_, y) => at(Math.round(x), y)));
    return {
      mind: at(Math.round(width / 2), Math.round(height / 2)),
      left: column(width * 0.03),
      right: column(width * 0.97),
    };
  });
  expect(board.mind).toBe(255);
  // Over the sides' shade alone (about 105 there), a trace makes about 200.
  expect(board.left).toBeGreaterThan(160);
  expect(board.right).toBeGreaterThan(160);
});

/** The animations of Hive's arrival still running: its layers and the transition's. */
const arriving = (page: Page) =>
  page.evaluate(
    () =>
      document.getAnimations().filter((animation) => {
        const effect = animation.effect as KeyframeEffect | null;
        const target = effect?.target;
        return (
          animation.playState !== 'finished' &&
          !!target &&
          (!!target.closest('[class^="hive-arrival"]') ||
            (target === document.documentElement && !!effect.pseudoElement))
        );
      }).length,
  );

/** The arrival's layers over the page (V92). */
const layers = (page: Page) =>
  page.locator('.hive-arrival-ring, .hive-arrival-glow, .hive-arrival-mind');

test("turning on, Hive's look opens from the question's Mind, then all is still (V92, decision 874)", async ({
  page,
}) => {
  await serve();
  await hivePage(page);
  await turnOn(page).click();
  await expect(question(page).locator('canvas.hive-joining')).toBeVisible();
  await confirm(page).click();
  // The transition under way: the look changed in it, its layers over the page.
  await expect(html(page)).toHaveAttribute('data-hive-arriving', '');
  await expect(html(page)).toHaveAttribute('data-hive', 'on');
  await expect(layers(page)).toHaveCount(3);
  // Then still, within 3 s: the question and the layers gone, nothing of the arrival running.
  await expect(html(page)).not.toHaveAttribute('data-hive-arriving', { timeout: 3_000 });
  await expect(question(page)).toBeHidden();
  await expect(layers(page)).toHaveCount(0);
  await expect(page.locator('[data-moving]')).toHaveCount(0, { timeout: 3_000 });
  expect(await arriving(page)).toBe(0);

  // Loaded with Hive on: still from the first paint.
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-hive', 'on');
  await expect(page.locator('.sidenav canvas')).toHaveCount(0);
  await expect(page.locator('[data-moving]')).toHaveCount(0);
  expect(await arriving(page)).toBe(0);
  await expect(layers(page)).toHaveCount(0);
});

// V88 (decision 815): no honeycomb, sheen, streak or glow, after the arrival or a reload; the
// sidenav and the narrow drawer opaque in Hive's ink.
test('after the arrival nothing lies over or behind the pages: no honeycomb, sheen or glow', async ({
  page,
}) => {
  await serve();
  await hivePage(page);
  await turnOn(page).click();
  await confirm(page).click();
  await expect(html(page)).toHaveAttribute('data-hive', 'on');
  await expect(html(page)).not.toHaveAttribute('data-hive-arriving', { timeout: 3_000 });
  const over = () =>
    page.evaluate(() => {
      const main = document.querySelector('.shell-main')!;
      const sidenav = document.querySelector('.sidenav')!;
      return {
        before: getComputedStyle(main, '::before').content,
        after: getComputedStyle(main, '::after').content,
        sidenav: getComputedStyle(sidenav).backgroundImage,
      };
    });
  const none = { before: 'none', after: 'none', sidenav: 'none' };
  expect(await over()).toEqual(none);
  await expect(comb(page)).toHaveCount(0);
  expect(await colour(page, '.sidenav', 'backgroundColor')).toBe('rgb(14, 14, 17)');
  await page.goto(`${symbiote!.url}git`);
  await expect(page.locator('.sidenav')).toBeVisible();
  expect(await over()).toEqual(none);
  await expect(comb(page)).toHaveCount(0);

  // Narrow: the drawer over the page opaque.
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open the sidenav' }).click();
  await expect(page.locator('.sidenav')).toBeVisible();
  expect(await colour(page, '.sidenav', 'backgroundColor')).toBe('rgb(14, 14, 17)');
  await page.setViewportSize(size);

  // Off: normal mode's ink.
  await hivePage(page);
  await editor(page).getByRole('button', { name: 'Turn off Hive' }).click();
  await expect(html(page)).not.toHaveAttribute('data-hive');
  expect(await colour(page, '.sidenav', 'backgroundColor')).toBe('rgb(13, 15, 19)');
});

test('with reduced motion, Hive turns on at once: no ink, no growing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await serve();
  await hivePage(page);
  await turnOn(page).click();
  await confirm(page).click();
  await expect(html(page)).toHaveAttribute('data-hive', 'on');
  await expect(page.locator('.sidenav canvas')).toHaveCount(0);
  expect(await arriving(page)).toBe(0);
  await expect(layers(page)).toHaveCount(0);
  await expect(page.locator('[data-moving]')).toHaveCount(0);
  await expect(html(page)).not.toHaveAttribute('data-hive-arriving');
  // No honeycomb (V88).
  await expect(comb(page)).toHaveCount(0);
});
