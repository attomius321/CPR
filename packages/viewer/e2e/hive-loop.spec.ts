import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// Hive's loop (HV2): a workspace started while Hive is on is driven by `symbiote view`'s runner —
// its writer (the fake Claude Code) ends a turn, Symbiote runs the project's check and sends the
// failure back, Hive off stops the writer and keeps the step, Hive on tells it to continue, and a
// passing check and review land it on their own (HV4).
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
  ) as {
    step: string;
    round: number;
    interrupted?: boolean;
    note?: string;
    message?: { sent?: true };
  };

test('Hive drives a workspace: the check, its failure sent back, Hive off and on, landed', async ({
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
    'Hive is on: it drives this workspace from its brief to landed.',
  );
  // Nothing to ask the person: no permission choice (HV4).
  await expect(startPage(page).getByRole('combobox', { name: 'Permissions' })).toHaveCount(0);
  await startPage(page).getByRole('textbox', { name: 'Title' }).fill('Halve it');
  await startPage(page).getByRole('textbox', { name: 'Goal' }).fill('Return a / 2.');
  await startPage(page).getByRole('textbox', { name: 'Branch name', exact: true }).fill(BRANCH);
  await expect(startPage(page).getByLabel('Plan first and wait for my OK')).toHaveCount(0);
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

  // The fix: the check passes, the running reviewer (HV3) finds nothing, and Hive lands it (HV4).
  symbiote.commit(BRANCH, 'fixed.txt', 'yes\n', 'Fix');
  symbiote.report(BRANCH, 'Done: fixed.txt.');
  await expect(card(page)).toContainText('Landed in main', { timeout: 40_000 });
  expect(record()).toMatchObject({ step: 'landed', round: 2 });
  expect(sent()).toHaveLength(2);
});

/** Starts a Hive workspace from the Start page, as the person does, without a plan first. */
async function startHive(page: Page, branch: string, title: string) {
  await page.goto(`${symbiote.url}start`);
  await startPage(page).getByRole('textbox', { name: 'Title' }).fill(title);
  await startPage(page).getByRole('textbox', { name: 'Goal' }).fill('Return a / 2.');
  await startPage(page).getByRole('textbox', { name: 'Branch name', exact: true }).fill(branch);
  await expect(startPage(page).getByLabel('Plan first and wait for my OK')).toHaveCount(0);
  await startPage(page).getByRole('button', { name: 'Start workspace' }).click();
  await expect(startPage(page)).toBeHidden();
}

test('a turn Hive cannot see: its message taken into a copy of the session, the card says why (decisions 719, 721)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  symbiote = await serveWorkspaces();
  setChecks(['test -f fixed.txt']);
  await page.goto(`${symbiote.url}git`);
  await hive(page, true);
  await startHive(page, BRANCH, 'Halve it');
  // The settings name Symbiote's copy of its hook, in its cache: no deleted build takes it along.
  const settings = readFileSync(join(symbiote.repo, 'symbiote', 'claude-settings.json'), 'utf8');
  expect(settings).toContain(join(symbiote.cache, 'hooks'));

  // From here on Claude Code takes every message into a copy, whose hooks record nothing.
  symbiote.copies();
  symbiote.commit(BRANCH, 'half.ts', 'export const half = (a: number) => a / 2;\n', 'Halve');
  symbiote.report(BRANCH, 'Done: half.ts.');
  await expect.poll(sent, { timeout: 20_000 }).toHaveLength(1);
  await expect.poll(() => record().step, { timeout: 10_000 }).toBe('stuck');
  expect(record().message).toBeUndefined();
  // The copy works on and finishes, unseen: the card says why Hive stopped, not "reading its turn".
  symbiote.report(BRANCH, 'Done: fixed.txt.');
  await expect(card(page)).toContainText("Stopped: the writer's turn cannot be seen", {
    timeout: 20_000,
  });
  expect(record().note).toMatch(/a copy of its session, fake\d+, whose hooks record nothing\)$/);
  expect(sent()).toHaveLength(1);
});

/** The project's check (`merge.checks`). */
const setChecks = (checks: string[]) => {
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(
    join(symbiote.repo, 'symbiote', 'config.json'),
    JSON.stringify({ merge: { checks } }),
  );
};

/** A command that prints, then waits for its gate's file. */
const held = (gate: string, said: string) =>
  `echo ${said}; while [ ! -f ${gate} ]; do sleep 0.1; done; echo ${said}-done`;

test("Hive's live progress: the check's commands, their output as it comes, then the running review", async ({
  page,
}) => {
  test.setTimeout(90_000);
  symbiote = await serveWorkspaces();
  const checkGate = join(symbiote.repo, 'check-gate');
  const reviewGate = join(symbiote.repo, 'review-gate');
  const commands = ['echo installing', held(checkGate, 'checking-lines'), 'echo built'];
  setChecks(commands);
  symbiote.reviewAnswers([
    {
      gate: reviewGate,
      stream: [
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Bash',
                input: { command: 'pnpm vitest run half.test.ts' },
              },
            ],
          },
        },
      ],
    },
  ]);
  await page.goto(`${symbiote.url}git`);
  await hive(page, true);
  await startHive(page, BRANCH, 'Halve it');
  symbiote.commit(BRANCH, 'half.ts', 'export const half = (a: number) => a / 2;\n', 'Halve');
  symbiote.report(BRANCH, 'Done: half.ts.');

  // The card: in the Hive group, the command running, its time ticking; no expected time on a
  // first check.
  const group = page.locator('.sidenav').getByRole('region', { name: 'Hive', exact: true });
  await expect(group.locator(`[data-branch="${BRANCH}"]`)).toBeVisible({ timeout: 20_000 });
  await expect(card(page).locator('.hive-live-head')).toContainText('Checking 2/3', {
    timeout: 10_000,
  });
  await expect(card(page).locator('.hive-live-detail')).toHaveText(commands[1] ?? '');
  await expect(card(page).locator('.state-dot')).toHaveClass(/tone-hive/);
  const time = card(page).locator('.hive-live-time');
  await expect(time).toHaveText(/^ · \d+:\d\d$/);
  const before = await time.textContent();
  await expect(time).not.toHaveText(before ?? '', { timeout: 5_000 });
  await expect(card(page).locator('.fact-hive')).toHaveAccessibleName(
    'Hive drives it: round 1 of 3',
  );

  // Folded: its dot and its time; its tip says it whole.
  await page.getByRole('button', { name: 'Fold the sidenav' }).click();
  await expect(card(page).locator('.hive-rail-time')).toHaveText(/^\d+:\d\d$/);
  await card(page).hover();
  await expect(page.getByRole('tooltip')).toContainText(`Checking 2/3: ${commands[1]}`);
  await page.getByRole('button', { name: 'Open the sidenav' }).click();

  // The page: its head's steps and the bar under its views say it (V89); the Review tab shows each
  // command and the output as it comes.
  await card(page).locator('.workspace-about').click();
  await expect(page.locator('.head-steps')).toContainText('Check');
  await expect(page.getByRole('region', { name: 'Agent status' })).toContainText(
    `Checking 2/3: ${commands[1]} · `,
  );
  await page.getByRole('tab', { name: 'Review' }).click();
  const now = page.getByRole('region', { name: 'Now' });
  const steps = now.getByRole('list', { name: 'Its steps' }).getByRole('button');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toHaveAccessibleName(/^echo installing: passed/);
  await expect(steps.nth(1)).toHaveAccessibleName(/: running, \d/);
  await expect(steps.nth(2)).toHaveAccessibleName('echo built: waiting');
  await expect(now.getByRole('log', { name: 'What it wrote' })).toContainText('checking-lines');

  // The check passes: the running review, what the reviewer runs now from its stream.
  writeFileSync(checkGate, '');
  await expect(card(page).locator('.hive-live-head')).toContainText('Reviewing', {
    timeout: 20_000,
  });
  await expect(card(page).locator('.hive-live-detail')).toHaveText(
    'Bash: pnpm vitest run half.test.ts',
  );
  await expect(now.getByRole('status')).toContainText('Reviewing · ');
  await expect(now.getByRole('status')).toContainText('Bash: pnpm vitest run half.test.ts');
  await expect(
    now.getByRole('list', { name: 'Its steps' }).getByRole('button'),
  ).toHaveAccessibleName(/^The reviewer: running/);
  await expect(now.getByRole('log', { name: 'What it wrote' })).toContainText(
    'Bash pnpm vitest run half.test.ts',
  );

  // It approves: Hive lands it, nothing running; the round keeps each command and its log.
  writeFileSync(reviewGate, '');
  await expect(card(page)).toContainText('Landed in main', { timeout: 40_000 });
  await expect(page.getByRole('region', { name: 'Now' })).toHaveCount(0);
  const round = page.getByRole('region', { name: 'Round 1' });
  await expect(round.getByRole('list', { name: 'Its commands' }).getByRole('listitem')).toHaveCount(
    3,
  );
  const check = round.getByLabel('Check, round 1');
  await check.getByText('Its log').click();
  await expect(check.getByRole('log', { name: 'What it wrote' })).toContainText(
    'checking-lines-done',
  );
  rmSync(checkGate);
});

test('a check of one command: no place among others; the next check of it, its expected time', async ({
  page,
}) => {
  test.setTimeout(90_000);
  symbiote = await serveWorkspaces();
  const gate = join(symbiote.repo, 'gate');
  const command = held(gate, 'testing');
  setChecks([command]);
  await page.goto(`${symbiote.url}git`);
  await hive(page, true);

  await startHive(page, BRANCH, 'Halve it');
  symbiote.commit(BRANCH, 'half.ts', 'export const half = (a: number) => a / 2;\n', 'Halve');
  symbiote.report(BRANCH, 'Done: half.ts.');
  await expect(card(page).locator('.hive-live-head')).toHaveText(/^Checking · \d+:\d\d$/, {
    timeout: 20_000,
  });
  writeFileSync(gate, '');
  await expect(card(page)).toContainText('Landed in main', { timeout: 40_000 });
  rmSync(gate);

  const other = 'feature/third';
  await startHive(page, other, 'A third');
  symbiote.commit(other, 'third.ts', 'export const third = (a: number) => a / 3;\n', 'Third');
  symbiote.report(other, 'Done: third.ts.');
  const second = page.locator(`.sidenav .workspace-row[data-branch="${other}"]`);
  await expect(second.locator('.hive-live-time')).toHaveText(/^ · \d+:\d\d of ~\d+ s$/, {
    timeout: 20_000,
  });
  writeFileSync(gate, '');
  await expect(second).toContainText('Landed in main', { timeout: 40_000 });
});

test('Hive will not turn on while a workspace is in normal mode; off asks while Hive works (HV4, decisions 771, 772)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  symbiote = await serveWorkspaces();
  const post = (path: string, body: unknown) =>
    page.evaluate(
      async ([path, body]) => {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(await response.text());
      },
      [path, body] as const,
    );
  await page.goto(`${symbiote.url}git`);
  // A workspace in normal mode, Hive off.
  await post('/api/workspaces', { branch: 'feature/mine', brief: 'Mine.', planFirst: false });
  await page.goto(`${symbiote.url}settings?prompt=hive-mode`);
  const editor = page.getByRole('region', { name: 'Hive mode' });
  await editor.getByRole('button', { name: 'Turn on Hive mode' }).click();
  const question = page.getByRole('alertdialog', { name: 'Turn on Hive mode?' });
  await expect(question.getByRole('status')).toContainText(
    'Hive cannot turn on while a workspace is in normal mode. Land it or clean it up first:',
  );
  await expect(question.getByRole('status')).toContainText('feature/mine');
  await expect(question.getByRole('button', { name: 'Turn on Hive mode' })).toBeDisabled();
  await question.getByRole('button', { name: 'Cancel' }).click();

  // Cleaned up: Hive turns on.
  await post('/api/workspaces/clean', { branch: 'feature/mine', unmerged: true });
  await editor.getByRole('button', { name: 'Turn on Hive mode' }).click();
  await expect(question.getByRole('status')).toHaveCount(0);
  await question.getByRole('button', { name: 'Turn on Hive mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-hive', 'on');

  // A Hive workspace at work: turning off asks, and says what it stops.
  await startHive(page, BRANCH, 'Halve it');
  await page.goto(`${symbiote.url}settings?prompt=hive-mode`);
  await editor.getByRole('button', { name: 'Turn off Hive mode' }).click();
  const off = page.getByRole('alertdialog', { name: 'Turn off Hive mode?' });
  await expect(off).toContainText(
    'Halve it: its agent is stopped; on again, Hive tells it to continue.',
  );
  await expect(off.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(off).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-hive', 'on');
  await editor.getByRole('button', { name: 'Turn off Hive mode' }).click();
  await off.getByRole('button', { name: 'Turn off Hive mode' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-hive');
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
    'Landing failed',
    'Plan OK',
    'No one to ask',
    'Reviewer',
    // What Alpha Ceph is told of Hive (V86, decision 751).
    'Alpha Ceph',
  ]);
  await group.getByRole('button', { name: 'Check failed' }).click();
  await expect(
    page.locator('.settings-editor').getByRole('textbox', { name: 'Check failed prompt' }),
  ).toHaveValue(/`\{command\}` failed/);
});
