import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveAgentBranch, showGraph, type RunningAgent } from './symbiote.js';

// V108 (decisions 983–985): a file viewed on Files and its symbols reviewed on Graph meet, one
// progress line on both pages, and R marks the picked symbol's whole file. The agent's branch:
// square and cube in src/math.ts, three functions in a new src/shapes.ts, and a note no symbol
// holds. Each test gets its own repository: reviews write into it.
let symbiote: RunningAgent;
const errors: string[] = [];

const SHAPES = [
  'export function area(w: number, h: number): number {',
  '  return w * h;',
  '}',
  '',
  'export function perimeter(w: number, h: number): number {',
  '  return 2 * (w + h);',
  '}',
  '',
  'export function diagonal(w: number, h: number): number {',
  '  return Math.sqrt(w * w + h * h);',
  '}',
  '',
].join('\n');

const git = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: symbiote.repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Agent',
      GIT_AUTHOR_EMAIL: 'agent@example.com',
      GIT_COMMITTER_NAME: 'Agent',
      GIT_COMMITTER_EMAIL: 'agent@example.com',
    },
  });

test.beforeEach(async ({ page }) => {
  symbiote = await serveAgentBranch();
  git('checkout', '-q', 'agent');
  mkdirSync(join(symbiote.repo, 'docs'));
  writeFileSync(join(symbiote.repo, 'docs/notes.md'), '# Notes\n\nShapes come next.\n');
  writeFileSync(join(symbiote.repo, 'src/shapes.ts'), SHAPES);
  git('add', 'docs/notes.md', 'src/shapes.ts');
  git('commit', '-q', '-m', 'Agent: shapes and notes');
  git('checkout', '-q', 'main');
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  symbiote.stop();
  expect(errors).toEqual([]);
});

const reviewFile = () =>
  join(symbiote.repo, 'symbiote', 'reviews', 'agent', 'reviewer@example.com.json');
/** The marks the review file keeps: the person's own (V108: derived ones are not stored). */
const stored = () =>
  existsSync(reviewFile())
    ? Object.keys(
        (JSON.parse(readFileSync(reviewFile(), 'utf8')) as { marks: Record<string, string> }).marks,
      ).sort()
    : [];
/** The review's progress line: the same on both pages (decision 984). */
const line = (page: Page) => page.locator('.review-progress');
const showFiles = (page: Page) =>
  page.locator('.page-switch').getByRole('tab', { name: 'Files' }).click();
const box = (page: Page, name: string) =>
  page.getByRole('checkbox', { name: `Mark ${name} reviewed` });
const fileRow = (page: Page, path: string) =>
  page.getByRole('button', { name: `Show the changes to ${path}` });
const fileState = (page: Page, path: string) =>
  page.locator('.files-item', { has: fileRow(page, path) }).locator('.files-state');
const changes = async (page: Page) => {
  await showGraph(page);
  await page.getByRole('tab', { name: /Changes/ }).click();
};
const SHAPE_IDS = ['src/shapes.ts#area', 'src/shapes.ts#diagonal', 'src/shapes.ts#perimeter'];

test('marks on Graph view the file on Files, and a file viewed on Files reviews its symbols', async ({
  page,
}) => {
  await page.goto(`${symbiote.url}review/agent/`);
  await expect(line(page)).toContainText('0 of 3 files viewed');
  await expect(line(page)).toContainText('0 of 5 symbols reviewed');

  // Both of math.ts's symbols on Graph: the file reads viewed, with no mark of its own.
  await changes(page);
  await box(page, 'square').check();
  await box(page, 'cube').check();
  await expect(line(page)).toContainText('1 of 3 files viewed');
  await expect(line(page)).toContainText('2 of 5 symbols reviewed');
  await showFiles(page);
  await expect(fileState(page, 'src/math.ts')).toHaveClass(/viewed/);
  await expect(line(page)).toContainText('1 of 3 files viewed');
  await expect(line(page)).toContainText('2 of 5 symbols reviewed');
  await expect.poll(stored).toEqual(['src/math.ts#cube', 'src/math.ts#square']);

  // shapes.ts viewed on Files: its three symbols read reviewed on Graph; one mark is stored.
  await fileRow(page, 'src/shapes.ts').click();
  await page.keyboard.press('v');
  await expect(fileState(page, 'src/shapes.ts')).toHaveClass(/viewed/);
  await expect(line(page)).toContainText('2 of 3 files viewed');
  await expect(line(page)).toContainText('5 of 5 symbols reviewed');
  await expect
    .poll(stored)
    .toEqual(['file:src/shapes.ts', 'src/math.ts#cube', 'src/math.ts#square']);
  await changes(page);
  for (const name of ['area', 'perimeter', 'diagonal']) await expect(box(page, name)).toBeChecked();
  await expect(line(page)).toContainText('2 of 3 files viewed');

  // One of them unmarked on Graph: the file is no longer viewed, the other two stay reviewed.
  await box(page, 'perimeter').uncheck();
  await expect(line(page)).toContainText('1 of 3 files viewed');
  await expect(line(page)).toContainText('4 of 5 symbols reviewed');
  await expect(box(page, 'area')).toBeChecked();
  await expect
    .poll(stored)
    .toEqual([
      'src/math.ts#cube',
      'src/math.ts#square',
      'src/shapes.ts#area',
      'src/shapes.ts#diagonal',
    ]);
  await showFiles(page);
  await expect(fileState(page, 'src/shapes.ts')).not.toHaveClass(/viewed/);

  // Next: on Graph the symbol left; on Files the files left, after the one shown.
  await changes(page);
  await page.getByRole('button', { name: 'Next symbol left' }).click();
  await expect(page.locator('.panel-title')).toHaveText('perimeter');
  await page.keyboard.press('Escape');
  await showFiles(page);
  // The note is last in the order of risk (V102): Next wraps around to the first file left.
  await fileRow(page, 'docs/notes.md').click();
  await page.getByRole('button', { name: 'Next file left' }).click();
  await expect(page.locator('.file-path')).toHaveText('src/shapes.ts');
  await page.getByRole('button', { name: 'Next file left' }).click();
  await expect(page.locator('.file-path')).toHaveText('docs/notes.md');
  await page.keyboard.press('v');
  await page.getByRole('button', { name: 'Next file left' }).click();
  await expect(page.locator('.file-path')).toHaveText('src/shapes.ts');
  await page.keyboard.press('v');
  await expect(line(page)).toContainText('Done: 3 files viewed, 5 symbols reviewed');
  await expect(page.getByRole('button', { name: 'Next file left' })).toHaveCount(0);

  // Kept: a reload reads the same from the person's own marks.
  await page.reload();
  await expect(line(page)).toContainText('Done: 3 files viewed, 5 symbols reviewed');
  await changes(page);
  await expect(line(page)).toContainText('Done: 3 files viewed, 5 symbols reviewed');
});

test("R marks every changed symbol of the picked symbol's file, and again unmarks them", async ({
  page,
}) => {
  await page.goto(`${symbiote.url}review/agent/`);
  await changes(page);
  await page.locator('.list-item', { hasText: 'perimeter' }).getByRole('button').click();
  await expect(page.locator('.panel-title')).toHaveText('perimeter');
  await page.keyboard.press('Shift+R');
  for (const name of ['area', 'perimeter', 'diagonal']) await expect(box(page, name)).toBeChecked();
  await expect(box(page, 'square')).not.toBeChecked();
  await expect(line(page)).toContainText('1 of 3 files viewed');
  await expect(line(page)).toContainText('3 of 5 symbols reviewed');
  // One write, a mark per symbol.
  await expect.poll(stored).toEqual(SHAPE_IDS);
  await showFiles(page);
  await expect(fileState(page, 'src/shapes.ts')).toHaveClass(/viewed/);

  await changes(page);
  await page.keyboard.press('Shift+R');
  for (const name of ['area', 'perimeter', 'diagonal']) {
    await expect(box(page, name)).not.toBeChecked();
  }
  await expect(line(page)).toContainText('0 of 5 symbols reviewed');
  await expect.poll(stored).toEqual([]);
});

test('a file changed since it was viewed shows unviewed, its symbols unreviewed', async ({
  page,
}) => {
  await page.goto(`${symbiote.url}review/agent/`);
  await fileRow(page, 'src/shapes.ts').click();
  await page.keyboard.press('v');
  await expect(line(page)).toContainText('3 of 5 symbols reviewed');
  await expect.poll(stored).toEqual(['file:src/shapes.ts']);

  // The agent changes perimeter; the review is opened again at the new tip.
  git('checkout', '-q', 'agent');
  writeFileSync(
    join(symbiote.repo, 'src/shapes.ts'),
    SHAPES.replace('2 * (w + h)', 'w + w + h + h'),
  );
  git('commit', '-q', '-am', 'Agent: perimeter by sides');
  git('checkout', '-q', 'main');
  const path = await page.evaluate(async () => {
    const response = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
      body: JSON.stringify({ ref: 'agent' }),
    });
    return ((await response.json()) as { url: string }).url;
  });
  await page.goto(`${new URL(symbiote.url).origin}${path}`);
  await expect(page.locator('.analysis-state')).toHaveCount(0, { timeout: 60_000 });
  await expect(line(page)).toContainText('0 of 3 files viewed');
  await expect(line(page)).toContainText('0 of 5 symbols reviewed');
  await expect(fileState(page, 'src/shapes.ts')).not.toHaveClass(/viewed/);
  await changes(page);
  for (const name of ['area', 'perimeter', 'diagonal']) {
    await expect(box(page, name)).not.toBeChecked();
  }
  // The old mark is kept as it was: viewing the file again marks its new blob.
  expect(stored()).toEqual(['file:src/shapes.ts']);
});
