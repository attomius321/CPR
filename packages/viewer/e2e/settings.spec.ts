import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
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
const editor = (page: Page) => page.locator('.settings-editor');
const text = (page: Page, title: string) =>
  editor(page).getByRole('textbox', { name: `${title} prompt` });
const save = (page: Page) => editor(page).getByRole('button', { name: 'Save', exact: true });
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
  await expect(page.locator('.settings-git')).toHaveText(
    "No prompt changed: every agent is told Symbiote's text.",
  );
  // 14 prompts and Scout's effort.
  await expect(list(page).getByRole('button')).toHaveCount(15);
  // The first is open; each group in its order (Scout's since V35).
  await expect(entry(page, 'Feature')).toHaveAttribute('aria-current', 'true');
  await expect(list(page).getByRole('heading')).toHaveText([
    'Workspaces',
    'Reviews',
    'Merger',
    'Scout',
  ]);

  await entry(page, 'Fix').click();
  await expect(page).toHaveURL(`${symbiote.url}settings?prompt=start.fix`);
  await expect(editor(page).getByRole('heading')).toHaveText("Workspaces: FixSymbiote's");
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
  await expect(editor(page).getByRole('heading')).toHaveText("Workspaces: FixThe project's");
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
  await form.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Started fix/dates-sort-as-text');
  const told = symbiote.calls().at(-1)?.args.at(-1) ?? '';
  expect(told).toMatch(/^Fix it on fix\/dates-sort-as-text\.\n\n# Fix: Dates sort as text\n/);
  expect(told).toMatch(/\n\nRun the tests before you say it is ready\.\n$/);
  expect(told).not.toContain('Reproduce it first');

  // Reset: Symbiote's text again, and nothing left in the file.
  await page.goto(`${symbiote.url}settings?prompt=start.fix`);
  await editor(page).getByRole('button', { name: "Reset to Symbiote's" }).click();
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
  await page.getByRole('link', { name: 'History' }).click();
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
  await editor(page).getByRole('button', { name: 'Discard changes' }).click();
  await expect(text(page, 'Spike')).toHaveValue(/Commit it under spikes\/\.$/);
  await expect(entry(page, 'Spike')).toContainText('changed');
});

test("shows the merger's answer format, which a project cannot change, and no placeholders", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}settings?prompt=merger`);
  await expect(editor(page).getByRole('heading')).toHaveText("Merger: InstructionsSymbiote's");
  await expect(text(page, 'Instructions')).toHaveValue(
    /^You resolve merge conflicts for Symbiote\./,
  );
  await expect(editor(page).locator('.settings-fixed pre')).toContainText(
    'Answer with one JSON object and nothing else:',
  );
  await expect(editor(page)).toContainText('No placeholders: the agent is given it as written.');
});

test('on a phone, the list first; a prompt takes the page, and comes back to the list', async ({
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
  await editor(page).getByRole('button', { name: 'All prompts' }).click();
  await expect(list(page)).toBeVisible();
  await expect(page).toHaveURL(`${symbiote.url}settings`);
  // Nothing wider than the screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

// Scout's effort (fix/scout-effort-level): `scout.effort` in the project's config, the level each
// conversation starts at, set on a stepper of Scout's agent's levels and saved when let go.
test("Scout's effort: a stepper of Claude Code's levels, saved in symbiote/config.json when let go", async ({
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
  const group = list(page).getByRole('region', { name: 'Scout' });
  await expect(group.getByRole('button')).toHaveText(['Instructions', 'Effort']);
  await group.getByRole('button', { name: 'Effort' }).click();
  await expect(page).toHaveURL(`${symbiote.url}settings?prompt=scout.effort`);
  await expect(editor(page).getByRole('heading')).toHaveText('Scout: Effort');
  const effort = editor(page).getByRole('slider', { name: 'Effort' });
  await expect(effort).toHaveAttribute('aria-valuetext', "Claude Code's default");
  await expect(stops(effort)).toHaveText(['Default', 'low', 'medium', 'high', 'xhigh', 'max']);
  await dragTo(page, effort, 3);
  await expect(effort).toHaveAttribute('aria-valuetext', 'high');
  await expect(editor(page).getByRole('status')).toContainText('Saved.');
  await expect.poll(scout).toEqual({ effort: 'high' });
  // A key steps one level, and saves it.
  await effort.press('ArrowLeft');
  await expect.poll(scout).toEqual({ effort: 'medium' });
  // Its address opens it, as saved.
  await page.reload();
  await expect(editor(page).getByRole('slider', { name: 'Effort' })).toHaveAttribute(
    'aria-valuetext',
    'medium',
  );
  // The prompts' version follows: a prompt saved after is not refused as changed since.
  await list(page)
    .getByRole('region', { name: 'Scout' })
    .getByRole('button', { name: 'Instructions' })
    .click();
  await text(page, 'Instructions').fill('Answer briefly. {question}');
  await save(page).click();
  await expect(editor(page).getByRole('status')).toContainText('Saved.');
  expect(prompts()).toEqual({ scout: 'Answer briefly. {question}' });
  // The agent's own default: the key goes, the rest stays.
  await list(page)
    .getByRole('region', { name: 'Scout' })
    .getByRole('button', { name: 'Effort' })
    .click();
  await editor(page).getByRole('slider', { name: 'Effort' }).press('Home');
  await expect.poll(scout).toBeUndefined();
  expect(prompts()).toEqual({ scout: 'Answer briefly. {question}' });
});

test("Scout's effort: a level its agent does not list is said, and Scout starts at the agent's default", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(config(), '{ "scout": { "effort": "ultra" } }\n');
  await page.goto(`${symbiote.url}settings?prompt=scout.effort`);
  await expect(editor(page).getByRole('alert')).toHaveText(
    'scout.effort is ultra, which Claude Code does not list: Scout starts it at its default.',
  );
  await expect(editor(page).getByRole('slider', { name: 'Effort' })).toHaveAttribute(
    'aria-valuetext',
    "Claude Code's default",
  );
});
