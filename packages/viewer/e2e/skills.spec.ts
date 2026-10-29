import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// Skills (V41a): the checkout's skills listed, edited, checked, added, deleted and linked for
// Codex, in the repository `symbiote view` runs in.
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

const REVIEW =
  '---\nname: review\ndescription: Reviews a change. Use when asked to review a branch.\n---\n\n# Review\n\nRead the tests first.\n';
const STYLE =
  '---\nname: style\ndescription: The look of the pages. Use when changing CSS.\n---\n\n# Style\n\nSee [tokens](tokens.md).\n';

/** Writes files into the repository and commits them. */
function commit(files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(symbiote.repo, path)), { recursive: true });
    writeFileSync(join(symbiote.repo, path), text);
  }
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Test', ...args], { cwd: symbiote.repo, stdio: 'pipe' });
  git('add', '--all');
  git('commit', '-q', '-m', 'Skills');
}

const list = (page: Page) => page.getByRole('navigation', { name: 'Skills' });
const entry = (page: Page, name: string) => list(page).getByRole('button', { name });
const editor = (page: Page) => page.locator('.skills-editor');
const text = (page: Page, name: string) =>
  editor(page).getByRole('textbox', { name: `${name} SKILL.md` });
const file = (path: string) => readFileSync(join(symbiote.repo, path), 'utf8');

test('lists the skills, checks one as it is typed, saves it, and refuses a save over a newer file', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  commit({
    '.claude/skills/review/SKILL.md': REVIEW,
    '.claude/skills/style/SKILL.md': STYLE,
    '.claude/skills/style/tokens.md': '# Tokens\n',
  });
  await page.goto(symbiote.url);
  await expect(page.getByRole('link', { name: 'Skills' })).toBeVisible();
  await page.keyboard.press('i');
  await expect(page).toHaveURL(`${symbiote.url}skills`);
  await expect(page.getByRole('link', { name: 'Skills' })).toHaveAttribute('aria-current', 'page');
  // Scribe first, in Agent; then the skills, in Skills (V64).
  await expect(list(page).getByRole('heading')).toHaveText(['Agent', 'Skills']);
  await expect(list(page).getByRole('button')).toHaveText(['Scribe', 'review', 'style']);
  // The first is open, with nothing to say of it.
  await expect(entry(page, 'review')).toHaveAttribute('aria-current', 'true');
  await expect(text(page, 'review')).toHaveValue(REVIEW);
  await expect(editor(page).locator('.skills-where')).toContainText(
    '.claude/skills/review/SKILL.md · read by Claude Code · Shared: committed as it is.',
  );
  await expect(editor(page).locator('.skills-checks-none')).toBeVisible();

  await entry(page, 'style').click();
  await expect(page).toHaveURL(`${symbiote.url}skills?skill=.claude%2Fskills%2Fstyle%2FSKILL.md`);
  await expect(editor(page).locator('.skills-files li')).toHaveText(['tokens.md']);
  // Checked as it is typed: a link to a file it does not have, then no frontmatter at all.
  await text(page, 'style').fill(STYLE.replace('tokens.md', 'colours.md'));
  await expect(editor(page).locator('.skills-checks li')).toHaveText([
    'Links to colours.md, which is not in the skill’s folder.',
  ]);
  await expect(entry(page, 'style')).toContainText('not saved');
  await text(page, 'style').fill('# Style\n');
  await expect(editor(page).locator('.skills-checks li.error')).toContainText('No frontmatter');

  // Saved in place, with Ctrl+S; git says it is changed.
  const changed = `${STYLE}\nKeep 8 px radii.\n`;
  await text(page, 'style').fill(changed);
  await text(page, 'style').press('Control+s');
  await expect(editor(page).locator('.skills-notice')).toHaveText(
    'Saved. Changes not committed: commit them to share them.',
  );
  expect(file('.claude/skills/style/SKILL.md')).toBe(changed);
  await expect(entry(page, 'style')).toContainText('changed');

  // Written elsewhere since it was read (by an editor, by Scribe): the save is refused, the draft
  // kept; read again, it saves.
  writeFileSync(join(symbiote.repo, '.claude/skills/style/SKILL.md'), `${changed}Elsewhere.\n`);
  await text(page, 'style').fill(`${changed}Here.\n`);
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor(page).locator('.skills-notice')).toContainText(
    '.claude/skills/style/SKILL.md changed since you opened it',
  );
  await editor(page).getByRole('button', { name: 'Read it again' }).click();
  await expect(text(page, 'style')).toHaveValue(`${changed}Here.\n`);
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor(page).locator('.skills-notice')).toContainText('Saved.');
  expect(file('.claude/skills/style/SKILL.md')).toBe(`${changed}Here.\n`);

  // Leaving with a draft asks first.
  await text(page, 'style').fill('draft');
  await page.getByRole('link', { name: 'Git' }).click();
  const asking = page.getByRole('alertdialog', { name: 'Leave Skills?' });
  await expect(asking).toBeVisible();
  await asking.getByRole('button', { name: 'Stay' }).click();
  await expect(page).toHaveURL(/skills/);
});

test('makes a new skill from its name and description, then deletes it', async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}skills`);
  // No skill yet: the form for the first one.
  await expect(list(page)).toContainText('No skills in this checkout yet.');
  const form = page.getByRole('form', { name: 'New skill' });
  await expect(form).toBeVisible();
  const create = form.getByRole('button', { name: 'Create' });
  await expect(create).toBeDisabled();
  await form.getByRole('textbox', { name: 'Name' }).fill('Release');
  await expect(form.locator('.skills-size')).toHaveText(
    'a name holds only lowercase letters, digits and hyphens',
  );
  await form.getByRole('textbox', { name: 'Name' }).fill('release-notes');
  await form
    .getByRole('textbox', { name: 'Description' })
    .fill('Writes release notes from merged branches: use when asked for release notes.');
  await expect(form.locator('.skills-size')).toHaveText('76 of 1,024 characters');
  await create.click();

  await expect(entry(page, 'release-notes')).toHaveAttribute('aria-current', 'true');
  await expect(entry(page, 'release-notes')).toContainText('new');
  expect(file('.claude/skills/release-notes/SKILL.md')).toBe(
    '---\nname: release-notes\ndescription: "Writes release notes from merged branches: use when asked for release notes."\n---\n',
  );
  await expect(editor(page).locator('.skills-notice')).toHaveText(
    'Made .claude/skills/release-notes/SKILL.md. Write its instructions under the frontmatter, then save.',
  );
  await expect(editor(page).locator('.skills-checks li')).toHaveText([
    'No instructions after the frontmatter: the skill gives an agent nothing when it is picked.',
  ]);

  await editor(page).getByRole('button', { name: 'Delete…' }).click();
  await expect(editor(page).locator('.workspace-confirm')).toContainText(
    'Deletes .claude/skills/release-notes, not committed: it is gone for good.',
  );
  await editor(page).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(list(page)).toContainText('No skills in this checkout yet.');
  await expect(form).toBeVisible();
  expect(existsSync(join(symbiote.repo, '.claude/skills/release-notes'))).toBe(false);
});

test('links .agents/skills to .claude/skills for Codex, which then reads them', async ({
  page,
}) => {
  symbiote = await serveWorkspaces({ codex: true });
  commit({ '.claude/skills/review/SKILL.md': REVIEW });
  await page.goto(`${symbiote.url}skills`);
  await expect(page.locator('.skills-codex')).toContainText(
    'Codex reads .agents/skills, not .claude/skills: it sees none of these skills.',
  );
  await page.getByRole('button', { name: 'Link for Codex', exact: true }).click();
  await expect(page.locator('.skills > .skills-note[role="status"]')).toHaveText(
    'Linked: Codex reads .agents/skills, now .claude/skills. The link is not committed: commit it to share it.',
  );
  await expect(page.locator('.skills-codex')).toHaveCount(0);
  await expect(list(page).getByRole('heading')).toHaveText(['Agent', 'Skills']);
  const link = join(symbiote.repo, '.agents/skills');
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(readlinkSync(link)).toBe('../.claude/skills');
  await expect(editor(page).locator('.skills-where')).toContainText(
    'read by Claude Code and Codex',
  );
});

test('on a phone, the list first; a skill takes the page, and goes back to the list', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  symbiote = await serveWorkspaces();
  commit({ '.claude/skills/review/SKILL.md': REVIEW, '.claude/skills/style/SKILL.md': STYLE });
  await page.goto(`${symbiote.url}skills`);
  await expect(list(page)).toBeVisible();
  await expect(editor(page)).toBeHidden();
  await entry(page, 'style').click();
  await expect(list(page)).toBeHidden();
  await expect(text(page, 'style')).toBeVisible();
  const wide = await page.evaluate(
    () =>
      [...document.querySelectorAll('.skills *')].filter(
        (element) => element.getBoundingClientRect().right > window.innerWidth + 1,
      ).length,
  );
  expect(wide).toBe(0);
  await editor(page).getByRole('button', { name: 'All skills' }).click();
  await expect(list(page)).toBeVisible();
});

// V56 (decisions 407–409): Skills is drawn with rules of its own (not Settings') over the whole
// main area. V64 (decision 458): Settings' head and spacing, the list 280 px; the page frame's
// since V72 (decision 508), the cards 16 px from the main area's edges (24 before) and 16 apart;
// the checks a card beside the skill where its area is 960 px wide, under it on a narrower one
// (decision 462).
test('uses the whole main area: the list at its left, the skill to its right and bottom', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  commit({
    '.claude/skills/review/SKILL.md': REVIEW,
    '.claude/skills/style/SKILL.md': STYLE,
    '.claude/skills/style/tokens.md': '# Tokens\n',
  });
  for (const [width, height] of [
    [1280, 720],
    [1440, 900],
    [1920, 1080],
    [2560, 1440],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`${symbiote.url}skills?skill=.claude%2Fskills%2Fstyle%2FSKILL.md`);
    await expect(text(page, 'style')).toBeVisible();
    const main = await page.locator('.shell-main').boundingBox();
    const l = await list(page).boundingBox();
    const e = await editor(page).boundingBox();
    const card = await editor(page).locator('.skills-card').boundingBox();
    const checks = await editor(page).locator('.skills-checks-card').boundingBox();
    const heading = await page.getByRole('heading', { name: 'Skills', level: 1 }).boundingBox();
    const icon = await page.locator('.skills-bar .page-icon').boundingBox();
    const add = await page.getByRole('button', { name: 'New skill' }).boundingBox();
    if (!main || !l || !e || !card || !checks || !heading || !icon || !add) {
      throw new Error('no box');
    }
    expect(Math.abs(l.x - main.x - 16)).toBeLessThanOrEqual(1);
    expect(Math.round(l.width)).toBe(280);
    expect(Math.abs(card.x - (l.x + l.width) - 16)).toBeLessThanOrEqual(1);
    expect(Math.abs(e.x + e.width - (main.x + main.width - 16))).toBeLessThanOrEqual(1);
    expect(Math.abs(e.y + e.height - (main.y + main.height - 16))).toBeLessThanOrEqual(1);
    // The head as Settings': its icon over the list's edge, New skill over the skill's.
    expect(Math.abs(icon.x - l.x)).toBeLessThanOrEqual(1);
    expect(heading.x).toBeGreaterThan(icon.x + icon.width);
    expect(Math.abs(add.x + add.width - (e.x + e.width))).toBeLessThanOrEqual(1);
    if (width >= 1920) {
      expect(checks.x).toBeGreaterThanOrEqual(card.x + card.width + 15);
      expect(Math.abs(checks.y - card.y)).toBeLessThanOrEqual(1);
    } else {
      expect(checks.y).toBeGreaterThanOrEqual(card.y + card.height + 15);
    }
  }
  // None of Settings' rules.
  await expect(page.locator('.skills[class*="settings"], .skills [class*="settings"]')).toHaveCount(
    0,
  );
  await expect(editor(page).getByRole('textbox')).toHaveCount(1);
});

// V64 (decision 458): the head as Settings' (the brief: "its icon and title, no breadcrumbs").
test('the head: the Skills icon, its title and line, and New skill as the primary', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  commit({ '.claude/skills/review/SKILL.md': REVIEW });
  await page.goto(`${symbiote.url}skills`);
  const head = page.locator('.skills-bar');
  await expect(head.locator('.page-icon svg')).toBeVisible();
  await expect(head.getByRole('heading', { level: 1 })).toHaveText('Skills');
  await expect(head.locator('.page-line')).toHaveText(
    "What your agents load for a kind of work: this checkout's skills and your library's.",
  );
  await expect(head).not.toContainText('Symbiote');
  // The primary: the S's violet, dark words.
  await expect(head.getByRole('button', { name: 'New skill' })).toHaveCSS(
    'background-color',
    'rgb(124, 104, 252)',
  );
  await expect(editor(page).getByRole('button', { name: 'Save', exact: true })).toHaveCSS(
    'background-color',
    'rgb(124, 104, 252)',
  );
});

// V64 (decision 459): a search over the skills' names and descriptions.
test('the search keeps the skills whose name or description holds it', async ({ page }) => {
  symbiote = await serveWorkspaces();
  commit({ '.claude/skills/review/SKILL.md': REVIEW, '.claude/skills/style/SKILL.md': STYLE });
  await page.goto(`${symbiote.url}skills`);
  const search = list(page).getByRole('searchbox', { name: 'Search skills' });
  await search.fill('sty');
  await expect(list(page).getByRole('button')).toHaveText(['Scribe', 'style']);
  // By its description: "Use when changing CSS."
  await search.fill('css');
  await expect(list(page).getByRole('button')).toHaveText(['Scribe', 'style']);
  await search.fill('deploy');
  await expect(list(page).getByRole('button')).toHaveText(['Scribe']);
  await expect(list(page)).toContainText('No skill matches “deploy”.');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(list(page).getByRole('button')).toHaveText(['Scribe', 'review', 'style']);
});

const LONG =
  '---\nname: long\ndescription: A skill with long lines. Use when testing the editor.\n---\n\n# Long\n\n' +
  `${'A line long enough to wrap in any pane, with `code` in it and [a link](a.md). '.repeat(6)}\n` +
  '\n```sh\npnpm check\n```\n\n- [ ] one\n- [x] two\n';

/** The drawn copy's height, and the text area's text's own (its height at 0 shows it). */
async function heights(page: Page) {
  return page.evaluate(() => {
    const area = document.querySelector<HTMLTextAreaElement>('.skills-code textarea');
    const copy = document.querySelector<HTMLElement>('.skills-code-lines');
    if (!area || !copy) return null;
    const kept = area.style.height;
    area.style.height = '0px';
    const own = area.scrollHeight;
    area.style.height = kept;
    return { copy: copy.getBoundingClientRect().height, own };
  });
}

// V64 (decision 460): the text area over a drawn copy holding its line numbers and colours.
test('the editor: a number a line, Markdown in colour, the copy always as tall as the text', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  commit({ '.claude/skills/long/SKILL.md': LONG });
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`${symbiote.url}skills?skill=.claude%2Fskills%2Flong%2FSKILL.md`);
    await expect(text(page, 'long')).toHaveValue(LONG);
    const numbers = editor(page).locator('.skills-code-number');
    // The last newline makes an empty last line, as in the text area.
    await expect(numbers).toHaveCount(LONG.split('\n').length);
    await expect(numbers.first()).toHaveText('1');
    await expect(editor(page).locator('.md-heading')).toHaveText('# Long');
    await expect(editor(page).locator('.md-code').first()).toHaveText('`code`');
    await expect(editor(page).locator('.md-key')).toHaveText(['name:', 'description:']);
    const wrapped = await heights(page);
    if (!wrapped) throw new Error('no editor');
    expect(Math.abs(wrapped.copy - wrapped.own)).toBeLessThanOrEqual(1);
    // As it is typed: a long line added, then the last line taken away.
    await text(page, 'long').press('Control+End');
    await text(page, 'long').pressSequentially('More words to wrap the line again. '.repeat(4));
    await expect(numbers).toHaveCount(LONG.split('\n').length);
    const typed = await heights(page);
    if (!typed) throw new Error('no editor');
    expect(Math.abs(typed.copy - typed.own)).toBeLessThanOrEqual(1);
    expect(typed.copy).toBeGreaterThan(wrapped.copy);
  }
});

// V64 (decision 461): Markdown ▾ shows the skill drawn; Expand gives it the main area.
test('Preview draws the skill and keeps the draft; Expand takes the main area until Esc', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  commit({ '.claude/skills/review/SKILL.md': REVIEW });
  await page.goto(`${symbiote.url}skills`);
  await text(page, 'review').fill(`${REVIEW}\n## Drafted\n`);
  await editor(page).getByRole('button', { name: 'Markdown' }).click();
  await page.getByRole('menuitemradio', { name: 'Preview' }).click();
  const preview = editor(page).locator('.skills-preview');
  await expect(preview.getByRole('heading', { name: 'Drafted' })).toBeVisible();
  await expect(preview).toContainText('Reviews a change. Use when asked to review a branch.');
  await expect(text(page, 'review')).toBeHidden();
  await editor(page).getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('menuitemradio', { name: 'Markdown' }).click();
  await expect(text(page, 'review')).toHaveValue(`${REVIEW}\n## Drafted\n`);

  const main = await page.locator('.shell-main').boundingBox();
  await editor(page).getByRole('button', { name: 'Expand' }).click();
  await expect(list(page)).toBeHidden();
  const card = await editor(page).locator('.skills-card').boundingBox();
  if (!main || !card) throw new Error('no box');
  expect(card.width).toBeGreaterThan(main.width - 50);
  await page.keyboard.press('Escape');
  await expect(list(page)).toBeVisible();
  await expect(editor(page).getByRole('button', { name: 'Expand' })).toBeVisible();
});

// V64 (decision 462): Checks a card; each check's lead in the text's colour.
test('Checks: a card, each check its lead and the rest', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  symbiote = await serveWorkspaces();
  commit({
    '.claude/skills/review/SKILL.md': REVIEW.replace('Reviews a change.', 'Reviews a <change>.'),
  });
  await page.goto(`${symbiote.url}skills`);
  const card = editor(page).getByRole('region', { name: 'Checks' });
  await expect(card.getByRole('heading', { name: 'Checks' })).toBeVisible();
  await expect(card.locator('li.warning')).toHaveText(
    "The description holds < or >: Anthropic's API and claude.ai refuse it; Claude Code and Codex take it.",
  );
  await expect(card.locator('li.warning strong')).toHaveText('The description holds < or >:');
});

// V64 (decision 464): Open in VS Code, at the caret's line; a library's in the library's window.
test('Open in VS Code opens the skill at the caret’s line', async ({ page }) => {
  symbiote = await serveWorkspaces();
  commit({ '.claude/skills/review/SKILL.md': REVIEW });
  await page.goto(`${symbiote.url}skills`);
  await expect(text(page, 'review')).toHaveValue(REVIEW);
  // The caret at the start of line 6, "# Review".
  await text(page, 'review').evaluate((area: HTMLTextAreaElement) => {
    const at = area.value.indexOf('# Review');
    area.focus();
    area.setSelectionRange(at, at);
  });
  await editor(page).getByRole('button', { name: 'Open in VS Code' }).click();
  await expect(editor(page).locator('.skills-notice')).toHaveText(
    'Opened .claude/skills/review/SKILL.md in VS Code at line 6.',
  );
  expect(symbiote.opened()).toEqual([
    [symbiote.repo, '--goto', `${join(symbiote.repo, '.claude/skills/review/SKILL.md')}:6:1`],
  ]);
});

/** Lists are read every 5 s while an agent works (V18b). */
const POLL = { timeout: 15_000 };
const scribePane = (page: Page) => page.getByRole('region', { name: 'Scribe' });
const screen = (page: Page) => scribePane(page).locator('.agent-terminal .xterm-rows');
const keys = (page: Page) => scribePane(page).locator('.xterm-helper-textarea');
/** The fake's starts named Scribe, as Claude Code was asked for them. */
const scribeCalls = () => symbiote.calls().filter((call) => call.args.includes('Scribe'));

// V78 (decisions 569, 570): Scribe's pane is its terminal, opened with no request, as Nucleus's page.
test('Scribe: its pane is its terminal, Claude Code opened writing skills only; what it writes is listed', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  commit({ '.claude/skills/review/SKILL.md': REVIEW });
  await page.goto(`${symbiote.url}skills`);
  // Nothing is started before its pane is opened.
  await expect(entry(page, 'review')).toBeVisible();
  expect(scribeCalls()).toEqual([]);
  await list(page).getByRole('button', { name: 'Scribe' }).click();
  await expect(page).toHaveURL(`${symbiote.url}skills?scribe`);
  await expect(scribePane(page).getByRole('heading', { name: 'Scribe' })).toBeVisible();
  await expect.poll(() => scribeCalls().length, POLL).toBe(1);
  await expect(screen(page)).toContainText('Fake Claude Code · fake0', POLL);
  await expect(keys(page)).toBeFocused();
  await expect(scribePane(page).getByRole('status')).toHaveText('Ready: ask in its terminal');
  // No box, no Effort, no Agent, no Write: only New conversation.
  await expect(scribePane(page).getByRole('textbox', { name: /Ask Scribe/ })).toHaveCount(0);
  await expect(scribePane(page).getByRole('slider')).toHaveCount(0);
  await expect(scribePane(page).getByRole('combobox')).toHaveCount(0);
  await expect(scribePane(page).getByRole('button', { name: 'Write' })).toHaveCount(0);
  await expect(scribePane(page).getByRole('button', { name: 'New conversation' })).toBeVisible();
  const [call] = scribeCalls();
  expect(call?.cwd).toBe(symbiote.repo);
  const args = call?.args ?? [];
  expect(args.slice(0, 9)).toEqual([
    '--bg',
    '--name',
    'Scribe',
    '--tools',
    'Read,Grep,Glob,Bash,Write,Edit',
    '--permission-mode',
    'default',
    '--strict-mcp-config',
    '--settings',
  ]);
  const settings = join(symbiote.repo, 'symbiote', 'scribe-settings.json');
  expect(args[9]).toBe(settings);
  // Its gate is given the skills folder.
  expect(readFileSync(settings, 'utf8')).toContain(join(symbiote.repo, '.claude', 'skills'));
  // Its instructions are its system prompt, and nothing follows: no prompt (decision 570).
  expect(args.at(-2)).toBe('--append-system-prompt');
  expect(args.at(-1)).toContain('You are Scribe');
  // The request is typed in its terminal.
  await page.keyboard.type('A skill for adding a prompt to Settings');
  await page.keyboard.press('Enter');
  await expect(screen(page)).toContainText('got: A skill for adding a prompt to Settings');
  symbiote.setSession('fake0', { state: 'working', status: 'busy' });

  // While it works, what it writes shows in the list; the sidenav marks Skills elsewhere.
  mkdirSync(join(symbiote.repo, '.claude/skills/adding-prompts'), { recursive: true });
  writeFileSync(
    join(symbiote.repo, '.claude/skills/adding-prompts/SKILL.md'),
    '---\nname: adding-prompts\ndescription: Adds a prompt to Settings. Use when an agent needs a new text.\n---\n\n# Adding a prompt\n',
  );
  await expect(entry(page, 'adding-prompts')).toBeVisible(POLL);
  await expect(entry(page, 'adding-prompts')).toContainText('new');
  await page.getByRole('link', { name: 'Git' }).click();
  const skillsLink = page.getByRole('navigation', { name: 'Pages' }).getByRole('link', {
    name: /Skills/,
  });
  await expect(skillsLink).toHaveAttribute('data-state', 'working', POLL);
  // It asks the person (V59, decision 424): Skills is the amber band Nucleus's link is.
  symbiote.setSession('fake0', {
    state: 'waiting',
    status: 'idle',
    waitingFor: 'permission prompt',
  });
  await expect(skillsLink).toHaveAttribute('data-state', 'waiting', POLL);
  await expect(skillsLink).toHaveAccessibleName('Skills, Scribe waits for you');
  await expect(skillsLink).toHaveAttribute('data-tip', 'Skills\nScribe waits for you');
  await expect(skillsLink).toHaveAttribute('data-tip-tone', 'warn');
  await expect(skillsLink.locator('.sidenav-waits')).toHaveText('Waits');
  await expect(skillsLink.locator('.state-dot')).toBeHidden();
  symbiote.setSession('fake0', { state: 'done', status: 'idle', answer: 'Wrote it.' });
  await expect(skillsLink).toHaveAttribute('data-state', 'answered', POLL);
  await skillsLink.click();
  await expect(skillsLink).not.toHaveAttribute('data-state');
});

// V56 (decision 410): Scribe's terminal edge to edge in the pane, as Nucleus's and a workspace's.
test("Scribe's terminal fills the pane: to the main area's right and bottom edges", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}skills?scribe`);
  const terminal = page.locator('.scribe-pane .agent-terminal');
  await expect(terminal.locator('.xterm-rows')).toContainText('Fake Claude Code', POLL);
  for (const [width, height] of [
    [1440, 900],
    [1920, 1080],
  ] as const) {
    await page.setViewportSize({ width, height });
    const main = await page.locator('.shell-main').boundingBox();
    const l = await list(page).boundingBox();
    const box = await terminal.boundingBox();
    if (!main || !l || !box) throw new Error('no box');
    // To the pane card's edges, 16 px in from the main area's (V72; 24 since V64) and inside its
    // 1 px border.
    expect(Math.abs(box.x + box.width - (main.x + main.width - 17))).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height - (main.y + main.height - 17))).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThanOrEqual(main.width - l.width - 68);
  }
});

// Scribe's effort (fix/scribe-effort-level): its conversation opens at the project's `scribe.effort`.
test("Effort: Scribe opens at the project's level, which reaches Claude Code; its line says it", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  commit({
    'symbiote/config.json':
      '{ "nucleus": { "effort": "low" }, "scribe": { "effort": "medium" } }\n',
  });
  await page.goto(`${symbiote.url}skills?scribe`);
  await expect.poll(() => scribeCalls().length, POLL).toBe(1);
  const args = scribeCalls()[0]?.args ?? [];
  expect(args[args.indexOf('--effort') + 1]).toBe('medium');
  await expect(scribePane(page).locator('.page-agent-about')).toContainText(
    'with Claude Code at medium effort',
  );
});

// V78 (decision 571): Improve with Scribe types the skill to change in its terminal, unsent.
test('Improve with Scribe: the skill to change typed in its terminal, not sent', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  commit({ '.claude/skills/review/SKILL.md': REVIEW });
  await page.goto(`${symbiote.url}skills`);
  await editor(page).getByRole('button', { name: 'Improve with Scribe' }).click();
  await expect(page).toHaveURL(`${symbiote.url}skills?scribe`);
  await expect(screen(page)).toContainText('> Improve .claude/skills/review/SKILL.md:', POLL);
  await expect(screen(page)).not.toContainText('got:');
  await expect(keys(page)).toBeFocused();
  // The person finishes it, and sends it.
  await page.keyboard.type('say when to run it');
  await page.keyboard.press('Enter');
  await expect(screen(page)).toContainText(
    'got: Improve .claude/skills/review/SKILL.md: say when to run it',
  );
  expect(scribeCalls()).toHaveLength(1);

  // Again from a skill, with the conversation running: the same conversation's terminal, joined
  // again (the fake prints nothing of before), the text typed there.
  await entry(page, 'review').click();
  await editor(page).getByRole('button', { name: 'Improve with Scribe' }).click();
  await expect.poll(() => symbiote.attaches(), POLL).toEqual(['fake0', 'fake0']);
  await expect(screen(page)).toContainText('> Improve .claude/skills/review/SKILL.md:', POLL);
  await expect(screen(page)).not.toContainText('got:');
  expect(scribeCalls()).toHaveLength(1);

  // From the new skill's form: the pane, nothing typed.
  await page.getByRole('button', { name: 'New skill' }).click();
  await page.getByRole('button', { name: 'ask Scribe to write it' }).click();
  await expect(page).toHaveURL(`${symbiote.url}skills?scribe`);
  await expect(screen(page)).toContainText('Fake Claude Code', POLL);
});

// V78 (decision 572): Scribe runs in a terminal; without one, no box.
test('without terminals, Scribe says it runs in a terminal and why none runs, starting nothing', async ({
  page,
}) => {
  symbiote = await serveWorkspaces({ terminal: false });
  await page.goto(`${symbiote.url}skills?scribe`);
  await expect(scribePane(page).locator('.page-agent-note')).toHaveText(
    'Scribe runs in a terminal, and none runs here: terminals are turned off (SYMBIOTE_TERMINAL=off).',
  );
  await expect(scribePane(page).getByRole('textbox')).toHaveCount(0);
  await expect(scribePane(page).getByRole('slider')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(scribeCalls()).toEqual([]);
});
