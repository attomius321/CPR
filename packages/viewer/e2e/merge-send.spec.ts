import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// AR2 (decision 742): a merge whose check failed is sent to the branch's agent on the person's
// press, as `merge.failed` says it; before AR2 the person pasted the failure into its terminal by
// hand (14 times in 13 workspaces). Its prompt then reads as Symbiote's, not the person's
// (decision 741).
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

test("a failed merge check: Send to the agent types it into the branch's agent, as Symbiote's", async ({
  page,
}) => {
  symbiote = await serveWorkspaces({ terminal: false });
  await page.goto(`${symbiote.url}start`);
  const start = page.getByRole('region', { name: 'Start a workspace' });
  await start.getByRole('textbox', { name: 'Title' }).fill('Add a half function');
  await start.getByRole('textbox', { name: 'Goal' }).fill('Return a / 2.');
  await start.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
  await expect(start).toBeHidden();
  const branch = 'feature/add-a-half-function';
  symbiote.commit(branch, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  symbiote.report(branch, 'Done: half() in src/half.ts.');
  await expect(page.locator(`.workspace-row[data-branch="${branch}"]`)).toContainText(
    'Ready for review',
    POLL,
  );
  // The project's check fails, whatever the branch does.
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(
    join(symbiote.repo, 'symbiote', 'config.json'),
    JSON.stringify({ merge: { checks: ['test -f never-there.txt'] } }),
  );

  const at = `?branch=${encodeURIComponent(branch)}`;
  await page.goto(`${symbiote.url}${at}`);
  const panel = page.getByRole('region', { name: `Workspace ${branch}` });
  await panel.getByRole('button', { name: 'Review', exact: true }).click();
  // The review is under the files on the Files page (V90): nothing to open.
  await expect(page.locator('.files-side .review-tab')).toBeVisible();
  await page.getByLabel('Approve').check();
  await page.getByRole('button', { name: 'Finish review' }).click();
  await expect(page.locator('.finished')).toContainText('Approved', POLL);
  await page.goto(`${symbiote.url}${at}`);
  await panel.getByRole('button', { name: 'Merge into', exact: true }).click();

  await page.goto(`${symbiote.url}?merge=${encodeURIComponent(branch)}`);
  const entry = page.getByRole('region', { name: `Merge of ${branch}` });
  await expect(entry.locator('.merge-row-state')).toContainText('test -f never-there.txt', POLL);
  // Failed, the workspace is its own card again beside its merge's row in Merging: its agent fixes
  // it (fix/failed-merge-hides-workspace; V93 showed it in Merging alone, failed too).
  await expect(page.locator(`.workspace-row[data-branch="${branch}"]`)).toBeVisible(POLL);
  await expect(
    page.getByRole('region', { name: 'Merging' }).locator(`[data-merge="${branch}"]`),
  ).toBeVisible();
  // The merge's page names its workspace as a link to it.
  await expect(entry.getByRole('link', { name: branch, exact: true })).toHaveAttribute(
    'href',
    `/${at}`,
  );
  // Screenshots of the button for the style check, dark and light at 1× (AR2_SHOTS=<folder>).
  const shots = process.env.AR2_SHOTS;
  if (shots) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await entry.getByRole('button', { name: 'Send to the agent' }).waitFor();
    await page.screenshot({ path: join(shots, 'merge-send-dark.png') });
    await page.evaluate(() => localStorage.setItem('symbiote.viewer.theme', 'light'));
    await page.reload();
    await entry.getByRole('button', { name: 'Send to the agent' }).waitFor();
    await page.screenshot({ path: join(shots, 'merge-send-light.png') });
    await page.evaluate(() => localStorage.setItem('symbiote.viewer.theme', 'dark'));
    await page.reload();
  }
  const before = symbiote.calls().length;
  await entry.getByRole('button', { name: 'Send to the agent' }).click();
  await expect(page.getByRole('contentinfo', { name: 'Status bar' })).toContainText(
    `Sent the failed check to ${branch}'s agent`,
    POLL,
  );
  // Sent, its workspace's page opens: the agent answers there.
  await expect(panel).toBeVisible();
  expect(new URL(page.url()).search).toBe(at);
  await expect(
    page.locator(`.workspace-row[data-branch="${branch}"] .workspace-about`),
  ).toHaveAttribute('aria-current', 'true');
  // The fake Claude Code was resumed with the failure, in merge.failed's words.
  const resumed = symbiote
    .calls()
    .slice(before)
    .find((c) => c.args.includes('--resume'));
  const said = resumed?.args.at(-1) ?? '';
  expect(said).toMatch(/^Symbiote merged [0-9a-f]{7} into main and ran the check: /);
  expect(said).toContain('`test -f never-there.txt` failed');
  expect(said).toContain('Say whether your branch causes it.');

  // Its thread says it was Symbiote's message, not the person's.
  await panel.getByRole('tab', { name: 'Thread' }).click();
  await expect(
    panel.locator('.thread-symbiote summary', { hasText: "Symbiote's message" }),
  ).toBeVisible(POLL);
  await expect(panel.locator('.thread-you', { hasText: 'Symbiote merged' })).toHaveCount(0);
});
