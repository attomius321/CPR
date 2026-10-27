import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveCommits, type RunningCommits } from './symbiote.js';

// Git's page (V66): a commit's details, the uncommitted changes staged and committed, branches
// and tags, fetch, pull and push, finding a commit. Each test gets its own repository.
let symbiote: RunningCommits;
const errors: string[] = [];
const cleanups: (() => void)[] = [];

test.beforeEach(async ({ page }) => {
  symbiote = await serveCommits();
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  symbiote.stop();
  for (const cleanup of cleanups.splice(0)) cleanup();
  expect(errors).toEqual([]);
});

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Symbiote Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Symbiote Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' }).trim();
const row = (page: Page, subject: string) =>
  page.locator('.commit', {
    has: page.locator('.commit-subject').getByText(new RegExp(`^${subject}(,|$)`)),
  });
const pane = (page: Page) => page.locator('.git-details');
/** The open file, shown in the rows' place (V70). */
const fileView = (page: Page) => page.locator('.git-shown');
const statusBar = (page: Page) => page.getByRole('contentinfo', { name: 'Status bar' });

test("a commit's details: its message, people, parent and files, a file's diff (V66b)", async ({
  page,
}) => {
  await page.goto(`${symbiote.url}git`);
  await row(page, 'Add cube').click();
  await expect(pane(page)).toHaveAttribute('aria-label', 'Commit details');
  await expect(pane(page).locator('.git-details-title')).toHaveText('Add cube');
  const facts = pane(page).locator('.git-details-facts');
  await expect(facts).toContainText('Symbiote Test');
  await expect(facts).toContainText(symbiote.shas[3]!.slice(0, 7));
  await expect(
    pane(page).getByRole('button', { name: 'Show the diff of src/math.ts' }),
  ).toContainText('+4');
  await pane(page).getByRole('button', { name: 'Show the diff of src/math.ts' }).click();
  const diff = fileView(page).getByRole('table', { name: 'Diff of src/math.ts' });
  await expect(diff.locator('.row-add', { hasText: 'export function cube' })).toBeVisible();
  // The parent's link goes to its row.
  await facts
    .getByRole('button', { name: `Go to the parent ${symbiote.shas[2]!.slice(0, 7)}` })
    .click();
  await expect(row(page, 'Add square')).toHaveClass(/cursor/);
  await expect(pane(page).locator('.git-details-title')).toHaveText('Add square');
  // d folds the pane and shows it again.
  await page.keyboard.press('d');
  await expect(pane(page)).toHaveCount(0);
  await page.keyboard.press('d');
  await expect(pane(page)).toBeVisible();
  // Review this commit: the commit against its parent, on a diff's page.
  await pane(page).getByRole('button', { name: 'Review this commit' }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/diff/${symbiote.shas[1]!.slice(0, 7)}[0-9a-f]*\\.\\.${symbiote.shas[2]!.slice(0, 7)}`,
    ),
  );
});

test('the details on the right, or below the commits from Settings → Appearance (V66b)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${symbiote.url}git`);
  await row(page, 'Add cube').click();
  const card = page.locator('.commits-card');
  let [rows, details] = [await card.boundingBox(), await pane(page).boundingBox()];
  expect(details!.x).toBeGreaterThan(rows!.x + rows!.width);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByRole('button', { name: 'Below the commits' }).click();
  await expect(page.getByRole('button', { name: 'Below the commits' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('g');
  await row(page, 'Add cube').click();
  [rows, details] = [await card.boundingBox(), await pane(page).boundingBox()];
  expect(details!.y).toBeGreaterThan(rows!.y + rows!.height - 1);
  expect(Math.abs(details!.x - rows!.x)).toBeLessThan(2);
  // Kept for this browser.
  await page.reload();
  await row(page, 'Add cube').click();
  [rows, details] = [await card.boundingBox(), await pane(page).boundingBox()];
  expect(details!.y).toBeGreaterThan(rows!.y + rows!.height - 1);
});

test('uncommitted changes: a row above the commits, staged and committed from the pane (V66c)', async ({
  page,
}) => {
  writeFileSync(join(symbiote.repo, 'src/math.ts'), 'export const changed = true;\n');
  writeFileSync(join(symbiote.repo, 'notes.txt'), 'a new file\n');
  await page.goto(`${symbiote.url}git`);
  const working = page.locator('.commit.working');
  await expect(working).toContainText('Uncommitted changes');
  await expect(working).toContainText('2 files');
  await working.click();
  await expect(pane(page)).toHaveAttribute('aria-label', 'Uncommitted changes');
  // Nothing staged: Commit is off.
  const commitButton = pane(page).getByRole('button', { name: 'Commit', exact: true });
  await expect(commitButton).toBeDisabled();
  await pane(page).getByRole('button', { name: 'Stage notes.txt' }).click();
  await expect(pane(page).getByRole('button', { name: 'Unstage notes.txt' })).toBeVisible();
  await expect(working).toContainText('1 staged');
  // A staged file's diff: against HEAD.
  await pane(page).getByRole('button', { name: 'Show the diff of notes.txt, staged' }).click();
  await expect(fileView(page).getByRole('table', { name: 'Diff of notes.txt' })).toContainText(
    'a new file',
  );
  await pane(page)
    .getByRole('textbox', { name: 'Commit message' })
    .fill('Add notes\n\nWhy: a test.');
  await page.keyboard.press('Control+Enter');
  await expect(statusBar(page)).toContainText(/Committed [0-9a-f]{7}/);
  await expect(page.locator('.commit-subject').first()).toHaveText('Uncommitted changes');
  await expect(row(page, 'Add notes')).toBeVisible();
  expect(git(symbiote.repo, 'log', '-1', '--format=%B')).toBe('Add notes\n\nWhy: a test.');
  // What was not staged is still there.
  await expect(working).toContainText('1 file');
  expect(git(symbiote.repo, 'status', '--porcelain')).toBe('M src/math.ts');
});

test("a commit's file shows in the rows' place, on screen; j/k step its files, Esc goes back (V70)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Thirty files: the pane's list runs past the window, as half of real commits' do.
  for (let i = 1; i <= 30; i++)
    writeFileSync(join(symbiote.repo, `notes-${String(i).padStart(2, '0')}.md`), `note ${i}\n`);
  git(symbiote.repo, 'add', '.');
  git(symbiote.repo, 'commit', '-q', '-m', 'Add thirty notes');
  await page.goto(`${symbiote.url}git`);
  await row(page, 'Add thirty notes').click();
  const last = pane(page).getByRole('button', { name: 'Show the diff of notes-30.md' });
  await last.click();
  await expect(fileView(page)).toHaveAttribute('aria-label', 'Changes to notes-30.md');
  const firstLine = fileView(page).locator('.git-diff .row').first();
  await expect(firstLine).toHaveText(/note 30/);
  await expect(firstLine).toBeInViewport({ ratio: 1 });
  await expect(last).toHaveAttribute('aria-current', 'true');
  // Over the rows, in their card: the pane beside it keeps the files.
  const [card, shown] = [
    await page.locator('.commits-card').boundingBox(),
    await fileView(page).boundingBox(),
  ];
  // Inside the card's 1 px edge.
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const inside = key === 'x' || key === 'y' ? card![key] + 1 : card![key] - 2;
    expect(Math.abs(shown![key] - inside)).toBeLessThan(1);
  }
  // k the file before it; j at the last stays there.
  await page.keyboard.press('k');
  await expect(fileView(page)).toHaveAttribute('aria-label', 'Changes to notes-29.md');
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await expect(fileView(page)).toHaveAttribute('aria-label', 'Changes to notes-30.md');
  // The rows' keys wait: x does not start compare mode under the file.
  await page.keyboard.press('x');
  await expect(page.getByRole('button', { name: 'Compare mode' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  // Esc: the rows again, the cursor on its commit, in view.
  await page.keyboard.press('Escape');
  await expect(fileView(page)).toHaveCount(0);
  await expect(row(page, 'Add thirty notes')).toHaveClass(/cursor/);
  await expect(row(page, 'Add thirty notes')).toBeInViewport();
  // A narrower window: the pane below the rows, the file still on screen.
  await page.setViewportSize({ width: 1280, height: 800 });
  await last.click();
  await expect(firstLine).toBeInViewport({ ratio: 1 });
  expect((await pane(page).boundingBox())!.y).toBeGreaterThan(
    (await fileView(page).boundingBox())!.y,
  );
  // The same file clicked again closes it.
  await last.click();
  await expect(fileView(page)).toHaveCount(0);
});

test("Open in VS Code: the file's diff in VS Code's diff editor, a commit's or an uncommitted one (V70)", async ({
  page,
}) => {
  // A stand-in for VS Code that writes down what it is asked.
  const dir = mkdtempSync(join(tmpdir(), 'symbiote-e2e-code-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'opened.jsonl');
  const fake = join(dir, 'code');
  writeFileSync(
    fake,
    '#!/usr/bin/env node\n' +
      `require('node:fs').appendFileSync(${JSON.stringify(log)}, ` +
      "JSON.stringify(process.argv.slice(2)) + '\\n');\n",
  );
  chmodSync(fake, 0o755);
  symbiote.stop();
  symbiote = await serveCommits({ SYMBIOTE_CODE: fake });
  const opened = () =>
    readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);
  const repo = realpathSync(symbiote.repo);
  const [, , square = '', cube = ''] = symbiote.shas;
  const status = fileView(page).getByRole('status');

  // A commit's file: against its parent; its own copy, as src/math.ts changed after it.
  await page.goto(`${symbiote.url}git`);
  await row(page, 'Add cube').click();
  await pane(page).getByRole('button', { name: 'Show the diff of src/math.ts' }).click();
  await fileView(page).getByRole('button', { name: 'Open in VS Code' }).click();
  await expect(status).toHaveText('Opened its diff in VS Code');
  const [first = []] = opened();
  expect(first.slice(0, 2)).toEqual([repo, '--diff']);
  expect(first[2]).toMatch(new RegExp(`/revisions/${square}/src/math\\.ts$`));
  expect(readFileSync(first[2]!, 'utf8')).toBe(git(repo, 'show', `${square}:src/math.ts`) + '\n');
  expect(first[3]).toMatch(new RegExp(`/revisions/${cube}/src/math\\.ts$`));

  // A change not staged, by its key: the index against the checkout's own file.
  writeFileSync(join(repo, 'src/math.ts'), 'export const changed = true;\n');
  await page.goto(`${symbiote.url}git`);
  await page.locator('.commit.working').click();
  await pane(page).getByRole('button', { name: 'Show the diff of src/math.ts' }).click();
  await expect(fileView(page)).toContainText('not staged');
  await page.keyboard.press('o');
  await expect(status).toHaveText('Opened its diff in VS Code');
  const second = opened()[1] ?? [];
  expect(second[2]).toMatch(/\/revisions\/index\/[0-9a-f]{40}\/src\/math\.ts$/);
  expect(second[3]).toBe(join(repo, 'src/math.ts'));
  // Staged, the open file follows it to its new side.
  await pane(page).getByRole('button', { name: 'Stage src/math.ts' }).click();
  await expect(fileView(page)).toContainText('staged');
  await expect(fileView(page)).not.toContainText('not staged');
});

test('branches and tags: made at a row, renamed and deleted from the panel (V66d)', async ({
  page,
}) => {
  await page.goto(`${symbiote.url}git`);
  await row(page, 'Add square').click({ button: 'right', position: { x: 120, y: 10 } });
  await page.getByRole('menuitem', { name: 'New branch here…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Branch name' }).fill('fix/one');
  await dialog.getByRole('checkbox', { name: 'Check it out' }).uncheck();
  await dialog.getByRole('button', { name: 'Make the branch' }).click();
  await expect(statusBar(page)).toContainText(`Made fix/one at ${symbiote.shas[2]!.slice(0, 7)}`);
  await expect(row(page, 'Add square').locator('.ref', { hasText: 'fix/one' })).toBeVisible();
  expect(git(symbiote.repo, 'branch', '--show-current')).toBe('main');

  const panel = page.getByRole('complementary', { name: 'Branches' });
  // A folder's one branch is listed whole.
  await panel.getByRole('button', { name: 'fix/one', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  await dialog.getByRole('textbox', { name: 'Branch name' }).fill('fix/two');
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(statusBar(page)).toContainText('Renamed fix/one to fix/two');
  await expect(row(page, 'Add square').locator('.ref', { hasText: 'fix/two' })).toBeVisible();

  // wip holds a commit no other branch does: deleting it asks again, counting it.
  await panel.getByRole('button', { name: 'wip', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog).toContainText('wip is not merged: 1 commit only it holds would be lost.');
  await dialog.getByRole('button', { name: 'Delete anyway' }).click();
  await expect(statusBar(page)).toContainText('Deleted wip');
  await expect(row(page, 'Try a wobble')).toHaveCount(0);

  // A tag, annotated, then deleted from its row's menu.
  await row(page, 'Add half').click({ button: 'right', position: { x: 120, y: 10 } });
  await page.getByRole('menuitem', { name: 'New tag here…' }).click();
  await dialog.getByRole('textbox', { name: 'Tag name' }).fill('v2');
  await dialog.getByRole('textbox', { name: /Message/ }).fill('Second release');
  await dialog.getByRole('button', { name: 'Tag it' }).click();
  await expect(row(page, 'Add half').locator('.ref-tag', { hasText: 'v2' })).toBeVisible();
  expect(git(symbiote.repo, 'cat-file', '-t', 'v2')).toBe('tag');
  await row(page, 'Add half').click({ button: 'right', position: { x: 120, y: 10 } });
  await page.getByRole('menuitem', { name: 'Delete the tag v2…' }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row(page, 'Add half').locator('.ref-tag', { hasText: 'v2' })).toHaveCount(0);
});

test('fetch, pull and push against a remote; never forced (V66e)', async ({ page }) => {
  const bare = mkdtempSync(join(tmpdir(), 'symbiote-e2e-origin-'));
  const other = mkdtempSync(join(tmpdir(), 'symbiote-e2e-other-'));
  cleanups.push(() => rmSync(bare, { recursive: true, force: true }));
  cleanups.push(() => rmSync(other, { recursive: true, force: true }));
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  git(symbiote.repo, 'remote', 'set-url', 'origin', bare);
  await page.goto(`${symbiote.url}git`);
  const remotes = page.getByRole('group', { name: 'Remotes' });
  await expect(page.locator('.git-title p')).toContainText(
    'main has no upstream: Push sets origin/main',
  );
  await remotes.getByRole('button', { name: 'Push' }).click();
  await expect(statusBar(page)).toContainText('Pushed to origin/main, now its upstream');
  await expect(page.locator('.git-title p')).toContainText('Up to date with origin/main');

  // Another clone pushes a commit: Fetch shows it to pull, Pull fast-forwards to it.
  git(other, 'clone', '-q', bare, '.');
  writeFileSync(join(other, 'theirs.txt'), 'theirs\n');
  git(other, 'add', '.');
  git(other, 'commit', '-q', '-m', 'Their change');
  git(other, 'push', '-q', 'origin', 'main');
  await remotes.getByRole('button', { name: 'Fetch' }).click();
  await expect(statusBar(page)).toContainText('Fetched every remote');
  await expect(remotes.getByRole('button', { name: /Pull/ })).toContainText('↓1');
  await remotes.getByRole('button', { name: /Pull/ }).click();
  await page.getByRole('menuitem', { name: 'Fast-forward only' }).click();
  await expect(statusBar(page)).toContainText('Pulled');
  await expect(page.locator('.commit.head .commit-subject')).toHaveText('Their change');

  // Diverged: fast-forward only is refused in git's words, and nothing moves.
  writeFileSync(join(other, 'more.txt'), 'more\n');
  git(other, 'add', '.');
  git(other, 'commit', '-q', '-m', 'More of theirs');
  git(other, 'push', '-q', 'origin', 'main');
  writeFileSync(join(symbiote.repo, 'mine.txt'), 'mine\n');
  git(symbiote.repo, 'add', '.');
  git(symbiote.repo, 'commit', '-q', '-m', 'Mine');
  await page.reload();
  await remotes.getByRole('button', { name: 'Fetch' }).click();
  await expect(statusBar(page)).toContainText('Fetched every remote');
  await remotes.getByRole('button', { name: /Pull/ }).click();
  await page.getByRole('menuitem', { name: 'Fast-forward only' }).click();
  await expect(statusBar(page)).toContainText('Could not pull');
  expect(git(symbiote.repo, 'log', '-1', '--format=%s')).toBe('Mine');
  // A push is refused, not forced.
  await remotes.getByRole('button', { name: /Push/ }).click();
  await expect(statusBar(page)).toContainText('Could not push');
  expect(git(bare, 'log', '-1', '--format=%s', 'main')).toBe('More of theirs');
  // Rebasing: Mine on top of theirs.
  await remotes.getByRole('button', { name: /Pull/ }).click();
  await page.getByRole('menuitem', { name: 'Rebase' }).click();
  await expect(statusBar(page)).toContainText('Pulled');
  expect(git(symbiote.repo, 'log', '-2', '--format=%s')).toBe('Mine\nMore of theirs');
});

test('find a commit by its message, author or SHA; Enter steps through them (V66f)', async ({
  page,
}) => {
  await page.goto(`${symbiote.url}git`);
  await expect(row(page, 'Add half')).toBeVisible();
  await page.keyboard.press('f');
  const field = page.getByRole('searchbox', { name: 'Find a commit' });
  await expect(field).toBeFocused();
  await field.fill('cube');
  await expect(page.locator('.git-find-count')).toHaveText('1 of 1');
  await expect(row(page, 'Add cube')).toHaveClass(/cursor/);
  await expect(row(page, 'Add cube')).toHaveClass(/matched/);
  await field.fill('add');
  await expect(page.locator('.git-find-count')).toHaveText(/of 3$/);
  const first = await page.locator('.commit.cursor .commit-subject').textContent();
  await field.press('Enter');
  await expect(page.locator('.commit.cursor .commit-subject')).not.toHaveText(first ?? '');
  await field.fill(symbiote.shas[0]!.slice(0, 8));
  await expect(page.locator('.git-find-count')).toHaveText('1 of 1');
  await field.fill('no such words');
  await expect(page.locator('.git-find-count')).toHaveText('None');
  await field.press('Escape');
  await expect(field).toHaveValue('');
  await expect(page.locator('.commit.matched')).toHaveCount(0);
});
