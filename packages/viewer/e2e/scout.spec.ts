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
  await expect(scoutLink(page)).toHaveAttribute('title', /\(a\)/);
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
  await expect(scoutLink(page)).toHaveAttribute('title', /answered/);
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

test('the Model and the Effort in its head move the conversation to a copy on them; its terminal joins it', async ({
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

  await model(page).selectOption('sonnet');
  await expect(screen(page)).toContainText('Fake Claude Code · fake1', POLL);
  await expect.poll(() => scoutCalls().length).toBe(2);
  const copy = scoutCalls()[1]?.args ?? [];
  // A copy of the session, its conversation kept, with Scout's options again (decision 384).
  expect(copy.slice(0, 5)).toEqual(['--bg', '--resume', 'session-0', '--name', 'Scout']);
  expect(copy).toContain('Read,Grep,Glob,Bash');
  expect(copy).toContain(join(symbiote.repo, 'symbiote', 'scout-settings.json'));
  expect(flag(copy, '--model')).toBe('sonnet');
  expect(copy.at(-2)).toBe('--append-system-prompt');
  expect(symbiote.stops()).toEqual(['fake0']);
  expect(symbiote.removed()).toEqual(['fake0']);
  await expect(model(page)).toHaveValue('sonnet');
  await expect(keys(page)).toBeFocused();

  await dragTo(page, effort(page), 3);
  await expect(screen(page)).toContainText('Fake Claude Code · fake2', POLL);
  await expect.poll(() => scoutCalls().length).toBe(3);
  const again = scoutCalls()[2]?.args ?? [];
  expect(again.slice(0, 3)).toEqual(['--bg', '--resume', 'session-1']);
  expect(flag(again, '--model')).toBe('sonnet');
  expect(flag(again, '--effort')).toBe('high');
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'high');
  expect(symbiote.removed()).toEqual(['fake0', 'fake1']);
  expect(symbiote.attaches()).toEqual(['fake0', 'fake1', 'fake2']);
  expect(JSON.parse(readFileSync(record(), 'utf8'))).toMatchObject({
    model: 'sonnet',
    effort: 'high',
  });
  // The project's settings are as they were: these are this conversation's.
  expect(existsSync(config())).toBe(false);

  // While Scout answers, neither can move it.
  const id = (JSON.parse(readFileSync(record(), 'utf8')) as { id: string }).id;
  symbiote.setSession(id, { state: 'working', status: 'busy' });
  await expect(model(page)).toBeDisabled(POLL);
  await expect(effort(page)).toBeDisabled();
  symbiote.setSession(id, { state: 'done', status: 'idle' });
  await expect(model(page)).toBeEnabled(POLL);
});

test("New conversation: the old session stopped and removed, the next opened at once on the project's model and level", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(config(), '{ "scout": { "effort": "medium" } }\n');
  await page.goto(`${symbiote.url}scout`);
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  expect(flag(scoutCalls()[0]?.args, '--effort')).toBe('medium');
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'medium');
  // This conversation's level, then a new one at the project's (decision 385).
  await effort(page).press('ArrowRight');
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'high');
  await expect.poll(() => scoutCalls().length, POLL).toBe(2);
  await expect(screen(page)).toContainText('Fake Claude Code · fake1', POLL);

  await scoutPage(page).getByRole('button', { name: 'New conversation' }).click();
  await expect.poll(() => scoutCalls().length, POLL).toBe(3);
  const next = scoutCalls()[2]?.args ?? [];
  expect(next[1]).toBe('--name');
  expect(flag(next, '--effort')).toBe('medium');
  expect(symbiote.stops()).toEqual(['fake0', 'fake1']);
  expect(symbiote.removed()).toEqual(['fake0', 'fake1']);
  // The fake numbers sessions by its list's length: fake0 again, a new session.
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'medium');
  await expect(keys(page)).toBeFocused();
  expect(JSON.parse(readFileSync(config(), 'utf8'))).toEqual({ scout: { effort: 'medium' } });
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
});

test('without Claude Code or Codex, Scout says what it needs', async ({ page }) => {
  symbiote = await serveWorkspaces({ agent: false });
  await page.goto(`${symbiote.url}scout`);
  await expect(scoutPage(page)).toContainText('Scout needs Claude Code or Codex');
  await expect(scoutPage(page).locator('.agent-terminal')).toHaveCount(0);
  await expect(scoutPage(page).getByRole('button', { name: 'New conversation' })).toHaveCount(0);
});
