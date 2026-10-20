import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './cpr.js';

// Settings (V28b): every agent's prompts, CPR's until changed, saved in the project's
// cpr/config.json and told to the next agent — a fake Claude Code, never a real one.
let cpr: RunningWorkspaces;
const errors: string[] = [];

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  cpr.stop();
  expect(errors).toEqual([]);
});

const list = (page: Page) => page.getByRole('navigation', { name: 'Prompts' });
const entry = (page: Page, name: string) => list(page).getByRole('button', { name });
const editor = (page: Page) => page.locator('.settings-editor');
const text = (page: Page, title: string) =>
  editor(page).getByRole('textbox', { name: `${title} prompt` });
const save = (page: Page) => editor(page).getByRole('button', { name: 'Save', exact: true });
const config = () => join(cpr.repo, 'cpr', 'config.json');
const prompts = () =>
  (JSON.parse(readFileSync(config(), 'utf8')) as { prompts?: Record<string, unknown> }).prompts;

const FIX = 'Fix it on {branch}.\n\n{brief}\n\nRun the tests before you say it is ready.\n\n';

test("changes the Fix prompt; the next Fix workspace's agent is told it; Reset gives CPR's back", async ({
  page,
}) => {
  cpr = await serveWorkspaces();
  await page.goto(cpr.url);
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('s');
  await expect(page).toHaveURL(`${cpr.url}settings`);
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('.settings-git')).toHaveText(
    "No prompt changed: every agent is told CPR's text.",
  );
  await expect(list(page).getByRole('button')).toHaveCount(13);
  // The first is open; each group in its order.
  await expect(entry(page, 'Feature')).toHaveAttribute('aria-current', 'true');
  await expect(list(page).getByRole('heading')).toHaveText(['Workspaces', 'Reviews', 'Merger']);

  await entry(page, 'Fix').click();
  await expect(page).toHaveURL(`${cpr.url}settings?prompt=start.fix`);
  await expect(editor(page).getByRole('heading')).toHaveText("Workspaces: FixCPR's");
  await expect(text(page, 'Fix')).toHaveValue(/Reproduce it first, with a failing test/);

  await text(page, 'Fix').fill(FIX);
  await expect(entry(page, 'Fix')).toContainText('not saved');
  // A placeholder goes in at the cursor.
  await text(page, 'Fix').press('Control+Home');
  await editor(page).getByRole('button', { name: '{plan}' }).click();
  await expect(text(page, 'Fix')).toHaveValue(`{plan}${FIX}`);
  // Without the brief it cannot be saved.
  await text(page, 'Fix').fill('Fix it on {branch}.');
  await expect(editor(page).locator('.settings-size')).toHaveText(
    "{brief} is missing: the agent would not be given the person's brief, as the start dialog made it.",
  );
  await expect(save(page)).toBeDisabled();
  await text(page, 'Fix').fill(FIX);
  await save(page).click();
  await expect(editor(page).getByRole('status')).toHaveText(
    'Saved. Saved in cpr/config.json, not committed: commit it to share the prompts with ' +
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
  await page.goto(cpr.url);
  await page.getByRole('button', { name: 'Start a workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a workspace' });
  await dialog.getByRole('radio', { name: 'Fix' }).click();
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Dates sort as text');
  await dialog.getByRole('textbox', { name: 'What happens' }).fill('They sort 1, 10, 2.');
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Started fix/dates-sort-as-text');
  const told = cpr.calls().at(-1)?.args.at(-1) ?? '';
  expect(told).toMatch(/^Fix it on fix\/dates-sort-as-text\.\n\n# Fix: Dates sort as text\n/);
  expect(told).toMatch(/\n\nRun the tests before you say it is ready\.\n$/);
  expect(told).not.toContain('Reproduce it first');

  // Reset: CPR's text again, and nothing left in the file.
  await page.goto(`${cpr.url}settings?prompt=start.fix`);
  await editor(page).getByRole('button', { name: "Reset to CPR's" }).click();
  await editor(page).getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(editor(page).getByRole('status')).toContainText("CPR's text again.");
  await expect(text(page, 'Fix')).toHaveValue(/Reproduce it first/);
  expect(prompts()).toBeUndefined();
});

test('keeps drafts across prompts, asks before leaving with one, and refuses a stale save', async ({
  page,
}) => {
  cpr = await serveWorkspaces();
  await page.goto(`${cpr.url}settings?prompt=start.spike`);
  await text(page, 'Spike').fill('Spike {branch}.\n\n{brief}\n\nCommit it under spikes/.');
  await entry(page, 'Chore').click();
  await expect(text(page, 'Chore')).toHaveValue(/Keep to what is asked/);
  await entry(page, 'Spike').click();
  await expect(text(page, 'Spike')).toHaveValue(/Commit it under spikes\/\.$/);
  await expect(entry(page, 'Spike')).toContainText('not saved');

  // Leaving with it asks first; staying keeps it. In the shell (V29a) the page is not unloaded:
  // the shell asks, in a dialog of CPR's own (N1c), not the browser's.
  await page.getByRole('link', { name: 'History' }).click();
  const asking = page.getByRole('alertdialog', { name: 'Leave Settings?' });
  await expect(asking).toContainText('A prompt is changed and not saved.');
  await asking.getByRole('button', { name: 'Stay' }).click();
  await expect(asking).toBeHidden();
  await expect(page).toHaveURL(`${cpr.url}settings?prompt=start.spike`);
  await expect(text(page, 'Spike')).toHaveValue(/Commit it under spikes\/\.$/);

  // Changed elsewhere since the page read it: refused, read again, the draft kept, saved.
  mkdirSync(join(cpr.repo, 'cpr'), { recursive: true });
  writeFileSync(config(), '{\n  "prompts": { "plan": { "direct": "Just do it." } }\n}\n');
  await save(page).click();
  await expect(editor(page).getByRole('status')).toContainText(
    'cpr/config.json changed since you opened it',
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
  cpr = await serveWorkspaces();
  await page.goto(`${cpr.url}settings?prompt=merger`);
  await expect(editor(page).getByRole('heading')).toHaveText("Merger: InstructionsCPR's");
  await expect(text(page, 'Instructions')).toHaveValue(/^You resolve merge conflicts for CPR\./);
  await expect(editor(page).locator('.settings-fixed pre')).toContainText(
    'Answer with one JSON object and nothing else:',
  );
  await expect(editor(page)).toContainText('No placeholders: the agent is given it as written.');
});

test('on a phone, the list first; a prompt takes the page, and comes back to the list', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  cpr = await serveWorkspaces();
  await page.goto(`${cpr.url}settings`);
  await expect(list(page)).toBeVisible();
  await expect(editor(page)).toBeHidden();
  await entry(page, 'cpr/AGENTS.md').click();
  await expect(list(page)).toBeHidden();
  await expect(text(page, 'cpr/AGENTS.md')).toHaveValue(/^# CPR reviews/);
  await editor(page).getByRole('button', { name: '← All prompts' }).click();
  await expect(list(page)).toBeVisible();
  await expect(page).toHaveURL(`${cpr.url}settings`);
  // Nothing wider than the screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
