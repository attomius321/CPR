import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// Hive's loop (HV2): a workspace started while Hive is on is driven by `symbiote view`'s runner —
// its writer (the fake Claude Code) ends a turn, Symbiote runs the project's check and sends the
// failure back, Hive off stops the writer and keeps the step, Hive on tells it to continue, and a
// passing check asks the person to land it.
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

const BRANCH = 'feature/halve';
const startPage = (page: Page) => page.getByRole('region', { name: 'Start a workspace' });
/** The workspace's card in the sidenav. */
const card = (page: Page) => page.locator(`.sidenav .workspace-row[data-branch="${BRANCH}"]`);
/** Turns Hive on or off as Settings does: `POST /api/hive`. */
const hive = (page: Page, on: boolean) =>
  page.evaluate(async (on) => {
    const response = await fetch('/api/hive', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
      body: JSON.stringify({ on }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, on);
/** What Hive sent the writer: the fake's resumes, by their text. */
const sent = () =>
  symbiote
    .calls()
    .filter((call) => call.args[1] === '--resume')
    .map((call) => call.args.at(-1) ?? '');
/** Hive's record of the workspace. */
const record = () =>
  JSON.parse(
    readFileSync(join(symbiote.repo, 'symbiote', 'hive', 'feature', 'halve.json'), 'utf8'),
  ) as { step: string; round: number; interrupted?: boolean; message?: { sent?: true } };

test('Hive drives a workspace: the check, its failure sent back, Hive off and on, landing asked', async ({
  page,
}) => {
  test.setTimeout(90_000);
  symbiote = await serveWorkspaces({ codex: true });
  // The project's check: fails until fixed.txt is committed.
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(
    join(symbiote.repo, 'symbiote', 'config.json'),
    JSON.stringify({ merge: { checks: ['test -f fixed.txt'] } }),
  );
  await page.goto(`${symbiote.url}git`);
  await hive(page, true);

  // Start: Claude Code only, and what Hive does.
  await page.goto(`${symbiote.url}start`);
  await expect(startPage(page).locator('.start-value')).toHaveText('Claude Code');
  await expect(startPage(page).getByRole('combobox', { name: 'Agent' })).toHaveCount(0);
  await expect(startPage(page).locator('.start-hive')).toContainText(
    'Hive is on: after each turn Symbiote runs the check',
  );
  await startPage(page).getByRole('textbox', { name: 'Title' }).fill('Halve it');
  await startPage(page).getByRole('textbox', { name: 'Goal' }).fill('Return a / 2.');
  await startPage(page).getByRole('textbox', { name: 'Branch name', exact: true }).fill(BRANCH);
  await startPage(page).getByLabel('Plan first and wait for my OK').uncheck();
  await startPage(page).getByRole('button', { name: 'Start workspace' }).click();
  await expect(startPage(page)).toBeHidden();
  const first =
    symbiote
      .calls()
      .find((call) => call.args[0] === '--bg')
      ?.args.at(-1) ?? '';
  expect(first).toContain('Hive drives this workspace.');
  expect(first).toContain('(`test -f fixed.txt`)');
  await expect(card(page).locator('.fact-hive')).toHaveAccessibleName(
    'Hive drives it: round 1 of 3',
  );

  // Its turn ends with a commit: the check fails, and its failure goes back to the writer.
  symbiote.commit(BRANCH, 'half.ts', 'export const half = (a: number) => a / 2;\n', 'Halve');
  symbiote.report(BRANCH, 'Done: half.ts.');
  await expect.poll(sent, { timeout: 20_000 }).toHaveLength(1);
  expect(sent()[0]).toContain('`test -f fixed.txt` failed');
  expect(sent()[0]).toContain('(round 1 of 3)');
  await expect(card(page).locator('.fact-hive')).toHaveAccessibleName(
    'Hive drives it: round 2 of 3',
  );

  // Hive off mid-turn: the writer stopped, the step kept, the card says so.
  await hive(page, false);
  await expect.poll(() => symbiote.stops(), { timeout: 10_000 }).toHaveLength(1);
  // Written once the stop answered.
  await expect.poll(() => record().interrupted).toBe(true);
  expect(record()).toMatchObject({ step: 'writing', round: 2 });
  await expect(card(page)).toContainText('Hive off: paused');

  // Hive on: the writer is told to continue.
  await hive(page, true);
  await expect.poll(sent, { timeout: 20_000 }).toHaveLength(2);
  expect(sent()[1]).toContain('Hive was turned off');
  // Its prompt recorded (the fake logs a resume before its hooks run): the next report is its turn's.
  await expect.poll(() => record().message?.sent, { timeout: 10_000 }).toBe(true);

  // The fix: the check passes, the running reviewer (HV3) finds nothing, and landing is asked.
  symbiote.commit(BRANCH, 'fixed.txt', 'yes\n', 'Fix');
  symbiote.report(BRANCH, 'Done: fixed.txt.');
  await expect(card(page)).toContainText('Checked and reviewed: land it', { timeout: 20_000 });
  expect(record()).toMatchObject({ step: 'landing', round: 2 });
  expect(sent()).toHaveLength(2);
});

test("Settings lists Hive's prompts only while Hive is on", async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}settings`);
  const list = page.getByRole('navigation', { name: 'Settings' });
  await expect(list.getByRole('region', { name: 'Workspaces' })).toBeVisible();
  await expect(list.getByRole('region', { name: 'Hive', exact: true })).toHaveCount(0);
  await hive(page, true);
  await page.reload();
  const group = list.getByRole('region', { name: 'Hive', exact: true });
  await expect(group.getByRole('button')).toHaveText([
    'Start',
    'Check failed',
    'Defects proven',
    'Not committed',
    'Resume',
    'Reviewer',
  ]);
  await group.getByRole('button', { name: 'Check failed' }).click();
  await expect(
    page.locator('.settings-editor').getByRole('textbox', { name: 'Check failed prompt' }),
  ).toHaveValue(/`\{command\}` failed/);
});
