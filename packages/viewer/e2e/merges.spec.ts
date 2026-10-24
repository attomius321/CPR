import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveAgentBranch, type RunningAgent } from './symbiote.js';

// Symbiote's merger agent (V26c): a conflict answered region by region by a fake Claude Code,
// written by Symbiote, reviewed in the merge the sidenav opens, asked again, then approved and
// landed.
let symbiote: RunningAgent;
const errors: string[] = [];

test.afterEach(() => {
  symbiote.stop();
  expect(errors).toEqual([]);
});

const DOUBLE = 'export const double = (a: number) => a * 2;';
const SQUARE = 'export function square(a: number): number {\n  return a * a;\n}';
const CUBE = 'export function cube(a: number): number {\n  return a * a * a;\n}';

const git = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: symbiote.repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Main',
      GIT_AUTHOR_EMAIL: 'main@example.com',
      GIT_COMMITTER_NAME: 'Main',
      GIT_COMMITTER_EMAIL: 'main@example.com',
    },
  }).trim();

/** Reviews `agent` from History and approves it. */
async function approve(page: Page) {
  await page.goto(`${symbiote.url}history`);
  const tip = page.locator('.commit', {
    has: page.locator('.commit-subject', { hasText: 'Agent: add cube' }),
  });
  await tip.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Review', exact: true }).hover();
  await page.getByRole('menu', { name: 'Review' }).getByRole('menuitem').first().click();
  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByLabel('Approve').check();
  await page.getByRole('button', { name: 'Finish review' }).click();
  await expect(page.locator('.finished')).toContainText('Approved');
}

test('a conflict: the merger agent answers, you ask again, then approve, and it lands', async ({
  page,
}) => {
  page.on('pageerror', (error) => errors.push(error.message));
  symbiote = await serveAgentBranch(
    {},
    {
      merger: [
        JSON.stringify({ regions: { '1': DOUBLE }, notes: { '1': "kept main's" } }),
        JSON.stringify({
          regions: { '1': `${DOUBLE}\n\n${SQUARE}\n\n${CUBE}` },
          notes: { '1': 'kept both: main first' },
        }),
      ],
    },
  );
  // main adds a function where the agent added its own: the merge conflicts.
  const math = join(symbiote.repo, 'src/math.ts');
  writeFileSync(math, `${readFileSync(math, 'utf8')}\n${DOUBLE}\n`);
  git('commit', '-q', '-am', 'Main: add double');
  const main = git('rev-parse', 'main');
  await approve(page);
  await page.getByRole('button', { name: 'Merge into', exact: true }).click();

  // Resolved by the agent, written by Symbiote, waiting for review: main has not moved.
  // In the sidenav's Merging group; opened in the main area (V29a).
  await page.goto(`${symbiote.url}history`);
  await page.locator('.sidenav [data-merge="agent"]').getByRole('link').click();
  await expect(page).toHaveURL(`${symbiote.url}?merge=agent`);
  const entry = page.getByRole('region', { name: 'Merge of agent' });
  await expect(entry.locator('.merge-row-state')).toHaveText(
    /^Resolved 1 region \(sonnet, [\d.K]+ tokens\): review it$/,
  );
  await expect(entry.locator('.merge-label')).toHaveText('Review resolution');
  const region = entry.getByRole('list', { name: 'Its resolution' }).getByRole('listitem');
  await expect(region.locator('.merge-region-where')).toContainText('src/math.ts:');
  await expect(region.locator('.merge-region-where')).toContainText("kept main's");
  // The resolution first, each line marked by its side; what it lost said in words, then shown.
  await expect(region.locator('.merge-resolved .merge-line-text')).toHaveText([DOUBLE]);
  await expect(region.locator('.merge-resolved .merge-line-from')).toHaveText(['main']);
  await expect(region.locator('.merge-flag')).toHaveText(['Drops all 6 lines from agent']);
  await expect(region.locator('.merge-dropped .merge-line-text')).toHaveText([
    ...SQUARE.split('\n'),
    ...CUBE.split('\n'),
  ]);
  // The raw conflict is folded: both sides added here, nothing before.
  await expect(region.locator('.merge-region-sides')).toHaveCount(0);
  await region.getByRole('button', { name: /Show the conflict/ }).click();
  await expect(region.locator('.merge-conflict')).toContainText(
    'both sides added here, nothing before',
  );
  await expect(region.locator('.merge-side figcaption')).toHaveText(['main', 'agent']);
  await region.getByRole('button', { name: /Hide the conflict/ }).click();
  // Retry and Remove wait in the ⋯ menu.
  await expect(entry.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await entry.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Retry', 'Remove']);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem')).toHaveCount(0);
  expect(git('rev-parse', 'main')).toBe(main);
  // Its prompt: the region, numbered, and the sides' titles; not the other files.
  const [first] = symbiote.mergerPrompts();
  expect(first).toContain('main (ours): Main: add double');
  expect(first).toContain('agent (theirs): Agent: add cube');
  expect(first).toContain('Region 1 (lines');
  expect(first).not.toContain('callers');

  // Asked again with your words: its earlier answer goes with them.
  await entry.getByRole('button', { name: 'Request changes' }).click();
  await entry.getByLabel('What to change in the resolution').fill("Keep the agent's functions.");
  await entry.getByRole('button', { name: 'Ask again' }).click();
  await expect(region.locator('.merge-resolved .merge-line-text')).toHaveText(
    `${DOUBLE}\n\n${SQUARE}\n\n${CUBE}`.split('\n'),
  );
  await expect(region.locator('.merge-flag')).toHaveText([
    'Keeps every line of both sides, nothing new',
  ]);
  await expect(region.locator('.merge-dropped')).toHaveCount(0);
  expect(symbiote.mergerPrompts()[1]).toContain(
    "Your earlier answer was reviewed: Keep the agent's functions.",
  );

  await entry.getByRole('button', { name: 'Approve' }).click();
  await expect(entry.locator('.merge-row-state')).toHaveText(/^Landed: main is at [0-9a-f]{7}$/);
  const merged = readFileSync(math, 'utf8');
  for (const text of [DOUBLE, SQUARE, CUBE]) expect(merged).toContain(text);
  expect(merged).not.toMatch(/^(<<<<<<<|=======|>>>>>>>)/m);
  expect(git('log', '-1', '--format=%s', 'main')).toBe('Merge agent: Agent: add cube');
  expect(git('status', '--porcelain', '--untracked-files=no')).toBe('');
});

/**
 * fix/fix-merger: main adds a function where the agent added its own, the merger agent keeps
 * both, and the project's check is `checks`. Approved and merged; the merge's page opened.
 */
async function resolvedConflict(page: Page, checks: string[], env: Record<string, string> = {}) {
  page.on('pageerror', (error) => errors.push(error.message));
  symbiote = await serveAgentBranch(env, {
    merger: [
      JSON.stringify({
        regions: { '1': `${DOUBLE}\n\n${SQUARE}\n\n${CUBE}` },
        notes: { '1': 'kept both: main first' },
      }),
    ],
  });
  const math = join(symbiote.repo, 'src/math.ts');
  writeFileSync(math, `${readFileSync(math, 'utf8')}\n${DOUBLE}\n`);
  git('commit', '-q', '-am', 'Main: add double');
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(
    join(symbiote.repo, 'symbiote', 'config.json'),
    JSON.stringify({ merge: { checks } }),
  );
  const main = git('rev-parse', 'main');
  await approve(page);
  await page.getByRole('button', { name: 'Merge into', exact: true }).click();
  await page.goto(`${symbiote.url}history`);
  const card = page.locator('.sidenav [data-merge="agent"]');
  await card.getByRole('link').click();
  return { main, math, card, entry: page.getByRole('region', { name: 'Merge of agent' }) };
}

test('the log: each step and what it writes, while it runs (V46a)', async ({ page }) => {
  // The second command writes, then waits for a file the test makes, then writes again.
  const flag = join(mkdtempSync(join(tmpdir(), 'symbiote-e2e-flag-')), 'go');
  // Its output is not its command's text, which heads its step: `$((40 + 2))` prints 42.
  const slow =
    'echo "first $((40 + 2))"; while [ ! -f "$E2E_FLAG" ]; do sleep 0.1; done; echo "then $((40 + 3))"';
  const { entry } = await resolvedConflict(page, ['test -f src/math.ts', slow], {
    E2E_FLAG: flag,
  });
  const steps = entry.getByRole('list', { name: 'Its steps' });
  const log = entry.getByRole('log', { name: 'What it wrote' }).locator('.xterm-rows');
  // It runs: its first line is in the log, its step running; the steps before it passed.
  await expect(steps.getByRole('button', { name: /^echo "first.*: running, / })).toBeVisible();
  await expect(log).toContainText('first 42');
  await expect(log).not.toContainText('then 43');
  await expect(steps.locator('.merge-step-name')).toHaveText([
    'Merge',
    'Merger agent',
    'test -f src/math.ts',
    slow,
  ]);
  await expect(
    steps.getByRole('button', { name: /^Merger agent: passed, \d+\.\d s$/ }),
  ).toBeVisible();
  // What each step did, under its heading: the conflict, then the agent's answer.
  await expect(log).toContainText('── Merge agent into main');
  await expect(log).toContainText('1 file conflicts: src/math.ts');
  await expect(log).toContainText('Wrote 1 region in 1 file; committed the merge');

  writeFileSync(flag, '');
  await expect(log).toContainText('then 43');
  await expect(steps.getByRole('button', { name: /^echo "first.*: passed, / })).toBeVisible();
  await expect(entry.locator('.merge-row-state')).toHaveText(/· checked in \d+\.\d s: review it$/);
  // A step scrolls the log to its heading; the merge's own stays where it is.
  await steps.getByRole('button', { name: /^Merge: passed/ }).click();
  await expect(log).toContainText('── Merge agent into main');
});

// A resolution whose check failed (a flaky e2e, in the real case) is the person's to judge: the
// row says what passed and what failed, and Approve lands it.
test('a resolution whose check failed: what ran is said, and Approve lands it', async ({
  page,
}) => {
  // The project's check: its first command passes, its second fails.
  const { main, math, card, entry } = await resolvedConflict(page, [
    'test -f src/math.ts',
    'ls e2e.passed',
  ]);
  await expect(entry.locator('.merge-row-state')).toHaveText(
    /^Resolved 1 region \(sonnet, [\d.K]+ tokens\) · its check failed \(ls e2e\.passed\): review it$/,
  );
  // The person's turn, not a failure.
  await expect(entry).toHaveClass(/merge-tone-you/);
  await expect(card).toHaveClass(/merge-tone-you/);
  await expect(entry.locator('.merge-label')).toHaveText('Review resolution');
  await expect(entry.locator('.merge-run')).toContainText(
    /^test -f src\/math\.ts passed; ls e2e\.passed failed after \d+\.\d s/,
  );
  // Its whole output is in the log (V46a), the failed command's step marked so.
  await expect(entry.getByRole('button', { name: 'Its output' })).toHaveCount(0);
  const steps = entry.getByRole('list', { name: 'Its steps' });
  await expect(steps.getByRole('button', { name: /^ls e2e\.passed: failed, / })).toBeVisible();
  await expect(
    entry.getByRole('log', { name: 'What it wrote' }).locator('.xterm-rows'),
  ).toContainText('e2e.passed');
  expect(git('rev-parse', 'main')).toBe(main);

  const approveIt = entry.getByRole('button', { name: 'Approve' });
  await expect(approveIt).toHaveAttribute(
    'title',
    'Land the merge, though its check failed (ls e2e.passed)',
  );
  await approveIt.click();
  await expect(entry.locator('.merge-row-state')).toHaveText(
    /^Landed: main is at [0-9a-f]{7} · its check failed \(ls e2e\.passed\)$/,
  );
  expect(git('log', '-1', '--format=%s', 'main')).toBe('Merge agent: Agent: add cube');
  for (const text of [DOUBLE, SQUARE, CUBE]) expect(readFileSync(math, 'utf8')).toContain(text);
});

test('Check again: only the check runs again on the same resolution, then Approve lands it', async ({
  page,
}) => {
  // A flaky check: it passes once a file outside the merge's worktree is there.
  const flag = join(mkdtempSync(join(tmpdir(), 'symbiote-e2e-flag-')), 'passed');
  const { main, entry } = await resolvedConflict(page, ['test -f $E2E_FLAG'], { E2E_FLAG: flag });
  await expect(entry.locator('.merge-row-state')).toHaveText(
    /· its check failed \(test -f \$E2E_FLAG\): review it$/,
  );

  writeFileSync(flag, '');
  await entry.getByRole('button', { name: 'Check again' }).click();
  await expect(entry.locator('.merge-row-state')).toHaveText(
    /^Resolved 1 region \(sonnet, [\d.K]+ tokens\) · checked in \d+\.\d s: review it$/,
  );
  await expect(entry.locator('.merge-run')).toHaveCount(0);
  await expect(entry.getByRole('button', { name: 'Check again' })).toHaveCount(0);
  // The agent was not asked again, and its resolution is still there to review.
  expect(symbiote.mergerPrompts()).toHaveLength(1);
  await expect(
    entry.getByRole('list', { name: 'Its resolution' }).getByRole('listitem'),
  ).toHaveCount(1);
  expect(git('rev-parse', 'main')).toBe(main);

  const approveIt = entry.getByRole('button', { name: 'Approve' });
  expect(await approveIt.getAttribute('title')).toBeNull();
  await approveIt.click();
  await expect(entry.locator('.merge-row-state')).toHaveText(
    /^Landed: main is at [0-9a-f]{7} · checked in \d+\.\d s$/,
  );
});

test('the merger agent says you must decide: nothing is merged', async ({ page }) => {
  page.on('pageerror', (error) => errors.push(error.message));
  symbiote = await serveAgentBranch(
    {},
    { merger: [JSON.stringify({ needsYou: 'region 1: double or square first?' })] },
  );
  const math = join(symbiote.repo, 'src/math.ts');
  writeFileSync(math, `${readFileSync(math, 'utf8')}\n${DOUBLE}\n`);
  git('commit', '-q', '-am', 'Main: add double');
  const main = git('rev-parse', 'main');
  await approve(page);
  await page.getByRole('button', { name: 'Merge into', exact: true }).click();
  // In the sidenav's Merging group; opened in the main area (V29a).
  await page.goto(`${symbiote.url}history`);
  await page.locator('.sidenav [data-merge="agent"]').getByRole('link').click();
  await expect(page).toHaveURL(`${symbiote.url}?merge=agent`);
  const entry = page.getByRole('region', { name: 'Merge of agent' });
  await expect(entry.locator('.merge-row-state')).toHaveText(
    'The merger agent: region 1: double or square first?',
  );
  await expect(entry.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(entry.locator('.merge-files li')).toHaveText(['src/math.ts']);
  expect(git('rev-parse', 'main')).toBe(main);
});
