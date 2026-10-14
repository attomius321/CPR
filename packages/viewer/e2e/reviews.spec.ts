import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveAgentBranch, type RunningAgent } from './cpr.js';

// Branch reviews (V15): review an agent's branch, then only what it changed since. Each test
// gets its own repository: reviews write into it.
let cpr: RunningAgent;
const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  cpr = await serveAgentBranch();
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  cpr.stop();
  expect(errors).toEqual([]);
});

const short = (sha: string | undefined) => (sha ?? '').slice(0, 7);
const row = (page: Page, subject: string) =>
  page.locator('.commit', { has: page.locator('.commit-subject', { hasText: subject }) });
const git = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: cpr.repo,
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
const originGit = (...args: string[]) => git('--git-dir', cpr.origin, ...args);
/** Opens row `subject`'s Review submenu and reviews its first branch. */
const review = async (page: Page, subject: string, entry: string) => {
  await row(page, subject).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Review', exact: true }).hover();
  const first = page.getByRole('menu', { name: 'Review' }).getByRole('menuitem').first();
  await expect(first).toHaveText(entry);
  await first.click();
};
const reviewFile = () => join(cpr.repo, 'cpr', 'reviews', 'agent', 'reviewer@example.com.json');

test('reviews a branch, then only what the agent changed since', async ({ page }) => {
  const [base, , cube] = cpr.shas;
  await page.goto(cpr.url);

  // The agent's tip offers "Review" beside "Check out"; main, the default branch, cannot be.
  await row(page, 'Agent: add cube').click({ button: 'right' });
  await expect(page.getByRole('menuitem')).toHaveText(['Check out', 'Review']);
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

  // In cpr/reviews/, out of git.
  await expect.poll(() => existsSync(reviewFile())).toBe(true);
  const saved = JSON.parse(readFileSync(reviewFile(), 'utf8')) as {
    base: string;
    head: string;
    marks: Record<string, string>;
  };
  expect(saved).toMatchObject({ base, head: cube });
  expect(Object.keys(saved.marks).sort()).toEqual(['src/math.ts#cube', 'src/math.ts#square']);
  expect(git('status', '--porcelain', '--untracked-files=all')).toBe('');

  // Back on the commits page the branch is being reviewed (V16: "✓" is an approval).
  await page.getByRole('link', { name: '← Commits' }).click();
  await expect(row(page, 'Agent: add cube').locator('.ref-review')).toHaveText('…');

  // The agent changes square and adds half.
  git('checkout', '-q', 'agent');
  const math = join(cpr.repo, 'src/math.ts');
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

  // A new `cpr view` (another port) finds the review in the repository.
  const url = await cpr.restart();
  await page.goto(`${url}review/agent/`);
  await changesTab(page).click();
  await expect(changesTab(page)).toContainText('1/3');
});

test('finishes a review: changes requested for the agent, then approved and pushed (V16)', async ({
  page,
}) => {
  const [, , cube] = cpr.shas;
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(cpr.url);
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
    'Changes requested: the agent finds them in cpr/reviews/agent/',
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
  await page.getByRole('link', { name: '← Commits' }).click();
  await expect(row(page, 'Agent: add cube').locator('.ref-review')).toHaveText('✗');

  // The agent fixes it.
  git('checkout', '-q', 'agent');
  const math = join(cpr.repo, 'src/math.ts');
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

  // Reviewed again and approved: pushed, that commit exactly.
  await review(page, 'Agent: square returns early', 'agent changes requested · 1 commit since');
  await expect(page.locator('.review-of')).toHaveText(
    'Review of agent · 1 commit since your last review',
  );
  await reviewTab(page).click();
  await page.getByLabel('Approve').check();
  await page.getByRole('button', { name: 'Approve and push 3 commits to origin/agent' }).click();
  await expect(page.locator('.finished')).toContainText(
    `Approved and pushed ${short(fix)} to origin/agent.`,
  );
  expect(originGit('rev-parse', 'agent')).toBe(fix);
  await page.getByRole('link', { name: '← Commits' }).click();
  await expect(row(page, 'Agent: square returns early').locator('.ref-review').first()).toHaveText(
    '✓',
  );
});

test("reviews the agent's commits on main itself, and pushes them on approval (V16)", async ({
  page,
}) => {
  const math = join(cpr.repo, 'src/math.ts');
  writeFileSync(math, `${readFileSync(math, 'utf8')}\nexport const half = (a: number) => a / 2;\n`);
  git('commit', '-q', '-am', 'Agent: add half on main');
  const tip = git('rev-parse', 'HEAD');
  await page.goto(cpr.url);
  await review(page, 'Agent: add half on main', 'main 1 unpushed commit');
  await expect(page).toHaveURL(/\/review\/main\/$/);
  await expect(page.locator('.review-of')).toHaveText('Review of main · first review');
  await reviewTab(page).click();
  await page.getByLabel('Approve').check();
  await page.getByRole('button', { name: 'Approve and push 1 commit to origin/main' }).click();
  await expect(page.locator('.finished')).toContainText(
    `Approved and pushed ${short(tip)} to origin/main.`,
  );
  expect(originGit('rev-parse', 'main')).toBe(tip);
});
