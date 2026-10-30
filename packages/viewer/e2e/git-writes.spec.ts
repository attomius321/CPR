import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveCommits, type RunningCommits } from './symbiote.js';

// More of git on Git's page (fix/git-page-feature-extend, decisions 636–645): cherry-pick, revert,
// merge, rebase, an operation continued or aborted, stashes, reset, discard, staging lines, a
// file's history and blame, a remote branch deleted, branches hidden. Each test gets its own
// repository (serveCommits: main at "Add half", wip at "Try a wobble").
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
const menuOf = (page: Page, subject: string) =>
  row(page, subject).click({ button: 'right', position: { x: 120, y: 10 } });
const pane = (page: Page) => page.locator('.git-details');
const fileView = (page: Page) => page.locator('.git-shown');
const dialog = (page: Page) => page.getByRole('dialog');
const panel = (page: Page) => page.getByRole('complementary', { name: 'Branches' });
const statusBar = (page: Page) => page.getByRole('contentinfo', { name: 'Status bar' });
const math = () => join(symbiote.repo, 'src/math.ts');

/** A branch `name` from `from` with one commit adding `file`; main checked out again. */
const branchWith = (name: string, from: string, file: string, content: string, subject: string) => {
  git(symbiote.repo, 'switch', '-q', '-c', name, from);
  writeFileSync(join(symbiote.repo, file), content);
  git(symbiote.repo, 'add', '.');
  git(symbiote.repo, 'commit', '-q', '-m', subject);
  const sha = git(symbiote.repo, 'rev-parse', 'HEAD');
  git(symbiote.repo, 'switch', '-q', 'main');
  return sha;
};

test('cherry-picks a commit onto main and reverts one, each asked first (decision 637)', async ({
  page,
}) => {
  const side = branchWith('side', symbiote.shas[2]!, 'side.txt', 'side\n', 'Add a side file');
  await page.goto(`${symbiote.url}git`);
  await menuOf(page, 'Add a side file');
  await page.getByRole('menuitem', { name: 'Cherry-pick onto main…' }).click();
  await expect(dialog(page)).toContainText(`Cherry-pick ${side.slice(0, 7)} onto main?`);
  await dialog(page).getByRole('button', { name: 'Cherry-pick' }).click();
  await expect(statusBar(page)).toContainText(`Cherry-picked ${side.slice(0, 7)} onto main`);
  expect(git(symbiote.repo, 'log', '-1', '--format=%s')).toBe('Add a side file');
  await expect(page.locator('.commit.head .commit-subject')).toHaveText('Add a side file');

  await page.locator('.commit.head').click({ button: 'right', position: { x: 120, y: 10 } });
  await page.getByRole('menuitem', { name: 'Revert…' }).click();
  await dialog(page).getByRole('button', { name: 'Revert' }).click();
  await expect(statusBar(page)).toContainText('Reverted');
  expect(git(symbiote.repo, 'log', '-1', '--format=%s')).toBe('Revert "Add a side file"');
  expect(existsSync(join(symbiote.repo, 'side.txt'))).toBe(false);
});

test('a merge that stops on conflicts: aborted, then resolved and continued (decisions 636, 638)', async ({
  page,
}) => {
  const atCube = git(symbiote.repo, 'show', `${symbiote.shas[3]}:src/math.ts`);
  branchWith(
    'clash',
    symbiote.shas[3]!,
    'src/math.ts',
    `${atCube}\nexport const clash = 1;\n`,
    'Clash with half',
  );
  const head = git(symbiote.repo, 'rev-parse', 'HEAD');
  await page.goto(`${symbiote.url}git`);
  const merge = async () => {
    await panel(page)
      .getByRole('button', { name: 'clash', exact: true })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Merge into main…' }).click();
    await dialog(page).getByRole('button', { name: 'Merge' }).click();
    await expect(statusBar(page)).toContainText('Stopped on conflicts');
  };
  await merge();
  await page.locator('.commit.working').click();
  const band = pane(page).locator('.git-operation');
  await expect(band).toContainText('A merge is in progress');
  await band.getByRole('button', { name: 'Abort…' }).click();
  await dialog(page).getByRole('button', { name: 'Abort' }).click();
  await expect(statusBar(page)).toContainText('Aborted the merge');
  await expect(page.locator('.commit.working')).toHaveCount(0);
  expect(git(symbiote.repo, 'rev-parse', 'HEAD')).toBe(head);

  // Again, resolved and staged, then Continue: the merge's commit.
  await merge();
  await page.locator('.commit.working').click();
  await expect(band.getByRole('button', { name: 'Continue' })).toBeVisible();
  writeFileSync(math(), `${atCube}\nexport const clash = 1;\n`);
  await pane(page).getByRole('button', { name: 'Stage src/math.ts' }).click();
  await band.getByRole('button', { name: 'Continue' }).click();
  await expect(statusBar(page)).toContainText('Continued the merge');
  expect(git(symbiote.repo, 'log', '-1', '--format=%s')).toBe("Merge branch 'clash'");
  await expect(page.locator('.commit.working')).toHaveCount(0);
});

test('rebases main onto a branch from its menu in the panel (decision 638)', async ({ page }) => {
  const side = branchWith('side', symbiote.shas[1]!, 'side.txt', 'side\n', 'Add a side file');
  await page.goto(`${symbiote.url}git`);
  await panel(page).getByRole('button', { name: 'side', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rebase main onto it…' }).click();
  await dialog(page).getByRole('button', { name: 'Rebase' }).click();
  await expect(statusBar(page)).toContainText('Rebased main onto side');
  git(symbiote.repo, 'merge-base', '--is-ancestor', side, 'main');
  expect(git(symbiote.repo, 'log', '-1', '--format=%s').startsWith('Add half')).toBe(true);
});

test('stashes the changes with a message, applies the stash, then drops it (decision 639)', async ({
  page,
}) => {
  writeFileSync(math(), 'export const changed = true;\n');
  writeFileSync(join(symbiote.repo, 'new.txt'), 'new\n');
  await page.goto(`${symbiote.url}git`);
  await page.locator('.commit.working').click();
  await pane(page).getByRole('button', { name: 'Stash…' }).click();
  await dialog(page).getByRole('textbox', { name: 'Message (optional)' }).fill('Half done');
  await dialog(page).getByRole('button', { name: 'Stash' }).click();
  await expect(statusBar(page)).toContainText('Stashed: Half done');
  await expect(page.locator('.commit.working')).toHaveCount(0);
  expect(existsSync(join(symbiote.repo, 'new.txt'))).toBe(false);
  const stashes = page.getByRole('list', { name: 'Stashes' });
  await stashes.getByRole('button', { name: /Half done/ }).click();
  await page.getByRole('menuitem', { name: 'Apply', exact: true }).click();
  await expect(statusBar(page)).toContainText('Applied the stash Half done');
  await expect(page.locator('.commit.working')).toBeVisible();
  expect(readFileSync(math(), 'utf8')).toBe('export const changed = true;\n');
  await stashes.getByRole('button', { name: /Half done/ }).click();
  await page.getByRole('menuitem', { name: 'Drop…' }).click();
  await expect(dialog(page)).toContainText('Its changes are lost');
  await dialog(page).getByRole('button', { name: 'Drop' }).click();
  await expect(statusBar(page)).toContainText('Dropped the stash Half done');
  await expect(stashes).toHaveCount(0);
});

test("resets main to a row, its changes kept; discards a file's changes and deletes a new one (decisions 640, 641)", async ({
  page,
}) => {
  const cube = symbiote.shas[3]!;
  await page.goto(`${symbiote.url}git`);
  await menuOf(page, 'Add cube');
  await page.getByRole('menuitem', { name: 'Reset main to here…' }).click();
  await expect(dialog(page)).toContainText('1 commit leaves main.');
  await expect(dialog(page).getByRole('radio', { name: /Mixed/ })).toBeChecked();
  await dialog(page).getByRole('button', { name: 'Reset' }).click();
  await expect(statusBar(page)).toContainText(`Reset main to ${cube.slice(0, 7)}, mixed`);
  expect(git(symbiote.repo, 'rev-parse', 'HEAD')).toBe(cube);
  expect(readFileSync(math(), 'utf8')).toContain('export function half');

  await page.locator('.commit.working').click();
  await pane(page).getByRole('button', { name: 'Discard the changes to src/math.ts' }).click();
  await expect(dialog(page)).toContainText('the changes not staged are lost');
  await dialog(page).getByRole('button', { name: 'Discard' }).click();
  await expect(statusBar(page)).toContainText('Discarded the changes to src/math.ts');
  expect(readFileSync(math(), 'utf8')).not.toContain('export function half');

  writeFileSync(join(symbiote.repo, 'new.txt'), 'new\n');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('.commit.working').click();
  await pane(page).getByRole('button', { name: 'Delete new.txt' }).click();
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(statusBar(page)).toContainText('Deleted new.txt');
  expect(existsSync(join(symbiote.repo, 'new.txt'))).toBe(false);
});

test("stages and unstages an uncommitted file's lines and hunks from its diff (decision 642)", async ({
  page,
}) => {
  const before = readFileSync(math(), 'utf8');
  writeFileSync(math(), `// top\n${before}export const tail = 1;\n`);
  await page.goto(`${symbiote.url}git`);
  await page.locator('.commit.working').click();
  await pane(page).getByRole('button', { name: 'Show the diff of src/math.ts' }).click();
  await expect(fileView(page).locator('.git-shown-side')).toHaveText('not staged');
  await expect(fileView(page).getByRole('button', { name: 'Stage this hunk' })).toHaveCount(2);
  await fileView(page).getByRole('button', { name: 'Pick added line 1' }).click();
  await expect(fileView(page).locator('.git-picks')).toContainText('1 line picked');
  await fileView(page).getByRole('button', { name: 'Stage it' }).click();
  await expect(fileView(page).getByRole('button', { name: 'Stage this hunk' })).toHaveCount(1);
  expect(git(symbiote.repo, 'diff', '--cached')).toContain('+// top');
  expect(git(symbiote.repo, 'diff', '--cached')).not.toContain('tail');
  // The other hunk: every line staged, the file follows to its staged side.
  await fileView(page).getByRole('button', { name: 'Stage this hunk' }).click();
  await expect(fileView(page).locator('.git-shown-side')).toHaveText('staged');
  expect(git(symbiote.repo, 'diff')).toBe('');
  // Unstaged again, a hunk at a time.
  await expect(fileView(page).getByRole('button', { name: 'Unstage this hunk' })).toHaveCount(2);
  await fileView(page).getByRole('button', { name: 'Unstage this hunk' }).first().click();
  await expect(fileView(page).getByRole('button', { name: 'Unstage this hunk' })).toHaveCount(1);
  expect(git(symbiote.repo, 'diff', '--cached')).not.toContain('// top');
  expect(readFileSync(math(), 'utf8').startsWith('// top\n')).toBe(true);
});

test("a shown file's history goes to an older commit, the file open there; its blame names each line's commit (decision 643)", async ({
  page,
}) => {
  const [, , square = '', cube = ''] = symbiote.shas;
  await page.goto(`${symbiote.url}git`);
  await row(page, 'Add cube').click();
  await pane(page).getByRole('button', { name: 'Show the diff of src/math.ts' }).click();
  const views = fileView(page).getByRole('group', { name: 'Show' });
  await views.getByRole('button', { name: 'History' }).click();
  const history = fileView(page).getByRole('list', { name: 'History of src/math.ts' });
  await expect(history.locator('[aria-current="true"]')).toContainText('Add cube');
  await expect(history).not.toContainText('Add half');
  await history.getByRole('button', { name: /Add square/ }).click();
  await expect(pane(page).locator('.git-details-title')).toHaveText('Add square');
  await expect(fileView(page)).toHaveAttribute('aria-label', 'Changes to src/math.ts');

  await views.getByRole('button', { name: 'Blame' }).click();
  const blame = fileView(page).getByRole('table', { name: 'Blame of src/math.ts' });
  await expect(blame.locator('.git-blame-commit', { hasText: square.slice(0, 7) })).toHaveCount(1);
  await expect(blame).not.toContainText(cube.slice(0, 7));
});

test('deletes a remote branch on its remote, and hides a branch from the graph then shows it (decisions 644, 645)', async ({
  page,
}) => {
  const bare = mkdtempSync(join(tmpdir(), 'symbiote-e2e-origin-'));
  cleanups.push(() => rmSync(bare, { recursive: true, force: true }));
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  git(symbiote.repo, 'remote', 'set-url', 'origin', bare);
  git(symbiote.repo, 'push', '-q', 'origin', 'main', 'wip:spare');
  await page.goto(`${symbiote.url}git`);
  await panel(page).getByRole('button', { name: 'spare', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete from origin…' }).click();
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(statusBar(page)).toContainText('Deleted origin/spare from origin');
  expect(git(bare, 'branch', '--list')).not.toContain('spare');
  await expect(panel(page).getByRole('button', { name: 'spare', exact: true })).toHaveCount(0);

  await expect(row(page, 'Try a wobble')).toHaveCount(1);
  await panel(page).getByRole('button', { name: 'wip', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Hide from the graph' }).click();
  await expect(statusBar(page)).toContainText('Hid wip from the graph');
  await expect(row(page, 'Try a wobble')).toHaveCount(0);
  const hidden = panel(page).getByRole('button', { name: 'wip hidden' });
  await expect(hidden).toBeVisible();
  await hidden.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Show in the graph' }).click();
  await expect(row(page, 'Try a wobble')).toHaveCount(1);
});
