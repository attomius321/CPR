import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './cpr.js';

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
  await sidenav(page).getByRole('button', { name: 'Start a workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a workspace' });
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

test("lists the branch's commits and files and what is not committed; a file opens at its change", async ({
  page,
}) => {
  const cpr = await serve();
  await page.goto(`${cpr.url}history`);
  await start(page);
  await expect(panel(page)).toBeVisible();
  const commits = panel(page).getByRole('region', { name: 'Commits' });
  const files = panel(page).getByRole('region', { name: 'Files' });
  const loose = panel(page).getByRole('region', { name: 'Not committed' });
  await expect(commits).toContainText('No commits yet');
  await expect(commits).toContainText('since main');

  cpr.commit(BRANCH, 'half.ts', 'export const half = (n: number) => n / 2;\n', 'Add half');
  cpr.commit(
    BRANCH,
    'src/half.test.ts',
    'import { half } from "../half";\nhalf(2);\n',
    'Test half',
  );
  writeFileSync(join(cpr.folder(BRANCH), 'notes.md'), 'To do\n');
  // Read again with the list, every 5 s while its agent works.
  await expect(commits.getByRole('listitem')).toHaveCount(2, POLL);
  await expect(commits.getByRole('listitem').nth(0)).toContainText('Test half');
  await expect(commits.getByRole('listitem').nth(1)).toContainText('Add half');
  await expect(files.getByRole('heading')).toContainText('2');
  await expect(files.getByRole('heading')).toContainText('+3');
  const half = files.getByRole('button', { name: 'Open half.ts in VS Code' });
  await expect(half).toContainText('+1');
  await expect(
    files.getByRole('button', { name: 'Open src/half.test.ts in VS Code' }),
  ).toContainText('+2');
  await expect(loose.getByRole('button', { name: 'Open notes.md in VS Code' })).toContainText('U');

  await half.click();
  await expect(workspace(page).getByRole('status')).toHaveText('Opened half.ts in VS Code');
  const folder = cpr.folder(BRANCH);
  expect(cpr.opened()).toEqual([[folder, '--goto', `${join(folder, 'half.ts')}:1:1`]]);

  // Beside it the terminal keeps more than half the window (decision 186).
  await expect.poll(async () => (await lastSize(page)).columns, POLL).toBeGreaterThan(0);
  const box = await workspace(page).locator('.xterm-screen').boundingBox();
  expect(((box?.width ?? 0) * (box?.height ?? 0)) / (1440 * 900)).toBeGreaterThan(0.55);
  expect((await lastSize(page)).columns).toBeGreaterThanOrEqual(110);
});

test("] and the head's button hide it, kept across a reload; shown only where there is room", async ({
  page,
}) => {
  const cpr = await serve();
  await page.goto(`${cpr.url}history`);
  await start(page);
  await expect(panel(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  await toggle(page).click();
  await expect(panel(page)).toBeHidden();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  // The terminal takes the room back.
  await expect.poll(async () => (await lastSize(page)).columns, POLL).toBeGreaterThanOrEqual(140);

  await page.reload();
  await expect(workspace(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(panel(page)).toBeHidden();
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
