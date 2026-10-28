import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// A workspace's changes (V29d): its branch's commits and files, and what its worktree has not
// committed, in a panel at the right of its terminal.
let running: { stop(): void }[] = [];
const errors: string[] = [];
const serve = async (): Promise<RunningWorkspaces> => {
  const served = await serveWorkspaces();
  running.push(served);
  return served;
};

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  for (const served of running) served.stop();
  running = [];
  expect(errors).toEqual([]);
});

const POLL = { timeout: 12_000 };
const BRANCH = 'feature/add-a-half-function';
const sidenav = (page: Page) => page.getByRole('complementary', { name: 'Pages and workspaces' });
const workspace = (page: Page) => page.getByRole('region', { name: `Workspace ${BRANCH}` });
const panel = (page: Page) => workspace(page).getByRole('complementary', { name: 'Changes' });
const toggle = (page: Page) => workspace(page).getByRole('button', { name: 'Changes' });
const start = async (page: Page) => {
  await sidenav(page).getByRole('link', { name: 'Start a workspace' }).click();
  const dialog = page.getByRole('region', { name: 'Start a workspace' });
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Add a half function');
  await dialog.getByRole('textbox', { name: 'Goal' }).fill('Add a half function');
  await dialog.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
  await expect(dialog).toBeHidden();
};
/** The size the fake agent last printed: its terminal's columns and rows. */
const lastSize = async (page: Page) => {
  const text = (await workspace(page).locator('.xterm-rows').textContent()) ?? '';
  const [, columns = '0', rows = '0'] = [...text.matchAll(/\[(\d+)x(\d+)\]/g)].at(-1) ?? [];
  return { columns: Number(columns), rows: Number(rows) };
};

test("lists the branch's commits and files and what is not committed; a file opens as its diff", async ({
  page,
}) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}git`);
  await start(page);
  await expect(panel(page)).toBeVisible();
  const commits = panel(page).getByRole('region', { name: 'Commits' });
  const files = panel(page).getByRole('region', { name: 'Files' });
  const loose = panel(page).getByRole('region', { name: 'Not committed' });
  await expect(commits).toContainText('No commits yet');
  await expect(commits).toContainText('since main');

  symbiote.commit(BRANCH, 'half.ts', 'export const half = (n: number) => n / 2;\n', 'Add half');
  symbiote.commit(
    BRANCH,
    'src/half.test.ts',
    'import { half } from "../half";\nhalf(2);\n',
    'Test half',
  );
  writeFileSync(join(symbiote.folder(BRANCH), 'notes.md'), 'To do\n');
  // Read again with the list, every 5 s while its agent works.
  await expect(commits.getByRole('listitem')).toHaveCount(2, POLL);
  await expect(commits.getByRole('listitem').nth(0)).toContainText('Test half');
  await expect(commits.getByRole('listitem').nth(1)).toContainText('Add half');
  await expect(files.getByRole('heading')).toContainText('2');
  await expect(files.getByRole('heading')).toContainText('+3');
  const half = files.getByRole('button', { name: 'Open the changes to half.ts in VS Code' });
  await expect(half).toContainText('+1');
  await expect(
    files.getByRole('button', { name: 'Open the changes to src/half.test.ts in VS Code' }),
  ).toContainText('+2');
  await expect(
    loose.getByRole('button', { name: 'Open the changes to notes.md in VS Code' }),
  ).toContainText('U');

  await half.click();
  await expect(workspace(page).getByRole('status')).toHaveText(
    'Opened the changes to half.ts in VS Code',
  );
  // A new file: nothing to compare it with, so the worktree's file alone, as it is.
  const folder = symbiote.folder(BRANCH);
  expect(symbiote.opened()).toEqual([[folder, join(folder, 'half.ts')]]);

  // Beside it the terminal keeps about half the window (decision 186): 47 % and 94 columns of 9 px
  // since V72 (the page frame's 16 px margins and gutter, its two-line head); 49 % and 97 since
  // V61 (the cards' gutters, a 264 px sidenav, its 15 px type); 56 % and 110 before.
  await expect.poll(async () => (await lastSize(page)).columns, POLL).toBeGreaterThan(0);
  const box = await workspace(page).locator('.xterm-screen').boundingBox();
  expect(((box?.width ?? 0) * (box?.height ?? 0)) / (1440 * 900)).toBeGreaterThan(0.45);
  expect((await lastSize(page)).columns).toBeGreaterThanOrEqual(92);
});

test("] and the head's button hide it, kept across a reload; shown only where there is room", async ({
  page,
}) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}git`);
  await start(page);
  await expect(panel(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  await toggle(page).click();
  await expect(panel(page)).toBeHidden();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  // The terminal takes the room back: 124 columns of 9 px since V72's 16 px margins (127 since
  // V61, 140 of 8 px before).
  await expect.poll(async () => (await lastSize(page)).columns, POLL).toBeGreaterThanOrEqual(122);

  await page.reload();
  await expect(workspace(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(panel(page)).toBeHidden();
  // The terminal takes the focus once it is attached: wait for it, or on a loaded machine it
  // lands between the click below and `]`, which then goes to the agent (a merge check, V59).
  await expect(workspace(page).locator('.xterm-helper-textarea')).toBeFocused(POLL);
  // ] outside the terminal (in it, the key is the agent's).
  await workspace(page).getByRole('heading', { name: 'Add a half function' }).click();
  await page.keyboard.press(']');
  await expect(panel(page)).toBeVisible();

  // 1280 with the sidenav: no room; with the rail, room again.
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(panel(page)).toBeHidden();
  await expect(toggle(page)).toBeHidden();
  await sidenav(page).getByRole('button', { name: 'Fold the sidenav' }).click();
  await expect(panel(page)).toBeVisible();
});

test('a file opens as its diff: the fork point against the worktree, a deleted file too, what is not committed against HEAD (V43)', async ({
  page,
}) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}git`);
  await start(page);
  const files = panel(page).getByRole('region', { name: 'Files' });
  const loose = panel(page).getByRole('region', { name: 'Not committed' });
  const status = workspace(page).getByRole('status');
  const folder = symbiote.folder(BRANCH);
  const inFolder = (...args: string[]) =>
    execFileSync('git', ['-C', folder, ...args], { encoding: 'utf8' }).trim();
  const fork = inFolder('rev-parse', 'main');
  const before = inFolder('show', 'main:src/math.ts');
  /** The last thing VS Code was asked to open, and its left side's text. */
  const last = () => {
    const args = symbiote.opened().at(-1) ?? [];
    return { args, left: readFileSync(args[2] ?? '', 'utf8') };
  };
  const copy = (sha: string, path: string) =>
    new RegExp(`\\${sep}revisions\\${sep}${sha}\\${sep}${path.replaceAll('/', `\\${sep}`)}$`);

  symbiote.commit(BRANCH, 'src/math.ts', `${before}\nexport const two = 2;\n`, 'Two');
  inFolder('rm', '-q', 'src/app.ts');
  inFolder('commit', '-q', '-m', 'No app');
  const tip = inFolder('rev-parse', 'HEAD');
  const math = files.getByRole('button', { name: 'Open the changes to src/math.ts in VS Code' });
  const app = files.getByRole('button', { name: 'Open the changes to src/app.ts in VS Code' });
  await expect(app).toContainText('D', POLL);

  // The fork point's file against the worktree's own.
  await math.click();
  await expect(status).toHaveText('Opened the changes to src/math.ts in VS Code');
  expect(last().args.slice(0, 2)).toEqual([folder, '--diff']);
  expect(last().args[2]).toMatch(copy(fork, 'src/math.ts'));
  expect(last().left).toBe(`${before}\n`);
  expect(last().args[3]).toBe(join(folder, 'src', 'math.ts'));
  // Deleted: a button too, against an empty side.
  await app.click();
  await expect(status).toHaveText('Opened the changes to src/app.ts in VS Code');
  expect(last().args[2]).toMatch(copy(fork, 'src/app.ts'));
  expect(last().args[3]).toMatch(copy('empty', 'src/app.ts'));
  expect(readFileSync(last().args[3] ?? '', 'utf8')).toBe('');

  // Changed again, not committed: its row from HEAD; the branch's row now ends at the tip's.
  writeFileSync(join(folder, 'src', 'math.ts'), `${before}\nexport const three = 3;\n`);
  const changed = loose.getByRole('button', {
    name: 'Open the changes to src/math.ts in VS Code',
  });
  await expect(changed).toContainText('M', POLL);
  await changed.click();
  await expect.poll(() => last().args[2]).toMatch(copy(tip, 'src/math.ts'));
  expect(last().left).toBe(`${before}\nexport const two = 2;\n`);
  expect(last().args[3]).toBe(join(folder, 'src', 'math.ts'));
  const count = symbiote.opened().length;
  await math.click();
  await expect.poll(() => symbiote.opened().length).toBe(count + 1);
  expect(last().args[2]).toMatch(copy(fork, 'src/math.ts'));
  expect(last().args[3]).toMatch(copy(tip, 'src/math.ts'));
});

test('reviews the workspace against a branch picked in its changes, or where it started (V65)', async ({
  page,
}) => {
  const symbiote = await serve();
  const [first = ''] = symbiote.shas;
  execFileSync('git', ['-C', symbiote.repo, 'branch', '-q', 'older', first]);
  await page.goto(`${symbiote.url}git`);
  await start(page);
  const commits = panel(page).getByRole('region', { name: 'Commits' });
  symbiote.commit(BRANCH, 'half.ts', 'export const half = (n: number) => n / 2;\n', 'Add half');
  await expect(commits.getByRole('listitem')).toHaveCount(1, POLL);

  const against = commits.getByRole('combobox', { name: 'Review against' });
  await expect(against).toHaveValue('');
  await expect(against.getByRole('option')).toHaveText(['main, where it started', 'main', 'older']);
  // Against older: main's last commit is the change too.
  await against.selectOption('older');
  await expect(commits.getByRole('listitem')).toHaveCount(2);
  await expect(against).toHaveValue('older');
  await expect(workspace(page).getByText('2 commits')).toBeVisible(POLL);

  // Review opens from older's fork point.
  await workspace(page).getByRole('button', { name: 'Review', exact: true }).click();
  await page.waitForURL(/\/review\//);
  await expect
    .poll(async () => {
      const answer = await page.request.get(new URL('api/graph', page.url()).href);
      return answer.status() === 200
        ? ((await answer.json()) as { revisions: { from: string } }).revisions.from
        : null;
    }, POLL)
    .toBe(first);

  // Where it started again: its own commit only.
  await page.goBack();
  await expect(against).toHaveValue('older');
  await against.selectOption('');
  await expect(commits.getByRole('listitem')).toHaveCount(1);
});
