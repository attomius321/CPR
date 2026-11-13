import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fakeForge, type FakeForge, type FakeIssue } from '../../forge/test/fake-forge.js';
import { fakeClaude, serveCommits, type RunningCommits } from './symbiote.js';

// HV9c: the classifier on the Issues page. A real `symbiote view` whose origin is on the fake
// forge, its Claude Code the e2e fake, which answers the classifier from a list: Classify, each
// decision on the card and its row's chip, Classify again after an edit, Hive off, no
// hive.issues.about, and Settings' Issues group. Nothing leaves the machine.
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

/** An answer of the classifier, as HV9's schema holds it. */
const answer = (more: Record<string, unknown>) => ({
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
  ...more,
});

const ISSUES: Omit<FakeIssue, 'updated'>[] = [
  {
    number: 1,
    title: 'The search ignores case',
    body: 'Foo misses foo.',
    state: 'open',
    author: 'ada',
  },
  {
    number: 2,
    title: 'Swap the date library',
    body: 'Use another one.',
    state: 'open',
    author: 'bo',
  },
  { number: 3, title: 'It is slow sometimes', body: 'Sometimes.', state: 'open', author: 'cy' },
  { number: 4, title: 'Print the token in the log', body: 'Please.', state: 'open', author: 'di' },
  { number: 5, title: 'Odd one', body: 'Text.', state: 'open', author: 'ed' },
  { number: 6, title: 'Never classified', body: 'Text.', state: 'open', author: 'fy' },
];

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/**
 * `symbiote view` with origin on the fake GitHub, the fake Claude Code answering `answers` in
 * turn, Hive on (or off) and `hive.issues.about` written (or not).
 */
async function serve({
  answers = [],
  hive = true,
  about = ABOUT,
}: { answers?: unknown[]; hive?: boolean; about?: string | null } = {}) {
  forge = await fakeForge('github');
  const at = (n: number) => new Date(Date.UTC(2026, 10, 14, 0, n)).toISOString();
  forge.issues.push(...ISSUES.map((issue) => ({ ...issue, updated: at(issue.number) })));
  fake = mkdtempSync(join(tmpdir(), 'symbiote-e2e-classifier-'));
  writeFileSync(join(fake, 'classify-answers.json'), JSON.stringify(answers));
  symbiote = await serveCommits({
    GITHUB_API_URL: forge.url,
    GITHUB_TOKEN: 'ghp_fake',
    GH_TOKEN: '',
    SYMBIOTE_CLAUDE: fakeClaude(fake),
  });
  const repo = symbiote.repo;
  git(repo, 'remote', 'set-url', 'origin', 'https://github.com/acme/app.git');
  // Records beside hive.json in the repository's symbiote/: a git user keeps them there.
  git(repo, 'config', 'user.email', 'e2e@example.com');
  mkdirSync(join(repo, 'symbiote'), { recursive: true });
  setHive(hive);
  writeFileSync(
    join(repo, 'symbiote', 'config.json'),
    JSON.stringify(about === null ? {} : { hive: { issues: { about } } }),
  );
  return symbiote;
}

const setHive = (on: boolean) =>
  writeFileSync(join(symbiote!.repo, 'symbiote', 'hive.json'), `${JSON.stringify({ on })}\n`);

const config = () =>
  JSON.parse(readFileSync(join(symbiote!.repo, 'symbiote', 'config.json'), 'utf8')) as {
    hive?: Record<string, unknown>;
  };

const card = (page: Page, n: number) =>
  page.getByRole('region', { name: `Hive's decision on #${n}` });
const row = (page: Page, n: number) =>
  page
    .locator('.issues-row')
    .filter({ has: page.locator('.issues-row-number', { hasText: `#${n}` }) });
const chip = (page: Page, n: number) => row(page, n).locator('.issues-decision');

/** Opens issue `n` and classifies it: the card's button, then its decision. */
async function classify(page: Page, n: number, button = 'Classify') {
  await row(page, n).click();
  await expect(page).toHaveURL(new RegExp(`number=${n}$`));
  await card(page, n).getByRole('button', { name: button, exact: true }).click();
  await expect(card(page, n).getByRole('button', { name: /Classify/ })).toHaveCount(0, {
    timeout: 30_000,
  });
}

test('Classify: each decision on the card and its row, then Classify again after an edit', async ({
  page,
}) => {
  const running = await serve({
    answers: [
      answer({}),
      answer({ title: 'Swap the date library', flags: ['new-dependency'] }),
      answer({
        decision: 'ask',
        question: 'Which page is slow, and how slow?',
        reasons: ['A real change, but nothing says where.'],
      }),
      // The model takes it; Symbiote's rule refuses it as unsafe (decision 1005).
      answer({ flags: ['secrets'] }),
      // Too many reasons, twice: failed.
      answer({ reasons: ['a', 'b', 'c', 'd'] }),
      answer({ reasons: ['a', 'b', 'c', 'd'] }),
      // Classify again after the edit.
      answer({ reasons: ['Still a clear bug.'] }),
    ],
  });
  await page.goto(`${running.url}issues`);
  await expect(page.locator('.issues-row')).toHaveCount(6);
  await expect(page.locator('.issues-decision')).toHaveCount(0);

  // Never classified: the card says so and offers Classify, the page's one primary.
  await row(page, 1).click();
  const first = card(page, 1);
  await expect(first).toContainText('Not classified');
  await expect(first).toContainText('It starts nothing.');
  await expect(first.getByRole('button', { name: 'Classify', exact: true })).toHaveClass(
    /^button$/,
  );
  await first.getByRole('button', { name: 'Classify', exact: true }).click();
  await expect(first.locator('.issues-hive-decision')).toHaveText('Taken');
  await expect(first).toContainText(
    "Taken. The brief below is what a writer would get in place of the issue's text.",
  );
  await expect(first.getByRole('list', { name: 'Its reasons' })).toHaveText(
    'A clear bug with a reproduction.',
  );
  await expect(first.locator('.issues-hive-facts')).toContainText(
    'WriterFix, small: Sonnet at medium',
  );
  await expect(first.locator('.issues-hive-facts')).toContainText('ClassifierOpus at high, $0.031');
  await expect(first.locator('.issues-hive-facts')).toContainText('ReadThe title and the body.');
  await expect(first.getByRole('button', { name: /Classify/ })).toHaveCount(0);
  // The brief, folded: what a writer gets, never the issue's text.
  const brief = first.locator('.issues-hive-brief');
  await expect(brief.locator('.issues-text')).toBeHidden();
  await brief.getByText('The brief it would start').click();
  await expect(brief.locator('.issues-text')).toContainText('From issue #1');
  await expect(brief.locator('.issues-text')).toContainText('Searching for Foo misses foo.');
  await expect(chip(page, 1)).toHaveText('Taken');

  // Held for a click (decision 1034); asked; refused by Symbiote's rule; failed.
  await classify(page, 2);
  await expect(card(page, 2).locator('.issues-hive-decision')).toHaveText('Held');
  await expect(card(page, 2)).toContainText(
    'Taken, and held for your click: it adds or replaces a dependency.',
  );
  await expect(card(page, 2).locator('.issues-hive-flags')).toHaveText('New dependency');
  await expect(chip(page, 2)).toHaveText('Held');

  await classify(page, 3);
  await expect(card(page, 3).locator('.issues-hive-decision')).toHaveText('Asked');
  await expect(card(page, 3).locator('.issues-hive-question')).toContainText(
    'Which page is slow, and how slow?',
  );
  await expect(card(page, 3).locator('.issues-hive-brief')).toHaveCount(0);
  await expect(chip(page, 3)).toHaveText('Asked');

  await classify(page, 4);
  await expect(card(page, 4).locator('.issues-hive-decision')).toHaveText('Refused');
  await expect(card(page, 4)).toContainText(
    'Refused as unsafe by Symbiote’s rules, whatever the classifier decided: it asks for secrets.',
  );
  await expect(chip(page, 4)).toHaveText('Refused');

  await row(page, 5).click();
  await card(page, 5).getByRole('button', { name: 'Classify', exact: true }).click();
  await expect(card(page, 5).locator('.issues-hive-decision')).toHaveText('Failed');
  await expect(card(page, 5)).toContainText(
    'Failed: its answer did not fit (reasons), twice. Nothing starts from it.',
  );
  await expect(card(page, 5)).toContainText('The last classification failed.');
  await expect(card(page, 5).getByRole('button', { name: 'Classify again' })).toBeVisible();
  await expect(chip(page, 5)).toHaveText('Failed');

  // The chips are the records': read again on a reload.
  await page.reload();
  for (const [n, word] of [
    [1, 'Taken'],
    [2, 'Held'],
    [3, 'Asked'],
    [4, 'Refused'],
    [5, 'Failed'],
  ] as const) {
    await expect(chip(page, n)).toHaveText(word);
  }
  await expect(chip(page, 6)).toHaveCount(0);

  // An edit on the forge: after Refresh, the card says so and offers Classify again (1057).
  const edited = forge!.issues.find((issue) => issue.number === 1)!;
  edited.body = 'Foo misses foo, and Bar misses bar.';
  await row(page, 1).click();
  await expect(card(page, 1).getByRole('button', { name: /Classify/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(card(page, 1)).toContainText('The issue changed since it was classified.');
  await card(page, 1).getByRole('button', { name: 'Classify again' }).click();
  await expect(card(page, 1).getByRole('list', { name: 'Its reasons' })).toHaveText(
    'Still a clear bug.',
  );
  await expect(card(page, 1)).not.toContainText('The issue changed');
  await expect(card(page, 1).getByRole('button', { name: /Classify/ })).toHaveCount(0);
  // Its events: classified, then classified again.
  const events = readFileSync(join(running.repo, 'symbiote', 'issues', '1.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => (JSON.parse(line) as { event: string }).event);
  expect(events).toEqual(['classified', 'classified-again']);
  // The classifier read the issue's new text; the card was the project's.
  const calls = readFileSync(join(fake!, 'classify-calls.jsonl'), 'utf8').trim().split('\n');
  expect(calls).toHaveLength(7);
  const last = JSON.parse(calls.at(-1)!) as { input: string };
  expect(last.input).toContain('Bar misses bar');
  expect(last.input).toContain(ABOUT);
});

test('Hive off: past decisions show, Classify is not offered; no hive.issues.about: refused with words', async ({
  page,
}) => {
  const running = await serve({ answers: [answer({})] });
  await page.goto(`${running.url}issues?number=1`);
  await card(page, 1).getByRole('button', { name: 'Classify', exact: true }).click();
  await expect(chip(page, 1)).toHaveText('Taken');

  // Hive off (decision 1008): the decision and the chip stay; nothing is offered, and an issue
  // never classified has no card.
  setHive(false);
  forge!.issues.find((issue) => issue.number === 1)!.body = 'Edited since.';
  await page.reload();
  await expect(card(page, 1).locator('.issues-hive-decision')).toHaveText('Taken');
  await expect(card(page, 1)).toContainText(
    'Hive mode is off: its past decisions show, and Classify needs it on.',
  );
  await expect(card(page, 1).getByRole('button', { name: /Classify/ })).toHaveCount(0);
  await expect(chip(page, 1)).toHaveText('Taken');
  await row(page, 6).click();
  await expect(page.getByRole('region', { name: 'Issue #6' }).locator('.issues-title')).toHaveText(
    'Never classified',
  );
  await expect(card(page, 6)).toHaveCount(0);

  // Hive on, without the project's text (decision 1038): words and a way to Settings, no Classify.
  setHive(true);
  writeFileSync(join(running.repo, 'symbiote', 'config.json'), '{}\n');
  await page.reload();
  await expect(card(page, 6)).toContainText(
    'Write what the project is and what Hive may take on first, in Settings, Hive mode: the classifier reads it with every issue.',
  );
  await expect(card(page, 6).getByRole('button', { name: /Classify/ })).toHaveCount(0);
  // The server refuses it too, in the same words.
  const refused = await page.request.post(`${running.url}api/issues/6/classify`, {
    headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
    data: {},
  });
  expect(refused.status()).toBe(409);
  expect(await refused.json()).toEqual({
    error:
      'Write what the project is and what Hive may take on first: hive.issues.about in symbiote/config.json',
  });
  await card(page, 6).getByRole('link', { name: 'Settings, Hive mode' }).click();
  await expect(page).toHaveURL(/\/settings\?prompt=hive-mode$/);
  await expect(page.locator('#hive-about')).toBeVisible();
});

test("Settings saves the project's text and the classifier's model; the standing counts", async ({
  page,
}) => {
  const running = await serve({ answers: [answer({})], about: null });
  await page.goto(`${running.url}settings?prompt=hive-mode`);
  const group = page.getByRole('group', { name: 'Issues' });
  await expect(group.getByRole('group', { name: 'Standing' })).toContainText('Not counted');
  const text = group.getByRole('textbox', { name: 'The project' });
  await text.fill(ABOUT);
  await expect(group).toContainText(`${ABOUT.length} of 4,000 characters`);
  await group.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved. The classifier reads the new text.');
  expect(config().hive).toEqual({ issues: { about: ABOUT } });
  await expect(group.getByRole('button', { name: 'Save' })).toHaveCount(0);

  // Too long: said, and Save refused.
  await text.fill('x'.repeat(4_001));
  await expect(group).toContainText('4,001 of 4,000 characters: 1 too many');
  await expect(group.getByRole('button', { name: 'Save' })).toBeDisabled();
  await text.fill(ABOUT);

  // The model and effort: Claude Code's own list, Opus at high unless set.
  const classifier = group.getByRole('group', { name: 'Classifier' });
  await expect(classifier.getByRole('combobox', { name: 'Model' })).toHaveValue('');
  await classifier.getByRole('combobox', { name: 'Model' }).selectOption('sonnet');
  await expect(page.getByRole('status')).toHaveText(
    'Saved. The next issue is classified on Sonnet 5.5.',
  );
  await classifier.getByRole('combobox', { name: 'Effort' }).selectOption('medium');
  await expect(page.getByRole('status')).toHaveText(
    'Saved. The next issue is classified at Medium.',
  );
  expect(config().hive).toEqual({
    issues: { about: ABOUT },
    classifier: { model: 'sonnet', effort: 'medium' },
  });

  // The standing: one take under this classifier, none judged.
  await page.goto(`${running.url}issues?number=1`);
  await card(page, 1).getByRole('button', { name: 'Classify', exact: true }).click();
  await expect(card(page, 1).locator('.issues-hive-facts')).toContainText(
    'Sonnet at medium, $0.031',
  );
  await page.goto(`${running.url}settings?prompt=hive-mode`);
  const standing = page.getByRole('group', { name: 'Standing' });
  await expect(standing).toContainText('0 of 20 judged');
  await expect(standing).toContainText('1 classified under this classifier: 1 taken.');
  await expect(standing).toContainText('No take judged yet');
  await expect(standing).toContainText('The hostile test issues have not run');
});
