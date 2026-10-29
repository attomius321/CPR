import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// History (V78): the finished workspaces under Monitor (`h`), the picked one beside the list,
// read only — its Activity, Thread, Brief and Changes — from Symbiote's files and git.
let symbiote: RunningWorkspaces;
const errors: string[] = [];

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  symbiote.stop();
  expect(errors).toEqual([]);
});

const POLL = { timeout: 15_000 };
const HALF = 'feature/add-a-half-function';
const OLD = 'fix/scout-effort';

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: symbiote.repo, encoding: 'utf8' }).trim();

/** Writes a file under the repository's `symbiote/`, its folders made. */
function put(path: string, text: string) {
  const file = join(symbiote.repo, 'symbiote', path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const lines = (values: unknown[]) => values.map((v) => `${JSON.stringify(v)}\n`).join('');

/**
 * A fix finished two days ago, before V78 (no `tip`): its brief, a report in its thread, one
 * recorded command; its branch gone, never merged.
 */
function oldFix() {
  const at = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
  put(
    `workspaces/${OLD}.json`,
    JSON.stringify({
      about: 'A workspace started in Symbiote.',
      agent: { kind: 'claude', hooks: true, activity: true, effort: 'high', started: at(50) },
      base: symbiote.shas[0],
      branch: OLD,
      brief: '# Fix: Scout effort\n\n## What happens\nScout starts at the wrong level.\n',
      created: at(50),
      finished: at(48),
      kind: 'fix',
      planFirst: false,
      title: 'Scout effort',
      worktree: `${symbiote.repo}.worktrees/fix-scout-effort`,
    }),
  );
  put(
    `threads/${OLD}.jsonl`,
    lines([
      { at: at(49.9), session: 's', kind: 'prompt', text: 'Fix the level.' },
      { at: at(49), session: 's', kind: 'report', text: 'Scout now starts at the **set** level.' },
    ]),
  );
  put(
    `activity/${OLD}.jsonl`,
    lines([
      {
        at: at(49.5),
        session: 's',
        id: 't1',
        tool: 'Bash',
        phase: 'start',
        subject: 'pnpm check',
        input: 'pnpm check',
      },
      { at: at(49.4), session: 's', id: 't1', tool: 'Bash', phase: 'end', exit: 0 },
    ]),
  );
}

/** Starts Add a half function, commits, merges it into main and cleans it up from its page. */
async function finishHalf(page: Page) {
  await page.goto(`${symbiote.url}start`);
  const start = page.getByRole('region', { name: 'Start a workspace' });
  await start.getByRole('textbox', { name: 'Title' }).fill('Add a half function');
  await start.getByRole('textbox', { name: 'Goal' }).fill('Return a / 2.');
  await start.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
  await expect(start).toBeHidden();
  symbiote.commit(HALF, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  symbiote.session(HALF, { state: 'done' });
  git('merge', '--quiet', '--no-ff', '-m', `Merge ${HALF}: Add a half function`, HALF);
  await page.reload();
  const head = page.getByRole('region', { name: `Workspace ${HALF}` }).locator('.workspace-top');
  const cleanUp = head.getByRole('button', { name: 'Clean up', exact: true });
  await expect(cleanUp).toBeVisible(POLL);
  await cleanUp.click();
  await expect(page).toHaveURL(`${symbiote.url}git`, POLL);
}

const list = (page: Page) => page.getByRole('navigation', { name: 'Finished workspaces' });
const rowOf = (page: Page, branch: string) => list(page).locator(`[data-branch="${branch}"]`);
const picked = (page: Page, branch: string) =>
  page.getByRole('region', { name: `Workspace ${branch}` });

test('History, under Monitor: the cleaned-up workspaces, the picked one read only (V78)', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await finishHalf(page);
  oldFix();

  // Its link under Monitor, and h.
  const pages = page.getByRole('navigation', { name: 'Pages' });
  await expect(pages.getByRole('link').nth(3)).toHaveAccessibleName('Monitor');
  await expect(pages.getByRole('link').nth(4)).toHaveAccessibleName('History');
  await page.keyboard.press('h');
  await expect(page).toHaveURL(`${symbiote.url}workspace-history`);
  await expect(pages.getByRole('link', { name: 'History' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('.page-head h1')).toHaveText('History');
  await expect(page.locator('.page-line')).toContainText('2 finished workspaces');

  // The newest first, by day; none picked, the newest is shown.
  await expect(list(page).locator('h2')).toHaveText(['Today', /\S/]);
  await expect(list(page).locator('.history-row')).toHaveCount(2);
  await expect(rowOf(page, HALF)).toHaveAttribute('aria-current', 'true');
  await expect(rowOf(page, HALF).locator('.history-outcome')).toHaveText('Merged');
  await expect(rowOf(page, OLD)).toContainText('Not merged');
  const half = picked(page, HALF);
  await expect(half.locator('h2')).toContainText('Add a half function');
  await expect(half.locator('h2 .history-outcome')).toHaveText('Merged into main');
  // Read only: its four tabs, no terminal, no shells, no reply, no Clean up.
  await expect(half.getByRole('tab')).toHaveText(['Activity', 'Thread', 'Brief', 'Changes']);
  await expect(half.getByRole('tab', { name: 'Activity' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(half.getByRole('button', { name: /Clean up|Stop the agent|New shell/ })).toHaveCount(
    0,
  );
  await expect(half.locator('textarea')).toHaveCount(0);
  // Its commit is in its Activity though its branch is gone.
  expect(git('branch', '--list', HALF)).toBe('');
  await expect(half.getByRole('list', { name: 'Activity' })).toContainText('Add half', POLL);
  await half.getByRole('tab', { name: 'Changes' }).click();
  await expect(half.getByRole('region', { name: 'Commits' })).toContainText('Add half');
  await expect(half.getByRole('region', { name: 'Files' })).toContainText('half.ts');
  await expect(half.getByRole('region', { name: 'Not committed' })).toHaveCount(0);
  await expect(page).toHaveURL(
    `${symbiote.url}workspace-history?branch=${encodeURIComponent(HALF)}&changes`,
  );

  // Search narrows the rows; Esc clears it.
  const search = list(page).getByRole('searchbox', { name: 'Search finished workspaces' });
  await search.fill('wrong level');
  await expect(list(page).locator('.history-row')).toHaveCount(1);
  await expect(rowOf(page, OLD)).toBeVisible();
  await search.press('Escape');
  await expect(list(page).locator('.history-row')).toHaveCount(2);

  // The arrows move the pick; the tab stays; the address keeps both through a reload.
  await rowOf(page, HALF).focus();
  await page.keyboard.press('ArrowDown');
  const old = picked(page, OLD);
  await expect(old).toBeVisible();
  await expect(rowOf(page, OLD)).toBeFocused();
  await old.getByRole('tab', { name: 'Brief' }).click();
  await expect(old.locator('.markdown')).toContainText('Scout starts at the wrong level.');
  await expect(old).toContainText('Started with Claude Code at high effort.');
  await page.reload();
  await expect(picked(page, OLD).getByRole('tab', { name: 'Brief' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // Its thread and its recorded command, from Symbiote's files.
  await picked(page, OLD).getByRole('tab', { name: 'Thread' }).click();
  await expect(picked(page, OLD).locator('.thread')).toContainText('Scout now starts at the set');
  await picked(page, OLD).getByRole('tab', { name: 'Activity' }).click();
  await expect(picked(page, OLD).locator('.activity-counts')).toContainText('1 call');

  // A finished workspace's old address moves here.
  await page.goto(`${symbiote.url}?branch=${encodeURIComponent(HALF)}`);
  await expect(page).toHaveURL(
    `${symbiote.url}workspace-history?branch=${encodeURIComponent(HALF)}`,
    POLL,
  );
  await expect(picked(page, HALF)).toBeVisible();
});

test('History with nothing finished says where workspaces come from', async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}workspace-history`);
  await expect(page.locator('.history-none')).toContainText('No finished workspace yet.');
  await expect(page.locator('.page-line')).toContainText('0 finished workspaces');
});
