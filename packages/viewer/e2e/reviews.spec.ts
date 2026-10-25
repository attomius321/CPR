import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveAgentBranch, type RunningAgent } from './symbiote.js';

// Branch reviews (V15): review an agent's branch, then only what it changed since. Each test
// gets its own repository: reviews write into it.
let symbiote: RunningAgent;
const errors: string[] = [];
// `SYMBIOTE_CODE`: a stand-in for VS Code that writes what it was given.
const dir = mkdtempSync(join(tmpdir(), 'symbiote-e2e-code-'));
const log = join(dir, 'opened.jsonl');
const fake = join(dir, 'code');
writeFileSync(
  fake,
  '#!/usr/bin/env node\n' +
    `require('node:fs').appendFileSync(${JSON.stringify(log)}, ` +
    "JSON.stringify(process.argv.slice(2)) + '\\n');\n",
);
chmodSync(fake, 0o755);
const opened = (): string[][] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as string[])
    : [];

test.beforeEach(async ({ page }) => {
  rmSync(log, { force: true });
  symbiote = await serveAgentBranch({ SYMBIOTE_CODE: fake });
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  symbiote.stop();
  expect(errors).toEqual([]);
});

test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

const short = (sha: string | undefined) => (sha ?? '').slice(0, 7);
const row = (page: Page, subject: string) =>
  page.locator('.commit', { has: page.locator('.commit-subject', { hasText: subject }) });
const git = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: symbiote.repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Agent',
      GIT_AUTHOR_EMAIL: 'agent@example.com',
      GIT_COMMITTER_NAME: 'Agent',
      GIT_COMMITTER_EMAIL: 'agent@example.com',
    },
  }).trim();
const changesTab = (page: Page) => page.getByRole('tab', { name: /Changes/ });
const reviewTab = (page: Page) => page.getByRole('tab', { name: /Review/ });
const originGit = (...args: string[]) => git('--git-dir', symbiote.origin, ...args);
/** Opens row `subject`'s Review submenu and reviews its first branch. */
const review = async (page: Page, subject: string, entry: string) => {
  await row(page, subject).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Review', exact: true }).hover();
  const first = page.getByRole('menu', { name: 'Review' }).getByRole('menuitem').first();
  await expect(first).toHaveText(entry);
  await first.click();
};
const reviewFile = () =>
  join(symbiote.repo, 'symbiote', 'reviews', 'agent', 'reviewer@example.com.json');

test('reviews a branch, then only what the agent changed since', async ({ page }) => {
  const [base, , cube] = symbiote.shas;
  await page.goto(`${symbiote.url}history`);

  // The agent's tip offers "Review" beside "Check out"; main, the default branch, cannot be.
  await row(page, 'Agent: add cube').click({ button: 'right' });
  await expect(page.getByRole('menuitem')).toHaveText([
    'Check out',
    'Review',
    'Start a workspace here',
  ]);
  await page.getByRole('menuitem', { name: 'Review', exact: true }).hover();
  const targets = page.getByRole('menu', { name: 'Review' }).getByRole('menuitem');
  await expect(targets).toHaveText(['agent not reviewed yet']);
  await expect(targets.first()).toHaveAccessibleName('Review branch agent');
  await targets.first().click();

  // From where the branch left main to its tip.
  await expect(page).toHaveURL(/\/review\/agent\/$/);
  await expect(page.locator('.review-of')).toHaveText('Review of agent · first review');
  await expect(page.locator('.revisions')).toHaveText(`${short(base)} → ${short(cube)}`);
  await changesTab(page).click();
  await expect(changesTab(page)).toContainText('0/2');
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('j');
    await page.keyboard.press('r');
  }
  await expect(changesTab(page)).toContainText('2/2');

  // In symbiote/reviews/, out of git, written mark by mark: read once both have landed.
  const read = () =>
    existsSync(reviewFile())
      ? (JSON.parse(readFileSync(reviewFile(), 'utf8')) as {
          base: string;
          head: string;
          marks: Record<string, string>;
        })
      : null;
  await expect
    .poll(() => Object.keys(read()?.marks ?? {}).sort())
    .toEqual(['src/math.ts#cube', 'src/math.ts#square']);
  expect(read()).toMatchObject({ base, head: cube });
  expect(git('status', '--porcelain', '--untracked-files=all')).toBe('');

  // Back on the commits page the branch is being reviewed (V16: "✓" is an approval).
  await page.getByRole('link', { name: 'Back to History' }).click();
  await expect(row(page, 'Agent: add cube').locator('.ref-review')).toHaveText('…');

  // The agent changes square and adds half.
  git('checkout', '-q', 'agent');
  const math = join(symbiote.repo, 'src/math.ts');
  writeFileSync(
    math,
    readFileSync(math, 'utf8').replace('return a * a;', 'return a ** 2;') +
      '\nexport function half(a: number): number {\n  return a / 2;\n}\n',
  );
  git('commit', '-q', '-am', 'Agent: square with **, add half');
  const tip = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'main');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const added = row(page, 'Agent: square with **');
  await expect(added.locator('.ref-review')).toHaveText('+1');
  await expect(added.locator('.review-new')).toHaveCount(1);
  await expect(row(page, 'Agent: add cube').locator('.review-new')).toHaveCount(0);

  // Reviewing again, from the keyboard: only square (changed) and half (new) are left.
  await added.click();
  await page.keyboard.press('r');
  await expect(page.getByRole('menu', { name: 'Review' }).getByRole('menuitem').first()).toHaveText(
    'agent 2 reviewed · 1 commit since',
  );
  await page.keyboard.press('Enter');
  await expect(page.locator('.review-of')).toHaveText(
    'Review of agent · 1 commit since your last review',
  );
  await expect(page.locator('.revisions')).toHaveText(`${short(base)} → ${short(tip)}`);
  await changesTab(page).click();
  await expect(changesTab(page)).toContainText('1/3');
  await expect(page.locator('.stale-note')).toContainText('1 symbol changed since you reviewed it');

  // A new `symbiote view` (another port) finds the review in the repository.
  const url = await symbiote.restart();
  await page.goto(`${url}review/agent/`);
  await changesTab(page).click();
  await expect(changesTab(page)).toContainText('1/3');
});

test('finishes a review: changes requested for the agent, then approved to merge (V16, V17)', async ({
  page,
}) => {
  const [, , cube] = symbiote.shas;
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${symbiote.url}history`);
  await review(page, 'Agent: add cube', 'agent not reviewed yet');
  await expect(page).toHaveURL(/\/review\/agent\/$/);

  // A comment on square, then Request changes.
  await changesTab(page).click();
  await page.locator('.list-link', { hasText: 'square' }).click();
  const panel = page.getByRole('complementary', { name: 'Symbol detail' });
  await expect(panel.locator('.row-add').first()).toBeVisible();
  await page.keyboard.press('c');
  await page.keyboard.type('Return early for 0.');
  await page.keyboard.press('Control+Enter');
  await expect(panel.locator('.draft-body')).toHaveText('Return early for 0.');
  await reviewTab(page).click();
  await expect(reviewTab(page)).toContainText('1');
  await page.getByLabel('Review summary').fill('One thing.');
  await page.getByLabel('Request changes').check();
  await page.getByRole('button', { name: 'Finish review' }).click();
  const finished = page.locator('.finished');
  await expect(finished).toContainText(
    'Changes requested: the agent finds them in symbiote/reviews/agent/',
  );
  await expect(reviewTab(page)).toContainText('0');

  // For a chat: the text on the clipboard.
  await page.getByRole('button', { name: 'Copy for the agent' }).click();
  await expect(finished).toContainText('Copied.');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(
    new RegExp(
      `^Address this review of the branch agent \\(reviewer@example\\.com, at ${short(cube)}\\): changes requested\\.`,
    ),
  );
  expect(text).toMatch(
    /\nsrc\/math\.ts:\d+ · square\n {4}export function square\(a: number\): number \{\nReturn early for 0\.\n/,
  );

  // In the review's JSON, for the agent; nothing pushed.
  const saved = JSON.parse(readFileSync(reviewFile(), 'utf8')) as {
    drafts: unknown[];
    verdicts: { event: string; head: string; summary: string; comments: unknown[] }[];
  };
  expect(saved.drafts).toEqual([]);
  expect(saved.verdicts).toEqual([
    expect.objectContaining({
      event: 'request-changes',
      head: cube,
      summary: 'One thing.',
      comments: [
        expect.objectContaining({
          symbol: 'src/math.ts#square',
          side: 'head',
          path: 'src/math.ts',
          body: 'Return early for 0.',
          code: 'export function square(a: number): number {',
        }),
      ],
    }),
  ]);
  expect(() => originGit('rev-parse', '--verify', '--quiet', 'agent')).toThrow();
  await page.getByRole('link', { name: 'Back to History' }).click();
  await expect(row(page, 'Agent: add cube').locator('.ref-review')).toHaveText('✗');
  await expect(row(page, 'Agent: add cube').locator('.ref-review')).toHaveClass(
    /ref-review-changes/,
  );

  // The agent fixes it.
  git('checkout', '-q', 'agent');
  const math = join(symbiote.repo, 'src/math.ts');
  writeFileSync(
    math,
    readFileSync(math, 'utf8').replace(
      '  return a * a;\n',
      '  if (a === 0) return 0;\n  return a * a;\n',
    ),
  );
  git('commit', '-q', '-am', 'Agent: square returns early for 0');
  const fix = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'main');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(row(page, 'Agent: square returns early').locator('.ref-review')).toHaveText('+1');

  // Reviewed again and approved (V17): metadata for the agent, the merge into main; no push.
  await review(page, 'Agent: square returns early', 'agent changes requested · 1 commit since');
  await expect(page.locator('.review-of')).toHaveText(
    'Review of agent · 1 commit since your last review',
  );
  await reviewTab(page).click();
  await expect(page.locator('.merge-check')).toHaveText('Merges cleanly into main.');
  await page.getByLabel('Approve').check();
  // Where the verdict goes, behind the help beside Finish review (V37).
  await page.getByRole('button', { name: 'Where the verdict goes' }).hover();
  await expect(page.getByRole('tooltip')).toContainText(
    `Approve, then Merge: Symbiote merges ${short(fix)} into main (or a branch you pick), checks it and lands it.`,
  );
  await page.mouse.move(0, 0);
  // Not approved yet: nothing to merge.
  await expect(page.getByRole('button', { name: /^Merge into/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish review' }).click();
  await expect(page.locator('.finished')).toContainText(
    `Approved ${short(fix)}: Merge it into main or another branch below; Symbiote merges, checks and lands it.`,
  );
  await page.getByRole('button', { name: 'Copy for the agent' }).click();
  await expect(page.locator('.finished')).toContainText('Copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `Approved the branch agent at ${short(fix)}: Symbiote merges ${short(fix)} into main; do not merge it yourself.\n\n` +
      'The review: symbiote/reviews/agent/reviewer@example.com.json; how to act on it: symbiote/AGENTS.md.\n',
  );
  expect(() => originGit('rev-parse', '--verify', '--quiet', 'agent')).toThrow();
  const verdicts = (JSON.parse(readFileSync(reviewFile(), 'utf8')) as { verdicts: unknown[] })
    .verdicts;
  expect(verdicts.at(-1)).toMatchObject({ event: 'approve', head: fix, into: 'main' });
  // What an agent opening it reads first, and the instructions beside it.
  expect(readFileSync(reviewFile(), 'utf8').split('\n')[1]).toContain('symbiote/AGENTS.md');
  const agents = readFileSync(join(symbiote.repo, 'symbiote', 'AGENTS.md'), 'utf8');
  expect(agents).not.toContain('git merge --no-ff');
  expect(agents).toContain('Do not merge it yourself');
  expect(git('status', '--porcelain', '--untracked-files=all')).toBe('');
  await page.getByRole('link', { name: 'Back to History' }).click();
  const approved = row(page, 'Agent: square returns early').locator('.ref-review').first();
  await expect(approved).toHaveText('✓');
  await expect(approved).toHaveAttribute('title', 'Approved');
  // A filled chip in the verdict's colour, not a glyph in the badge's text colour.
  await expect(approved).toHaveClass(/ref-review-approved/);
  const look = await approved.evaluate((el) => {
    const badge = el.parentElement!;
    return {
      background: getComputedStyle(el).backgroundColor,
      color: getComputedStyle(el).color,
      badgeColor: getComputedStyle(badge).color,
      height: el.getBoundingClientRect().height,
      badgeHeight: badge.getBoundingClientRect().height,
    };
  });
  expect(look.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(look.color).not.toBe(look.badgeColor);
  expect(look.height).toBeLessThan(look.badgeHeight);

  // Symbiote merges the approved commit (V26a): Merge into ▾ on the review, preselected main.
  await review(page, 'Agent: square returns early', 'agent approved');
  await reviewTab(page).click();
  const target = page.getByLabel('Branch to merge into');
  await expect(target).toHaveValue('main');
  await expect(target.locator('option')).toHaveText(['main']);
  const main = git('rev-parse', 'main');
  await page.getByRole('button', { name: 'Merge into', exact: true }).click();
  // No check in this repository: merged in Symbiote's worktree, waiting for Land; main unchanged.
  await expect(page.locator('p.merge-control')).toHaveText(
    /^Merged, not checked: no check to run: set merge.checks in symbiote\/config.json/,
  );
  expect(git('rev-parse', 'main')).toBe(main);

  // In the sidenav's Merging group; open, in the main area (V29a).
  await page.goto(`${symbiote.url}history`);
  await expect(
    page.getByRole('region', { name: 'Merging' }).locator('[data-merge="agent"]'),
  ).toBeVisible();
  await page.goto(`${symbiote.url}?merge=agent`);
  const entry = page.getByRole('region', { name: 'Merge of agent' });
  await expect(entry.locator('.merge-row-state')).toHaveText(/^Merged, not checked/);
  await entry.getByRole('button', { name: 'Land', exact: true }).click();
  await expect(entry.locator('.merge-row-state')).toHaveText(/^Landed: main is at [0-9a-f]{7}$/);
  const merge = git('rev-parse', 'main');
  expect(git('log', '-1', '--format=%P%n%s', merge)).toBe(
    `${main} ${fix}\nMerge agent: Agent: square returns early for 0`,
  );
  // Fast-forwarded in this checkout, which has main: its files are the merge's.
  expect(git('status', '--porcelain', '--untracked-files=all')).toBe('');
  expect(readFileSync(math, 'utf8')).toContain('if (a === 0) return 0;');
  await expect(entry.getByRole('button', { name: 'Land', exact: true })).toHaveCount(0);

  await page.goto(`${symbiote.url}history`);
  await expect(
    row(page, 'Agent: square returns early').locator('.ref-review').first(),
  ).toHaveAttribute('title', 'Approved · merged into main');
});

test('says a branch will conflict with main; resolved on the branch, only its commit is new (V17)', async ({
  page,
}) => {
  const [, , cube] = symbiote.shas;
  const math = join(symbiote.repo, 'src/math.ts');
  // main adds a function where the agent added its own: the merge conflicts.
  writeFileSync(
    math,
    `${readFileSync(math, 'utf8')}\nexport const double = (a: number) => a * 2;\n`,
  );
  git('commit', '-q', '-am', 'Main: add double');
  await page.goto(`${symbiote.url}history`);
  await review(page, 'Agent: add cube', 'agent not reviewed yet');
  await reviewTab(page).click();
  // Each file on its line, its folder beside it, and a button that opens it in VS Code.
  const check = page.locator('.merge-check');
  await expect(check.locator('.merge-check-head')).toHaveText(
    'Conflicts with main in 1 file: Merge into gives them to the merger agent, and you review its resolution before it lands:',
  );
  await expect(check.locator('li')).toHaveText(['math.tssrc/']);
  await check.getByRole('button', { name: 'Open src/math.ts in VS Code' }).click();
  await expect(check.getByRole('status')).toHaveText('Opened src/math.ts in VS Code');
  expect(opened()).toEqual([
    [symbiote.repo, '--goto', `${join(symbiote.repo, 'src', 'math.ts')}:1:1`],
  ]);
  await page.getByLabel('Approve').check();
  await page.getByRole('button', { name: 'Finish review' }).click();
  await expect(page.locator('.finished')).toContainText(`Approved ${short(cube)}`);
  // Symbiote's merge stops at the conflict (V26a): nothing changes, the file is named.
  const main = git('rev-parse', 'main');
  await page.getByRole('button', { name: 'Merge into', exact: true }).click();
  await expect(page.locator('p.merge-control')).toHaveText('Conflicts with main in 1 file');
  expect(git('rev-parse', 'main')).toBe(main);
  await page.goto(`${symbiote.url}?merge=agent`);
  const entry = page.getByRole('region', { name: 'Merge of agent' });
  // Its file in its Files list (V46c), not resolved: no merger agent here.
  await entry.getByRole('tab', { name: /^Files/ }).click();
  await expect(entry.getByRole('list', { name: 'Its files' }).getByRole('button')).toHaveText([
    /^math\.ts src.*Not resolved$/,
  ]);
  await expect(entry).toContainText('merge main into agent, resolve it there, and review it again');
  await entry.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(page.getByRole('region', { name: 'Merging' })).toHaveCount(0);
  await page.goto(`${symbiote.url}history`);

  // The agent merges main into its branch and resolves the conflict there.
  git('checkout', '-q', 'agent');
  expect(() => git('merge', '-q', '--no-edit', 'main')).toThrow();
  const theirs = readFileSync(math, 'utf8')
    .split('\n')
    .filter((line) => !/^(<<<<<<<|=======|>>>>>>>)/.test(line))
    .join('\n');
  writeFileSync(math, theirs);
  git('commit', '-q', '-am', 'Merge main into agent');
  git('checkout', '-q', 'main');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  // One commit since the approval, the merge; main's own commit is not the branch's.
  const merged = row(page, 'Merge main into agent');
  await expect(merged.locator('.ref-review')).toHaveText('+1');
  await expect(merged.locator('.review-new')).toHaveCount(1);
  await expect(row(page, 'Main: add double').locator('.review-new')).toHaveCount(0);

  // Reviewed again: the merge into main is clean now.
  await review(page, 'Merge main into agent', 'agent approved · 1 commit since');
  await reviewTab(page).click();
  await expect(page.locator('.merge-check')).toHaveText('Merges cleanly into main.');
});

test("reviews the agent's commits on main itself; an approval says they may be pushed (V16, V17)", async ({
  page,
}) => {
  const math = join(symbiote.repo, 'src/math.ts');
  writeFileSync(math, `${readFileSync(math, 'utf8')}\nexport const half = (a: number) => a / 2;\n`);
  git('commit', '-q', '-am', 'Agent: add half on main');
  const tip = git('rev-parse', 'HEAD');
  await page.goto(`${symbiote.url}history`);
  await review(page, 'Agent: add half on main', 'main 1 unpushed commit');
  await expect(page).toHaveURL(/\/review\/main\/$/);
  await expect(page.locator('.review-of')).toHaveText('Review of main · first review');
  await reviewTab(page).click();
  // Nothing to merge into: no merge check.
  await expect(page.locator('.merge-check')).toHaveCount(0);
  await page.getByLabel('Approve').check();
  await page.getByRole('button', { name: 'Finish review' }).click();
  await expect(page.locator('.finished')).toContainText(
    `Approved ${short(tip)}: the agent may push these commits when you ask it to act on this review.`,
  );
  expect(originGit('rev-parse', 'main')).not.toBe(tip);
});
