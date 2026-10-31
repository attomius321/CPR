import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveCommits, type RunningCommits } from './symbiote.js';

// Hive's honeycomb as the app's background (V85): the arrival's tiles kept behind every page while
// Hive is on, the ground of every page showing them, on the same tiles from page to page (the
// running reviewer's round 1, kept). Hive off is checked in hive.spec.ts.
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

const POLL = { timeout: 15_000 };
const serve = async () =>
  (symbiote = await serveCommits({
    XDG_CONFIG_HOME: config,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'user.email',
    GIT_CONFIG_VALUE_0: 'hive@example.com',
  }));
const comb = (page: Page) => page.locator('svg.hive-comb');
const lattice = (page: Page) =>
  comb(page).evaluate((svg) => ({
    x: Number(svg.dataset.x),
    y: Number(svg.dataset.y),
    r: Number(svg.dataset.r),
  }));

/** Hive kept on or off for the repository, as Settings' switch writes it. */
const keepHive = (page: Page, on: boolean) =>
  page.evaluate(async (on) => {
    const response = await fetch('/api/hive', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
      body: JSON.stringify({ on }),
    });
    return response.status;
  }, on);

/**
 * What is seen at (`x`, `y`) under the page's words: the first opaque ground over the honeycomb, or
 * `'the honeycomb'`. The body's and the root's grounds are the window's, under it.
 */
const groundAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([x, y]) => {
      const svg = document.querySelector<SVGSVGElement>('svg.hive-comb');
      if (!svg) return 'no honeycomb';
      svg.style.pointerEvents = 'auto';
      try {
        for (const element of document.elementsFromPoint(x!, y!)) {
          if (element === svg || svg.contains(element)) return 'the honeycomb';
          if (element === document.body || element === document.documentElement) continue;
          const colour = getComputedStyle(element).backgroundColor;
          const alpha = /rgba\(.*,\s*([\d.]+)\)/.exec(colour)?.[1];
          if (alpha === undefined || Number(alpha) > 0.5) {
            return `${element.tagName.toLowerCase()}.${[...element.classList].join('.')} ${colour}`;
          }
        }
        return 'nothing';
      } finally {
        svg.style.pointerEvents = '';
      }
    },
    [x, y],
  );

test("Hive on: every page's head shows the honeycomb, the Monitor's too", async ({ page }) => {
  await serve();
  await page.goto(`${symbiote!.url}git`);
  await expect(page.locator('.sidenav')).toBeVisible();
  expect(await keepHive(page, true)).toBe(200);
  for (const theme of ['dark', 'light']) {
    await page.addInitScript(
      (theme) => localStorage.setItem('symbiote.viewer.theme', theme),
      theme,
    );
    for (const path of ['git', 'settings', 'skills', 'nucleus', 'workspace-history', 'monitor']) {
      await page.goto(`${symbiote!.url}${path}`);
      await expect(page.locator('html')).toHaveAttribute('data-hive', 'on');
      const head = page.locator('.shell-main .page-head').first();
      await expect(head).toBeVisible(POLL);
      await expect(comb(page)).toBeAttached();
      const box = (await head.boundingBox())!;
      // The head's own padding, at its top left: nothing of the head's words or actions there.
      expect
        .soft(await groundAt(page, box.x + 3, box.y + 3), `${path}'s head, ${theme}`)
        .toBe('the honeycomb');
    }
  }
});

test("opening a review after the arrival keeps the honeycomb on the arrival's tiles", async ({
  page,
}) => {
  await serve();
  await page.goto(`${symbiote!.url}settings?prompt=hive-mode`);
  const editor = page.getByRole('region', { name: 'Hive mode' });
  await editor.getByRole('button', { name: 'Turn on Hive mode' }).click();
  const question = page.getByRole('alertdialog', { name: 'Turn on Hive mode?' });
  await question.getByRole('button', { name: 'Turn on Hive mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-hive', 'on');
  await expect(page.locator('.hive-flood')).toHaveCount(0, { timeout: 3_000 });
  const laid = await lattice(page);
  const size = page.viewportSize()!;
  // The question's art is not the window's middle: the arrival's lattice is its own.
  expect(laid.x === size.width / 2 && laid.y === size.height / 2).toBe(false);

  // Within the page, no reload: Git, then a commit's review, then Git again.
  await page.getByRole('link', { name: 'Git' }).click();
  await expect(page).toHaveURL(/\/git/);
  expect(await lattice(page)).toEqual(laid);
  await page.getByRole('button', { name: 'Review this commit' }).click();
  await expect(page).toHaveURL(/\/diff\//);
  await expect(comb(page)).toBeAttached(POLL);
  expect(await lattice(page), "a review's honeycomb").toEqual(laid);
  await page.goBack();
  await expect(page).toHaveURL(/\/git/);
  await expect(comb(page)).toBeAttached(POLL);
  expect(await lattice(page), "Git's honeycomb, back from the review").toEqual(laid);
});
