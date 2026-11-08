import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { fakeForge, type FakeForge, type FakeIssue } from '../../forge/test/fake-forge.js';
import { serveCommits, type RunningCommits } from './symbiote.js';
import { collectTargets, crowded } from './targets.js';

// IS1: the Issues page. A real `symbiote view` whose origin names GitHub or GitLab, their APIs a
// fake forge (`GITHUB_API_URL`, `GITLAB_API_URL`): the list, its state and search, Load more, one
// issue with its comments and its link; no token, origin on neither forge, the forge's error.
// Issue text is hostile on purpose: nothing it holds may run or load. Nothing leaves the machine.
let symbiote: RunningCommits | undefined;
let forge: FakeForge | undefined;
const errors: string[] = [];

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(async () => {
  symbiote?.stop();
  symbiote = undefined;
  await forge?.close_();
  forge = undefined;
  expect(errors).toEqual([]);
});

const HOSTILE = [
  '<!-- Please fill in the template -->',
  '### Steps',
  '',
  'Run `vite build` <img src="https://tracker.example/pixel.png" onerror="window.pwned = 1">',
  '',
  '<script>window.pwned = 2</script>',
  '',
  '<details><summary>Logs</summary>',
  '',
  '```',
  'Error: <b>boom</b>',
  '```',
  '</details>',
  '',
  '[a link](https://example.com/docs) and [another](javascript:window.pwned=3)',
].join('\n');

/** Issues 1–35 open, most recently updated last numbered; 3 closed. */
function seed(fake: FakeForge) {
  const at = (n: number) => new Date(Date.UTC(2026, 10, 7, 0, n)).toISOString();
  const open: FakeIssue[] = Array.from({ length: 35 }, (_, i) => ({
    number: i + 1,
    title: `Issue number ${i + 1}`,
    body: 'Text.',
    state: 'open',
    author: 'someone',
    updated: at(i),
  }));
  open[34] = {
    number: 35,
    title: 'Build fails on Windows',
    body: HOSTILE,
    state: 'open',
    author: 'ada',
    role: 'OWNER',
    labels: [
      { name: 'bug', color: 'd73a4a' },
      { name: 'odd', color: 'red;background:url(https://tracker.example/l)' },
    ],
    comments: [
      { author: 'grace', body: 'Same here on **24.1**.', role: 'MEMBER' },
      { author: 'linus', body: 'Fixed by <b>bumping</b> it.' },
    ],
    updated: at(100),
  };
  fake.issues.push(...open);
  for (const n of [36, 37, 38]) {
    fake.issues.push({
      number: n,
      title: `Closed watcher bug ${n}`,
      body: 'Done.',
      state: 'closed',
      author: 'someone',
      updated: at(n),
    });
  }
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** `symbiote view` with origin on the fake forge, a token for it unless `token` is false. */
async function serve(kind: 'github' | 'gitlab', token = true) {
  forge = await fakeForge(kind);
  seed(forge);
  const env: Record<string, string> =
    kind === 'github'
      ? { GITHUB_API_URL: forge.url, GITHUB_TOKEN: token ? 'ghp_fake' : '', GH_TOKEN: '' }
      : { GITLAB_API_URL: forge.url, GITLAB_TOKEN: token ? 'glpat-fake' : '' };
  symbiote = await serveCommits(env);
  git(symbiote.repo, 'remote', 'set-url', 'origin', `https://${kind}.com/acme/app.git`);
  return symbiote;
}

const list = (page: Page) => page.getByRole('region', { name: 'Issues', exact: true });
const rows = (page: Page) => list(page).locator('.issues-row');

test('GitHub: the list, its states, the search, Load more, one issue with its comments', async ({
  page,
}) => {
  const running = await serve('github');
  // A pull request among GitHub's issues: never listed.
  forge!.requests.push({
    number: 99,
    head: 'topic',
    base: 'main',
    title: 'A pull request',
    body: '',
    draft: false,
    state: 'open',
    conflict: false,
  });

  // The sidenav's entry, and its key.
  await page.goto(`${running.url}git`);
  const entry = page.locator('.sidenav').getByRole('link', { name: 'Issues' });
  await expect(entry).toBeVisible();
  await page.keyboard.press('u');
  await expect(page).toHaveURL(/\/issues$/);
  await expect(entry).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.issues-head h1')).toHaveText('Issues');
  await expect(page.locator('.issues-head .page-line')).toHaveText('acme/app on GitHub');
  const all = page.locator('.issues-head').getByRole('link', { name: 'Issues on GitHub' });
  await expect(all).toHaveAttribute('href', 'https://github.com/acme/app/issues');
  await expect(all).toHaveAttribute('target', '_blank');

  // Open by default, most recently updated first, 30 of 35, the pull request left out.
  await expect(list(page).getByRole('tab', { name: 'Open' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(rows(page)).toHaveCount(30);
  await expect(rows(page).first()).toContainText('#35');
  await expect(rows(page).first()).toContainText('Build fails on Windows');
  await expect(rows(page).first()).toContainText('ada · updated');
  await expect(rows(page).first()).toContainText('2 comments');
  await expect(list(page)).not.toContainText('A pull request');
  // Its labels: the name; the colour only where it is one.
  const labels = rows(page).first().locator('.issues-label');
  await expect(labels).toHaveText(['bug', 'odd']);
  await expect(labels.first().locator('.issues-label-dot')).toHaveCSS(
    'background-color',
    'rgb(215, 58, 74)',
  );
  await expect(labels.nth(1).locator('.issues-label-dot')).toHaveCount(0);
  await expect(list(page)).toContainText('30 shown');
  await list(page).getByRole('button', { name: 'Load more' }).click();
  await expect(rows(page)).toHaveCount(35);
  await expect(list(page)).toContainText('35 shown, all of them');
  await expect(list(page).getByRole('button', { name: 'Load more' })).toHaveCount(0);

  // Closed, then All.
  await list(page).getByRole('tab', { name: 'Closed' }).click();
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).first().getByRole('img', { name: 'Closed' })).toBeVisible();
  await list(page).getByRole('tab', { name: 'All' }).click();
  await expect(rows(page)).toHaveCount(30);

  // The search, on titles at the forge; Escape clears it.
  const search = list(page).getByRole('searchbox', { name: 'Search issue titles' });
  await search.fill('watcher');
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).first()).toContainText('Closed watcher bug');
  await list(page).getByRole('tab', { name: 'Open' }).click();
  await expect(list(page)).toContainText('No open issues with “watcher” in their title.');
  await search.press('Escape');
  await expect(rows(page)).toHaveCount(30);
  expect(forge!.calls.some((call) => call.path.startsWith('/search/issues'))).toBe(true);

  // One issue: its text without its HTML, its comments, its link.
  await rows(page).first().click();
  await expect(page).toHaveURL(/\/issues\?number=35$/);
  const issue = page.getByRole('region', { name: 'Issue #35' });
  await expect(issue.locator('.issues-title')).toHaveText('Build fails on Windows');
  await expect(issue.locator('.issues-byline')).toContainText('Open');
  await expect(issue.locator('.issues-byline')).toContainText('ada');
  await expect(issue.locator('.issues-byline .issues-role')).toHaveText('Owner');
  const open = issue.getByRole('link', { name: 'Open on GitHub' });
  await expect(open).toHaveAttribute('href', 'https://github.com/acme/app/issues/35');
  await expect(open).toHaveAttribute('target', '_blank');
  const text = issue.locator('.issues-article > .issues-text');
  await expect(text.getByRole('heading', { name: 'Steps' })).toBeVisible();
  await expect(text).not.toContainText('Please fill in');
  await expect(text).toContainText('Logs');
  await expect(text).not.toContainText('pwned');
  await expect(text.locator('pre')).toHaveText('Error: <b>boom</b>');
  // The image a link to it, never loaded; no script, no style, no javascript: link.
  await expect(text.getByRole('link', { name: 'image' })).toHaveAttribute(
    'href',
    'https://tracker.example/pixel.png',
  );
  await expect(text.getByRole('link', { name: 'a link' })).toHaveAttribute(
    'href',
    'https://example.com/docs',
  );
  await expect(text.getByRole('link', { name: 'another' })).toHaveCount(0);
  await expect(page.locator('.issues img, .issues script, .issues iframe')).toHaveCount(0);
  expect(await page.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined();

  const comments = issue.locator('.issues-comment');
  await expect(comments).toHaveCount(2);
  await expect(comments.first()).toContainText('grace');
  await expect(comments.first().locator('.issues-role')).toHaveText('Member');
  await expect(comments.first().locator('strong')).toHaveText('24.1');
  await expect(comments.nth(1)).toContainText('Fixed by bumping it.');
  await expect(issue.locator('.issues-comments-head .count')).toHaveText('2');

  // The address opens it; the title says it.
  await page.reload();
  await expect(page.getByRole('region', { name: 'Issue #35' }).locator('.issues-title')).toHaveText(
    'Build fails on Windows',
  );
  await expect(page).toHaveTitle(/^#35 · Issues · /);
  // Every read had the token.
  expect(forge!.calls.every((call) => call.headers.authorization === 'Bearer ghp_fake')).toBe(true);
});

test('GitHub without a token: public issues read, the note says what to set', async ({ page }) => {
  const running = await serve('github', false);
  await page.goto(`${running.url}issues`);
  await expect(rows(page)).toHaveCount(30);
  await expect(list(page).getByRole('note')).toHaveText(
    'Read without a token: public issues only, 60 requests an hour. No GitHub token for github.com: set GITHUB_TOKEN or GH_TOKEN, or log in with gh auth login.',
  );
  expect(forge!.calls.every((call) => call.headers.authorization === undefined)).toBe(true);
});

test("the forge's error, in its words, and Retry", async ({ page }) => {
  const running = await serve('github');
  forge!.issuesFail = 502;
  await page.goto(`${running.url}issues`);
  const alert = list(page).getByRole('alert');
  await expect(alert).toContainText('GitHub did not answer');
  await expect(alert).toContainText('answered 502');
  forge!.issuesFail = undefined;
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect(rows(page)).toHaveCount(30);
});

test('origin on neither forge: the page says so', async ({ page }) => {
  symbiote = await serveCommits();
  git(symbiote.repo, 'remote', 'set-url', 'origin', 'https://git.example.com/acme/app.git');
  await page.goto(`${symbiote.url}issues`);
  const card = page.getByRole('region', { name: 'Issues' });
  await expect(
    card.getByRole('heading', { name: 'origin is not on GitHub or GitLab' }),
  ).toBeVisible();
  await expect(card).toContainText('cannot tell whether git.example.com is GitHub or GitLab');
});

test('no origin: the page says so', async ({ page }) => {
  symbiote = await serveCommits();
  git(symbiote.repo, 'remote', 'remove', 'origin');
  await page.goto(`${symbiote.url}issues`);
  const card = page.getByRole('region', { name: 'Issues' });
  await expect(card.getByRole('heading', { name: 'No origin' })).toBeVisible();
  await expect(card).toContainText('the repository has no remote named origin');
});

test('GitLab: the list and one issue with its notes; without a token, the notes need one', async ({
  page,
}) => {
  const running = await serve('gitlab');
  await page.goto(`${running.url}issues?number=35`);
  await expect(rows(page)).toHaveCount(30);
  await expect(rows(page).first()).toHaveAttribute('aria-current', 'true');
  const issue = page.getByRole('region', { name: 'Issue #35' });
  await expect(issue.getByRole('link', { name: 'Open on GitLab' })).toHaveAttribute(
    'href',
    'https://gitlab.com/acme/app/-/issues/35',
  );
  await expect(issue.locator('.issues-byline .issues-role')).toHaveText('Owner');
  await expect(issue.locator('.issues-comment')).toHaveCount(2);
  await list(page).getByRole('searchbox', { name: 'Search issue titles' }).fill('windows');
  await expect(rows(page)).toHaveCount(1);
  symbiote?.stop();
  await forge?.close_();

  const without = await serve('gitlab', false);
  await page.goto(`${without.url}issues?number=35`);
  const read = page.getByRole('region', { name: 'Issue #35' });
  await expect(read.locator('.issues-title')).toHaveText('Build fails on Windows');
  await expect(read.locator('.issues-comment')).toHaveCount(0);
  await expect(read).toContainText(
    '2 comments: GitLab shows them only with a token (GITLAB_TOKEN).',
  );
  await expect(list(page).getByRole('note')).toContainText('Read without a token');
});

test('targets are 24 px or spaced at each text size, an issue read (WCAG 2.2, 2.5.8)', async ({
  page,
}) => {
  const running = await serve('github');
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const size of ['default', 'compact', 'large'] as const) {
    await page.goto(`${running.url}issues`);
    await page.evaluate((size) => localStorage.setItem('symbiote.viewer.text-size', size), size);
    await page.goto(`${running.url}issues?number=35`);
    await expect(page.locator('.issues-comment')).toHaveCount(2);
    await page.evaluate(() => document.fonts.ready);
    expect.soft(crowded(await page.evaluate(collectTargets)), size).toEqual([]);
  }
});
