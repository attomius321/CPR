import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { dragTo, stops } from './stepper.js';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// Settings (V28b): every agent's prompts, Symbiote's until changed, saved in the project's
// symbiote/config.json and told to the next agent — a fake Claude Code, never a real one.
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

const list = (page: Page) => page.getByRole('navigation', { name: 'Settings' });
const entry = (page: Page, name: string) => list(page).getByRole('button', { name });
const agents = (page: Page) => list(page).getByRole('region', { name: 'Prebuilt agents' });
const editor = (page: Page) => page.locator('.settings-editor');
/** The open page's name in its card's head (V62): a prompt's with its chip. */
const title = (page: Page) => editor(page).getByRole('heading', { level: 2 });
/** A part of a prebuilt agent's page: its Model, Effort or Instructions. */
const part = (page: Page, name: string) => editor(page).getByRole('region', { name });
const text = (page: Page, title: string) =>
  editor(page).getByRole('textbox', { name: `${title} prompt` });
const save = (page: Page) =>
  editor(page).getByRole('button', { name: 'Save changes', exact: true });
const config = () => join(symbiote.repo, 'symbiote', 'config.json');
const prompts = () =>
  (JSON.parse(readFileSync(config(), 'utf8')) as { prompts?: Record<string, unknown> }).prompts;

const FIX = 'Fix it on {branch}.\n\n{brief}\n\nRun the tests before you say it is ready.\n\n';

test("changes the Fix prompt; the next Fix workspace's agent is told it; Reset gives Symbiote's back", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(symbiote.url);
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('s');
  await expect(page).toHaveURL(`${symbiote.url}settings`);
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // Beside Save since V62 (the head has the mockup's line).
  await expect(page.locator('.settings-git')).toHaveText(
    "No prompt changed: every agent is told Symbiote's text.",
  );
  // 14 prompts (Documents since V40, Suggest settings since V75) and the three prebuilt agents,
  // each one page of its settings (fix/scout-merger-scribe-settings); this machine's Skill library
  // (SK1); this browser's Appearance last (V51).
  await expect(list(page).getByRole('button')).toHaveCount(19);
  await expect(entry(page, 'Documents')).toBeVisible();
  await expect(entry(page, 'Suggest settings')).toBeVisible();
  // The first is open; each group in its order.
  await expect(entry(page, 'Feature')).toHaveAttribute('aria-current', 'true');
  await expect(list(page).getByRole('heading')).toHaveText([
    'Workspaces',
    'Reviews',
    'Prebuilt agents',
    'This machine',
    'This browser',
  ]);
  await expect(agents(page).getByRole('button')).toHaveText(['Merger', 'Scout', 'Scribe']);
  // An entry's words in line with its group's heading (V62, the mockup), 16 px in (V72, the
  // card's inset), its wash further out.
  const heading = await list(page).getByRole('heading', { name: 'Workspaces' }).boundingBox();
  const name = await entry(page, 'Feature').locator('.settings-name').boundingBox();
  const first = await entry(page, 'Feature').boundingBox();
  const card = await list(page).boundingBox();
  expect(Math.abs((name?.x ?? 0) - (heading?.x ?? 0) - 8)).toBeLessThanOrEqual(1);
  expect(Math.abs((name?.x ?? 0) - (card?.x ?? 0) - 17)).toBeLessThanOrEqual(1);
  expect(first?.x).toBeLessThan(name?.x ?? 0);

  await entry(page, 'Fix').click();
  await expect(page).toHaveURL(`${symbiote.url}settings?prompt=start.fix`);
  await expect(title(page)).toHaveText("Workspaces: FixSymbiote's");
  await expect(text(page, 'Fix')).toHaveValue(/Reproduce it first, with a failing test/);

  await text(page, 'Fix').fill(FIX);
  await expect(entry(page, 'Fix')).toContainText('not saved');
  // A placeholder goes in at the cursor.
  await text(page, 'Fix').press('Control+Home');
  await editor(page).getByRole('button', { name: '{plan}' }).click();
  await expect(text(page, 'Fix')).toHaveValue(`{plan}${FIX}`);
  // The cursor after it, placed on the next frame: typing goes on from there. (Filled before that
  // frame, the text went in after `{plan}` instead of replacing it: 4 runs in 48 at 8 workers.)
  await expect
    .poll(() => text(page, 'Fix').evaluate((field: HTMLTextAreaElement) => field.selectionStart))
    .toBe('{plan}'.length);
  // Without the brief it cannot be saved.
  await text(page, 'Fix').fill('Fix it on {branch}.');
  await expect(editor(page).locator('.settings-size')).toHaveText(
    "{brief} is missing: the agent would not be given the person's brief, as the start page made it.",
  );
  await expect(save(page)).toBeDisabled();
  await text(page, 'Fix').fill(FIX);
  await save(page).click();
  await expect(editor(page).getByRole('status')).toHaveText(
    'Saved. Saved in symbiote/config.json, not committed: commit it to share the prompts with ' +
      'everyone who uses this repository.',
  );
  await expect(entry(page, 'Fix')).toContainText('changed');
  await expect(title(page)).toHaveText("Workspaces: FixThe project's");
  // Kept as lines, without the blank end.
  expect(prompts()).toEqual({
    start: {
      fix: ['Fix it on {branch}.', '', '{brief}', '', 'Run the tests before you say it is ready.'],
    },
  });

  // The next Fix workspace's agent is told the project's prompt.
  await page.goto(symbiote.url);
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  const form = page.getByRole('region', { name: 'Start a workspace' });
  await form.getByRole('radio', { name: 'Fix' }).click();
  await form.getByRole('textbox', { name: 'Title' }).fill('Dates sort as text');
  await form.getByRole('textbox', { name: 'What happens' }).fill('They sort 1, 10, 2.');
  await form.getByRole('button', { name: 'Start workspace' }).click();
  await expect(page.getByRole('status')).toContainText('Started fix/dates-sort-as-text');
  const told = symbiote.calls().at(-1)?.args.at(-1) ?? '';
  expect(told).toMatch(/^Fix it on fix\/dates-sort-as-text\.\n\n# Fix: Dates sort as text\n/);
  expect(told).toMatch(/\n\nRun the tests before you say it is ready\.\n$/);
  expect(told).not.toContain('Reproduce it first');

  // Reset: Symbiote's text again, and nothing left in the file.
  await page.goto(`${symbiote.url}settings?prompt=start.fix`);
  await editor(page).getByRole('button', { name: 'Reset to default' }).click();
  await editor(page).getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(editor(page).getByRole('status')).toContainText("Symbiote's text again.");
  await expect(text(page, 'Fix')).toHaveValue(/Reproduce it first/);
  expect(prompts()).toBeUndefined();
});

test('keeps drafts across prompts, asks before leaving with one, and refuses a stale save', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}settings?prompt=start.spike`);
  await text(page, 'Spike').fill('Spike {branch}.\n\n{brief}\n\nCommit it under spikes/.');
  await entry(page, 'Chore').click();
  await expect(text(page, 'Chore')).toHaveValue(/Keep to what is asked/);
  await entry(page, 'Spike').click();
  await expect(text(page, 'Spike')).toHaveValue(/Commit it under spikes\/\.$/);
  await expect(entry(page, 'Spike')).toContainText('not saved');

  // Leaving with it asks first; staying keeps it. In the shell (V29a) the page is not unloaded:
  // the shell asks, in a dialog of Symbiote's own (N1c), not the browser's.
  await page.getByRole('link', { name: 'Git' }).click();
  const asking = page.getByRole('alertdialog', { name: 'Leave Settings?' });
  await expect(asking).toContainText('A prompt is changed and not saved.');
  await asking.getByRole('button', { name: 'Stay' }).click();
  await expect(asking).toBeHidden();
  await expect(page).toHaveURL(`${symbiote.url}settings?prompt=start.spike`);
  await expect(text(page, 'Spike')).toHaveValue(/Commit it under spikes\/\.$/);

  // Changed elsewhere since the page read it: refused, read again, the draft kept, saved.
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(config(), '{\n  "prompts": { "plan": { "direct": "Just do it." } }\n}\n');
  await save(page).click();
  await expect(editor(page).getByRole('status')).toContainText(
    'symbiote/config.json changed since you opened it',
  );
  await editor(page).getByRole('button', { name: 'Read it again' }).click();
  await expect(entry(page, 'Plan without')).toContainText('changed');
  await expect(text(page, 'Spike')).toHaveValue(/Commit it under spikes\/\.$/);
  await save(page).click();
  await expect(editor(page).getByRole('status')).toContainText('Saved.');
  expect(prompts()).toMatchObject({
    plan: { direct: 'Just do it.' },
    start: { spike: expect.arrayContaining(['Commit it under spikes/.']) as unknown },
  });

  // Discard: the text in use again, nothing marked.
  await text(page, 'Spike').fill('Something else: {brief}');
  await editor(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(text(page, 'Spike')).toHaveValue(/Commit it under spikes\/\.$/);
  await expect(entry(page, 'Spike')).toContainText('changed');
});

// A prebuilt agent (fix/scout-merger-scribe-settings): one entry by its name under Prebuilt
// agents, and one page for its settings: its Model, its Effort when Settings sets one, then its
// Instructions.
test("the merger's page: its Model, Effort and Instructions; its answer format, which a project cannot change, and no placeholders", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}settings?prompt=merger`);
  await expect(agents(page).getByRole('button', { name: 'Merger' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(editor(page).getByRole('heading')).toHaveText([
    'Merger',
    'Model',
    'Effort',
    "InstructionsSymbiote's",
  ]);
  await expect(text(page, 'Instructions')).toHaveValue(
    /^You resolve merge conflicts for Symbiote\./,
  );
  await expect(part(page, 'Instructions').locator('.settings-fixed pre')).toContainText(
    'Answer with one JSON object and nothing else:',
  );
  await expect(part(page, 'Instructions')).toContainText(
    'No placeholders: the agent is given it as written.',
  );
});

test('on a phone, the list first; a prompt or an agent takes the page, and comes back to the list', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}settings`);
  await expect(list(page)).toBeVisible();
  await expect(editor(page)).toBeHidden();
  await entry(page, 'symbiote/AGENTS.md').click();
  await expect(list(page)).toBeHidden();
  await expect(text(page, 'symbiote/AGENTS.md')).toHaveValue(/^# Symbiote reviews/);
  await editor(page).getByRole('button', { name: 'All settings' }).click();
  await expect(list(page)).toBeVisible();
  await expect(page).toHaveURL(`${symbiote.url}settings`);
  // An agent's page, its parts one under another.
  await entry(page, 'Scout').click();
  await expect(list(page)).toBeHidden();
  await expect(part(page, 'Effort').getByRole('slider', { name: 'Effort' })).toBeVisible();
  // Its system prompt since V50: the person asks in its terminal.
  await expect(text(page, 'Instructions')).toHaveValue(/^You are Scout/);
  // Nothing wider than the screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await editor(page).getByRole('button', { name: 'All settings' }).click();
  await expect(list(page)).toBeVisible();
});

// V62: the person's mockup. The list and the page are two cards filling the main area to its
// bottom; the list has no icons (the brief); the page is one card, its head over sections that say
// what they are.
test("the mockup: two cards to the main area's bottom, the list without icons, the page a head over its sections", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  const near = (actual: number, expected: number) =>
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
  const boxes = async () => {
    const area = await page.locator('.shell-main').boundingBox();
    const l = await list(page).boundingBox();
    const e = await editor(page).boundingBox();
    if (!area || !l || !e) throw new Error('no box');
    return { area, l, e };
  };
  // The mockup's size, and a smaller window.
  for (const [width, height] of [
    [1700, 925],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`${symbiote.url}settings`);
    await expect(text(page, 'Feature')).toBeVisible();
    const { area, l, e } = await boxes();
    // The page frame since V72 (decision 508): 16 px from the area's edges, 16 apart.
    near(l.width, 280);
    near(l.x - area.x, 16);
    near(e.x - (l.x + l.width), 16);
    near(area.x + area.width - (e.x + e.width), 16);
    near(l.y, e.y);
    near(area.y + area.height - (l.y + l.height), 16);
    near(area.y + area.height - (e.y + e.height), 16);
  }
  // The list scrolls on its own when taller than its card: the open entry is scrolled to.
  await page.goto(`${symbiote.url}settings?prompt=appearance`);
  await expect(entry(page, 'Appearance')).toHaveAttribute('aria-current', 'true');
  await expect(entry(page, 'Appearance')).toBeInViewport({ ratio: 1 });
  await page.goto(`${symbiote.url}settings`);
  await expect(text(page, 'Feature')).toBeVisible();
  // Cards, the style's 10 px; no icon by an entry.
  await expect(list(page)).toHaveCSS('border-top-left-radius', '10px');
  await expect(editor(page)).toHaveCSS('border-top-left-radius', '10px');
  await expect(list(page).locator('svg')).toHaveCount(0);
  // The open entry's words in the accent.
  const accent = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent)';
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(entry(page, 'Feature')).toHaveCSS('color', accent);
  await expect(entry(page, 'Fix')).not.toHaveCSS('color', accent);

  // The head: the page's icon, its title and the mockup's line.
  const head = page.locator('.settings-bar');
  await expect(head.locator('.page-icon svg')).toBeVisible();
  await expect(head).toContainText('Configure Symbiote to match your workflow and preferences.');

  // The page's head: its name and chip; its sections, each with a line of what it is.
  await expect(title(page)).toHaveText("Workspaces: FeatureSymbiote's");
  await expect(editor(page).getByRole('heading', { level: 3 })).toHaveText([
    'Prompt',
    'Placeholders',
  ]);
  await expect(
    editor(page).getByText("What a Feature workspace's agent is told when it starts"),
  ).toBeVisible();
  await expect(editor(page).getByText('click one to insert it at the cursor')).toBeVisible();
  // The placeholders in two columns.
  const chips = await editor(page).locator('.settings-placeholders li .link').all();
  const columns = new Set<number>();
  for (const chip of chips) columns.add(Math.round((await chip.boundingBox())?.x ?? 0));
  expect(columns.size).toBe(2);

  // Cancel and Save changes at the card's bottom right, the git note at their left.
  await expect(editor(page).locator('.settings-git')).toHaveText(
    "No prompt changed: every agent is told Symbiote's text.",
  );
  await text(page, 'Feature').fill('A feature on {branch}.\n\n{brief}');
  const cancel = await editor(page)
    .getByRole('button', { name: 'Cancel', exact: true })
    .boundingBox();
  const saving = await save(page).boundingBox();
  const card = await editor(page).boundingBox();
  const note = await editor(page).locator('.settings-git').boundingBox();
  if (!cancel || !saving || !card || !note) throw new Error('no box');
  expect(saving.x).toBeGreaterThan(cancel.x + cancel.width);
  expect(cancel.x).toBeGreaterThan(note.x + note.width);
  expect(card.x + card.width - (saving.x + saving.width)).toBeLessThanOrEqual(40);
  await editor(page).getByRole('button', { name: 'Cancel', exact: true }).click();

  // Wider windows: the whole main area (V72, decision 507: centred at 1,400 px before), the head
  // over the list's edge.
  for (const [width, height] of [
    [1920, 1080],
    [2560, 1440],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(text(page, 'Feature')).toBeVisible();
    const { area, l, e } = await boxes();
    near(l.x - area.x, 16);
    near(area.x + area.width - (e.x + e.width), 16);
    const icon = await head.locator('.page-icon').boundingBox();
    near(icon?.x ?? 0, l.x);
  }

  // An agent's page: one card, its name in the head; Model and Effort rows, then its Instructions.
  await agents(page).getByRole('button', { name: 'Scout' }).click();
  await expect(title(page)).toHaveText('Scout');
  const name = await part(page, 'Model').getByRole('heading', { name: 'Model' }).boundingBox();
  const field = await modelSelect(page).boundingBox();
  if (!name || !field) throw new Error('no box');
  expect(field.x).toBeGreaterThan(name.x + name.width);
  expect(Math.abs(field.y + field.height / 2 - (name.y + name.height / 2))).toBeLessThanOrEqual(4);
  await expect(part(page, 'Instructions').getByText("Scout's system prompt")).toBeVisible();
});

// V51 (decision 388): the theme and the intro, a setting each, under an entry of their own; the
// head keeps only its title.
test('Appearance is an entry of its own: the theme and the intro; listed when the prompts cannot be read', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}settings`);
  await expect(text(page, 'Feature')).toBeVisible();
  const head = page.locator('.settings-bar');
  await expect(head.getByRole('button')).toHaveCount(1);
  await expect(head.getByRole('button', { name: 'About Settings' })).toBeVisible();
  await list(page)
    .getByRole('region', { name: 'This browser' })
    .getByRole('button', { name: 'Appearance' })
    .click();
  await expect(page).toHaveURL(`${symbiote.url}settings?prompt=appearance`);
  const theme = editor(page).getByRole('group', { name: 'Theme' });
  await expect(theme.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
  await theme.getByRole('button', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(editor(page).getByRole('button', { name: 'Play the intro' })).toBeVisible();

  // Without the prompts, Appearance is still there, and open.
  await page.route('**/api/settings/prompts', (route) =>
    route.fulfill({ status: 500, body: 'broken' }),
  );
  await page.goto(`${symbiote.url}settings`);
  await expect(page.getByRole('alert')).toContainText('The prompts could not be read');
  await expect(theme.getByRole('button', { name: 'Light' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

// Scout's effort (fix/scout-effort-level): `scout.effort` in the project's config, the level each
// conversation starts at, set on a stepper of Scout's agent's levels and saved when let go.
test("Scout's page: its Model, Effort and Instructions; the effort a stepper of Claude Code's levels, saved in symbiote/config.json when let go", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  // Null while the server writes it: it truncates the file, then writes it.
  const scout = () => {
    try {
      return (JSON.parse(readFileSync(config(), 'utf8')) as { scout?: Record<string, unknown> })
        .scout;
    } catch {
      return null;
    }
  };
  await page.goto(`${symbiote.url}settings`);
  await agents(page).getByRole('button', { name: 'Scout' }).click();
  await expect(page).toHaveURL(`${symbiote.url}settings?prompt=scout`);
  await expect(editor(page).getByRole('heading')).toHaveText([
    'Scout',
    'Model',
    'Effort',
    "InstructionsSymbiote's",
  ]);
  const effort = part(page, 'Effort').getByRole('slider', { name: 'Effort' });
  await expect(effort).toHaveAttribute('aria-valuetext', "Claude Code's default");
  await expect(stops(effort)).toHaveText(['Default', 'Low', 'Medium', 'High', 'xHigh', 'Max']);
  await dragTo(page, effort, 3);
  await expect(effort).toHaveAttribute('aria-valuetext', 'high');
  await expect(part(page, 'Effort').getByRole('status')).toContainText('Saved.');
  await expect.poll(scout).toEqual({ effort: 'high' });
  // A key steps one level, and saves it; the page reads the prompts' version again after.
  const reread = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/settings/prompts') && response.request().method() === 'GET',
  );
  await effort.press('ArrowLeft');
  await expect.poll(scout).toEqual({ effort: 'medium' });
  await reread;
  // So the Instructions saved after, on the same page, are not refused as changed since.
  await text(page, 'Instructions').fill('Answer briefly.');
  await save(page).click();
  await expect(part(page, 'Instructions').getByRole('status')).toContainText('Saved.');
  expect(prompts()).toEqual({ scout: 'Answer briefly.' });
  await expect(agents(page).getByRole('button', { name: 'Scout' })).toContainText('changed');
  // Its address opens it, as saved.
  await page.reload();
  await expect(effort).toHaveAttribute('aria-valuetext', 'medium');
  await expect(text(page, 'Instructions')).toHaveValue('Answer briefly.');
  // The agent's own default: the key goes, the rest stays.
  await effort.press('Home');
  await expect.poll(scout).toBeUndefined();
  expect(prompts()).toEqual({ scout: 'Answer briefly.' });
});

// The merger's effort (V46d): `merge.effort`, the level each merger agent's run is asked at, on
// the same stepper as Scout's, on the merger's page.
test("the merger's effort: a stepper of its agent's levels, saved as merge.effort when let go", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(config(), '{ "merge": { "checks": ["pnpm check"] } }\n');
  // Null while the server writes it.
  const merge = () => {
    try {
      return (JSON.parse(readFileSync(config(), 'utf8')) as { merge?: Record<string, unknown> })
        .merge;
    } catch {
      return null;
    }
  };
  await page.goto(`${symbiote.url}settings`);
  await agents(page).getByRole('button', { name: 'Merger' }).click();
  await expect(page).toHaveURL(`${symbiote.url}settings?prompt=merger`);
  const effort = part(page, 'Effort').getByRole('slider', { name: 'Effort' });
  await expect(effort).toHaveAttribute('aria-valuetext', "Claude Code's default");
  await expect(stops(effort)).toHaveText(['Default', 'Low', 'Medium', 'High', 'xHigh', 'Max']);
  await dragTo(page, effort, 3);
  await expect(effort).toHaveAttribute('aria-valuetext', 'high');
  await expect(part(page, 'Effort').getByRole('status')).toHaveText(
    "Saved. The merger agent's next run is asked at high.",
  );
  // Beside the merge's other settings, which stay.
  await expect.poll(merge).toEqual({ checks: ['pnpm check'], effort: 'high' });
  await page.reload();
  await expect(effort).toHaveAttribute('aria-valuetext', 'high');
  await effort.press('Home');
  await expect.poll(merge).toEqual({ checks: ['pnpm check'] });
  // A level its agent does not list is said.
  writeFileSync(config(), '{ "merge": { "effort": "ultra" } }\n');
  await page.reload();
  await expect(part(page, 'Effort').getByRole('alert')).toHaveText(
    'merge.effort is ultra, which Claude Code does not list: the merger runs it at its default.',
  );
});

test("Scout's effort: a level its agent does not list is said, and Scout starts at the agent's default", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(config(), '{ "scout": { "effort": "ultra" } }\n');
  await page.goto(`${symbiote.url}settings?prompt=scout`);
  await expect(part(page, 'Effort').getByRole('alert')).toHaveText(
    'scout.effort is ultra, which Claude Code does not list: Scout starts it at its default.',
  );
  await expect(part(page, 'Effort').getByRole('slider', { name: 'Effort' })).toHaveAttribute(
    'aria-valuetext',
    "Claude Code's default",
  );
});

// Scout's, Scribe's and the merger's model (V47): from their agent's own list, saved in the
// project's config when picked; their Effort follows it.
const section =
  <T>(name: string) =>
  (): T | null | undefined => {
    try {
      return (JSON.parse(readFileSync(config(), 'utf8')) as Record<string, T>)[name];
    } catch {
      // Null while the server writes it.
      return null;
    }
  };
const modelSelect = (page: Page) => part(page, 'Model').getByRole('combobox', { name: 'Model' });

test("Scout's model: Claude Code's own list, saved as scout.model when picked; the Effort beside it and the next conversation follow it", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  const scout = section<Record<string, unknown>>('scout');
  await page.goto(`${symbiote.url}settings`);
  await agents(page).getByRole('button', { name: 'Scout' }).click();
  await expect(page).toHaveURL(`${symbiote.url}settings?prompt=scout`);
  await expect(modelSelect(page).locator('option')).toHaveText([
    "Claude Code's default",
    'Opus 5.5',
    'Sonnet 5.5',
    'Haiku 4.5',
    'Opus 4.6',
  ]);
  // xhigh, on Claude Code's default model.
  const effort = part(page, 'Effort').getByRole('slider', { name: 'Effort' });
  await dragTo(page, effort, 4);
  await expect.poll(scout).toEqual({ effort: 'xhigh' });
  await modelSelect(page).selectOption({ label: 'Opus 4.6' });
  await expect(part(page, 'Model').getByRole('status')).toHaveText(
    "Saved. Scout's next conversation starts on Opus 4.6.",
  );
  await expect.poll(scout).toEqual({ effort: 'xhigh', model: 'claude-opus-4-6' });
  await expect(part(page, 'Model').locator('.settings-row-note')).toHaveText(
    'Best for everyday, complex tasks',
  );
  // The Effort beside it follows at once: Opus 4.6 has no xhigh, so Scout starts at the default.
  await expect(stops(effort)).toHaveText(['Default', 'Low', 'Medium', 'High', 'Max']);
  await expect(effort).toHaveAttribute('aria-valuetext', "Claude Code's default");
  await expect(part(page, 'Effort').getByRole('alert')).toHaveText(
    'scout.effort is xhigh, which Claude Code does not list: Scout starts it at its default.',
  );
  // The next conversation starts on it, opened with the page (V50), and its line says so (V78).
  await page.goto(`${symbiote.url}scout`);
  const scoutPage = page.getByRole('region', { name: 'Scout' });
  await expect
    .poll(() => symbiote.calls().find((call) => call.args.includes('Scout'))?.args ?? [])
    .toEqual(expect.arrayContaining(['--model', 'claude-opus-4-6']));
  await expect(scoutPage.locator('.scout-about')).toContainText('with Claude Code on Opus 4.6');
  // Back to the default: the key goes.
  await page.goto(`${symbiote.url}settings?prompt=scout`);
  await expect(modelSelect(page)).toHaveValue('claude-opus-4-6');
  await modelSelect(page).selectOption({ label: "Claude Code's default" });
  await expect.poll(scout).toEqual({ effort: 'xhigh' });
});

test("the merger's model: Symbiote's sonnet named as its default; merge.model saved, one written by hand said", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(config(), '{ "merge": { "checks": ["pnpm check"] } }\n');
  const merge = section<Record<string, unknown>>('merge');
  await page.goto(`${symbiote.url}settings?prompt=merger`);
  await expect(modelSelect(page).locator('option').first()).toHaveText(
    "Symbiote's default (Sonnet 5.5)",
  );
  await modelSelect(page).selectOption({ label: 'Opus 5.5' });
  await expect(part(page, 'Model').getByRole('status')).toHaveText(
    "Saved. The merger agent's next run is asked on Opus 5.5.",
  );
  await expect.poll(merge).toEqual({ checks: ['pnpm check'], model: 'opus' });
  // A full name Claude Code takes but does not list: passed as written (decision 343), and said.
  writeFileSync(config(), '{ "merge": { "model": "claude-sonnet-4-5-20250929" } }\n');
  await page.reload();
  await expect(part(page, 'Model').getByRole('alert')).toHaveText(
    'merge.model is claude-sonnet-4-5-20250929, which Claude Code does not list: the merger asks on it as written.',
  );
});

// Scribe's effort (fix/scribe-effort-level): `scribe.effort`, the level each of its conversations
// starts at, as Scout's.
test("Scribe's page: its Model, Effort and Instructions; saved as scribe.model and scribe.effort", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  const scribe = section<Record<string, unknown>>('scribe');
  await page.goto(`${symbiote.url}settings`);
  await agents(page).getByRole('button', { name: 'Scribe' }).click();
  await expect(page).toHaveURL(`${symbiote.url}settings?prompt=scribe`);
  await expect(editor(page).getByRole('heading')).toHaveText([
    'Scribe',
    'Model',
    'Effort',
    "InstructionsSymbiote's",
    'Placeholders',
    // What its {library} becomes when a skill library is set (SK1).
    "LibrarySymbiote's",
    'Placeholders',
  ]);
  await modelSelect(page).selectOption({ label: 'Sonnet 5.5' });
  await expect.poll(scribe).toEqual({ model: 'sonnet' });
  const effort = part(page, 'Effort').getByRole('slider', { name: 'Effort' });
  await expect(effort).toHaveAttribute('aria-valuetext', "Claude Code's default");
  await expect(stops(effort)).toHaveText(['Default', 'Low', 'Medium', 'High', 'xHigh', 'Max']);
  await dragTo(page, effort, 3);
  await expect(part(page, 'Effort').getByRole('status')).toHaveText(
    "Saved. Scribe's next conversation starts at high.",
  );
  await expect.poll(scribe).toEqual({ model: 'sonnet', effort: 'high' });
  // Scout's is not Scribe's.
  await expect.poll(section('scout')).toBeUndefined();
  await page.reload();
  await expect(effort).toHaveAttribute('aria-valuetext', 'high');
  // Home: the agent's own, and the key goes.
  await effort.press('Home');
  await expect.poll(scribe).toEqual({ model: 'sonnet' });
  // One its agent does not list: said, and Scribe starts at the agent's default.
  writeFileSync(config(), '{ "scribe": { "effort": "ultra" } }\n');
  await page.reload();
  await expect(part(page, 'Effort').getByRole('alert')).toHaveText(
    'scribe.effort is ultra, which Claude Code does not list: Scribe starts it at its default.',
  );
  await expect(effort).toHaveAttribute('aria-valuetext', "Claude Code's default");
});

// The advisor's model and level on each agent (V75c, decision 556): Suggest settings' page, a
// section for Claude Code and one for Codex above its instructions, saved as advisor.<agent>; the
// next suggestion runs on them.
test("Suggest settings' page: a Model and an Effort for each agent, saved as advisor.<agent>; the next suggestion asks on them", async ({
  page,
}) => {
  symbiote = await serveWorkspaces({ codex: true, appServer: true });
  const advisor = section<Record<string, unknown>>('advisor');
  await page.goto(`${symbiote.url}settings`);
  await entry(page, 'Suggest settings').click();
  await expect(page).toHaveURL(`${symbiote.url}settings?prompt=advisor`);
  await expect(editor(page).getByRole('heading')).toHaveText([
    'Workspaces: Suggest settings',
    'Claude Code',
    'Model',
    'Effort',
    'Codex',
    'Model',
    'Effort',
    "InstructionsSymbiote's",
    'Placeholders',
  ]);
  const claude = editor(page).getByRole('region', { name: 'Claude Code' });
  const codex = editor(page).getByRole('region', { name: 'Codex' });
  const model = (agent: Locator) => agent.getByRole('combobox', { name: 'Model' });
  const effort = (agent: Locator) => agent.getByRole('slider', { name: 'Effort' });
  // Codex lists its small model: Symbiote's default, at Symbiote's low.
  await expect(model(codex).locator('option')).toHaveText([
    "Symbiote's default (GPT-6-Luna)",
    'GPT-6-Luna',
    'GPT-5.6-Terra',
    'GPT-5.6-Luna',
  ]);
  await expect(effort(codex)).toHaveAttribute('aria-valuetext', "Symbiote's default (low)");
  // This Claude Code lists no Haiku 5.5: the advisor asks on its default model.
  await expect(model(claude).locator('option').first()).toHaveText("Claude Code's default");
  await expect(effort(claude)).toHaveAttribute('aria-valuetext', "Claude Code's default");

  await model(claude).selectOption({ label: 'Sonnet 5.5' });
  await expect(claude.getByRole('region', { name: 'Model' }).getByRole('status')).toHaveText(
    'Saved. With Claude Code picked, Suggest settings asks Sonnet 5.5.',
  );
  await expect.poll(advisor).toEqual({ claude: { model: 'sonnet' } });
  // On Sonnet 5.5, Symbiote's low is the default level.
  await expect(effort(claude)).toHaveAttribute('aria-valuetext', "Symbiote's default (low)");
  await dragTo(page, effort(claude), 2);
  await expect(claude.getByRole('region', { name: 'Effort' }).getByRole('status')).toHaveText(
    'Saved. With Claude Code picked, Suggest settings asks at medium.',
  );
  await expect.poll(advisor).toEqual({ claude: { model: 'sonnet', effort: 'medium' } });
  await model(codex).selectOption({ label: 'GPT-5.6-Terra' });
  await expect.poll(advisor).toEqual({
    claude: { model: 'sonnet', effort: 'medium' },
    codex: { model: 'gpt-5.6-terra' },
  });
  await expect(stops(effort(codex))).toHaveText([
    'Default',
    'Low',
    'Medium',
    'High',
    'xHigh',
    'Max',
    'Ultra',
  ]);
  await page.reload();
  await expect(model(claude)).toHaveValue('sonnet');
  await expect(effort(claude)).toHaveAttribute('aria-valuetext', 'medium');

  // The next suggestion with Claude Code asks Sonnet 5.5 at medium, and says so.
  symbiote.advise({ model: 'opus', effort: 'high', planFirst: true, why: 'A migration.' });
  await page.goto(`${symbiote.url}start`);
  const start = page.getByRole('region', { name: 'Start a workspace' });
  await start.getByRole('textbox', { name: 'Title' }).fill('Move workspace records to SQLite');
  await start.getByRole('textbox', { name: 'Goal' }).fill('Move the records to one database.');
  await start.getByRole('button', { name: 'Suggest settings' }).click();
  await expect(start.locator('.start-proposal')).toContainText(
    'Sonnet 5.5 suggests Opus 5.5 at high effort, plan first',
  );
  expect(symbiote.adviceCalls()[0]?.args.slice(0, 5)).toEqual([
    '-p',
    '--model',
    'sonnet',
    '--effort',
    'medium',
  ]);

  // Back to Symbiote's: the keys go. A model written by hand that Claude Code does not list is said.
  await page.goto(`${symbiote.url}settings?prompt=advisor`);
  await model(claude).selectOption({ label: "Claude Code's default" });
  await effort(claude).press('Home');
  await model(codex).selectOption({ label: "Symbiote's default (GPT-6-Luna)" });
  await expect.poll(advisor).toBeUndefined();
  writeFileSync(config(), '{ "advisor": { "claude": { "model": "gpt-6-luna" } } }\n');
  await page.reload();
  await expect(claude.getByRole('region', { name: 'Model' }).getByRole('alert')).toHaveText(
    'advisor.claude.model is gpt-6-luna, which Claude Code does not list: Suggest settings asks on the default.',
  );
});
