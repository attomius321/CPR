import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveAgentBranch, servePullRequest, type RunningAgent } from './symbiote.js';

// The Files page (V60): a review opens on the changed files; a click shows a file's diff, and a
// click on one of its lines writes a comment there, one of the review's. Each test gets its own
// repository: reviews write into it.
let symbiote: RunningAgent;
const errors: string[] = [];

/** The agent's branch with a note beside its two functions: a file no symbol holds. */
const NOTES = ['# Notes', '', 'Square and cube, for the totals.', 'Half comes later.', ''].join(
  '\n',
);

test.beforeEach(async ({ page }) => {
  symbiote = await serveAgentBranch();
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
    });
  git('checkout', '-q', 'agent');
  mkdirSync(join(symbiote.repo, 'docs'));
  writeFileSync(join(symbiote.repo, 'docs/notes.md'), NOTES);
  git('add', 'docs/notes.md');
  git('commit', '-q', '-m', 'Agent: notes');
  git('checkout', '-q', 'main');
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  symbiote.stop();
  expect(errors).toEqual([]);
});

const reviewFile = () =>
  join(symbiote.repo, 'symbiote', 'reviews', 'agent', 'reviewer@example.com.json');
const fileRow = (page: Page, path: string) =>
  page.getByRole('button', { name: `Show the changes to ${path}` });
const diff = (page: Page) => page.getByRole('table', { name: /^Diff of / });
const line = (page: Page, text: string) => diff(page).getByRole('row').filter({ hasText: text });

test('opens a review on its files; a comment on a line of a note is recorded with its place', async ({
  page,
}) => {
  await page.goto(`${symbiote.url}review/agent/`);
  const files = page.getByRole('navigation', { name: 'Files' });
  await expect(files.getByRole('tab', { name: /Files/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.page-switch .scope.active')).toHaveText('Files');
  await expect(page.locator('.react-flow')).toHaveCount(0);

  // Every changed file, as a workspace lists them: the note has no symbol.
  await expect(page.locator('.files-list .changes-file')).toHaveCount(2);
  await expect(fileRow(page, 'docs/notes.md')).toContainText('notes.mddocs+4 −0');
  await expect(fileRow(page, 'src/math.ts')).toContainText('math.tssrc+8 −0');
  // The first is open.
  await expect(fileRow(page, 'docs/notes.md')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.file-path')).toHaveText('docs/notes.md');
  await expect(page.locator('.file-words')).toHaveText('added');
  await expect(diff(page).getByRole('row')).toHaveCount(4);

  // A click on a line opens a comment box under it.
  await line(page, 'Half comes later.').click();
  const box = page.getByLabel('Comment');
  await expect(box).toBeFocused();
  await expect(page.locator('.file-comment-form .comment-actions')).toContainText(
    'on line 4 of docs/notes.md',
  );
  await page.keyboard.press('Escape');
  await expect(box).toHaveCount(0);
  await line(page, 'Half comes later.').click();
  await page.keyboard.type('When?');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.file-comments .draft-body')).toHaveText('When?');
  await expect(page.locator('.file-comments .draft-where')).toContainText('On this line');
  await expect(fileRow(page, 'docs/notes.md').locator('.files-commented')).toHaveText('1');

  // The review's tab lists it by its place, and finishes the review.
  const reviewTab = files.getByRole('tab', { name: /Review/ });
  await expect(reviewTab).toContainText('1');
  await reviewTab.click();
  await expect(page.locator('.draft-row .list-link')).toHaveText('docs/notes.md:4');
  await page.getByRole('button', { name: 'Finish review' }).click();
  await expect(page.locator('.finished')).toContainText('Comments recorded');
  const verdicts = () =>
    existsSync(reviewFile())
      ? (JSON.parse(readFileSync(reviewFile(), 'utf8')) as { verdicts: unknown[] }).verdicts
      : [];
  await expect.poll(() => verdicts().length).toBe(1);
  expect(verdicts()[0]).toMatchObject({
    event: 'comment',
    comments: [
      { body: 'When?', side: 'head', path: 'docs/notes.md', line: 4, code: 'Half comes later.' },
    ],
  });
  expect(verdicts()[0]).not.toHaveProperty('comments.0.symbol');
});

test("a comment in a function names it, and the Graph page shows it in the symbol's panel", async ({
  page,
}) => {
  await page.goto(`${symbiote.url}review/agent/`);
  await expect(page.locator('.file-path')).toHaveText('docs/notes.md');
  await page.keyboard.press('j');
  await expect(page.locator('.file-path')).toHaveText('src/math.ts');
  await expect(fileRow(page, 'src/math.ts')).toHaveAttribute('aria-current', 'true');

  // The function before the change is folded but its last three lines; a click opens the rest.
  const fold = diff(page).getByRole('button', { name: '4 unchanged lines' });
  await expect(fold).toBeVisible();
  await expect(diff(page).getByRole('row')).toHaveCount(11);
  await fold.click();
  await expect(diff(page).getByRole('row')).toHaveCount(15);

  // An unchanged line takes a comment on a branch review, on its head side.
  await line(page, 'return a + b;').click();
  await expect(page.locator('.file-comment-form .comment-actions')).toContainText(
    'on line 2 of src/math.ts',
  );
  // A line in square: the comment is about square.
  await line(page, 'return a * a;').first().click();
  await page.keyboard.type('Why not a ** 2?');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await expect(page.locator('.file-comments .draft-where')).toContainText('On square');

  // g: the Graph page, kept on reload; the comment is in square's panel.
  await page.keyboard.press('g');
  await expect(page).toHaveURL(/\/review\/agent\/\?view=graph$/);
  await expect(page.locator('.react-flow__node-symbol').first()).toBeVisible();
  await page.reload();
  await expect(page.locator('.page-switch .scope.active')).toHaveText('Graph');
  await page.getByRole('tab', { name: /Review/ }).click();
  await page.locator('.draft-row .list-link', { hasText: 'square' }).click();
  const panel = page.getByRole('complementary', { name: 'Symbol detail' });
  await expect(panel.locator('.draft-body')).toHaveText('Why not a ** 2?');

  // The switch: back to Files, the address without the page.
  await page.locator('.page-switch').getByRole('tab', { name: 'Files' }).click();
  await expect(page).toHaveURL(/\/review\/agent\/$/);
  await expect(page.locator('.file-path')).toBeVisible();
});

test('under symbiote pr, only changed lines take a comment, posted on the forge', async ({
  page,
}) => {
  const pr = await servePullRequest('callers');
  try {
    await page.goto(pr.url);
    await expect(page.locator('.files-list .changes-file')).toHaveCount(1);
    await expect(page.locator('.file-path')).toHaveText('src/math.ts');
    // Unchanged lines are not offered: the forge takes only lines of its own hunks.
    await expect(diff(page).locator('.row-same.pickable')).toHaveCount(0);
    await expect(diff(page).locator('.row-add.pickable').first()).toBeVisible();
    await diff(page).locator('.row-add').first().click();
    await page.keyboard.type('Named well.');
    await page.keyboard.press('Control+Enter');
    await page.getByRole('tab', { name: /Review/ }).click();
    await page.getByRole('button', { name: 'Submit review to GitHub' }).click();
    await expect(page.locator('.posted')).toContainText('Review posted.');
    const posted = pr.requests.filter((r) => r.method === 'POST');
    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toMatchObject({
      comments: [{ path: 'src/math.ts', side: 'RIGHT', body: 'Named well.' }],
    });
  } finally {
    pr.stop();
  }
});
