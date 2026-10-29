import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';
import { textAt } from './terminal.js';

// Nucleus (V35): an agent in the checkout, its terminal on its page since V50 — a fake Claude Code,
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
const nucleusPage = (page: Page) => page.getByRole('region', { name: 'Scout' });
const screen = (page: Page) => nucleusPage(page).locator('.agent-terminal .xterm-rows');
const keys = (page: Page) => nucleusPage(page).locator('.xterm-helper-textarea');
const renew = (page: Page) => nucleusPage(page).getByRole('button', { name: 'New conversation' });
const nucleusLink = (page: Page) =>
  page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: /Scout/ });
const historyLink = (page: Page) =>
  page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: /Git/ });
const record = () => join(symbiote.repo, 'symbiote', 'scout.json');
const config = () => join(symbiote.repo, 'symbiote', 'config.json');
/** The fake's starts and copies in the checkout, as Claude Code was asked for them. */
const nucleusCalls = () => symbiote.calls().filter((call) => call.args.includes('Scout'));
const flag = (args: readonly string[] = [], name: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined;

test("opens as Scout's terminal, from the sidenav and by its key: started in the checkout with no question", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  // The person's own session in the checkout, started before (V35: never taken for Nucleus's).
  symbiote.addSession({ cwd: symbiote.repo, kind: 'interactive', name: 'mine', status: 'idle' });
  await page.goto(`${symbiote.url}git`);
  await expect(nucleusLink(page)).toHaveAttribute('data-tip-keys', 'a');
  // Nothing is started before Nucleus is opened.
  expect(nucleusCalls()).toEqual([]);
  await nucleusLink(page).click();
  await expect(page).toHaveURL(`${symbiote.url}scout`);
  await expect(nucleusPage(page).getByRole('heading', { name: 'Scout' })).toBeVisible();
  await expect(nucleusLink(page)).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle(/^Scout · /);

  // Its terminal, with no question asked first: no box, no form.
  await expect(screen(page)).toContainText('Fake Claude Code · fake1', POLL);
  await expect(nucleusPage(page).getByRole('textbox', { name: 'Ask Scout' })).toHaveCount(0);
  await expect(keys(page)).toBeFocused();
  await expect(nucleusPage(page).getByRole('status')).toHaveText('Ready: ask in its terminal');
  expect(nucleusCalls()).toHaveLength(1);
  const [call] = nucleusCalls();
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
  await expect(page).toHaveURL(`${symbiote.url}git`);
  await page.keyboard.press('a');
  await expect(page).toHaveURL(`${symbiote.url}scout`);
  await expect(screen(page)).toContainText('Fake Claude Code · fake1', POLL);
  await expect(keys(page)).toBeFocused();
  expect(nucleusCalls()).toHaveLength(1);
  expect(symbiote.attaches()).toEqual(['fake1', 'fake1']);
  // Read-only: the checkout is as it was.
  expect(git('status', '--porcelain')).toBe('');
});

test("a session of the person's in the checkout is not taken for Scout's", async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}scout`);
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  symbiote.setSession('fake0', { state: 'done', status: 'idle' });
  // The person starts a session of their own there: newer, working, even named Nucleus.
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
  await expect(nucleusPage(page).getByRole('status')).toHaveText(
    'Answered: ask more in its terminal',
    POLL,
  );
  const kept = JSON.parse(readFileSync(record(), 'utf8')) as { id: string };
  expect(kept.id).toBe('fake0');
  expect(nucleusCalls()).toHaveLength(1);
});

test('the sidenav says Scout works, then that it answered while you were away', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}scout`);
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  // Ready is not an answer: no mark.
  await expect(nucleusLink(page)).not.toHaveAttribute('data-state', /.+/);
  await page.keyboard.type('Why does a reply stop the session first?');
  await page.keyboard.press('Enter');
  symbiote.setSession('fake0', { state: 'working', status: 'busy' });
  await historyLink(page).click();
  await expect(nucleusLink(page)).toHaveAttribute('data-state', 'working', POLL);
  symbiote.setSession('fake0', { state: 'done', status: 'idle', answer: 'Because…' });
  await expect(nucleusLink(page)).toHaveAttribute('data-state', 'answered', POLL);
  await expect(nucleusLink(page)).toHaveAttribute('data-tip', /Answered/);
  await nucleusLink(page).click();
  await expect(nucleusLink(page)).not.toHaveAttribute('data-state', /.+/);
});

/**
 * A computed colour's channels (0–255) and alpha: `rgb()`, `rgba()` or `color(srgb …)`; none for a
 * colour in a transition or an animation (Chromium gives those in `oklab()`).
 */
function channels(css: string): [number, number, number, number] | undefined {
  const srgb = /color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)/.exec(css);
  if (srgb) {
    const [r, g, b] = [srgb[1], srgb[2], srgb[3]].map((value) => Number(value) * 255);
    return [r ?? 0, g ?? 0, b ?? 0, srgb[4] === undefined ? 1 : Number(srgb[4])];
  }
  const rgb = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(css);
  if (!rgb) return undefined;
  return [
    Number(rgb[1]),
    Number(rgb[2]),
    Number(rgb[3]),
    rgb[4] === undefined ? 1 : Number(rgb[4]),
  ];
}
/** How strong a tint of `of` the colour is (its alpha); NaN for another colour or one moving. */
const tintOf = (css: string, of: string) => {
  const [r, g, b, a] = channels(css) ?? [];
  const [or, og, ob] = channels(of) ?? [];
  if (r === undefined || or === undefined) return Number.NaN;
  return Math.abs(r - or) + Math.abs((g ?? 0) - (og ?? 0)) + Math.abs((b ?? 0) - (ob ?? 0)) < 6
    ? (a ?? 1)
    : Number.NaN;
};
/** What a sidenav link shows: its background, its ring, its words', icon's colours, its flash. */
const looks = (link: Locator) =>
  link.evaluate((a) => {
    const style = getComputedStyle(a);
    const icon = a.querySelector('.icon');
    return {
      background: style.backgroundColor,
      ring: style.boxShadow,
      color: style.color,
      icon: icon ? getComputedStyle(icon).color : '',
      flash: style.animationName,
    };
  });
/** A token's colour as the page computes it. */
const token = (page: Page, name: string) =>
  page.evaluate((name) => {
    const probe = document.createElement('i');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, name);

// V59 (decisions 422, 423): Nucleus waiting on the person is its whole link, in Waiting for you's
// amber band, saying so; nothing moves.
test('Scout waiting for you: its whole link an amber band saying "Waits", folded and on its page too', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}scout`);
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  await historyLink(page).click();
  const link = nucleusLink(page);
  const waits = link.locator('.sidenav-waits');
  const atRest = await link.boundingBox();
  const warning = await token(page, '--warning');
  // As at rest, once the current page's wash has gone.
  await expect.poll(async () => (await looks(link)).background, POLL).toBe('rgba(0, 0, 0, 0)');

  symbiote.setSession('fake0', {
    state: 'waiting',
    status: 'idle',
    waitingFor: 'permission prompt',
  });
  await expect(link).toHaveAttribute('data-state', 'waiting', POLL);
  await expect(link).toHaveAccessibleName('Scout, waits for you');
  await expect(link).toHaveAttribute('data-tip', 'Scout\nWaits for you');
  await expect(waits).toBeVisible();
  await expect(waits).toHaveText('Waits');
  await expect(link.locator('.state-dot')).toBeHidden();
  // A flash as it starts to wait, then still: a light tint of the warning, its ring, its icon.
  expect((await looks(link)).flash).toBe('wait-flash');
  // Without motion, no flash (with it again, it flashes again: the poll below waits it out).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect((await looks(link)).flash).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect
    .poll(async () => tintOf((await looks(link)).background, warning), POLL)
    .toBeLessThan(0.2);
  let shown = await looks(link);
  expect(tintOf(shown.background, warning)).toBeGreaterThan(0.05);
  expect(shown.ring).toMatch(/ 0px 0px 0px 1px inset$/);
  expect(tintOf(shown.ring.replace(/ 0px 0px 0px 1px inset$/, ''), warning)).toBeGreaterThan(0.2);
  expect(shown.icon).toBe(warning);
  expect(shown.color).toBe(await token(page, '--text'));
  expect(await link.boundingBox()).toEqual(atRest);

  // Folded: the band and its dot on the icon's corner; no words.
  await page.keyboard.press('[');
  await expect(page.locator('.sidenav')).toHaveClass(/rail/);
  await expect(waits).toBeHidden();
  await expect(link.locator('.state-dot')).toBeVisible();
  await expect(link.locator('.state-dot')).toHaveClass(/tone-waiting/);
  shown = await looks(link);
  expect(tintOf(shown.background, warning)).toBeGreaterThan(0.05);
  expect(shown.icon).toBe(warning);
  await page.keyboard.press('[');
  await expect(page.locator('.sidenav')).not.toHaveClass(/rail/);

  // On its own page: the current page's wash and icon, the ring and "Waits" with them.
  await link.click();
  await expect(link).toHaveAttribute('aria-current', 'page');
  const selected = await token(page, '--selected');
  await expect.poll(async () => (await looks(link)).background, POLL).toBe(selected);
  shown = await looks(link);
  expect(shown.ring).toMatch(/ 0px 0px 0px 1px inset$/);
  expect(shown.icon).toBe(await token(page, '--accent'));
  await expect(waits).toBeVisible();

  // It answers: the link as it was.
  symbiote.setSession('fake0', { state: 'done', status: 'idle' });
  await expect(link).not.toHaveAttribute('data-state', /.+/, POLL);
  await expect(waits).toHaveCount(0);
  await expect(link).toHaveAccessibleName('Scout');
  await historyLink(page).click();
  await expect.poll(async () => (await looks(link)).background, POLL).toBe('rgba(0, 0, 0, 0)');
  expect((await looks(link)).ring).toBe('none');
  // An idle page's icon in the muted words' colour since V61 (the mockup; `--faint` before).
  expect((await looks(link)).icon).toBe(await token(page, '--muted'));
});

test("a path Scout prints opens in VS Code, in the checkout's window (V38)", async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}scout`);
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  symbiote.setSession('fake0', { state: 'done', status: 'idle', answer: 'In src/math.ts:1.' });
  await expect(screen(page)).toContainText('In src/math.ts:1.', POLL);
  const at = await textAt(screen(page), 'src/math.ts:1');
  await page.mouse.move(at.x, at.y);
  await expect(nucleusPage(page).getByRole('tooltip')).toHaveText(/^Open in VS Code/);
  await page.keyboard.down('ControlOrMeta');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up('ControlOrMeta');
  await expect
    .poll(() => symbiote.opened())
    .toEqual([[symbiote.repo, '--goto', `${join(symbiote.repo, 'src', 'math.ts')}:1:1`]]);
});

// V78 (decision 569): the agent, the model and the effort are Settings'; the page says which.
test('its page has no choices: the terminal, its line saying what it runs on, the state and New conversation', async ({
  page,
}) => {
  symbiote = await serveWorkspaces({ codex: true, appServer: true });
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(config(), '{ "scout": { "model": "sonnet", "effort": "high" } }\n');
  await page.goto(`${symbiote.url}scout`);
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  // Two agents installed, and still no Agent, Model or Effort; no box either.
  await expect(nucleusPage(page).getByRole('combobox')).toHaveCount(0);
  await expect(nucleusPage(page).getByRole('slider')).toHaveCount(0);
  await expect(nucleusPage(page).getByRole('textbox', { name: 'Ask Scout' })).toHaveCount(0);
  await expect(nucleusPage(page).locator('.page-agent-about')).toHaveText(
    /^In \S+, with Claude Code on Sonnet 5\.5 at high effort$/,
  );
  // Its only buttons: its help and New conversation.
  expect(
    await nucleusPage(page)
      .getByRole('button')
      .evaluateAll((all) => all.map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim())),
  ).toEqual(['About Scout', 'New conversation']);
  await expect(renew(page)).toHaveClass(/secondary/);
  const args = nucleusCalls()[0]?.args ?? [];
  expect(flag(args, '--model')).toBe('sonnet');
  expect(flag(args, '--effort')).toBe('high');
  // The Help says where they are set.
  await nucleusPage(page).getByRole('button', { name: 'About Scout' }).click();
  await expect(page.getByRole('tooltip')).toContainText('Settings sets the model and effort');
});

// V72 (decision 510): the state and New conversation the page head's actions; since V78 the card
// is the terminal alone, with no head of its own.
test("the state and New conversation share one centre; the terminal starts at the card's top", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  const box = async (part: Locator) => {
    const b = await part.boundingBox();
    if (!b) throw new Error('not drawn');
    return { top: b.y, bottom: b.y + b.height, centre: b.y + b.height / 2 };
  };
  for (const width of [1920, 1200]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${symbiote.url}scout`);
    await expect(screen(page)).toContainText('Fake Claude Code', POLL);
    const state = await box(nucleusPage(page).getByRole('status'));
    const button = await box(renew(page));
    expect(Math.abs(state.centre - button.centre)).toBeLessThanOrEqual(1);
    const card = await box(nucleusPage(page).locator('.nucleus-card'));
    const terminal = await box(nucleusPage(page).locator('.page-agent-terminal'));
    // Inside the card's 1 px border.
    expect(Math.abs(terminal.top - (card.top + 1))).toBeLessThanOrEqual(1);
    expect(button.bottom).toBeLessThan(card.top);
  }
});

test("New conversation: the old session stopped and removed, the next opened at once on Settings'", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(config(), '{ "scout": { "effort": "medium" } }\n');
  await page.goto(`${symbiote.url}scout`);
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  // Opened on the project's level.
  expect(flag(nucleusCalls()[0]?.args, '--effort')).toBe('medium');
  await expect(nucleusPage(page).locator('.page-agent-about')).toContainText('at medium effort');
  await expect(renew(page)).toHaveAttribute('data-tip', /starts another on Settings'/);

  // Settings changed while it runs: the running conversation keeps its own.
  writeFileSync(config(), '{ "scout": { "effort": "high" } }\n');
  await renew(page).click();
  await expect.poll(() => nucleusCalls().length, POLL).toBe(2);
  expect(flag(nucleusCalls()[1]?.args, '--effort')).toBe('high');
  expect(symbiote.stops()).toEqual(['fake0']);
  expect(symbiote.removed()).toEqual(['fake0']);
  // The fake numbers sessions by its list's length: fake0 again, a new session.
  await expect.poll(() => symbiote.attaches(), POLL).toEqual(['fake0', 'fake0']);
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  await expect(nucleusPage(page).getByRole('status')).toHaveText(
    'Ready: ask in its terminal',
    POLL,
  );
  await expect(nucleusPage(page).locator('.page-agent-about')).toContainText('at high effort');
  await expect(keys(page)).toBeFocused();
  // Nothing written by the page: the project's settings are Settings'.
  expect(JSON.parse(readFileSync(config(), 'utf8'))).toEqual({ scout: { effort: 'high' } });
});

// V78 (decision 572): Nucleus runs in a terminal; without one, no box.
test('without terminals, no box: it says Scout runs in a terminal, and why none runs, starting nothing', async ({
  page,
}) => {
  symbiote = await serveWorkspaces({ terminal: false });
  await page.goto(`${symbiote.url}scout`);
  await expect(nucleusPage(page).locator('.page-agent-note')).toHaveText(
    'Scout runs in a terminal, and none runs here: terminals are turned off (SYMBIOTE_TERMINAL=off).',
  );
  await expect(nucleusPage(page).getByRole('textbox')).toHaveCount(0);
  await expect(nucleusPage(page).getByRole('combobox')).toHaveCount(0);
  await expect(nucleusPage(page).getByRole('slider')).toHaveCount(0);
  await expect(renew(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(nucleusCalls()).toEqual([]);
});

test('without Claude Code or Codex, Scout says what it needs', async ({ page }) => {
  symbiote = await serveWorkspaces({ agent: false });
  await page.goto(`${symbiote.url}scout`);
  await expect(nucleusPage(page)).toContainText('Scout needs Claude Code or Codex');
  await expect(nucleusPage(page).locator('.agent-terminal')).toHaveCount(0);
  await expect(nucleusPage(page).getByRole('button', { name: 'New conversation' })).toHaveCount(0);
});
