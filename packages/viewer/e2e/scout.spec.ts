import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { dragTo, stops } from './stepper.js';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';
import { textAt } from './terminal.js';

// Scout (V35): an agent in the checkout, its terminal on its page since V50 — a fake Claude Code,
// never a real one.
let symbiote: RunningWorkspaces;
const errors: string[] = [];

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  symbiote.stop();
  expect(errors).toEqual([]);
});

/** Lists are read every 5 s while an agent works (V18b). */
const POLL = { timeout: 15_000 };
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: symbiote.repo, encoding: 'utf8' }).trim();
const scoutPage = (page: Page) => page.getByRole('region', { name: 'Scout' });
const screen = (page: Page) => scoutPage(page).locator('.agent-terminal .xterm-rows');
const keys = (page: Page) => scoutPage(page).locator('.xterm-helper-textarea');
const model = (page: Page) => scoutPage(page).getByRole('combobox', { name: 'Model' });
const effort = (page: Page) => scoutPage(page).getByRole('slider', { name: 'Effort' });
const renew = (page: Page) => scoutPage(page).getByRole('button', { name: 'New conversation' });
const scoutLink = (page: Page) =>
  page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: /Scout/ });
const historyLink = (page: Page) =>
  page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: /History/ });
const record = () => join(symbiote.repo, 'symbiote', 'scout.json');
const config = () => join(symbiote.repo, 'symbiote', 'config.json');
/** The fake's starts and copies in the checkout, as Claude Code was asked for them. */
const scoutCalls = () => symbiote.calls().filter((call) => call.args.includes('Scout'));
const flag = (args: readonly string[] = [], name: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined;

test("opens as Scout's terminal, from the sidenav and by its key: started in the checkout with no question", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  // The person's own session in the checkout, started before (V35: never taken for Scout's).
  symbiote.addSession({ cwd: symbiote.repo, kind: 'interactive', name: 'mine', status: 'idle' });
  await page.goto(`${symbiote.url}history`);
  await expect(scoutLink(page)).toHaveAttribute('data-tip-keys', 'a');
  // Nothing is started before Scout is opened.
  expect(scoutCalls()).toEqual([]);
  await scoutLink(page).click();
  await expect(page).toHaveURL(`${symbiote.url}scout`);
  await expect(scoutPage(page).getByRole('heading', { name: 'Scout' })).toBeVisible();
  await expect(scoutLink(page)).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle(/^Scout · /);

  // Its terminal, with no question asked first: no box, no form.
  await expect(screen(page)).toContainText('Fake Claude Code · fake1', POLL);
  await expect(scoutPage(page).getByRole('textbox', { name: 'Ask Scout' })).toHaveCount(0);
  await expect(keys(page)).toBeFocused();
  await expect(scoutPage(page).getByRole('status')).toHaveText('Ready: ask in its terminal');
  expect(scoutCalls()).toHaveLength(1);
  const [call] = scoutCalls();
  expect(call?.cwd).toBe(symbiote.repo);
  const args = call?.args ?? [];
  // Read-only, Symbiote's MCP server and no other (MC1), then the gate's settings.
  expect(args.slice(0, 12)).toEqual([
    '--bg',
    '--name',
    'Scout',
    '--tools',
    'Read,Grep,Glob,Bash',
    '--permission-mode',
    'dontAsk',
    '--strict-mcp-config',
    '--mcp-config',
    join(symbiote.repo, 'symbiote', 'scout-mcp.json'),
    '--settings',
    join(symbiote.repo, 'symbiote', 'scout-settings.json'),
  ]);
  // Its instructions are its system prompt, and nothing follows: no prompt (decision 383).
  expect(args.at(-2)).toBe('--append-system-prompt');
  expect(args.at(-1)).toContain('You are Scout');
  expect(JSON.parse(readFileSync(record(), 'utf8'))).toMatchObject({
    agent: 'claude',
    id: 'fake1',
  });

  // The first question is typed there; its answer comes there.
  await page.keyboard.type("Where is the merger's prompt defined?");
  await page.keyboard.press('Enter');
  await expect(screen(page)).toContainText("got: Where is the merger's prompt defined?");
  symbiote.setSession('fake1', {
    state: 'done',
    status: 'idle',
    answer: 'It is in packages/cli/src/prompts.ts (MERGER).',
  });
  await expect(screen(page)).toContainText('packages/cli/src/prompts.ts', POLL);
  // An image pasted there is attached too (V36), and kept out of the checkout.
  await keys(page).evaluate((element, data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
    );
  }, 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
  await expect(screen(page)).toContainText('[Image #1]');
  expect(symbiote.images().map((image) => image.id)).toEqual(['fake1']);

  // `a` from another page opens it again: the same conversation, its terminal focused.
  await historyLink(page).click();
  await expect(page).toHaveURL(`${symbiote.url}history`);
  await page.keyboard.press('a');
  await expect(page).toHaveURL(`${symbiote.url}scout`);
  await expect(screen(page)).toContainText('Fake Claude Code · fake1', POLL);
  await expect(keys(page)).toBeFocused();
  expect(scoutCalls()).toHaveLength(1);
  expect(symbiote.attaches()).toEqual(['fake1', 'fake1']);
  // Read-only: the checkout is as it was.
  expect(git('status', '--porcelain')).toBe('');
});

test("a session of the person's in the checkout is not taken for Scout's", async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}scout`);
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  symbiote.setSession('fake0', { state: 'done', status: 'idle' });
  // The person starts a session of their own there: newer, working, even named Scout.
  symbiote.addSession({
    cwd: symbiote.repo,
    kind: 'background',
    id: 'mine0',
    sessionId: 'session-mine',
    name: 'Scout',
    state: 'working',
    status: 'busy',
  });
  await page.reload();
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  expect(symbiote.attaches()).toEqual(['fake0', 'fake0']);
  await expect(scoutPage(page).getByRole('status')).toHaveText(
    'Answered: ask more in its terminal',
    POLL,
  );
  const kept = JSON.parse(readFileSync(record(), 'utf8')) as { id: string };
  expect(kept.id).toBe('fake0');
  expect(scoutCalls()).toHaveLength(1);
});

test('the sidenav says Scout works, then that it answered while you were away', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}scout`);
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  // Ready is not an answer: no mark.
  await expect(scoutLink(page)).not.toHaveAttribute('data-state', /.+/);
  await page.keyboard.type('Why does a reply stop the session first?');
  await page.keyboard.press('Enter');
  symbiote.setSession('fake0', { state: 'working', status: 'busy' });
  await historyLink(page).click();
  await expect(scoutLink(page)).toHaveAttribute('data-state', 'working', POLL);
  symbiote.setSession('fake0', { state: 'done', status: 'idle', answer: 'Because…' });
  await expect(scoutLink(page)).toHaveAttribute('data-state', 'answered', POLL);
  await expect(scoutLink(page)).toHaveAttribute('data-tip', /Answered/);
  await scoutLink(page).click();
  await expect(scoutLink(page)).not.toHaveAttribute('data-state', /.+/);
});

test("a path Scout prints opens in VS Code, in the checkout's window (V38)", async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}scout`);
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  symbiote.setSession('fake0', { state: 'done', status: 'idle', answer: 'In src/math.ts:1.' });
  await expect(screen(page)).toContainText('In src/math.ts:1.', POLL);
  const at = await textAt(screen(page), 'src/math.ts:1');
  await page.mouse.move(at.x, at.y);
  await expect(scoutPage(page).getByRole('tooltip')).toHaveText(/^Open in VS Code/);
  await page.keyboard.down('ControlOrMeta');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up('ControlOrMeta');
  await expect
    .poll(() => symbiote.opened())
    .toEqual([[symbiote.repo, '--goto', `${join(symbiote.repo, 'src', 'math.ts')}:1:1`]]);
});

test('a model and an effort picked in its head start nothing: New conversation starts the next on them', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}scout`);
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  // The conversation's: Claude Code's own, from its own list (V47).
  await expect(model(page)).toHaveValue('');
  await expect(model(page).locator('option')).toHaveText([
    "Claude Code's default",
    'Opus 5.5',
    'Sonnet 5.5',
    'Haiku 4.5',
    'Opus 4.6',
  ]);
  await expect(effort(page)).toHaveAttribute('aria-valuetext', "Claude Code's default");
  await expect(stops(effort(page))).toHaveText([
    'Default',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ]);
  await expect(renew(page)).toHaveClass(/secondary/);

  // A model, then three levels by keys (each a copy of the session before V52): nothing runs.
  await model(page).selectOption('sonnet');
  for (let i = 0; i < 3; i += 1) await effort(page).press('ArrowRight');
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'high');
  await expect(model(page)).toHaveValue('sonnet');
  // New conversation is the one to start them, and says so.
  await expect(renew(page)).not.toHaveClass(/secondary/);
  await expect(renew(page)).toHaveAttribute('data-tip', /starts another on Sonnet 5\.5 at high/);
  expect(scoutCalls()).toHaveLength(1);
  expect(symbiote.stops()).toEqual([]);
  expect(symbiote.removed()).toEqual([]);
  expect(symbiote.attaches()).toEqual(['fake0']);
  await expect(screen(page)).toContainText('Fake Claude Code · fake0');
  expect(JSON.parse(readFileSync(record(), 'utf8'))).not.toHaveProperty('model');

  // While Scout answers they stay free: they touch nothing that runs.
  symbiote.setSession('fake0', { state: 'working', status: 'busy' });
  await expect(scoutPage(page).getByRole('status')).toHaveText('Answering', POLL);
  await expect(model(page)).toBeEnabled();
  await expect(effort(page)).toBeEnabled();
  symbiote.setSession('fake0', { state: 'done', status: 'idle' });
  await expect(scoutPage(page).getByRole('status')).toHaveText(
    'Answered: ask more in its terminal',
    POLL,
  );

  await renew(page).click();
  await expect.poll(() => scoutCalls().length, POLL).toBe(2);
  const next = scoutCalls()[1]?.args ?? [];
  // A new session, not a copy of the old one: what was said there stays there.
  expect(next.slice(0, 3)).toEqual(['--bg', '--name', 'Scout']);
  expect(flag(next, '--model')).toBe('sonnet');
  expect(flag(next, '--effort')).toBe('high');
  expect(symbiote.stops()).toEqual(['fake0']);
  expect(symbiote.removed()).toEqual(['fake0']);
  await expect.poll(() => symbiote.attaches(), POLL).toEqual(['fake0', 'fake0']);
  await expect(scoutPage(page).getByRole('status')).toHaveText('Ready: ask in its terminal', POLL);
  await expect(model(page)).toHaveValue('sonnet');
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'high');
  await expect(renew(page)).toHaveClass(/secondary/);
  await expect(keys(page)).toBeFocused();
  expect(JSON.parse(readFileSync(record(), 'utf8'))).toMatchObject({
    model: 'sonnet',
    effort: 'high',
  });
  // The project's settings are as they were: these are the head's.
  expect(existsSync(config())).toBe(false);
});

test('New conversation: the old session stopped and removed, the next opened at once on what the head shows', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(config(), '{ "scout": { "effort": "medium" } }\n');
  await page.goto(`${symbiote.url}scout`);
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  // Opened on the project's level.
  expect(flag(scoutCalls()[0]?.args, '--effort')).toBe('medium');
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'medium');
  // A level picked, by a drag, starts nothing (decision 391); New conversation starts on it.
  await dragTo(page, effort(page), 3);
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'high');
  await expect(renew(page)).not.toHaveClass(/secondary/);
  expect(scoutCalls()).toHaveLength(1);

  await renew(page).click();
  await expect.poll(() => scoutCalls().length, POLL).toBe(2);
  expect(flag(scoutCalls()[1]?.args, '--effort')).toBe('high');
  expect(symbiote.stops()).toEqual(['fake0']);
  expect(symbiote.removed()).toEqual(['fake0']);
  // The fake numbers sessions by its list's length: fake0 again, a new session.
  await expect.poll(() => symbiote.attaches(), POLL).toEqual(['fake0', 'fake0']);
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'high');
  await expect(renew(page)).toHaveClass(/secondary/);
  await expect(keys(page)).toBeFocused();

  // Nothing changed: the next starts on this one's, what the head shows, not Settings' (392).
  await renew(page).click();
  await expect.poll(() => scoutCalls().length, POLL).toBe(3);
  expect(flag(scoutCalls()[2]?.args, '--effort')).toBe('high');
  expect(symbiote.removed()).toEqual(['fake0', 'fake0']);
  await expect.poll(() => symbiote.attaches(), POLL).toEqual(['fake0', 'fake0', 'fake0']);
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'high');
  expect(JSON.parse(readFileSync(config(), 'utf8'))).toEqual({ scout: { effort: 'medium' } });
});

test('another agent picked in its head starts nothing: New conversation starts it', async ({
  page,
}) => {
  symbiote = await serveWorkspaces({ codex: true, appServer: true });
  const threads = () =>
    (symbiote.codexServer?.calls ?? []).filter((call) => call.method === 'thread/start');
  await page.goto(`${symbiote.url}scout`);
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  const agent = scoutPage(page).getByRole('combobox', { name: 'Agent' });
  await expect(agent).toHaveValue('claude');

  await agent.selectOption('codex');
  await expect(renew(page)).not.toHaveClass(/secondary/);
  await expect(renew(page)).toHaveAttribute('data-tip', /starts another with Codex/);
  // Codex's models in the head; Claude Code's conversation in the terminal, as it was.
  await expect(model(page).locator('option').first()).toHaveText(/^Codex's default/);
  expect(threads()).toEqual([]);
  expect(symbiote.stops()).toEqual([]);
  expect(symbiote.removed()).toEqual([]);
  await expect(screen(page)).toContainText('Fake Claude Code · fake0');

  await renew(page).click();
  await expect.poll(() => threads().length, POLL).toBe(1);
  expect(symbiote.removed()).toEqual(['fake0']);
  // A thread with no turn: its terminal takes the first question.
  expect((symbiote.codexServer?.calls ?? []).some((call) => call.method === 'turn/start')).toBe(
    false,
  );
  expect(JSON.parse(readFileSync(record(), 'utf8'))).toMatchObject({ agent: 'codex' });
  await expect(agent).toHaveValue('codex');
  await expect(renew(page)).toHaveClass(/secondary/);
  expect(scoutCalls()).toHaveLength(1);
});

test('without terminals, the question box: the head picks what its first question starts on', async ({
  page,
}) => {
  symbiote = await serveWorkspaces({ terminal: false });
  await page.goto(`${symbiote.url}scout`);
  const question = scoutPage(page).getByRole('textbox', { name: 'Ask Scout' });
  await expect(question).toBeVisible();
  await expect(question).toBeFocused();
  // Nothing starts before the question: no terminal to take it.
  expect(scoutCalls()).toEqual([]);
  await model(page).selectOption('opus');
  await effort(page).press('End');
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'max');
  expect(scoutCalls()).toEqual([]);
  await question.fill('Where is add?');
  await question.press('Enter');
  await expect.poll(() => scoutCalls().length, POLL).toBe(1);
  const args = scoutCalls()[0]?.args ?? [];
  expect(flag(args, '--model')).toBe('opus');
  expect(flag(args, '--effort')).toBe('max');
  expect(args.at(-1)).toBe('Where is add?');
  expect(args.at(-3)).toBe('--append-system-prompt');
  await expect(scoutPage(page)).toContainText('claude attach fake0', POLL);
  await expect(model(page)).toHaveValue('opus');

  // During it, a model picked starts nothing; after New conversation, the next question starts
  // on it.
  await model(page).selectOption('sonnet');
  await expect(renew(page)).not.toHaveClass(/secondary/);
  expect(scoutCalls()).toHaveLength(1);
  await renew(page).click();
  await expect.poll(() => symbiote.removed(), POLL).toEqual(['fake0']);
  await expect(scoutPage(page)).not.toContainText('claude attach', POLL);
  await expect(model(page)).toHaveValue('sonnet');
  expect(scoutCalls()).toHaveLength(1);
  await question.fill('Where is sub?');
  await question.press('Enter');
  await expect.poll(() => scoutCalls().length, POLL).toBe(2);
  const second = scoutCalls()[1]?.args ?? [];
  expect(flag(second, '--model')).toBe('sonnet');
  expect(second.at(-1)).toBe('Where is sub?');
});

test('without Claude Code or Codex, Scout says what it needs', async ({ page }) => {
  symbiote = await serveWorkspaces({ agent: false });
  await page.goto(`${symbiote.url}scout`);
  await expect(scoutPage(page)).toContainText('Scout needs Claude Code or Codex');
  await expect(scoutPage(page).locator('.agent-terminal')).toHaveCount(0);
  await expect(scoutPage(page).getByRole('button', { name: 'New conversation' })).toHaveCount(0);
});
