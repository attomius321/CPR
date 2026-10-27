import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { openRepo, type SkillChange } from '@symbiote/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import type { FolderAt, OpenFolder } from '../src/editor.js';
import { libraryService, type LibraryService } from '../src/library.js';
import {
  parseSkillChange,
  parseSkillOpen,
  skillNameProblem,
  SkillRefused,
  skillsService,
  yamlText,
} from '../src/skills.js';

const repos: TestRepo[] = [];
const folders: string[] = [];
beforeEach(() => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
});
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const REVIEW =
  '---\nname: review\ndescription: Reviews a change. Use when asked to review.\n---\n\n# Review\n';
const STYLE = '---\nname: style\ndescription: The look.\n---\n\nSee [tokens](tokens.md).\n';

/** A repository with two committed skills, one with a file of its own, and a folder without one. */
function fresh(): TestRepo {
  const repo = createRepo();
  repo.write({
    'src/a.ts': 'export const a = 1;\n',
    '.claude/skills/style/SKILL.md': STYLE,
    '.claude/skills/style/tokens.md': '# Tokens\n',
    '.claude/skills/style/scripts/check.mjs': 'console.log(1);\n',
    '.claude/skills/review/SKILL.md': REVIEW,
    '.claude/skills/notes/README.md': 'not a skill\n',
  });
  repo.commit('A');
  repos.push(repo);
  return repo;
}

async function service(
  repo: TestRepo,
  options: {
    codex?: boolean;
    platform?: NodeJS.Platform;
    library?: LibraryService;
    openFolder?: OpenFolder;
  } = {},
) {
  return skillsService(await openRepo(repo.root), {
    codexInstalled: () => Promise.resolve(options.codex ?? false),
    ...(options.platform ? { platform: options.platform } : {}),
    ...(options.library ? { library: options.library } : {}),
    ...(options.openFolder ? { openFolder: options.openFolder } : {}),
  });
}

/** A library kept in a config folder of the test's own, set to `folder` when given. */
async function library(folder?: string, commits: 'none' | 'commit' = 'none') {
  const config = tempDir();
  folders.push(config);
  const made = libraryService(join(config, 'library.json'), { home: config });
  if (folder) await made.set({ action: 'library', folder, commits });
  return made;
}

/** A plain folder holding a skill, `deploy`, with a file of its own. */
function plainLibrary(): string {
  const dir = tempDir();
  folders.push(dir);
  mkdirSync(join(dir, 'deploy', 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'deploy', 'SKILL.md'), DEPLOY);
  writeFileSync(join(dir, 'deploy', 'scripts', 'run.sh'), 'echo\n');
  mkdirSync(join(dir, 'notes'));
  return dir;
}

const DEPLOY = '---\nname: deploy\ndescription: Deploys a service.\n---\n\n# Deploy\n';

/** The refusal `act` throws: its status and words. */
async function refusal(act: () => Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await act();
  } catch (error) {
    if (error instanceof SkillRefused) return { status: error.status, message: error.message };
    throw error;
  }
  throw new Error('not refused');
}

describe('listing a checkout’s skills', () => {
  it('lists Claude Code’s skills by name, with their text, files and git state', async () => {
    const repo = fresh();
    const state = await (await service(repo)).state();
    expect(state.checkout).toBe(repo.root);
    expect(state.skills.map((s) => s.path)).toEqual([
      '.claude/skills/review/SKILL.md',
      '.claude/skills/style/SKILL.md',
    ]);
    const style = state.skills[1]!;
    expect(style).toMatchObject({
      folder: '.claude/skills',
      name: 'style',
      text: STYLE,
      files: ['scripts/check.mjs', 'tokens.md'],
      git: 'committed',
      agents: ['claude'],
    });
    expect(style.version).toMatch(/^[0-9a-f]{16}$/);
    expect(state.codex).toEqual({ installed: false, link: 'none', canLink: true });
  });

  it('says a changed or new skill is not committed', async () => {
    const repo = fresh();
    repo.write({
      '.claude/skills/review/SKILL.md': `${REVIEW}More.\n`,
      '.claude/skills/fresh/SKILL.md': '---\nname: fresh\ndescription: New.\n---\n',
    });
    const state = await (await service(repo)).state();
    expect(Object.fromEntries(state.skills.map((s) => [s.name, s.git]))).toEqual({
      fresh: 'new',
      review: 'changed',
      style: 'committed',
    });
  });

  it('lists Codex’s own folder after Claude Code’s', async () => {
    const repo = fresh();
    repo.write({ '.agents/skills/deploy/SKILL.md': '---\nname: deploy\ndescription: D.\n---\n' });
    const state = await (await service(repo, { codex: true })).state();
    expect(state.skills.map((s) => [s.path, s.agents])).toEqual([
      ['.claude/skills/review/SKILL.md', ['claude']],
      ['.claude/skills/style/SKILL.md', ['claude']],
      ['.agents/skills/deploy/SKILL.md', ['codex']],
    ]);
    expect(state.codex).toMatchObject({ installed: true, link: 'folder', canLink: false });
  });

  it('lists the skills once when .agents/skills links to .claude/skills, read by both', async () => {
    const repo = fresh();
    mkdirSync(join(repo.root, '.agents'));
    symlinkSync('../.claude/skills', join(repo.root, '.agents/skills'));
    const state = await (await service(repo, { codex: true })).state();
    expect(state.skills.map((s) => [s.path, s.agents])).toEqual([
      ['.claude/skills/review/SKILL.md', ['claude', 'codex']],
      ['.claude/skills/style/SKILL.md', ['claude', 'codex']],
    ]);
    expect(state.codex).toEqual({ installed: true, link: 'linked', canLink: false, git: 'new' });
  });

  it('lists nothing in a checkout without skills', async () => {
    const repo = createRepo();
    repo.write({ 'a.txt': 'a\n' });
    repo.commit('A');
    repos.push(repo);
    const state = await (await service(repo)).state();
    expect(state.skills).toEqual([]);
    expect(state.codex.link).toBe('none');
  });

  it('keeps a skill too large to edit here out of the page, by name', async () => {
    const repo = fresh();
    repo.write({ '.claude/skills/huge/SKILL.md': `---\nname: huge\n---\n${'x'.repeat(300_000)}` });
    const huge = (await (await service(repo)).state()).skills.find((s) => s.name === 'huge');
    expect(huge).toMatchObject({ tooLarge: true });
    expect(huge?.text).toBeUndefined();
  });
});

describe('saving a skill', () => {
  it('writes the text, and refuses a save made from an older read', async () => {
    const repo = fresh();
    const skills = await service(repo);
    const before = (await skills.state()).skills[0]!;
    const after = await skills.change({
      action: 'save',
      path: before.path,
      text: `${REVIEW}\nCheck the tests.\n`,
      version: before.version,
    });
    expect(readFileSync(join(repo.root, before.path), 'utf8')).toBe(
      `${REVIEW}\nCheck the tests.\n`,
    );
    expect(after.skills[0]).toMatchObject({ git: 'changed' });
    expect(after.skills[0]!.version).not.toBe(before.version);
    const stale = await refusal(() =>
      skills.change({ action: 'save', path: before.path, text: 'x', version: before.version }),
    );
    expect(stale).toEqual({
      status: 409,
      message: '.claude/skills/review/SKILL.md changed since you opened it: open it again',
    });
  });

  it('refuses a path that is not a skill’s SKILL.md in one of the two folders', async () => {
    const repo = fresh();
    const skills = await service(repo);
    for (const path of [
      '.claude/settings.json',
      '.claude/skills/review/notes.md',
      '.claude/skills/review/deep/SKILL.md',
      '.claude/skills/../skills/review/SKILL.md',
      '.claude/skills/../../src/SKILL.md',
      'skills/review/SKILL.md',
      '/etc/SKILL.md',
    ]) {
      const refused = await refusal(() =>
        skills.change({ action: 'save', path, text: 'x', version: 'v' }),
      );
      expect(refused.status, path).toBe(400);
    }
    expect(readFileSync(join(repo.root, 'src/a.ts'), 'utf8')).toBe('export const a = 1;\n');
  });

  it('refuses a skill whose folder links out of the skills', async () => {
    const repo = fresh();
    const outside = tempDir();
    folders.push(outside);
    mkdirSync(join(outside, 'shared'));
    symlinkSync(join(outside, 'shared'), join(repo.root, '.claude/skills/shared'));
    const refused = await refusal(async () =>
      (await service(repo)).change({
        action: 'save',
        path: '.claude/skills/shared/SKILL.md',
        text: 'x',
        version: 'v',
      }),
    );
    expect(refused).toEqual({
      status: 400,
      message: '.claude/skills/shared is a link out of .claude/skills: change it where it is',
    });
    expect(existsSync(join(outside, 'shared/SKILL.md'))).toBe(false);
  });

  it('refuses a save of a skill deleted since it was read', async () => {
    const repo = fresh();
    const skills = await service(repo);
    const read = (await skills.state()).skills[0]!;
    rmSync(join(repo.root, '.claude/skills/review'), { recursive: true });
    expect(
      await refusal(() =>
        skills.change({ action: 'save', path: read.path, text: 'x', version: read.version }),
      ),
    ).toMatchObject({ status: 409 });
  });
});

describe('a new skill', () => {
  it('writes its name and description, and an empty body, in .claude/skills', async () => {
    const repo = createRepo();
    repo.write({ 'a.txt': 'a\n' });
    repo.commit('A');
    repos.push(repo);
    const state = await (
      await service(repo)
    ).change({
      action: 'new',
      name: 'release-notes',
      description: 'Writes release notes from merged branches. Use when asked for release notes.',
    });
    expect(readFileSync(join(repo.root, '.claude/skills/release-notes/SKILL.md'), 'utf8')).toBe(
      '---\nname: release-notes\ndescription: Writes release notes from merged branches. Use when asked for release notes.\n---\n',
    );
    expect(state.skills).toMatchObject([{ name: 'release-notes', git: 'new' }]);
  });

  it('quotes a description YAML would read otherwise', async () => {
    const repo = fresh();
    await (
      await service(repo)
    ).change({
      action: 'new',
      name: 'quoted',
      description: 'Checks a plan: "measured" first # always',
    });
    expect(readFileSync(join(repo.root, '.claude/skills/quoted/SKILL.md'), 'utf8')).toContain(
      'description: "Checks a plan: \\"measured\\" first # always"\n',
    );
  });

  it('refuses a name the standard refuses, a reserved folder, or one taken', async () => {
    const repo = fresh();
    const skills = await service(repo);
    const cases: [string, number][] = [
      ['Review', 400],
      ['-review', 400],
      ['review-', 400],
      ['re--view', 400],
      ['re view', 400],
      ['../review', 400],
      ['a'.repeat(65), 400],
      ['synced', 400],
      ['anthropic-skills', 400],
      ['review', 409],
      ['notes', 409],
    ];
    for (const [name, status] of cases) {
      const refused = await refusal(() =>
        skills.change({ action: 'new', name, description: 'Does a thing.' }),
      );
      expect(refused.status, name).toBe(status);
    }
  });

  it('refuses a description that is empty, too long, or holds < or >', async () => {
    const skills = await service(fresh());
    for (const description of ['', '   ', 'x'.repeat(1025), 'Runs --plugin <name>']) {
      const refused = await refusal(() =>
        skills.change({ action: 'new', name: 'thing', description }),
      );
      expect(refused.status, description.slice(0, 20)).toBe(400);
    }
  });
});

describe('deleting a skill', () => {
  it('removes its folder, and refuses a delete made from an older read', async () => {
    const repo = fresh();
    const skills = await service(repo);
    const style = (await skills.state()).skills[1]!;
    const stale = await refusal(() =>
      skills.change({ action: 'delete', path: style.path, version: 'old' }),
    );
    expect(stale.status).toBe(409);
    const after = await skills.change({
      action: 'delete',
      path: style.path,
      version: style.version,
    });
    expect(existsSync(join(repo.root, '.claude/skills/style'))).toBe(false);
    expect(after.skills.map((s) => s.name)).toEqual(['review']);
  });
});

describe('linking .agents/skills for Codex', () => {
  it('makes .agents/skills a relative link to ../.claude/skills', async () => {
    const repo = fresh();
    const state = await (await service(repo, { codex: true })).change({ action: 'link' });
    const link = join(repo.root, '.agents/skills');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe('../.claude/skills');
    expect(state.codex).toMatchObject({ link: 'linked', git: 'new' });
  });

  it('refuses when .agents/skills is there, and on Windows', async () => {
    const repo = fresh();
    repo.write({ '.agents/skills/deploy/SKILL.md': '---\nname: deploy\n---\n' });
    expect(await refusal(async () => (await service(repo)).change({ action: 'link' }))).toEqual({
      status: 409,
      message: '.agents/skills is there already: Codex reads it as it is',
    });
    const windows = await service(fresh(), { platform: 'win32' });
    expect((await windows.state()).codex).toMatchObject({ canLink: false });
    expect((await refusal(() => windows.change({ action: 'link' }))).status).toBe(409);
  });
});

describe('the skill library (SK1)', () => {
  it('answers as main does without a library: no library key', async () => {
    const repo = fresh();
    const without = await (await service(repo)).state();
    const unset = await (await service(repo, { library: await library() })).state();
    expect(unset).toEqual(without);
    expect('library' in unset).toBe(false);
  });

  it('lists the library’s skills after the checkout’s, by library/<name>/SKILL.md', async () => {
    const repo = fresh();
    const dir = plainLibrary();
    const state = await (await service(repo, { library: await library(dir) })).state();
    expect(state.skills.map((s) => s.path)).toEqual([
      '.claude/skills/review/SKILL.md',
      '.claude/skills/style/SKILL.md',
      'library/deploy/SKILL.md',
    ]);
    expect(state.skills[2]).toMatchObject({
      folder: 'library',
      name: 'deploy',
      text: DEPLOY,
      files: ['scripts/run.sh'],
      git: 'none',
      agents: [],
    });
    expect(state.library).toEqual({ folder: dir, exists: true, commits: 'none' });
  });

  it('gives each skill its state in the library’s repository', async () => {
    const repo = fresh();
    const held = createRepo();
    repos.push(held);
    held.write({ 'skills/deploy/SKILL.md': DEPLOY, 'skills/audit/SKILL.md': DEPLOY });
    held.commit('Skills');
    held.write({
      'skills/audit/SKILL.md': `${DEPLOY}More.\n`,
      'skills/fresh/SKILL.md': DEPLOY,
    });
    const state = await (
      await service(repo, { library: await library(join(held.root, 'skills')) })
    ).state();
    expect(state.skills.filter((s) => s.folder === 'library').map((s) => [s.name, s.git])).toEqual([
      ['audit', 'changed'],
      ['deploy', 'committed'],
      ['fresh', 'new'],
    ]);
    expect(state.library?.git?.changes).toEqual([
      { path: 'audit/SKILL.md', state: 'changed' },
      { path: 'fresh/SKILL.md', state: 'new' },
    ]);
  });

  it('lists no skill of a library that is not there, and says so', async () => {
    const repo = fresh();
    const dir = plainLibrary();
    const kept = await library(dir);
    rmSync(dir, { recursive: true });
    const state = await (await service(repo, { library: kept })).state();
    expect(state.skills.map((s) => s.folder)).toEqual(['.claude/skills', '.claude/skills']);
    expect(state.library).toEqual({ folder: dir, exists: false, commits: 'none' });
  });

  it('lists the checkout’s own folder once, as the checkout’s', async () => {
    const repo = fresh();
    const state = await (
      await service(repo, { library: await library(join(repo.root, '.claude/skills')) })
    ).state();
    expect(state.skills.map((s) => s.path)).toEqual([
      '.claude/skills/review/SKILL.md',
      '.claude/skills/style/SKILL.md',
    ]);
    expect(state.library?.checkout).toBe('.claude/skills');
  });

  it('saves, adds and deletes a library skill, and refuses a save from an older read', async () => {
    const repo = fresh();
    const dir = plainLibrary();
    const skills = await service(repo, { library: await library(dir) });
    const deploy = (await skills.state()).skills.find((s) => s.folder === 'library')!;
    await skills.change({
      action: 'save',
      path: 'library/deploy/SKILL.md',
      text: `${DEPLOY}Step one.\n`,
      version: deploy.version,
    });
    expect(readFileSync(join(dir, 'deploy/SKILL.md'), 'utf8')).toBe(`${DEPLOY}Step one.\n`);
    expect(
      await refusal(() =>
        skills.change({
          action: 'save',
          path: 'library/deploy/SKILL.md',
          text: 'x',
          version: deploy.version,
        }),
      ),
    ).toEqual({
      status: 409,
      message: 'library/deploy/SKILL.md changed since you opened it: open it again',
    });

    const added = await skills.change({
      action: 'new',
      name: 'audit',
      description: 'Audits a release.',
      where: 'library',
    });
    expect(readFileSync(join(dir, 'audit/SKILL.md'), 'utf8')).toBe(
      '---\nname: audit\ndescription: Audits a release.\n---\n',
    );
    expect(existsSync(join(repo.root, '.claude/skills/audit'))).toBe(false);
    expect(
      await refusal(() =>
        skills.change({ action: 'new', name: 'audit', description: 'Again.', where: 'library' }),
      ),
    ).toEqual({ status: 409, message: `${dir}/audit is there already` });

    const audit = added.skills.find((s) => s.path === 'library/audit/SKILL.md')!;
    await skills.change({ action: 'delete', path: audit.path, version: audit.version });
    expect(existsSync(join(dir, 'audit'))).toBe(false);
    expect(existsSync(join(dir, 'deploy/SKILL.md'))).toBe(true);
  });

  it('refuses a library skill without a library, outside it, or linking out of it', async () => {
    const repo = fresh();
    const none = await service(repo, { library: await library() });
    expect(
      await refusal(() =>
        none.change({ action: 'new', name: 'audit', description: 'A.', where: 'library' }),
      ),
    ).toEqual({ status: 409, message: 'No skill library is set: set one in Settings' });
    expect(
      await refusal(() =>
        none.change({ action: 'save', path: 'library/deploy/SKILL.md', text: 'x', version: 'v' }),
      ),
    ).toEqual({ status: 409, message: 'No skill library is set: set one in Settings' });

    const dir = plainLibrary();
    const skills = await service(repo, { library: await library(dir) });
    for (const path of ['library/../x/SKILL.md', 'library/deploy/scripts/SKILL.md']) {
      expect(
        await refusal(() => skills.change({ action: 'save', path, text: 'x', version: 'v' })),
      ).toMatchObject({ status: 400 });
    }
    const outside = tempDir();
    folders.push(outside);
    mkdirSync(join(outside, 'shared'));
    symlinkSync(join(outside, 'shared'), join(dir, 'shared'));
    expect(
      await refusal(() =>
        skills.change({ action: 'save', path: 'library/shared/SKILL.md', text: 'x', version: 'v' }),
      ),
    ).toEqual({
      status: 400,
      message: `${dir}/shared is a link out of ${dir}: change it where it is`,
    });
    expect(existsSync(join(outside, 'shared/SKILL.md'))).toBe(false);
  });

  it('sets, commits and forgets the library through a change', async () => {
    vi.stubEnv('GIT_AUTHOR_NAME', 'Symbiote Test');
    vi.stubEnv('GIT_AUTHOR_EMAIL', 'test@example.com');
    vi.stubEnv('GIT_COMMITTER_NAME', 'Symbiote Test');
    vi.stubEnv('GIT_COMMITTER_EMAIL', 'test@example.com');
    const repo = fresh();
    const held = createRepo();
    repos.push(held);
    held.write({ 'skills/deploy/SKILL.md': DEPLOY });
    held.commit('Skills');
    const skills = await service(repo, { library: await library() });
    const set = await skills.change({
      action: 'library',
      folder: join(held.root, 'skills'),
      commits: 'commit',
    });
    expect(set.library).toMatchObject({ folder: join(held.root, 'skills'), commits: 'commit' });
    held.write({ 'skills/fresh/SKILL.md': DEPLOY });
    const committed = await skills.change({ action: 'commit', message: 'Skills: fresh' });
    expect(committed.library?.git?.changes).toEqual([]);
    expect(held.git('log', '-1', '--format=%s')).toBe('Skills: fresh');
    const forgotten = await skills.change({ action: 'forget' });
    expect('library' in forgotten).toBe(false);
  });
});

describe('a change as the page sends it', () => {
  it('reads each action, and says what is wrong with one it cannot', () => {
    const changes: SkillChange[] = [
      { action: 'save', path: '.claude/skills/a/SKILL.md', text: 't', version: 'v' },
      { action: 'new', name: 'a', description: 'd' },
      { action: 'delete', path: '.claude/skills/a/SKILL.md', version: 'v' },
      { action: 'link' },
      { action: 'new', name: 'a', description: 'd', where: 'library' },
      { action: 'library', folder: '/srv/skills', commits: 'none' },
      { action: 'library', folder: '/srv/s', url: 'git@host:s.git', create: true, commits: 'push' },
      { action: 'forget' },
      { action: 'commit', message: 'Skills: a' },
      { action: 'push' },
      { action: 'pull' },
    ];
    for (const change of changes) expect(parseSkillChange(JSON.stringify(change))).toEqual(change);
    expect(() => parseSkillChange('{"action":"move"}')).toThrow(
      'action: save, new, delete, link, library, forget, commit, push or pull',
    );
    expect(() => parseSkillChange('{"action":"library","folder":"/s","commits":"always"}')).toThrow(
      'commits: none, commit or push',
    );
    expect(() =>
      parseSkillChange('{"action":"new","name":"a","description":"d","where":"x"}'),
    ).toThrow('where: library, or none for the checkout');
    expect(() => parseSkillChange('{"action":"save","path":"p","version":"v"}')).toThrow('text');
  });
});

describe('opening a skill in VS Code (V64)', () => {
  /** An editor that records where it was asked to open, and answers `answer`. */
  function editor(answer: Awaited<ReturnType<OpenFolder>> = { opened: true }) {
    const opened: [string, FolderAt | undefined][] = [];
    const openFolder: OpenFolder = (folder, at) => {
      opened.push([folder, at]);
      return Promise.resolve(answer);
    };
    return { opened, openFolder };
  }

  it('opens a checkout’s skill in its window at the line, a library’s in the library’s', async () => {
    const repo = fresh();
    const dir = plainLibrary();
    const code = editor();
    const skills = await service(repo, {
      library: await library(dir),
      openFolder: code.openFolder,
    });
    await skills.open({ path: '.claude/skills/style/SKILL.md', line: 4 });
    await skills.open({ path: 'library/deploy/SKILL.md' });
    const root = (await openRepo(repo.root)).root;
    expect(code.opened).toEqual([
      [root, { file: '.claude/skills/style/SKILL.md', line: 4, column: 1 }],
      [dir, { file: 'deploy/SKILL.md', line: 1, column: 1 }],
    ]);
  });

  it('refuses a skill that is not there, and says why VS Code did not open', async () => {
    const repo = fresh();
    const code = editor({ opened: false, message: 'VS Code was not found' });
    const skills = await service(repo, { openFolder: code.openFolder });
    expect(await refusal(() => skills.open({ path: '.claude/skills/gone/SKILL.md' }))).toEqual({
      status: 400,
      message: '.claude/skills/gone/SKILL.md is not there',
    });
    expect(await refusal(() => skills.open({ path: 'src/a.ts' }))).toMatchObject({ status: 400 });
    expect(await refusal(() => skills.open({ path: '.claude/skills/review/SKILL.md' }))).toEqual({
      status: 502,
      message: 'VS Code was not found',
    });
    expect(code.opened).toHaveLength(1);
    const without = await service(repo);
    expect(
      await refusal(() => without.open({ path: '.claude/skills/review/SKILL.md' })),
    ).toMatchObject({ status: 502 });
  });

  it('reads the request: a skill’s path, and a line from 1', () => {
    expect(parseSkillOpen('{"path":".claude/skills/a/SKILL.md","line":3}')).toEqual({
      path: '.claude/skills/a/SKILL.md',
      line: 3,
    });
    expect(parseSkillOpen('{"path":"library/a/SKILL.md"}')).toEqual({
      path: 'library/a/SKILL.md',
    });
    expect(() => parseSkillOpen('{}')).toThrow("path: the skill's SKILL.md");
    expect(() => parseSkillOpen('{"path":"p","line":0}')).toThrow('line: a line from 1');
  });
});

describe('names and YAML', () => {
  it('says what is wrong with a name, as the standard has it', () => {
    expect(skillNameProblem('release-notes')).toBeNull();
    expect(skillNameProblem('a1')).toBeNull();
    expect(skillNameProblem('')).toBe('a name cannot be empty');
    expect(skillNameProblem('Release')).toBe(
      'a name holds only lowercase letters, digits and hyphens',
    );
    expect(skillNameProblem('-a')).toBe('a name cannot start or end with a hyphen');
    expect(skillNameProblem('a--b')).toBe('a name cannot hold two hyphens in a row');
    expect(skillNameProblem('a'.repeat(65))).toBe('a name is at most 64 characters');
  });

  it('writes plain text as it is, and anything YAML reads otherwise in double quotes', () => {
    expect(yamlText('Writes notes. Use when asked.')).toBe('Writes notes. Use when asked.');
    expect(yamlText('Use: when asked')).toBe('"Use: when asked"');
    expect(yamlText('yes')).toBe('"yes"');
    expect(yamlText('3 steps')).toBe('"3 steps"');
    expect(yamlText("- a list's start")).toBe('"- a list\'s start"');
    expect(yamlText('a #comment')).toBe('"a #comment"');
    expect(yamlText('back\\slash "quoted"')).toBe('back\\slash "quoted"');
    expect(yamlText('"quoted" \\ first')).toBe('"\\"quoted\\" \\\\ first"');
    expect(yamlText('two\nlines')).toBe('"two\\nlines"');
  });
});
