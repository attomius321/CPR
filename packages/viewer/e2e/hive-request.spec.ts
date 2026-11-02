import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fakeForge, type FakeForge } from '../../forge/test/fake-forge.js';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// HV8: Hive lands through a pull request. A real `symbiote view` whose `origin` names GitHub
// (git reaches a bare repository in its place, by `insteadOf`) and whose GitHub API is a fake: the
// workspace's request opened at landing, the card waiting for the person's merge with its link,
// the Review tab's request, and Done once merged on the fake forge. Nothing leaves the machine.
let symbiote: RunningWorkspaces;
let forge: FakeForge | undefined;
const errors: string[] = [];

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(async () => {
  symbiote.stop();
  await forge?.close_();
  forge = undefined;
  expect(errors).toEqual([]);
});

const BRANCH = 'feature/one';
const GITHUB = 'https://github.com/acme/app.git';
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const card = (page: Page) => page.locator(`.sidenav .workspace-row[data-branch="${BRANCH}"]`);
const startPage = (page: Page) => page.getByRole('region', { name: 'Start a workspace' });
const hive = (page: Page, on: boolean) =>
  page.evaluate(async (on) => {
    const response = await fetch('/api/hive', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
      body: JSON.stringify({ on }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, on);
const config = () => join(symbiote.repo, 'symbiote', 'config.json');

/** `origin` named GitHub's address; git reaches the bare repository it was in its place. */
function originOnGitHub(): string {
  const bare = git(symbiote.repo, 'config', '--get', 'remote.origin.url');
  git(symbiote.repo, 'remote', 'set-url', 'origin', GITHUB);
  git(symbiote.repo, 'config', `url.${bare}.insteadOf`, GITHUB);
  return bare;
}

test('by a pull request: opened at landing, waits for your merge with its link, landed once merged', async ({
  page,
}) => {
  test.setTimeout(90_000);
  forge = await fakeForge('github');
  symbiote = await serveWorkspaces({
    env: {
      GITHUB_API_URL: forge.url,
      GITHUB_TOKEN: 'ghp_fake',
      SYMBIOTE_HIVE_REQUEST_MS: '500',
    },
  });
  forge.remote = originOnGitHub();
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(
    config(),
    JSON.stringify({ merge: { checks: ['test -f one.txt'] }, hive: { lands: 'request' } }),
  );
  symbiote.reviewAnswers([
    { answer: { summary: 'one.txt says one.', ran: 'cat one.txt', findings: [] } },
  ]);
  await page.goto(`${symbiote.url}git`);
  await hive(page, true);
  await page.goto(`${symbiote.url}start`);
  await startPage(page).getByRole('textbox', { name: 'Title' }).fill('One');
  await startPage(page).getByRole('textbox', { name: 'Goal' }).fill('one.txt says one.');
  await startPage(page).getByRole('textbox', { name: 'Branch name', exact: true }).fill(BRANCH);
  await startPage(page).getByRole('button', { name: 'Start workspace' }).click();
  await expect(startPage(page)).toBeHidden();
  const main = git(symbiote.repo, 'rev-parse', 'main');

  symbiote.commit(BRANCH, 'one.txt', 'one\n', 'One');
  symbiote.report(BRANCH, 'Done: one.txt.');
  await expect.poll(() => forge?.requests.length, { timeout: 40_000 }).toBe(1);
  expect(forge.requests[0]).toMatchObject({
    head: BRANCH,
    base: 'main',
    title: 'One',
    draft: false,
  });
  expect(forge.requests[0]?.body).toContain('one.txt says one.');
  expect(forge.requests[0]?.body).toMatch(/Approved by Hive at [0-9a-f]{7}/);

  // The card: in Hive's group, waiting for the person's merge, the request a link.
  await expect(card(page)).toContainText('Waiting for your merge: #12 on GitHub', {
    timeout: 20_000,
  });
  const link = card(page).getByRole('link', { name: '#12 on GitHub' });
  await expect(link).toHaveAttribute('href', 'https://github.com/acme/app/pull/12');
  await expect(link).toHaveAttribute('target', '_blank');
  // Nothing landed locally: main neither moved nor pushed.
  expect(git(symbiote.repo, 'rev-parse', 'main')).toBe(main);
  expect(git(forge.remote, 'rev-parse', 'main')).toBe(main);

  // The Review tab: the request beside the landings.
  await card(page).getByRole('button', { name: 'One' }).click();
  const tabs = page.getByRole('tablist', { name: 'Talk to the agent' });
  await tabs.getByRole('tab', { name: 'Review' }).click();
  const landings = page.getByRole('region', { name: 'Landings' });
  const request = landings.getByLabel('Pull request #12 on GitHub');
  await expect(request).toContainText('Open: waiting for your merge');
  await expect(request.getByRole('link', { name: '#12 on GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/acme/app/pull/12',
  );
  await expect(page.locator('.hive-now')).toHaveText('Waiting for your merge: #12 on GitHub');

  // The person merges it on the forge: landed, main fast-forwarded to the forge's merge.
  const merge = forge.merge(12);
  await expect(card(page)).toContainText('Landed in main on GitHub · #12', { timeout: 20_000 });
  await expect(
    page.locator('.sidenav').getByRole('region', { name: 'Done' }).locator('.workspace-row'),
  ).toHaveCount(1);
  expect(git(symbiote.repo, 'rev-parse', 'main')).toBe(merge);
  await expect(request).toContainText('Merged');
  expect(forge.requests).toHaveLength(1);
});

test('Settings: Hive lands by, with the forge origin names and whether a token is found', async ({
  page,
}) => {
  symbiote = await serveWorkspaces({ env: { GITHUB_TOKEN: 'ghp_fake' } });
  await page.goto(`${symbiote.url}settings?prompt=hive-mode`);
  const part = page.getByRole('region', { name: 'Hive lands by' });
  const queue = part.getByRole('button', { name: 'The merge queue' });
  const request = part.getByRole('button', { name: 'A pull or merge request' });
  await expect(queue).toHaveAttribute('aria-pressed', 'true');
  await expect(part).toContainText('through the merge queue');
  // origin is a folder: no forge to open a request on.
  await expect(part).toContainText(
    'Hive cannot open a request now: origin is not a GitHub or GitLab repository',
  );
  await request.click();
  await expect(request).toHaveAttribute('aria-pressed', 'true');
  await expect(part).toContainText('your merge lands it');
  // The page's warning says it too.
  await expect(page.locator('.hive-warning')).toContainText(
    'opens a pull or merge request into the branch the workspace started from',
  );
  await expect(part.locator('.hive-lands-forge.cannot')).toBeVisible();
  expect(JSON.parse(readFileSync(config(), 'utf8'))).toMatchObject({ hive: { lands: 'request' } });

  originOnGitHub();
  await page.reload();
  await expect(request).toHaveAttribute('aria-pressed', 'true');
  await expect(part).toContainText('origin is acme/app on GitHub; a token is found.');
  await expect(part.locator('.hive-lands-forge.cannot')).toHaveCount(0);
  await queue.click();
  await expect(queue).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.hive-warning')).toContainText('through the merge queue');
  expect(JSON.parse(readFileSync(config(), 'utf8'))).not.toHaveProperty('hive');
});
