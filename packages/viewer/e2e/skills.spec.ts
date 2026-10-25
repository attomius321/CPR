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
  // Scribe first, then the skills by folder.
  await expect(list(page).getByRole('heading')).toHaveText([
    'Agent',
    '.claude/skills · Claude Code',
  ]);
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
  await page.getByRole('link', { name: 'History' }).click();
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
  await expect(list(page).getByRole('heading')).toHaveText([
    'Agent',
    '.claude/skills · Claude Code and Codex',
  ]);
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
// main area: the list at its left edge, the skill to its right and bottom edges, no card; its
// checks beside the text where the pane is 880 px wide, under it on a narrower one.
test('uses the whole main area: the list at its left edge, the skill to its right and bottom', async ({
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
    const area = await text(page, 'style').boundingBox();
    const checks = await editor(page).getByText('Nothing the standard').boundingBox();
    const heading = await page.getByRole('heading', { name: 'Skills', exact: true }).boundingBox();
    const add = await page.getByRole('button', { name: 'New skill' }).boundingBox();
    if (!main || !l || !e || !area || !checks || !heading || !add) throw new Error('no box');
    expect(Math.abs(l.x - main.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(e.x + e.width - (main.x + main.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(e.y + e.height - (main.y + main.height))).toBeLessThanOrEqual(1);
    // The head as History's: its title 16 px in, New skill 12 px from the right.
    expect(Math.round(heading.x - main.x)).toBe(16);
    expect(Math.round(main.x + main.width - (add.x + add.width))).toBe(12);
    // The text as tall as the pane allows: only the line of actions under it and, in a pane under
    // 880 px, the checks and files.
    const side = await editor(page).locator('.skills-side').boundingBox();
    if (!side) throw new Error('no box');
    const under = width === 1280 ? side : area;
    expect(main.y + main.height - (under.y + under.height)).toBeLessThan(80);
    if (width === 1280) expect(checks.y).toBeGreaterThanOrEqual(area.y + area.height);
    else expect(checks.x).toBeGreaterThanOrEqual(area.x + area.width);
  }
  // None of Settings' rules, no card.
  await expect(page.locator('.skills[class*="settings"], .skills [class*="settings"]')).toHaveCount(
    0,
  );
  await expect(editor(page)).toHaveCSS('box-shadow', 'none');
  await expect(editor(page).getByRole('textbox')).toHaveCount(1);
});

/** Lists are read every 5 s while an agent works (V18b). */
const POLL = { timeout: 15_000 };
const scribePane = (page: Page) => page.getByRole('region', { name: 'Scribe' });
const request = (page: Page) =>
  scribePane(page).getByRole('textbox', { name: 'Ask Scribe for a skill' });
/** The fake's starts named Scribe, as Claude Code was asked for them. */
const scribeCalls = () => symbiote.calls().filter((call) => call.args.includes('Scribe'));

test('Scribe: a request starts Claude Code writing skills only, and what it writes is listed', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  commit({ '.claude/skills/review/SKILL.md': REVIEW });
  await page.goto(`${symbiote.url}skills`);
  await list(page).getByRole('button', { name: 'Scribe' }).click();
  await expect(page).toHaveURL(`${symbiote.url}skills?scribe`);
  await expect(scribePane(page).getByRole('heading', { name: 'Scribe' })).toBeVisible();
  // Nothing is started or written until it is asked.
  expect(scribeCalls()).toEqual([]);

  await request(page).fill('A skill for adding a prompt to Settings');
  await request(page).press('Enter');
  await expect.poll(() => scribeCalls().length, POLL).toBe(1);
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
  expect(args.at(-1)).toContain('A skill for adding a prompt to Settings');
  await expect(scribePane(page).locator('.agent-terminal .xterm-rows')).toContainText(
    'Fake Claude Code · fake0',
    POLL,
  );

  // While it works, what it writes shows in the list; the sidenav marks Skills elsewhere.
  mkdirSync(join(symbiote.repo, '.claude/skills/adding-prompts'), { recursive: true });
  writeFileSync(
    join(symbiote.repo, '.claude/skills/adding-prompts/SKILL.md'),
    '---\nname: adding-prompts\ndescription: Adds a prompt to Settings. Use when an agent needs a new text.\n---\n\n# Adding a prompt\n',
  );
  await expect(entry(page, 'adding-prompts')).toBeVisible(POLL);
  await expect(entry(page, 'adding-prompts')).toContainText('new');
  await page.getByRole('link', { name: 'History' }).click();
  const skillsLink = page.getByRole('navigation', { name: 'Pages' }).getByRole('link', {
    name: /Skills/,
  });
  await expect(skillsLink).toHaveAttribute('data-state', 'working', POLL);
  symbiote.setSession('fake0', { state: 'done', status: 'idle', answer: 'Wrote it.' });
  await expect(skillsLink).toHaveAttribute('data-state', 'answered', POLL);
  await skillsLink.click();
  await expect(skillsLink).not.toHaveAttribute('data-state');
});

// V56 (decision 410): Scribe's terminal edge to edge in the pane, as Scout's and a workspace's.
test("Scribe's terminal fills the pane: to the main area's right and bottom edges", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}skills?scribe`);
  await request(page).fill('A skill for releases');
  await request(page).press('Enter');
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
    expect(Math.abs(box.x + box.width - (main.x + main.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height - (main.y + main.height))).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThanOrEqual(main.width - l.width - 2);
  }
});

// Scribe's effort (fix/scribe-effort-level): the box starts at the project's `scribe.effort`.
test("Effort: Scribe's box starts at the project's level, which reaches Claude Code", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  commit({
    'symbiote/config.json': '{ "scout": { "effort": "low" }, "scribe": { "effort": "medium" } }\n',
  });
  await page.goto(`${symbiote.url}skills?scribe`);
  const effort = scribePane(page).getByRole('slider', { name: 'Effort' });
  await expect(effort).toHaveAttribute('aria-valuetext', 'medium');
  await request(page).fill('A skill for releases');
  await request(page).press('Enter');
  await expect.poll(() => scribeCalls().length, POLL).toBe(1);
  const args = scribeCalls()[0]?.args ?? [];
  expect(args[args.indexOf('--effort') + 1]).toBe('medium');
  await expect(scribePane(page).locator('.scout-about')).toContainText(
    'with Claude Code at medium effort',
  );
});

test('Improve with Scribe: its box takes the skill to change', async ({ page }) => {
  symbiote = await serveWorkspaces();
  commit({ '.claude/skills/review/SKILL.md': REVIEW });
  await page.goto(`${symbiote.url}skills`);
  await editor(page).getByRole('button', { name: 'Improve with Scribe' }).click();
  await expect(page).toHaveURL(`${symbiote.url}skills?scribe`);
  await expect(request(page)).toHaveValue('Improve .claude/skills/review/SKILL.md: ');
  // From the new skill's form too.
  await page.getByRole('button', { name: 'New skill' }).click();
  await page.getByRole('button', { name: 'ask Scribe to write it' }).click();
  await expect(request(page)).toBeVisible();
});
