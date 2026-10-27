import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { spinner } from './spinner.js';
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

/** Reviews `agent` from History and approves it, at its tip `subject`. */
async function approve(page: Page, subject = 'Agent: add cube') {
  await page.goto(`${symbiote.url}history`);
  const tip = page.locator('.commit', {
    has: page.locator('.commit-subject', { hasText: subject }),
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
  // Between the lines around it, dim (fix/merge-viewer-on-conflict).
  const resolved = region.locator('.merge-resolved .merge-line:not(.from-around)');
  await expect(resolved.locator('.merge-line-text')).toHaveText([DOUBLE]);
  await expect(resolved.locator('.merge-line-from')).toHaveText(['main']);
  await expect(region.locator('.merge-resolved .from-around .merge-line-from')).toHaveText([
    'above',
    'above',
    'above',
  ]);
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
  // Retry and Remove wait in the ⋯ menu; not landed, its card has no icon to remove it (V55).
  await expect(entry.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await page.locator('.sidenav [data-merge="agent"]').hover();
  await expect(page.locator('.sidenav [data-merge="agent"]').getByRole('button')).toHaveCount(0);
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
  await expect(resolved.locator('.merge-line-text')).toHaveText(
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

  // Landed (V55): Remove, the head's primary button, takes it from the queue; History shows.
  await expect(entry.getByRole('button', { name: 'More actions' })).toHaveCount(0);
  await entry.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page).toHaveURL(`${symbiote.url}history`);
  await expect(page.locator('.sidenav [data-merge="agent"]')).toHaveCount(0);
  await expect(page.getByRole('contentinfo', { name: 'Status bar' })).toContainText(
    'Removed the merge of agent from the queue.',
  );
  expect(git('log', '-1', '--format=%s', 'main')).toBe('Merge agent: Agent: add cube');
});

/**
 * fix/fix-merger: main adds a function where the agent added its own, the merger agent keeps
 * both, and the project's check is `checks`. Approved and merged; the merge's page opened.
 */
async function resolvedConflict(
  page: Page,
  checks: string[],
  env: Record<string, string> = {},
  more: Record<string, unknown> = {},
) {
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
    JSON.stringify({ merge: { checks, ...more } }),
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
  // Resolved: its files come first (V46c), the log a tab away.
  await entry.getByRole('tab', { name: 'Log' }).click();
  // A step scrolls the log to its heading; the merge's own stays where it is.
  await steps.getByRole('button', { name: /^Merge: passed/ }).click();
  await expect(log).toContainText('── Merge agent into main');
});

test("a merge at work spins on its card, as a working agent's dot; still once it is your turn (fix/merging-status)", async ({
  page,
}) => {
  // The check waits for a file the test makes: until then the merge is at work.
  const flag = join(mkdtempSync(join(tmpdir(), 'symbiote-e2e-flag-')), 'go');
  const { card } = await resolvedConflict(
    page,
    ['while [ ! -f "$E2E_FLAG" ]; do sleep 0.1; done'],
    { E2E_FLAG: flag },
  );
  const dot = card.locator('.state-dot');
  await expect(card.locator('.workspace-state')).toHaveText(/^Checking: /);
  await expect
    .poll(() => spinner(dot))
    .toEqual({ animation: 'state-spin 1s', across: 11, comet: true });
  // Without motion, the comet holds still: its words say it works.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => spinner(dot)).toEqual({ animation: 'none 0s', across: 11, comet: true });
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  writeFileSync(flag, '');
  // Checked: the resolution is the person's to review, a still dot in its colour.
  await expect(card).toHaveClass(/merge-tone-you/);
  await expect.poll(() => spinner(dot)).toMatchObject({ animation: 'none 0s', comet: false });
});

test("the merger agent's thinking and the files it reads, while it works (V46b)", async ({
  page,
}) => {
  // The fake agent thinks and reads, then answers once the test makes a file.
  const flag = join(mkdtempSync(join(tmpdir(), 'symbiote-e2e-flag-')), 'answer');
  // At the merger's effort (V46d), a level its agent lists.
  const { entry } = await resolvedConflict(
    page,
    ['test -f src/math.ts'],
    { E2E_AGENT_FLAG: flag },
    { effort: 'high' },
  );
  const steps = entry.getByRole('list', { name: 'Its steps' });
  const log = entry.getByRole('log', { name: 'What it wrote' }).locator('.xterm-rows');
  await expect(steps.getByRole('button', { name: /^Merger agent: running, / })).toBeVisible();
  await expect(log).toContainText('Effort: high (merge.effort)');
  await expect(log).toContainText('Claude Code 9.9.9 · claude-fake');
  await expect(log).toContainText('∴ Both sides add a function here.');
  await expect(log).toContainText('● Read src/math.ts');
  await expect(log).toContainText(/⎿ \d+ lines/);
  await expect(log).not.toContainText('Answered in');

  writeFileSync(flag, '');
  await expect(log).toContainText('Answered in');
  // Its JSON answer counted on one line: its regions are on Files.
  await expect(log).toContainText(/Writing its answer: [\d,]+ characters/);
  await expect(log).not.toContainText('"regions"');
  await expect(steps.getByRole('button', { name: /^Merger agent: passed, / })).toBeVisible();
  await expect(entry.locator('.merge-label')).toHaveText('Review resolution');
  expect(symbiote.mergerArgs()[0]).toEqual(expect.arrayContaining(['--effort', 'high']));
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
  await entry.getByRole('tab', { name: 'Log' }).click();
  const steps = entry.getByRole('list', { name: 'Its steps' });
  await expect(steps.getByRole('button', { name: /^ls e2e\.passed: failed, / })).toBeVisible();
  await expect(
    entry.getByRole('log', { name: 'What it wrote' }).locator('.xterm-rows'),
  ).toContainText('e2e.passed');
  expect(git('rev-parse', 'main')).toBe(main);

  const approveIt = entry.getByRole('button', { name: 'Approve' });
  await expect(approveIt).toHaveAttribute(
    'data-tip',
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
  expect(await approveIt.getAttribute('data-tip')).toBeNull();
  await approveIt.click();
  await expect(entry.locator('.merge-row-state')).toHaveText(
    /^Landed: main is at [0-9a-f]{7} · checked in \d+\.\d s$/,
  );
});

test('the merger agent asks you: its regions numbered, their conflict shown, and you answer it there', async ({
  page,
}) => {
  page.on('pageerror', (error) => errors.push(error.message));
  symbiote = await serveAgentBranch(
    {},
    {
      merger: [
        JSON.stringify({ needsYou: 'Region 1: double or square first?' }),
        JSON.stringify({ regions: { '1': `${DOUBLE}\n\n${SQUARE}\n\n${CUBE}` } }),
      ],
    },
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
    'The merger agent: Region 1: double or square first?',
  );
  await expect(entry.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  expect(git('rev-parse', 'main')).toBe(main);
  // Files first: its file, the region the question names, numbered, with the lines around it
  // and its sides (fix/merge-viewer-on-conflict).
  await expect(entry.getByRole('tab', { name: /^Files/ })).toHaveAttribute('aria-selected', 'true');
  await expect(entry.getByRole('list', { name: 'Its files' }).getByRole('button')).toHaveText([
    /^math\.ts src1 regionWaiting for your answer$/,
  ]);
  const region = entry.getByRole('list', { name: 'What it asks about' }).getByRole('listitem');
  await expect(region.locator('.merge-region-where')).toContainText('Region 1src/math.ts:');
  await expect(region.locator('.merge-flag')).toHaveText('Asked about');
  await expect(region.locator('.merge-side figcaption')).toHaveText(['main', 'agent']);
  await expect(region.locator('.merge-side').nth(1)).toContainText('export function square');
  await expect(region.locator('.from-around .merge-line-from').first()).toHaveText('above');

  // Answered on the page: it runs again with the question and the answer.
  await entry.getByLabel('Your answer to the merger agent').fill('Double first, then both.');
  await entry.getByRole('button', { name: 'Answer', exact: true }).click();
  await expect(entry.locator('.merge-row-state')).toHaveText(
    /^Resolved 1 region \(sonnet, [\d.K]+ tokens\): review it$/,
  );
  expect(symbiote.mergerPrompts()[1]).toContain(
    'You asked: Region 1: double or square first?\nThe person answered: Double first, then both.',
  );
  await expect(
    entry.getByRole('list', { name: 'Its resolution' }).locator('.merge-flag'),
  ).toHaveText(['Keeps every line of both sides, nothing new']);
  expect(git('rev-parse', 'main')).toBe(main);
});

test('Ask again: the files stay listed, and the log goes to the new run (fix/merge-viewer-on-conflict)', async ({
  page,
}) => {
  page.on('pageerror', (error) => errors.push(error.message));
  const flag = join(mkdtempSync(join(tmpdir(), 'symbiote-e2e-flag-')), 'answer');
  writeFileSync(flag, '');
  const { entry } = await resolvedConflict(
    page,
    // A check of 120 lines and the merge it ran on: each run's end is its own.
    [
      'for i in $(seq 1 120); do echo "line $i"; done; echo "checked $(git rev-parse --short HEAD)"',
    ],
    { E2E_AGENT_FLAG: flag },
  );
  await expect(entry.locator('.merge-label')).toHaveText('Review resolution');
  const log = entry.locator('.merge-terminal');
  // Scrolled up in run 1's log.
  await entry.getByRole('tab', { name: 'Log' }).click();
  await log.hover();
  await page.mouse.wheel(0, -2000);
  await expect(log.locator('.xterm-rows')).not.toContainText('checked');
  await entry.getByRole('tab', { name: /^Files/ }).click();

  rmSync(flag);
  await entry.getByRole('button', { name: 'Request changes' }).click();
  await entry.getByLabel('What to change in the resolution').fill('Keep them.');
  await entry.getByRole('button', { name: 'Ask again' }).click();
  // Its file stays listed while the merge runs again: looked at until the agent works.
  const seen: string[] = [];
  for (
    const until = Date.now() + 15_000;
    Date.now() < until && seen.at(-1) !== 'Resolving: Files';
  ) {
    const label = (await entry.locator('.merge-label').textContent()) ?? '';
    const tab = await entry.getByRole('tab', { name: /^Files/ }).count();
    const now = `${label}: ${tab > 0 ? 'Files' : 'no Files'}`;
    if (seen.at(-1) !== now) seen.push(now);
  }
  expect(seen.filter((s) => s.endsWith('no Files'))).toEqual([]);
  expect(seen.at(-1)).toBe('Resolving: Files');
  await expect(entry.getByRole('list', { name: 'Its files' }).getByRole('button')).toHaveText([
    /^math\.ts src.*Resolving…$/,
  ]);
  writeFileSync(flag, '');
  await expect(entry.locator('.merge-label')).toHaveText('Review resolution');
  // The log is at run 2's end, not on run 1's lines it was scrolled to.
  await entry.getByRole('tab', { name: 'Log' }).click();
  await expect(log.locator('.xterm-rows')).toContainText('line 120checked');
  await expect(log.locator('.xterm-rows')).not.toContainText('line 80');
});

// fix/scribe-terminal-problem: the fit add-on counted the rows from the height of the box xterm
// opened in, its padding included (border-box), and the box cut the last line off.
test("the log's last line whole at every height (fix/scribe-terminal-problem)", async ({
  page,
}) => {
  const { entry } = await resolvedConflict(page, [
    'for i in $(seq 1 120); do echo "line $i"; done',
  ]);
  await expect(entry.locator('.merge-label')).toHaveText('Review resolution');
  await entry.getByRole('tab', { name: 'Log' }).click();
  const log = entry.locator('.merge-terminal');
  await expect(log.locator('.xterm-rows')).toContainText('line 120');
  // The log takes what is left of the page (V69), as the window: one cycle of a 19 px row.
  for (let height = 881; height < 900; height++) {
    await page.setViewportSize({ width: 1440, height });
    const past = await log.evaluate(async (box) => {
      for (let i = 0; i < 5; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
      const rows = box.querySelector('.xterm-screen')?.getBoundingClientRect();
      const outer = box.getBoundingClientRect();
      if (!rows) throw new Error('no log');
      return rows.bottom - (outer.bottom - parseFloat(getComputedStyle(box).paddingBottom));
    });
    expect.soft(past, `at 1440×${height}: its rows inside the padding`).toBeLessThanOrEqual(0.5);
  }
});

test("a merge like the person's: the line copied from above it in red and shown first, a rewrite in amber, closing lines kept (fix/merge-viewer-on-conflict)", async ({
  page,
}) => {
  page.on('pageerror', (error) => errors.push(error.message));
  const test1 = (name: string, value: string) =>
    `  it('${name}', () => {\n    expect(${value}).toBe(true);\n  });\n`;
  const tests = (more: string) => `describe('total', () => {\n${test1('adds', 'true')}${more}});\n`;
  const readme = (paragraph: string) => `# Shop\n\n${paragraph}\n\n## Install\n\nnpm i\n`;
  const changelog = (entries: string) =>
    `# Changelog\n\n## Unreleased\n${entries}\n## 1.0.0\n- First release.\n`;
  const MAIN_TESTS = test1('rounds', 'round()') + test1('rounds halves', 'half()');
  const AGENT_TESTS = test1('applies a code', 'code()') + test1('ignores a code', 'none()');
  symbiote = await serveAgentBranch(
    {},
    {
      merger: [
        JSON.stringify({
          regions: {
            // CHANGELOG.md, README.md, src/total.test.ts: git's order.
            '1': '## Unreleased\n- Totals are rounded to cents.\n- Discount codes at checkout.',
            '2': 'Totals are the sum of the prices, less any\ndiscount code, rounded to cents.',
            '3': `${MAIN_TESTS}${AGENT_TESTS}`.trimEnd(),
          },
        }),
      ],
    },
  );
  const write = (files: Record<string, string>) => {
    for (const [path, text] of Object.entries(files))
      writeFileSync(join(symbiote.repo, path), text);
  };
  write({
    'CHANGELOG.md': changelog(''),
    'README.md': readme('Totals are the sum of the prices.'),
    'src/total.test.ts': tests(''),
  });
  git('add', '.');
  git('commit', '-q', '-m', 'Main: docs and tests');
  git('checkout', '-q', 'agent');
  git('merge', '-q', '--no-edit', 'main');
  write({
    'CHANGELOG.md': changelog('- Discount codes at checkout.\n'),
    'README.md': readme('Totals are the sum of the prices, less any\ndiscount code.'),
    'src/total.test.ts': tests(AGENT_TESTS),
  });
  git('commit', '-q', '-am', 'Agent: discount codes');
  git('checkout', '-q', 'main');
  write({
    'CHANGELOG.md': changelog('- Totals are rounded to cents.\n'),
    'README.md': readme('Totals are the sum of the prices, rounded\nto cents.'),
    'src/total.test.ts': tests(MAIN_TESTS),
  });
  git('commit', '-q', '-am', 'Main: rounding');
  await approve(page, 'Agent: discount codes');
  await page.getByRole('button', { name: 'Merge into', exact: true }).click();
  await page.goto(`${symbiote.url}?merge=agent`);
  const entry = page.getByRole('region', { name: 'Merge of agent' });
  await expect(entry.locator('.merge-label')).toHaveText('Review resolution');

  const files = entry.getByRole('list', { name: 'Its files' }).getByRole('button');
  await expect(files).toHaveText([
    /^CHANGELOG\.md1 regionRepeats “## Unreleased” from just above it$/,
    /^README\.md1 region1 line written by the agent, with the changes of the 3 it replaces$/,
    /^total\.test\.ts src1 regionKeeps every line of both sides, nothing new$/,
  ]);
  await expect(files.nth(0)).toHaveClass(/merge-tone-bad/);
  await expect(files.nth(1)).toHaveClass(/merge-tone-new/);
  await expect(files.nth(2)).toHaveClass(/merge-tone-done/);
  // The copy is the file shown first, between the lines around it.
  await expect(files.nth(0)).toHaveAttribute('aria-current', 'true');
  const region = entry.getByRole('list', { name: 'Its resolution' }).getByRole('listitem');
  await expect(region.locator('.merge-region-where')).toContainText('Region 1CHANGELOG.md:');
  const resolved = region.locator('.merge-resolved .merge-line');
  // A blank line around it carries no name.
  await expect(resolved.locator('.merge-line-from')).toHaveText([
    'above',
    '',
    'above',
    'new',
    'main',
    'agent',
    '',
    'below',
    'below',
  ]);
  await expect(resolved.nth(3)).toContainText('also just above');
  // README: both sides' lines rewritten, their changes kept: listed, not struck out.
  await files.nth(1).click();
  await expect(region.locator('.merge-region-where')).toContainText('Region 2README.md:');
  await expect(region.locator('.merge-sub')).toHaveText([
    'Rewritten from main, its changes kept',
    'Rewritten from agent, its changes kept',
  ]);
  await expect(region.locator('.merge-rewritten .merge-line-text')).toHaveText([
    'Totals are the sum of the prices, rounded',
    'to cents.',
    'discount code.',
  ]);
});

test('a resolution of two files: each listed with what it did, the one that loses lines first (V46c)', async ({
  page,
}) => {
  page.on('pageerror', (error) => errors.push(error.message));
  const APP_MAIN = 'export const mainNote = 1;';
  const APP_AGENT = 'export const agentNote = 2;';
  symbiote = await serveAgentBranch(
    {},
    {
      merger: [
        JSON.stringify({
          // Region 1 in src/app.ts keeps both; region 2 in src/math.ts drops the agent's.
          regions: { '1': `${APP_MAIN}\n${APP_AGENT}`, '2': DOUBLE },
          notes: { '1': 'kept both', '2': "kept main's" },
        }),
      ],
    },
  );
  const app = join(symbiote.repo, 'src/app.ts');
  const math = join(symbiote.repo, 'src/math.ts');
  git('checkout', '-q', 'agent');
  writeFileSync(app, `${readFileSync(app, 'utf8')}\n${APP_AGENT}\n`);
  git('commit', '-q', '-am', 'Agent: note in app');
  git('checkout', '-q', 'main');
  writeFileSync(app, `${readFileSync(app, 'utf8')}\n${APP_MAIN}\n`);
  writeFileSync(math, `${readFileSync(math, 'utf8')}\n${DOUBLE}\n`);
  git('commit', '-q', '-am', 'Main: add double and a note');
  await approve(page, 'Agent: note in app');
  await page.getByRole('button', { name: 'Merge into', exact: true }).click();
  await page.goto(`${symbiote.url}history`);
  await page.locator('.sidenav [data-merge="agent"]').getByRole('link').click();
  const entry = page.getByRole('region', { name: 'Merge of agent' });
  await expect(entry.locator('.merge-label')).toHaveText('Review resolution');

  // Files first, once resolved: each file, its regions and what they did.
  await expect(entry.getByRole('tab', { name: /^Files/ })).toHaveAttribute('aria-selected', 'true');
  const files = entry.getByRole('list', { name: 'Its files' }).getByRole('button');
  await expect(files).toHaveText([
    /^app\.ts src1 regionKeeps every line of both sides, nothing new$/,
    /^math\.ts src1 regionDrops all 6 lines from agent$/,
  ]);
  // The file that loses lines is shown first, only its own regions.
  await expect(files.nth(1)).toHaveAttribute('aria-current', 'true');
  const regions = entry.getByRole('list', { name: 'Its resolution' }).getByRole('listitem');
  await expect(regions).toHaveCount(1);
  await expect(regions.locator('.merge-region-where')).toContainText('src/math.ts:');
  await files.nth(0).click();
  await expect(files.nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(regions.locator('.merge-region-where')).toContainText('src/app.ts:');
  await expect(
    regions.locator('.merge-resolved .merge-line:not(.from-around) .merge-line-text'),
  ).toHaveText([APP_MAIN, APP_AGENT]);

  // The log a tab away, the files hidden meanwhile.
  await entry.getByRole('tab', { name: 'Log' }).click();
  const log = entry.getByRole('log', { name: 'What it wrote' });
  await expect(log.locator('.xterm-rows')).toContainText(
    '2 files conflict: src/app.ts, src/math.ts',
  );
  await expect(entry.getByRole('list', { name: 'Its files' })).toBeHidden();
  await entry.getByRole('tab', { name: /^Files/ }).click();
  await expect(log).toBeHidden();
  await expect(files.nth(0)).toHaveAttribute('aria-current', 'true');
});

/** The space under the merge log's card, to the main area's end (V69: 16 px). */
const underLog = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('.shell-main')?.getBoundingClientRect();
    const log = document.querySelector('.merge-terminal')?.getBoundingClientRect();
    if (!main || !log) throw new Error('no merge log');
    return Math.round(main.bottom - log.bottom);
  });

/** The picked tab's line under it: `3px`, or `auto` when it has none. */
const tabLine = (tab: ReturnType<Page['getByRole']>) =>
  tab.evaluate((element) => getComputedStyle(element, '::after').height);

test("the person's mockup: the head's chips with their icons, the log a card down to the page's end (V69)", async ({
  page,
}) => {
  page.on('pageerror', (error) => errors.push(error.message));
  symbiote = await serveAgentBranch();
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(
    join(symbiote.repo, 'symbiote', 'config.json'),
    JSON.stringify({ merge: { checks: ['echo checked'] } }),
  );
  await approve(page);
  await page.getByRole('button', { name: 'Merge into', exact: true }).click();
  await page.goto(`${symbiote.url}history`);
  await page.locator('.sidenav [data-merge="agent"]').getByRole('link').click();
  const entry = page.getByRole('region', { name: 'Merge of agent' });
  await expect(entry.locator('.merge-label')).toHaveText('Landed');

  // The branch, the target and the state are chips; the arrow an icon in the target's, the
  // state's dot its tone's icon.
  const head = entry.locator('.merge-row-head');
  await expect(head).not.toContainText('→');
  await expect(head.locator('.merge-chip')).toHaveText(['agent', 'main', 'Landed']);
  await expect(head.locator('.merge-ref-ours svg')).toHaveCount(1);
  await expect(head.locator('.merge-label svg')).toHaveCount(1);

  // Symbiote's own steps weigh more than a check's command.
  const names = entry.getByRole('list', { name: 'Its steps' }).locator('.merge-step-name');
  await expect(names).toHaveText(['Merge', 'echo checked', 'Land']);
  await expect(names.nth(0)).toHaveCSS('font-weight', '500');
  await expect(names.nth(1)).toHaveCSS('font-weight', '400');

  // The log is a card, its edge a hairline, down to 16 px above the page's end at any height.
  await expect(entry.locator('.merge-terminal')).toHaveCSS('border-top-width', '1px');
  for (const height of [900, 700]) {
    await page.setViewportSize({ width: 1440, height });
    await expect.poll(() => underLog(page), { message: `at 1440×${height}` }).toBe(16);
  }
});

test("a resolution: its state's icon, Files and Log as line tabs, the log down to the page's end (V69)", async ({
  page,
}) => {
  const { entry } = await resolvedConflict(page, ['echo checked']);
  await expect(entry.locator('.merge-label')).toHaveText('Review resolution');
  await expect(entry.locator('.merge-label svg')).toHaveCount(1);
  const files = entry.getByRole('tab', { name: /^Files/ });
  const log = entry.getByRole('tab', { name: 'Log' });
  await expect(files).toHaveAttribute('aria-selected', 'true');
  expect(await tabLine(files)).toBe('3px');
  expect(await tabLine(log)).toBe('auto');
  await log.click();
  expect(await tabLine(log)).toBe('3px');
  expect(await tabLine(files)).toBe('auto');
  await expect.poll(() => underLog(page)).toBe(16);
});
