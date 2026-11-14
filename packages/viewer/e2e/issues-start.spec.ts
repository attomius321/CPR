import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fakeForge, type FakeForge } from '../../forge/test/fake-forge.js';
import { fakeClaude, serveCommits, type RunningCommits } from './symbiote.js';

// HV10b: Start in Hive on the Issues page. A real `symbiote view` whose origin is on the fake
// forge, its Claude Code the e2e fake: Classify, then Start in Hive; the workspace's branch and
// Hive's step on the card and the row, `#n` on its sidenav card and its page's head; the writer
// started with its own settings and --strict-mcp-config. Then Settings' rows for an issue's
// landing and its writer's network. Nothing leaves the machine.
let symbiote: RunningCommits | undefined;
let forge: FakeForge | undefined;
let fake: string | undefined;
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
  if (fake) rmSync(fake, { recursive: true, force: true });
  fake = undefined;
  expect(errors).toEqual([]);
});

const ABOUT = 'A small web app. Hive may take bug fixes with a reproduction, and docs.';

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
    doneWhen: '',
  },
  size: 'small',
  model: 'sonnet',
  effort: 'medium',
  flags: [],
};

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** `symbiote view` with origin on the fake GitHub, Hive on, the classifier taking issue #1. */
async function serve() {
  forge = await fakeForge('github');
  forge.issues.push({
    number: 1,
    title: 'The search ignores case',
    body: 'Foo misses foo.',
    state: 'open',
    author: 'ada',
    updated: new Date(Date.UTC(2026, 10, 14)).toISOString(),
  });
  fake = mkdtempSync(join(tmpdir(), 'symbiote-e2e-issue-start-'));
  writeFileSync(join(fake, 'classify-answers.json'), JSON.stringify([TAKE]));
  symbiote = await serveCommits({
    GITHUB_API_URL: forge.url,
    GITHUB_TOKEN: 'ghp_fake',
    GH_TOKEN: '',
    SYMBIOTE_CLAUDE: fakeClaude(fake),
  });
  const repo = symbiote.repo;
  git(repo, 'remote', 'set-url', 'origin', 'https://github.com/acme/app.git');
  git(repo, 'config', 'user.email', 'e2e@example.com');
  mkdirSync(join(repo, 'symbiote'), { recursive: true });
  writeFileSync(join(repo, 'symbiote', 'hive.json'), `${JSON.stringify({ on: true })}\n`);
  writeFileSync(
    join(repo, 'symbiote', 'config.json'),
    JSON.stringify({ hive: { issues: { about: ABOUT } } }),
  );
  return symbiote;
}

const card = (page: Page) => page.getByRole('region', { name: "Hive's decision on #1" });
const row = (page: Page) =>
  page
    .locator('.issues-row')
    .filter({ has: page.locator('.issues-row-number', { hasText: '#1' }) });

/** The fake's `claude --bg` starts, as it recorded them. */
const starts = () =>
  existsSync(join(fake!, 'calls.jsonl'))
    ? readFileSync(join(fake!, 'calls.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { args: string[] }).args)
        .filter((args) => args[0] === '--bg' && args[1] !== '--resume')
    : [];

test('Start in Hive: the workspace on the card, the row and the sidenav, its writer confined', async ({
  page,
}) => {
  const running = await serve();
  await page.goto(`${running.url}issues?number=1`);
  const hive = card(page);
  // Not classified yet: nothing to start.
  await expect(hive.getByRole('button', { name: 'Start in Hive' })).toHaveCount(0);
  await hive.getByRole('button', { name: 'Classify', exact: true }).click();
  await expect(hive.locator('.issues-hive-decision')).toHaveText('Taken', { timeout: 30_000 });

  // A take on the issue's current text: Start in Hive, the card's primary.
  const start = hive.getByRole('button', { name: 'Start in Hive' });
  await expect(start).toHaveClass(/^button$/);
  await start.click();
  const branch = 'fix/1-the-search-ignores-case';
  const opened = hive.locator('.issues-hive-workspace');
  await expect(opened).toContainText(`Its workspace${branch}`, { timeout: 20_000 });
  await expect(opened.locator('.issues-hive-step')).toHaveText('Writing');
  await expect(hive.getByRole('button', { name: 'Start in Hive' })).toHaveCount(0);

  // The row: the workspace's branch and Hive's step.
  await expect(row(page).locator('.issues-row-branch')).toHaveText(branch);
  await expect(row(page).locator('.issues-row-step')).toHaveText('Writing');

  // Its sidenav card says #1 before its name.
  const side = page.locator(`.sidenav .ws-row[data-branch="${branch}"]`);
  await expect(side.locator('.ws-row-issue')).toHaveText('#1');

  // The writer started with its own settings, in Symbiote's cache, and no MCP server of the person's.
  const [args] = starts();
  expect(args).toContain('--strict-mcp-config');
  // The classifier's model and effort for the work (decision 1011's request from the decision).
  expect(args?.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual([
    '--model',
    'sonnet',
  ]);
  expect(args?.slice(args.indexOf('--effort'), args.indexOf('--effort') + 2)).toEqual([
    '--effort',
    'medium',
  ]);
  const settings = args?.[(args?.indexOf('--settings') ?? 0) + 1] ?? '';
  expect(settings).toMatch(/[\\/]writers[\\/][0-9a-f]{16}[\\/]settings\.json$/);
  const written = JSON.parse(readFileSync(settings, 'utf8')) as {
    sandbox: { enabled: boolean; allowUnsandboxedCommands: boolean };
    permissions: { deny: string[] };
  };
  expect(written.sandbox).toMatchObject({ enabled: true, allowUnsandboxedCommands: false });
  expect(written.permissions.deny).toEqual(expect.arrayContaining(['WebFetch', 'WebSearch']));
  // Its prompt says where the brief came from, and to leave the issue alone.
  const prompt = args?.at(-1) ?? '';
  expect(prompt).toContain('From issue #1 (');
  expect(prompt).toContain('This brief came from issue #1');

  // Its page's head: #1, a link to the issue on the Issues page.
  await opened.getByRole('link', { name: branch }).click();
  await expect(page).toHaveURL(new RegExp(`branch=${encodeURIComponent(branch)}`));
  const issue = page.locator('.workspace-top .workspace-issue');
  await expect(issue).toHaveText('#1');
  await issue.click();
  await expect(page).toHaveURL(/\/issues\?number=1$/);
  await expect(card(page).locator('.issues-hive-workspace')).toContainText(branch);
});

test("Settings: an issue's landing, a request by default, and its writer's network", async ({
  page,
}) => {
  const running = await serve();
  await page.goto(`${running.url}settings?prompt=hive-mode`);
  const lands = page.getByRole('group', { name: 'Work from an issue', exact: true });
  await expect(lands.getByRole('button', { name: 'Pull request' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(lands).toContainText('Its description starts with Closes #n.');
  await lands.getByRole('button', { name: 'Merge queue' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Saved. Work from an issue lands through the merge queue.',
  );
  const config = () =>
    JSON.parse(readFileSync(join(running.repo, 'symbiote', 'config.json'), 'utf8')) as {
      hive: { issues: { lands?: string }; sandbox?: { allowedDomains: string[] } };
    };
  expect(config().hive.issues.lands).toBe('queue');

  const network = page.getByRole('group', { name: "The writer's network" });
  await expect(network.getByRole('list', { name: 'Hosts in force' })).toContainText('In force:');
  await network.getByRole('textbox').fill('npm.corp.example\n*.mirror.example');
  await network.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toContainText("Saved. An issue's writer reaches");
  expect(config().hive.sandbox?.allowedDomains).toEqual(['npm.corp.example', '*.mirror.example']);
  await expect(network.getByRole('list', { name: 'Hosts in force' })).toContainText(
    'npm.corp.example',
  );
});
