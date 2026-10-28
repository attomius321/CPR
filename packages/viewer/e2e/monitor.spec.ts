import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveCommits, type RunningCommits } from './symbiote.js';

// The Monitor (RM1): where the checkout's code is. The commits page's repository with a few more
// files committed: `app` holds most of the source, `lib` a little, tests and docs beside them;
// `notes` two long docs for the heat (RM2). `SYMBIOTE_CODE` is a stand-in for VS Code that
// writes what it was given.
let symbiote: RunningCommits;
const dir = mkdtempSync(join(tmpdir(), 'symbiote-e2e-monitor-'));
const log = join(dir, 'opened.jsonl');
const fake = join(dir, 'code');
const errors: string[] = [];

/** `n` lines of code, each a statement. */
const code = (n: number) =>
  Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';
/** `n` lines of Markdown, each an item. */
const items = (n: number) => Array.from({ length: n }, (_, i) => `- item ${i}`).join('\n') + '\n';

test.beforeAll(async () => {
  writeFileSync(
    fake,
    '#!/usr/bin/env node\n' +
      `require('node:fs').appendFileSync(${JSON.stringify(log)}, ` +
      "JSON.stringify(process.argv.slice(2)) + '\\n');\n",
  );
  chmodSync(fake, 0o755);
  symbiote = await serveCommits({ SYMBIOTE_CODE: fake });
  const files: Record<string, string> = {
    'app/big.ts': code(300),
    'app/mid.ts': code(120),
    'app/ui/view.ts': code(90),
    'app/ui/panel.ts': code(60),
    'lib/util.ts': code(40),
    'app/big.test.ts': code(200),
    'README.md': '# Notes\n\nText.\n',
    'notes/long.md': items(520),
    'notes/huge.md': items(1000),
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(symbiote.repo, path)), { recursive: true });
    writeFileSync(join(symbiote.repo, path), text);
  }
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
      cwd: symbiote.repo,
      stdio: 'pipe',
    });
  git('add', '--all');
  git('commit', '-q', '-m', 'More code');
});

test.afterAll(() => {
  symbiote.stop();
  rmSync(dir, { recursive: true, force: true });
});

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  rmSync(log, { force: true });
});

test.afterEach(() => expect(errors).toEqual([]));

const tile = (page: Page, id: string) => page.locator(`.monitor-tile[data-id="${id}"]`);
const row = (page: Page, name: string) =>
  page
    .locator('.monitor-row')
    .filter({ has: page.locator('.monitor-row-name', { hasText: name }) });
const headline = (page: Page) => page.locator('.monitor-headline');

test('m opens the Monitor: the concentration in words, the treemap and the ranked list', async ({
  page,
}) => {
  await page.goto(`${symbiote.url}git`);
  await expect(page.locator('.commit-subject').first()).toBeVisible();
  await page.keyboard.press('m');
  await expect(page).toHaveURL(/\/monitor$/);
  await expect(page.getByRole('link', { name: /^Monitor/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page).toHaveTitle(/^Monitor · /);

  // Source only: app 570 lines, lib 40, and the commits page's own src/.
  await expect(headline(page)).toContainText('lines of code in');
  await expect(headline(page)).toContainText('app holds');
  await expect(tile(page, 'app')).toHaveClass(/type-frame/);
  await expect(tile(page, 'app/big.ts')).toContainText('300');
  await expect(tile(page, 'app/big.test.ts')).toHaveCount(0);
  await expect(page.locator('.monitor-row').first()).toContainText('app/');
  await expect(page.locator('.monitor-half')).toHaveCount(1);

  // Hovering a tile gives its numbers, and lights its row's counterpart the other way round.
  await tile(page, 'app/big.ts').hover();
  const details = page.getByRole('region', { name: 'Details' });
  await expect(details).toContainText('big.ts');
  await expect(details).toContainText('300 lines of code');
  await row(page, 'lib/').hover();
  await expect(tile(page, 'lib')).toHaveClass(/hovered/);
});

test('goes into a folder and back: a click, the breadcrumbs, Backspace and the browser', async ({
  page,
}) => {
  await page.goto(`${symbiote.url}monitor`);
  await tile(page, 'app').locator('.monitor-band').click();
  await expect(page).toHaveURL(/\/monitor\?path=app$/);
  const crumbs = page.getByRole('navigation', { name: 'Folder in view' });
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('app');
  await expect(headline(page)).toContainText('570 lines of code in 4 files.');
  await expect(tile(page, 'app/ui')).toBeVisible();

  await tile(page, 'app/ui').click({ position: { x: 8, y: 8 } });
  await expect(page).toHaveURL(/\/monitor\?path=app%2Fui$/);
  await expect(headline(page)).toContainText('150 lines of code in 2 files.');

  await page.keyboard.press('Backspace');
  await expect(page).toHaveURL(/\/monitor\?path=app$/);
  await crumbs.getByRole('button', { name: 'All files' }).click();
  await expect(page).toHaveURL(/\/monitor$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/monitor\?path=app$/);
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('app');
});

test('counts the kinds turned on: Tests added, Source taken off', async ({ page }) => {
  await page.goto(`${symbiote.url}monitor?path=app`);
  const kinds = page.getByRole('group', { name: 'What counts' });
  await expect(kinds.getByRole('button', { name: /^Source/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await kinds.getByRole('button', { name: /^Tests/ }).click();
  await expect(tile(page, 'app/big.test.ts')).toHaveClass(/kind-test/);
  await expect(headline(page)).toContainText('770 lines of code in 5 files.');
  await kinds.getByRole('button', { name: /^Source/ }).click();
  await expect(headline(page)).toContainText('200 lines of code in 1 file.');
  await kinds.getByRole('button', { name: /^Tests/ }).click();
  await expect(headline(page)).toHaveText('No lines of the kinds turned on here.');
});

test('a file picked keeps its numbers, ranks by keyboard, and opens in VS Code', async ({
  page,
}) => {
  await page.goto(`${symbiote.url}monitor?path=app`);
  await tile(page, 'app/mid.ts').click();
  await expect(tile(page, 'app/mid.ts')).toHaveClass(/selected/);
  await page.mouse.move(0, 0);
  const details = page.getByRole('region', { name: 'Details' });
  await expect(details).toContainText('mid.ts');
  await expect(details).toContainText('Language');
  await details.getByRole('button', { name: 'Open in VS Code' }).click();
  await expect(details.getByRole('status')).toHaveText('Opened.');
  const opened = readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[]);
  expect(opened.at(-1)).toContain(`${join(symbiote.repo, 'app/mid.ts')}:1:1`);

  // The list: the arrows move between rows (big.ts 300, ui/ 150, mid.ts 120), Enter on a folder
  // goes in.
  await page.getByRole('tab', { name: 'Largest files' }).click();
  await expect(page.locator('.monitor-row').first()).toContainText('app/big.ts');
  await page.getByRole('tab', { name: 'In this folder' }).click();
  await row(page, 'big.ts').focus();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'ui/')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'mid.ts')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/monitor\?path=app%2Fui$/);
  await page.keyboard.press('Escape');
});

// RM2 (decision 332): a file's colour by its own lines of code, the same steps at every folder.
test('colours a file by its lines: yellow from 250, orange from 500, red from 1,000', async ({
  page,
}) => {
  await page.goto(`${symbiote.url}monitor?path=app`);
  const legend = page.getByRole('group', { name: 'Lines in a file' });
  await expect(legend).toHaveText(/under 250.*250.*500.*1,000\+/);
  await expect(tile(page, 'app/big.ts')).toHaveClass(/\bheat-1\b/);
  await expect(tile(page, 'app/mid.ts')).not.toHaveClass(/\bheat-/);
  await expect(tile(page, 'app/mid.ts')).toHaveClass(/kind-source/);

  // Docs on: the long notes are orange and red, here and in the list's bars.
  await page.goto(`${symbiote.url}monitor?path=notes`);
  await page
    .getByRole('group', { name: 'What counts' })
    .getByRole('button', { name: /^Docs/ })
    .click();
  await expect(tile(page, 'notes/long.md')).toHaveClass(/\bheat-2\b/);
  await expect(tile(page, 'notes/huge.md')).toHaveClass(/\bheat-3\b/);
  await expect(row(page, 'huge.md').locator('.monitor-row-bar > span')).toHaveClass(/\bheat-3\b/);

  // Kind gives RM1's picture back: the kinds' fills, no heat, no legend.
  const colour = page.getByRole('group', { name: 'Colour' });
  await expect(colour.getByRole('button', { name: 'Lines' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await colour.getByRole('button', { name: 'Kind' }).click();
  await expect(tile(page, 'notes/huge.md')).toHaveClass(/kind-docs/);
  await expect(tile(page, 'notes/huge.md')).not.toHaveClass(/\bheat-/);
  await expect(legend).toHaveCount(0);
});

// RM2 (decisions 334, 335): the folder in view is the heading, with Back before it; a section
// lights up under the pointer.
test('goes back up: the Back button, Escape once nothing is picked, and Backspace', async ({
  page,
}) => {
  await page.goto(`${symbiote.url}monitor`);
  await expect(page.locator('.monitor').getByRole('button', { name: /^Back/ })).toBeDisabled();
  await tile(page, 'app/big.ts').hover();
  await expect(tile(page, 'app')).toHaveClass(/\blit\b/);
  await expect(tile(page, 'lib')).not.toHaveClass(/\blit\b/);

  await page.goto(`${symbiote.url}monitor?path=app%2Fui`);
  const back = page.getByRole('button', { name: 'Back to app' });
  await expect(back).toHaveAttribute('data-tip', 'Back to app');
  await back.click();
  await expect(page).toHaveURL(/\/monitor\?path=app$/);
  await expect(page.getByRole('button', { name: 'Back to All files' })).toBeEnabled();

  // Escape lets go of the file picked first, then goes up.
  await tile(page, 'app/mid.ts').click();
  await expect(tile(page, 'app/mid.ts')).toHaveClass(/selected/);
  await page.keyboard.press('Escape');
  await expect(tile(page, 'app/mid.ts')).not.toHaveClass(/selected/);
  await expect(page).toHaveURL(/\/monitor\?path=app$/);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/monitor$/);

  await page.goto(`${symbiote.url}monitor?path=app%2Fui`);
  await expect(page.locator('.monitor-crumbs [aria-current="page"]')).toHaveText('ui');
  await page.keyboard.press('Backspace');
  await expect(page).toHaveURL(/\/monitor\?path=app$/);
});

// V56: the head is History's strip, its title 16 px in and its commit 12 px from the right (it
// borrowed `.settings-bar`, whose padding is defined only on Settings' page: 0 px). V72 (decision
// 509): the page frame's head — its icon, the title at x 60, the commit its line under the title;
// what counts and the colour its actions, 16 px from the right.
test("the head: the frame's, the commit under the title, what counts at the right", async ({
  page,
}) => {
  await page.goto(`${symbiote.url}monitor`);
  await expect(headline(page)).toContainText('lines of code in');
  const main = await page.locator('.shell-main').boundingBox();
  const title = await page.getByRole('heading', { name: 'Monitor', exact: true }).boundingBox();
  const commit = await page.locator('.monitor-commit').boundingBox();
  const colour = await page.locator('.monitor-colour').boundingBox();
  if (!main || !title || !commit || !colour) throw new Error('no box');
  expect(Math.round(title.x - main.x)).toBe(60);
  expect(Math.round(commit.x - main.x)).toBe(60);
  expect(commit.y).toBeGreaterThanOrEqual(title.y + title.height);
  expect(Math.round(main.x + main.width - (colour.x + colour.width))).toBe(16);
});
