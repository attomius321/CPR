import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fakeForge, type FakeForge, type FakeForgeKind } from '../../forge/test/fake-forge.js';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// HV11: the issue answered on the forge. A real `symbiote view` whose `origin` names GitHub or
// GitLab (git reaches a bare repository in its place, by `insteadOf`), whose API is the fake
// forge, Hive on: Classify and Start in Hive on the Issues page, the writer's turn, the check, the
// running reviewer, the landing — and on the fake forge each step's comment and label, and the
// closing: through the merge queue (Symbiote closes it), through a merge request (its
// `Closes #1` does). Then Settings' rows. Nothing leaves the machine.
let symbiote: RunningWorkspaces | undefined;
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

const ABOUT = 'A small web app. Hive may take bug fixes with a reproduction, and docs.';
const BRANCH = 'fix/1-the-search-ignores-case';
/** A request read, a retry and a request's closing every half second, not every minute (HV8, HV11). */
const POLL = { SYMBIOTE_HIVE_REQUEST_MS: '500' };

/** A take of the classifier, as HV9's schema holds it. */
const TAKE = {
  decision: 'take',
  reasons: ['A clear bug with a reproduction.'],
  refusal: 'none',
  question: '',
  kind: 'fix',
  title: 'Make the search ignore case',
  parts: {
    goal: '',
    happens: 'Searching for Foo misses foo.',
    reproduce: '',
    restructure: '',
    change: '',
    question: '',
    known: '',
    where: '',
    outOfScope: '',
    notes: '',
    doneWhen: 'one.txt says one.',
  },
  size: 'small',
  model: 'sonnet',
  effort: 'medium',
  flags: [],
};

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const hiveOn = (page: Page) =>
  page.evaluate(async () => {
    const response = await fetch('/api/hive', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
      body: JSON.stringify({ on: true }),
    });
    if (!response.ok) throw new Error(await response.text());
  });

/**
 * `symbiote view` with `origin` on the fake forge of `kind`, issue #1 open there, the check and
 * the project's text set, the classifier taking it.
 */
async function serve(kind: FakeForgeKind, hive: Record<string, unknown> = {}) {
  forge = await fakeForge(kind);
  forge.issues.push({
    number: 1,
    title: 'The search ignores case',
    body: 'Foo misses foo.',
    state: 'open',
    author: 'grace',
    updated: new Date(Date.UTC(2026, 10, 14)).toISOString(),
  });
  const running = await serveWorkspaces({
    env:
      kind === 'github'
        ? { GITHUB_API_URL: forge.url, GITHUB_TOKEN: 'ghp_fake', GH_TOKEN: '', ...POLL }
        : { GITLAB_API_URL: forge.url, GITLAB_TOKEN: 'glpat-fake', ...POLL },
  });
  symbiote = running;
  const address = `https://${kind}.com/acme/app.git`;
  const bare = git(running.repo, 'config', '--get', 'remote.origin.url');
  git(running.repo, 'remote', 'set-url', 'origin', address);
  git(running.repo, 'config', `url.${bare}.insteadOf`, address);
  forge.remote = bare;
  mkdirSync(join(running.repo, 'symbiote'), { recursive: true });
  writeFileSync(
    join(running.repo, 'symbiote', 'config.json'),
    JSON.stringify({
      merge: { checks: ['test -f one.txt'] },
      hive: { issues: { about: ABOUT, ...hive } },
    }),
  );
  running.classifyAnswers([TAKE]);
  running.reviewAnswers([
    { answer: { summary: 'one.txt says one.', ran: 'cat one.txt', findings: [] } },
  ]);
  return running;
}

/** Classify on the Issues page, then Start in Hive. */
async function startFromIssue(page: Page, running: RunningWorkspaces) {
  await page.goto(`${running.url}git`);
  await hiveOn(page);
  await page.goto(`${running.url}issues?number=1`);
  const card = page.getByRole('region', { name: "Hive's decision on #1" });
  await card.getByRole('button', { name: 'Classify', exact: true }).click();
  await expect(card.locator('.issues-hive-decision')).toHaveText('Taken', { timeout: 30_000 });
  await card.getByRole('button', { name: 'Start in Hive' }).click();
  await expect(card.locator('.issues-hive-workspace')).toContainText(BRANCH, { timeout: 20_000 });
}

const issue = () => forge!.issues[0]!;
const comments = () => (issue().comments ?? []).map((c) => c.body);
const labels = () => (issue().labels ?? []).map((l) => l.name);
/** The issue's events in Symbiote's record. */
const events = (running: RunningWorkspaces) => {
  const file = join(running.repo, 'symbiote', 'issues', '1.jsonl');
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { event: string; key?: string; by?: string })
    : [];
};

test('through the merge queue on GitHub: taken, then landed and closed by Symbiote', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const running = await serve('github', { lands: 'queue' });
  await startFromIssue(page, running);

  // Taken: its comment and the working label, made once in the project.
  await expect
    .poll(comments, { timeout: 20_000 })
    .toEqual([`Symbiote's Hive is working on this in \`${BRANCH}\`.`]);
  await expect.poll(labels).toEqual(['symbiote: working']);
  expect(forge!.labels.map((l) => l.name)).toEqual(['symbiote: working']);
  expect(issue().comments?.[0]?.author).toBe('ada');

  // The writer's turn; Hive checks, reviews and lands it through the queue into main.
  running.commit(BRANCH, 'one.txt', 'one\n', 'One');
  running.report(BRANCH, 'Done: one.txt.');
  await expect.poll(() => issue().state, { timeout: 60_000 }).toBe('closed');
  const main = git(running.repo, 'rev-parse', 'main');
  expect(git(running.repo, 'log', '-1', '--format=%B', 'main')).toContain('Closes #1');
  const tip = git(running.repo, 'rev-parse', `${BRANCH}`);
  expect(comments()).toEqual([
    `Symbiote's Hive is working on this in \`${BRANCH}\`.`,
    `Landed in \`main\` at ${tip.slice(0, 7)}.`,
  ]);
  expect(main).not.toBe(tip);
  expect(issue()).toMatchObject({ closedBy: 'api', stateReason: 'completed', labels: [] });
  expect(events(running).map((e) => e.event)).toEqual([
    'classified',
    'started',
    'due',
    'answered',
    'labelled',
    'judged',
    'due',
    'answered',
    'labelled',
    'closed',
  ]);
  expect(events(running).at(-1)).toMatchObject({ key: `landed:${BRANCH}`, by: 'symbiote' });
});

test('through a merge request on GitLab: taken, the request’s link, closed by its Closes #1', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const running = await serve('gitlab');
  await startFromIssue(page, running);
  await expect
    .poll(comments, { timeout: 20_000 })
    .toEqual([`Symbiote's Hive is working on this in \`${BRANCH}\`.`]);

  running.commit(BRANCH, 'one.txt', 'one\n', 'One');
  running.report(BRANCH, 'Done: one.txt.');
  await expect.poll(() => forge!.requests.length, { timeout: 60_000 }).toBe(1);
  expect(forge!.requests[0]?.body).toMatch(/^Closes #1\./);
  await expect
    .poll(comments, { timeout: 20_000 })
    .toEqual([
      `Symbiote's Hive is working on this in \`${BRANCH}\`.`,
      'A merge request is open: https://gitlab.com/acme/app/-/merge_requests/12.',
    ]);
  expect(labels()).toEqual(['symbiote: working']);

  // The person merges it on the forge: its Closes #1 closes the issue, and Symbiote records so.
  forge!.merge(12);
  expect(issue()).toMatchObject({ state: 'closed', closedBy: 'keyword' });
  await expect
    .poll(() => events(running).at(-1), { timeout: 60_000 })
    .toMatchObject({ event: 'closed', key: `landed:${BRANCH}`, by: 'forge' });
  // No comment for the landing, the label removed, closed once.
  expect(comments()).toHaveLength(2);
  expect(labels()).toEqual([]);
  expect(
    forge!.calls.filter((c) => c.method === 'PUT' && /state_event/.test(JSON.stringify(c.body))),
  ).toEqual([]);
});

test('Settings: answers on or off, the account they appear under, the labels', async ({ page }) => {
  const running = await serve('github', { labels: { working: 'hive: on it' } });
  await page.goto(`${running.url}settings?prompt=hive-mode`);
  const answers = page.getByRole('group', { name: 'Answers on the issue', exact: true });
  await expect(answers.getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
  const account = page.getByRole('group', { name: 'Posted as', exact: true });
  await expect(account).toContainText('Comments, labels and closing appear under ada on GitHub');
  await expect(account).toContainText('May write');
  const named = page.getByRole('group', { name: 'Labels', exact: true });
  await expect(named).toContainText('hive: on it');
  await expect(named).toContainText('symbiote: stopped');

  await answers.getByRole('button', { name: 'Off' }).click();
  await expect(page.getByRole('status')).toContainText('Saved. Nothing is written to issues.');
  await expect(answers).toContainText('Requests still say Closes #n.');
  const config = JSON.parse(
    readFileSync(join(running.repo, 'symbiote', 'config.json'), 'utf8'),
  ) as {
    hive: { issues: { answer?: boolean } };
  };
  expect(config.hive.issues.answer).toBe(false);
});
