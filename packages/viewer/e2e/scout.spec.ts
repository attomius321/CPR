import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { dragTo, stops } from './stepper.js';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';
import { textAt } from './terminal.js';

// Scout (V35): a read-only agent in the checkout, asked from its page — a fake Claude Code, never
// a real one.
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
const question = (page: Page) => scoutPage(page).getByRole('textbox', { name: 'Ask Scout' });
const screen = (page: Page) => scoutPage(page).locator('.agent-terminal .xterm-rows');
const scoutLink = (page: Page) =>
  page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: /Scout/ });
const record = () => join(symbiote.repo, 'symbiote', 'scout.json');
/** The fake's starts in the checkout, as Claude Code was asked for them. */
const scoutCalls = () => symbiote.calls().filter((call) => call.args.includes('Scout'));

test('opens from the sidenav and by its key; a question starts a read-only agent in the checkout', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  // The person's own session in the checkout, started before (V35: never taken for Scout's).
  symbiote.addSession({ cwd: symbiote.repo, kind: 'interactive', name: 'mine', status: 'idle' });
  await page.goto(`${symbiote.url}history`);
  await expect(scoutLink(page)).toBeVisible();
  await expect(scoutLink(page)).toHaveAttribute('title', /\(a\)/);
  await scoutLink(page).click();
  await expect(page).toHaveURL(`${symbiote.url}scout`);
  await expect(scoutPage(page).getByRole('heading', { name: 'Scout' })).toBeVisible();
  await expect(scoutLink(page)).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle(/^Scout · /);
  // Nothing is started or written until a question is asked.
  expect(scoutCalls()).toEqual([]);
  expect(existsSync(record())).toBe(false);

  // `a` from another page opens it; on Scout, it goes to the question.
  await page
    .getByRole('navigation', { name: 'Pages' })
    .getByRole('link', { name: /History/ })
    .click();
  await expect(page).toHaveURL(`${symbiote.url}history`);
  await page.keyboard.press('a');
  await expect(page).toHaveURL(`${symbiote.url}scout`);
  await expect(question(page)).toBeFocused();
  await question(page).evaluate((box) => (box as HTMLElement).blur());
  await page.keyboard.press('a');
  await expect(question(page)).toBeFocused();

  await question(page).fill("Where is the merger's prompt defined?");
  await question(page).press('Enter');
  // Claude Code, read-only, in the checkout as it is.
  await expect.poll(() => scoutCalls().length, POLL).toBe(1);
  const [call] = scoutCalls();
  expect(call?.cwd).toBe(symbiote.repo);
  const args = call?.args ?? [];
  expect(args.slice(0, 9)).toEqual([
    '--bg',
    '--name',
    'Scout',
    '--tools',
    'Read,Grep,Glob,Bash',
    '--permission-mode',
    'dontAsk',
    '--strict-mcp-config',
    '--settings',
  ]);
  expect(args[9]).toBe(join(symbiote.repo, 'symbiote', 'scout-settings.json'));
  expect(args.at(-1)).toContain("Where is the merger's prompt defined?");

  // Its answer, in its own terminal.
  await expect(screen(page)).toContainText('Fake Claude Code · fake1', POLL);
  symbiote.setSession('fake1', {
    state: 'done',
    status: 'idle',
    answer: 'It is in packages/cli/src/prompts.ts (MERGER).',
  });
  await expect(screen(page)).toContainText('packages/cli/src/prompts.ts', POLL);
  // A follow-up is typed there.
  await page.keyboard.type('And why there?');
  await page.keyboard.press('Enter');
  await expect(screen(page)).toContainText('got: And why there?');
  expect(symbiote.attaches()).toEqual(['fake1']);
  // An image pasted there is attached too (V36), and kept out of the checkout.
  await scoutPage(page)
    .locator('.xterm-helper-textarea')
    .evaluate((element, data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const clipboardData = new DataTransfer();
      clipboardData.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
      );
    }, 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
  await expect(screen(page)).toContainText('[Image #1]');
  expect(symbiote.images().map((image) => image.id)).toEqual(['fake1']);
  // Read-only: the checkout is as it was.
  expect(git('status', '--porcelain')).toBe('');
});

test("a session of the person's in the checkout is not taken for Scout's", async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}scout`);
  await question(page).fill('What touches newestSession?');
  await scoutPage(page).getByRole('button', { name: 'Ask' }).click();
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
  // Read every 5 s while it works: then answered, its own state, not the person's session's.
  await expect(scoutPage(page)).toContainText('Answered', POLL);
  const kept = JSON.parse(readFileSync(record(), 'utf8')) as { id: string };
  expect(kept.id).toBe('fake0');
});

test('the sidenav says Scout works, then that it answered while you were away', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}scout`);
  await question(page).fill('Why does a reply stop the session first?');
  await question(page).press('Enter');
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  await page
    .getByRole('navigation', { name: 'Pages' })
    .getByRole('link', { name: /History/ })
    .click();
  await expect(scoutLink(page)).toHaveAttribute('data-state', 'working', POLL);
  symbiote.setSession('fake0', { state: 'done', status: 'idle', answer: 'Because…' });
  await expect(scoutLink(page)).toHaveAttribute('data-state', 'answered', POLL);
  await expect(scoutLink(page)).toHaveAttribute('title', /answered/);
  await scoutLink(page).click();
  await expect(scoutLink(page)).not.toHaveAttribute('data-state', /.+/);
});

test("a path Scout prints opens in VS Code, in the checkout's window (V37)", async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}scout`);
  await question(page).fill('Where is add?');
  await question(page).press('Enter');
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

test('New conversation: the old session stopped and removed, the question box back', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}scout`);
  await question(page).fill('Where are workspaces kept?');
  await question(page).press('Enter');
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  await scoutPage(page).getByRole('button', { name: 'New conversation' }).click();
  await expect(question(page)).toBeVisible();
  await expect(question(page)).toBeFocused();
  expect(symbiote.stops()).toEqual(['fake0']);
  expect(symbiote.removed()).toEqual(['fake0']);
  expect(existsSync(record())).toBe(false);
  // The next question starts another (the fake numbers sessions by its list's length: fake0 again).
  await question(page).fill('And reviews?');
  await question(page).press('Enter');
  await expect.poll(() => scoutCalls().length, POLL).toBe(2);
  expect(scoutCalls()[1]?.args.at(-1)).toContain('And reviews?');
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  expect(symbiote.attaches()).toEqual(['fake0', 'fake0']);
});

test('without Claude Code or Codex, Scout says what it needs', async ({ page }) => {
  symbiote = await serveWorkspaces({ agent: false });
  await page.goto(`${symbiote.url}scout`);
  await expect(scoutPage(page)).toContainText('Scout needs Claude Code or Codex');
  await expect(question(page)).toBeDisabled();
});

// Scout's effort (fix/scout-effort-level): the project's level in symbiote/config.json, a level
// picked on the stepper for one conversation.
const effort = (page: Page) => scoutPage(page).getByRole('slider', { name: 'Effort' });
const config = () => join(symbiote.repo, 'symbiote', 'config.json');
const flag = (args: readonly string[] = []) =>
  args.includes('--effort') ? args[args.indexOf('--effort') + 1] : undefined;

test("Effort: the box starts at the project's level; one dragged to reaches Claude Code for that conversation", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(config(), '{ "scout": { "effort": "medium" } }\n');
  await page.goto(`${symbiote.url}scout`);
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'medium');
  await expect(stops(effort(page))).toHaveText([
    'Default',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ]);
  await dragTo(page, effort(page), 3);
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'high');
  await question(page).fill('Where is the merger decided?');
  await question(page).press('Enter');
  await expect.poll(() => scoutCalls().length, POLL).toBe(1);
  const args = scoutCalls()[0]?.args ?? [];
  expect(flag(args)).toBe('high');
  // Before the question, as Claude Code takes options.
  expect(args.indexOf('--effort')).toBeLessThan(args.length - 2);
  await expect(scoutPage(page).locator('.scout-about')).toContainText(
    'with Claude Code at high effort',
  );
  // For that conversation: the project's level is as it was, and the next starts at it.
  expect(JSON.parse(readFileSync(config(), 'utf8'))).toEqual({ scout: { effort: 'medium' } });
  await scoutPage(page).getByRole('button', { name: 'New conversation' }).click();
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'medium');
  // Home: the agent's own default, no flag, even with the project's level set.
  await effort(page).press('Home');
  await expect(effort(page)).toHaveAttribute('aria-valuetext', "Claude Code's default");
  await question(page).fill('And reviews?');
  await question(page).press('Enter');
  await expect.poll(() => scoutCalls().length, POLL).toBe(2);
  expect(scoutCalls()[1]?.args).not.toContain('--effort');
  await expect(scoutPage(page).locator('.scout-about')).not.toContainText('effort');
});

test('Effort: without a level in the project, the box is at the default and passes none; a key steps one level', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}scout`);
  await expect(effort(page)).toHaveAttribute('aria-valuetext', "Claude Code's default");
  await effort(page).press('ArrowRight');
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'low');
  await effort(page).press('ArrowLeft');
  await question(page).fill('Q');
  await question(page).press('Enter');
  await expect.poll(() => scoutCalls().length, POLL).toBe(1);
  expect(scoutCalls()[0]?.args).not.toContain('--effort');
  // A conversation that runs has no stepper: its level is its session's.
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  await expect(effort(page)).toHaveCount(0);
  expect(existsSync(config())).toBe(false);
});
