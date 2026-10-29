import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// The skill library (SK1): one folder of skills outside the checkout, set in Settings (This
// machine), listed on the Skills page beside the checkout's, edited, added to, committed and pushed
// there as the setting says. Every server here has a config folder of its own.
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

const DEPLOY =
  '---\nname: deploy\ndescription: Deploys a service. Use when asked to ship one.\n---\n\n# Deploy\n';
const AWAY = '---\nname: away\ndescription: Written elsewhere. Use when away.\n---\n';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

/** Writes files under `root`. */
function write(root: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/** A plain folder of skills: `deploy`. */
function plainFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'symbiote-e2e-library-'));
  write(dir, { 'deploy/SKILL.md': DEPLOY });
  return dir;
}

/** A bare remote holding `skills/deploy`, and a clone of it with an identity, on main. */
function remoteAndClone(): { bare: string; clone: string } {
  const dir = mkdtempSync(join(tmpdir(), 'symbiote-e2e-library-'));
  const seed = join(dir, 'seed');
  mkdirSync(seed);
  git(seed, 'init', '-q', '--initial-branch=main');
  git(seed, 'config', 'user.name', 'Test');
  git(seed, 'config', 'user.email', 'test@example.com');
  write(seed, { 'skills/deploy/SKILL.md': DEPLOY, 'README.md': '# Skills\n' });
  git(seed, 'add', '--all');
  git(seed, 'commit', '-q', '-m', 'Skills');
  const bare = join(dir, 'skills.git');
  git(dir, 'clone', '-q', '--bare', seed, bare);
  const clone = join(dir, 'skillbar');
  git(dir, 'clone', '-q', bare, clone);
  git(clone, 'config', 'user.name', 'Test');
  git(clone, 'config', 'user.email', 'test@example.com');
  return { bare, clone };
}

/** The library set as Settings would set it, before the page opens. */
function setLibrary(folder: string, commits: 'none' | 'commit' | 'push') {
  mkdirSync(symbiote.config, { recursive: true });
  writeFileSync(join(symbiote.config, 'library.json'), JSON.stringify({ folder, commits }));
}

const list = (page: Page) => page.getByRole('navigation', { name: 'Skills' });
const librarySection = (page: Page) => list(page).getByRole('region', { name: 'Library' });
const editor = (page: Page) => page.locator('.skills-editor');
const pane = (page: Page) => page.getByRole('region', { name: 'Skill library' });
const settingsPage = (page: Page) => page.getByRole('region', { name: 'Skill library' });

test('Settings sets a plain folder; the Skills page lists, edits and adds its skills there', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  const dir = plainFolder();
  // Before: no library section; a line says where one is set.
  await page.goto(`${symbiote.url}skills`);
  await expect(list(page).getByRole('heading')).toHaveText(['Agent']);
  await list(page).getByRole('link', { name: 'Set a skill library in Settings' }).click();
  await expect(page).toHaveURL(`${symbiote.url}settings?prompt=skill-library`);

  await expect(settingsPage(page).getByRole('heading', { name: 'Skill library' })).toBeVisible();
  const folder = settingsPage(page).getByRole('textbox', { name: 'Folder' });
  await folder.fill(dir);
  await expect(settingsPage(page).locator('.library-probe')).toHaveText(
    '1 skill: a plain folder, no git.',
  );
  await settingsPage(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(settingsPage(page).getByRole('status')).toContainText('Saved');
  expect(JSON.parse(readFileSync(join(symbiote.config, 'library.json'), 'utf8'))).toEqual({
    folder: dir,
    commits: 'none',
  });

  await page.getByRole('link', { name: 'Skills' }).click();
  await expect(list(page).getByRole('heading')).toHaveText(['Agent', 'Library']);
  await expect(librarySection(page).getByRole('button')).toHaveText([/^skills|library-/, 'deploy']);
  await librarySection(page).getByRole('button', { name: 'deploy' }).click();
  await expect(editor(page).locator('.skills-where')).toContainText(`${dir}/deploy/SKILL.md`);
  await expect(editor(page).locator('.skills-where')).toContainText('A plain folder: no git.');
  const text = editor(page).getByRole('textbox', { name: 'deploy SKILL.md' });
  await expect(text).toHaveValue(DEPLOY);
  await text.fill(`${DEPLOY}Ship it.\n`);
  await text.press('Control+s');
  await expect(editor(page).getByRole('status')).toContainText('Saved');
  expect(readFileSync(join(dir, 'deploy/SKILL.md'), 'utf8')).toBe(`${DEPLOY}Ship it.\n`);

  // A new skill in the library.
  await page.getByRole('button', { name: 'New skill' }).click();
  const form = page.getByRole('form', { name: 'New skill' });
  await form.getByRole('button', { name: 'Library' }).click();
  await form.getByRole('textbox', { name: 'Name' }).fill('deploy');
  await expect(form.locator('.skills-size')).toHaveText(`${dir}/deploy is there already`);
  await form.getByRole('textbox', { name: 'Name' }).fill('audit');
  await form
    .getByRole('textbox', { name: 'Description' })
    .fill('Audits a release. Use when asked to check one.');
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(librarySection(page).getByRole('button', { name: 'audit' })).toBeVisible();
  expect(readFileSync(join(dir, 'audit/SKILL.md'), 'utf8')).toContain('name: audit');
  expect(existsSync(join(symbiote.repo, '.claude/skills/audit'))).toBe(false);
});

test('a missing folder is made only when Save says it will', async ({ page }) => {
  symbiote = await serveWorkspaces();
  const missing = join(mkdtempSync(join(tmpdir(), 'symbiote-e2e-library-')), 'my', 'skills');
  await page.goto(`${symbiote.url}settings?prompt=skill-library`);
  await settingsPage(page).getByRole('textbox', { name: 'Folder' }).fill(missing);
  await expect(settingsPage(page).locator('.library-probe')).toHaveText(
    'Nothing there yet: Save makes the folder.',
  );
  await settingsPage(page).getByRole('button', { name: 'Make the folder and save' }).click();
  await expect(settingsPage(page).getByRole('status')).toContainText('Saved');
  expect(existsSync(missing)).toBe(true);
});

test('Clone a repository: cloned into a new folder, its skills folder the library', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  const { bare } = remoteAndClone();
  const into = join(mkdtempSync(join(tmpdir(), 'symbiote-e2e-library-')), 'skillbar');
  await page.goto(`${symbiote.url}settings?prompt=skill-library`);
  await settingsPage(page).getByRole('button', { name: 'Clone a repository' }).click();
  await settingsPage(page).getByRole('textbox', { name: 'Repository' }).fill(bare);
  await settingsPage(page).getByRole('textbox', { name: 'Clone into' }).fill(into);
  await expect(settingsPage(page).locator('.library-probe')).toHaveText(
    'Nothing there yet: the repository is cloned into it.',
  );
  await settingsPage(page).getByRole('button', { name: 'Clone and save' }).click();
  await expect(settingsPage(page).getByRole('status')).toHaveText(
    `Cloned and saved. The library is ${into}/skills.`,
  );
  expect(JSON.parse(readFileSync(join(symbiote.config, 'library.json'), 'utf8'))).toEqual({
    folder: join(into, 'skills'),
    commits: 'none',
  });
  await page.goto(`${symbiote.url}skills`);
  await expect(librarySection(page).getByRole('button', { name: 'deploy' })).toBeVisible();
});

test('Commit and push: the library’s changes committed with a message, pushed, then pulled', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  const { bare, clone } = remoteAndClone();
  setLibrary(join(clone, 'skills'), 'push');
  write(clone, { 'skills/fresh/SKILL.md': DEPLOY.replaceAll('deploy', 'fresh') });

  await page.goto(`${symbiote.url}skills?library`);
  await expect(pane(page).locator('.skills-where')).toContainText(
    `In the git repository ${clone}, on main, tracking origin/main.`,
  );
  await expect(pane(page).getByRole('list', { name: 'Changes' })).toHaveText(['fresh/SKILL.mdnew']);
  const message = pane(page).getByRole('textbox', { name: 'Message' });
  await expect(message).toHaveValue('Skills: fresh');
  await pane(page).getByRole('button', { name: 'Commit and push' }).click();
  await expect(pane(page).getByRole('status')).toContainText('Committed and pushed');
  expect(git(bare, 'log', '-1', '--format=%s', 'main')).toBe('Skills: fresh');
  await expect(pane(page).getByText('Nothing to commit.')).toBeVisible();

  // Pushed from elsewhere, pulled here.
  const there = join(dirname(clone), 'there');
  git(dirname(clone), 'clone', '-q', bare, there);
  git(there, 'config', 'user.name', 'Test');
  git(there, 'config', 'user.email', 'test@example.com');
  write(there, { 'skills/away/SKILL.md': AWAY });
  git(there, 'add', '--all');
  git(there, 'commit', '-q', '-m', 'Away');
  git(there, 'push', '-q');
  await pane(page).getByRole('button', { name: 'Pull' }).click();
  await expect(pane(page).getByRole('status')).toContainText('Pulled');
  await expect(librarySection(page).getByRole('button', { name: 'away' })).toBeVisible();
});

test('by default git is left to the person; Forget keeps the folder', async ({ page }) => {
  symbiote = await serveWorkspaces();
  const { clone } = remoteAndClone();
  setLibrary(join(clone, 'skills'), 'none');
  write(clone, { 'skills/fresh/SKILL.md': DEPLOY.replaceAll('deploy', 'fresh') });
  await page.goto(`${symbiote.url}skills?library`);
  await expect(pane(page).getByRole('list', { name: 'Changes' })).toHaveText(['fresh/SKILL.mdnew']);
  await expect(pane(page).getByRole('button', { name: /Commit/ })).toHaveCount(0);
  await expect(pane(page).locator('.library-git-note')).toContainText(
    'Symbiote leaves this git to you',
  );
  expect(git(clone, 'status', '--porcelain')).toBe('?? skills/fresh/');

  await page.goto(`${symbiote.url}settings?prompt=skill-library`);
  await expect(settingsPage(page).getByRole('textbox', { name: 'Folder' })).toHaveValue(
    join(clone, 'skills'),
  );
  await settingsPage(page).getByRole('button', { name: 'Forget' }).click();
  await expect(settingsPage(page).getByRole('status')).toContainText('Forgotten');
  expect(existsSync(join(symbiote.config, 'library.json'))).toBe(false);
  expect(existsSync(join(clone, 'skills', 'fresh', 'SKILL.md'))).toBe(true);
  await page.goto(`${symbiote.url}skills`);
  await expect(list(page).getByRole('heading')).toHaveText(['Agent']);
});

test('Scribe is given the library: Claude Code’s --add-dir, its gate’s second folder', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  const dir = plainFolder();
  setLibrary(dir, 'none');
  await page.goto(`${symbiote.url}skills`);
  await librarySection(page).getByRole('button', { name: 'deploy' }).click();
  await editor(page).getByRole('button', { name: 'Improve with Scribe' }).click();
  // Its terminal takes the library skill's full path, unsent (V78).
  await expect(
    page.getByRole('region', { name: 'Scribe' }).locator('.agent-terminal .xterm-rows'),
  ).toContainText(`> Improve ${dir}/deploy/SKILL.md:`, { timeout: 15_000 });
  await expect
    .poll(() => symbiote.calls().filter((call) => call.args.includes('Scribe')).length, {
      timeout: 15_000,
    })
    .toBe(1);
  const args = symbiote.calls().find((call) => call.args.includes('Scribe'))?.args ?? [];
  expect(args[args.indexOf('--add-dir') + 1]).toBe(dir);
  // In its system prompt (V78, decision 570).
  expect(args.at(-2)).toBe('--append-system-prompt');
  expect(args.at(-1)).toContain(`${dir}/<name>/SKILL.md`);
  const settings = readFileSync(join(symbiote.repo, 'symbiote', 'scribe-settings.json'), 'utf8');
  expect(settings).toContain(`'${dir}'`);
});

test('on a phone: the list, then the library’s pane with All skills', async ({ page }) => {
  symbiote = await serveWorkspaces();
  const { clone } = remoteAndClone();
  setLibrary(join(clone, 'skills'), 'commit');
  write(clone, { 'skills/fresh/SKILL.md': DEPLOY.replaceAll('deploy', 'fresh') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${symbiote.url}skills`);
  await librarySection(page)
    .getByRole('button', { name: /skillbar\/skills/ })
    .click();
  await expect(page).toHaveURL(`${symbiote.url}skills?library`);
  await expect(pane(page).getByRole('button', { name: 'Commit', exact: true })).toBeVisible();
  const box = await pane(page).boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  await pane(page).getByRole('button', { name: 'All skills' }).click();
  await expect(librarySection(page)).toBeVisible();
  // Nothing overflows the window.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
