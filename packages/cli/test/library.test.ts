import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { libraryService, type LibraryService } from '../src/library.js';
import { SkillRefused } from '../src/skills.js';

// The skill library (SK1): one folder of skills outside the checkout, a plain folder or one in a
// git repository, set on this machine (decisions 426–428).
const repos: TestRepo[] = [];
const folders: string[] = [];
let config: string;
beforeEach(() => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_AUTHOR_NAME', 'Symbiote Test');
  vi.stubEnv('GIT_AUTHOR_EMAIL', 'test@example.com');
  vi.stubEnv('GIT_COMMITTER_NAME', 'Symbiote Test');
  vi.stubEnv('GIT_COMMITTER_EMAIL', 'test@example.com');
  config = folder();
});
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
  for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const SKILL = (name: string) => `---\nname: ${name}\ndescription: ${name} things.\n---\n`;

function folder(): string {
  const dir = tempDir();
  folders.push(dir);
  return dir;
}

function repo(): TestRepo {
  const made = createRepo();
  repos.push(made);
  return made;
}

/** A bare repository to push to and clone from, holding `files` on `main`. */
function remote(files: Record<string, string> = { 'README.md': '# Skills\n' }): string {
  const seed = repo();
  seed.write(files);
  seed.commit('Seed');
  const bare = join(folder(), 'skills.git');
  execFileSync('git', ['clone', '--quiet', '--bare', seed.root, bare], { stdio: 'pipe' });
  return bare;
}

/** A clone of `bare`, on `main` tracking `origin/main`. */
function clone(bare: string): TestRepo {
  const dir = join(folder(), 'clone');
  execFileSync('git', ['clone', '--quiet', bare, dir], { stdio: 'pipe' });
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
  return {
    root: dir,
    git,
    write(files) {
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(join(dir, path, '..'), { recursive: true });
        writeFileSync(join(dir, path), text);
      }
    },
    commit(message) {
      git('add', '--all');
      git('commit', '--quiet', '--message', message);
      return git('rev-parse', 'HEAD');
    },
    commitAt: () => '',
    cleanup: () => undefined,
  };
}

const service = (home = '/home/someone'): LibraryService =>
  libraryService(join(config, 'symbiote', 'library.json'), { home });

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

describe('the library’s record', () => {
  it('reads as none when missing, broken or foreign, and keeps what is set', async () => {
    const file = join(config, 'symbiote', 'library.json');
    expect(service().setting()).toBeNull();
    mkdirSync(join(config, 'symbiote'), { recursive: true });
    writeFileSync(file, '{ not json');
    expect(service().setting()).toBeNull();
    writeFileSync(file, JSON.stringify({ folder: 3 }));
    expect(service().setting()).toBeNull();
    writeFileSync(file, JSON.stringify({ folder: 'relative/skills' }));
    expect(service().setting()).toBeNull();
    // An unknown commits value is the default.
    writeFileSync(file, JSON.stringify({ folder: '/srv/skills', commits: 'always' }));
    expect(service().setting()).toEqual({ folder: '/srv/skills', commits: 'none' });

    const skills = folder();
    await service().set({ action: 'library', folder: skills, commits: 'push' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ folder: skills, commits: 'push' });
    expect(service().setting()).toEqual({ folder: skills, commits: 'push' });
  });

  it('forgets the library, and leaves its folder as it is', async () => {
    const skills = folder();
    writeFileSync(join(skills, 'notes.md'), 'kept\n');
    const library = service();
    await library.set({ action: 'library', folder: skills, commits: 'none' });
    await library.forget();
    expect(library.setting()).toBeNull();
    expect(await library.state()).toBeNull();
    expect(readFileSync(join(skills, 'notes.md'), 'utf8')).toBe('kept\n');
  });
});

describe('what is at a folder', () => {
  it('says what is there: nothing, a file, an empty folder, skills, a repository', async () => {
    const dir = folder();
    const library = service(dir);
    expect(await library.probe('skills')).toMatchObject({
      problem: 'give the folder’s full path (/…, or ~/… in your home)',
    });
    expect(await library.probe('~/skills')).toEqual({
      folder: join(dir, 'skills'),
      kind: 'missing',
      skills: 0,
    });
    writeFileSync(join(dir, 'file'), 'x');
    expect(await library.probe(join(dir, 'file'))).toMatchObject({
      kind: 'file',
      problem: `${join(dir, 'file')} is a file, not a folder`,
    });
    mkdirSync(join(dir, 'empty'));
    expect(await library.probe(join(dir, 'empty'))).toMatchObject({ kind: 'empty', skills: 0 });

    const held = repo();
    held.write({
      'skills/review/SKILL.md': SKILL('review'),
      'skills/style/SKILL.md': SKILL('style'),
      'skills/notes/README.md': 'not a skill\n',
    });
    held.commit('Skills');
    expect(await library.probe(join(held.root, 'skills'))).toEqual({
      folder: join(held.root, 'skills'),
      kind: 'folder',
      skills: 2,
      git: { root: held.root, branch: 'main' },
    });
    // The repository's root: its skills are in skills/, which a clone's library would be.
    expect(await library.probe(held.root)).toMatchObject({
      kind: 'folder',
      skills: 0,
      skillsFolder: 2,
    });
  });
});

describe('setting the library', () => {
  it('takes a plain folder, and says it is in no repository', async () => {
    const skills = folder();
    mkdirSync(join(skills, 'review'));
    writeFileSync(join(skills, 'review', 'SKILL.md'), SKILL('review'));
    const library = service();
    await library.set({ action: 'library', folder: skills, commits: 'commit' });
    expect(await library.state()).toEqual({ folder: skills, exists: true, commits: 'commit' });
  });

  it('refuses a folder that is not there unless asked to make it, a file, or a relative path', async () => {
    const dir = folder();
    const library = service(dir);
    const missing = join(dir, 'my', 'skills');
    expect(
      await refusal(() => library.set({ action: 'library', folder: missing, commits: 'none' })),
    ).toEqual({ status: 409, message: `${missing} is not there: make it, or give another folder` });
    expect(library.setting()).toBeNull();
    await library.set({ action: 'library', folder: '~/my/skills', create: true, commits: 'none' });
    expect(existsSync(missing)).toBe(true);
    expect(library.setting()).toEqual({ folder: missing, commits: 'none' });

    writeFileSync(join(dir, 'file'), 'x');
    expect(
      await refusal(() =>
        library.set({ action: 'library', folder: join(dir, 'file'), commits: 'none' }),
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await refusal(() => library.set({ action: 'library', folder: 'skills', commits: 'none' })),
    ).toMatchObject({ status: 400 });
  });

  it('clones a URL into a new folder, and takes its skills/ when it has one', async () => {
    const bare = remote({ 'skills/review/SKILL.md': SKILL('review'), 'README.md': '# S\n' });
    const into = join(folder(), 'skillbar');
    const library = service();
    await library.set({ action: 'library', folder: into, url: bare, commits: 'push' });
    expect(library.setting()).toEqual({ folder: join(into, 'skills'), commits: 'push' });
    const state = await library.state();
    expect(state).toMatchObject({
      folder: join(into, 'skills'),
      exists: true,
      git: {
        root: into,
        path: 'skills',
        branch: 'main',
        upstream: 'origin/main',
        remote: 'origin',
        ahead: 0,
        behind: 0,
        changes: [],
      },
    });
  });

  it('clones into a folder’s root when it has no skills/, and refuses a folder with files', async () => {
    const bare = remote({ 'review/SKILL.md': SKILL('review') });
    const into = join(folder(), 'skills');
    const library = service();
    await library.set({ action: 'library', folder: into, url: bare, commits: 'none' });
    expect(library.setting()).toEqual({ folder: into, commits: 'none' });

    const taken = folder();
    writeFileSync(join(taken, 'notes.md'), 'x');
    expect(
      await refusal(() =>
        library.set({ action: 'library', folder: taken, url: bare, commits: 'none' }),
      ),
    ).toEqual({
      status: 409,
      message: `${taken} holds files: clone into a new or empty folder`,
    });
  });

  it('says why a clone failed, in git’s words', async () => {
    const into = join(folder(), 'skills');
    const failed = await refusal(() =>
      service().set({
        action: 'library',
        folder: into,
        url: join(folder(), 'nothing.git'),
        commits: 'none',
      }),
    );
    expect(failed.status).toBe(409);
    expect(failed.message).toMatch(
      /^Not cloned: .*(does not exist|not a git repository|Could not read)/s,
    );
    expect(existsSync(into)).toBe(false);
  });
});

describe('the library’s git', () => {
  /** A repository with the library in `skills/`, committed, and a file outside it. */
  function held(): TestRepo {
    const made = repo();
    made.write({
      'skills/review/SKILL.md': SKILL('review'),
      'skills/style/SKILL.md': SKILL('style'),
      'README.md': '# Skills\n',
    });
    made.commit('Skills');
    return made;
  }

  it('lists the changes in its folder only', async () => {
    const made = held();
    made.write({
      'skills/review/SKILL.md': `${SKILL('review')}\nMore.\n`,
      'skills/fresh/SKILL.md': SKILL('fresh'),
      'README.md': '# Changed outside\n',
    });
    rmSync(join(made.root, 'skills', 'style'), { recursive: true });
    const library = service();
    await library.set({ action: 'library', folder: join(made.root, 'skills'), commits: 'commit' });
    expect((await library.state())?.git).toEqual({
      root: made.root,
      path: 'skills',
      branch: 'main',
      ahead: 0,
      behind: 0,
      changes: [
        { path: 'fresh/SKILL.md', state: 'new' },
        { path: 'review/SKILL.md', state: 'changed' },
        { path: 'style/SKILL.md', state: 'deleted' },
      ],
    });
  });

  it('commits only its folder, with the message, and leaves the rest staged', async () => {
    const made = held();
    made.write({ 'skills/fresh/SKILL.md': SKILL('fresh'), 'README.md': '# Staged\n' });
    made.git('add', 'README.md');
    const library = service();
    await library.set({ action: 'library', folder: join(made.root, 'skills'), commits: 'commit' });
    await library.commit('Skills: fresh');
    expect(made.git('log', '-1', '--format=%s')).toBe('Skills: fresh');
    expect(made.git('show', '--name-only', '--format=', 'HEAD')).toBe('skills/fresh/SKILL.md');
    expect(made.git('diff', '--cached', '--name-only')).toBe('README.md');
    expect((await library.state())?.git?.changes).toEqual([]);
  });

  it('refuses a commit when the setting leaves git to the person, or with nothing to commit', async () => {
    const made = held();
    made.write({ 'skills/fresh/SKILL.md': SKILL('fresh') });
    const library = service();
    await library.set({ action: 'library', folder: join(made.root, 'skills'), commits: 'none' });
    expect(await refusal(() => library.commit('Skills'))).toEqual({
      status: 409,
      message:
        'Symbiote leaves the library’s git to you: commit it yourself, or change it in Settings',
    });
    await library.set({ action: 'library', folder: join(made.root, 'skills'), commits: 'commit' });
    expect(await refusal(() => library.commit('  '))).toMatchObject({ status: 400 });
    await library.commit('Skills: fresh');
    expect(await refusal(() => library.commit('Again'))).toEqual({
      status: 409,
      message: 'Nothing to commit in the library',
    });
  });

  it('refuses a commit in a plain folder, or on no branch', async () => {
    const plain = folder();
    const library = service();
    await library.set({ action: 'library', folder: plain, commits: 'commit' });
    expect(await refusal(() => library.commit('Skills'))).toEqual({
      status: 409,
      message: `${plain} is in no git repository: there is nothing to commit to`,
    });
    const made = held();
    made.git('checkout', '--quiet', '--detach');
    made.write({ 'skills/fresh/SKILL.md': SKILL('fresh') });
    await library.set({ action: 'library', folder: join(made.root, 'skills'), commits: 'commit' });
    expect(await refusal(() => library.commit('Skills'))).toEqual({
      status: 409,
      message: 'The library’s repository is on no branch: check one out first',
    });
  });

  it('pushes after a commit when set to, and says how far ahead it is otherwise', async () => {
    const bare = remote({ 'skills/review/SKILL.md': SKILL('review') });
    const local = clone(bare);
    local.write({ 'skills/fresh/SKILL.md': SKILL('fresh') });
    const library = service();
    await library.set({ action: 'library', folder: join(local.root, 'skills'), commits: 'commit' });
    await library.commit('Skills: fresh');
    expect((await library.state())?.git).toMatchObject({ ahead: 1, behind: 0 });
    // Push is not offered with Commit alone.
    expect(await refusal(() => library.push())).toMatchObject({ status: 409 });

    await library.set({ action: 'library', folder: join(local.root, 'skills'), commits: 'push' });
    await library.push();
    expect((await library.state())?.git).toMatchObject({ ahead: 0, behind: 0 });
    expect(
      execFileSync('git', ['-C', bare, 'log', '-1', '--format=%s', 'main']).toString().trim(),
    ).toBe('Skills: fresh');

    local.write({ 'skills/other/SKILL.md': SKILL('other') });
    await library.commit('Skills: other');
    expect(
      execFileSync('git', ['-C', bare, 'log', '-1', '--format=%s', 'main']).toString().trim(),
    ).toBe('Skills: other');
  });

  it('pushes a branch without an upstream to origin, and sets it', async () => {
    const bare = remote();
    const made = held();
    made.git('remote', 'add', 'origin', bare);
    made.git('fetch', '--quiet', 'origin');
    made.git('checkout', '--quiet', '-b', 'skills');
    const library = service();
    await library.set({ action: 'library', folder: join(made.root, 'skills'), commits: 'push' });
    expect((await library.state())?.git).toMatchObject({ branch: 'skills', remote: 'origin' });
    await library.push();
    expect((await library.state())?.git).toMatchObject({ upstream: 'origin/skills', ahead: 0 });
  });

  it('refuses a push with no remote', async () => {
    const made = held();
    const library = service();
    await library.set({ action: 'library', folder: join(made.root, 'skills'), commits: 'push' });
    expect(await refusal(() => library.push())).toEqual({
      status: 409,
      message: 'The library’s repository has no remote to push to: add one with git remote add',
    });
  });

  it('pulls fast-forward only, and says so when the branches went apart', async () => {
    const bare = remote({ 'skills/review/SKILL.md': SKILL('review') });
    const here = clone(bare);
    const there = clone(bare);
    there.write({ 'skills/away/SKILL.md': SKILL('away') });
    there.commit('Away');
    there.git('push', '--quiet');
    const library = service();
    await library.set({ action: 'library', folder: join(here.root, 'skills'), commits: 'push' });
    await library.pull();
    expect(existsSync(join(here.root, 'skills', 'away', 'SKILL.md'))).toBe(true);

    there.write({ 'skills/later/SKILL.md': SKILL('later') });
    there.commit('Later');
    there.git('push', '--quiet');
    here.write({ 'skills/mine/SKILL.md': SKILL('mine') });
    here.commit('Mine');
    const failed = await refusal(() => library.pull());
    expect(failed.status).toBe(409);
    expect(failed.message).toMatch(/^Not pulled: .*(Not possible to fast-forward|fast-forward)/s);
    expect(here.git('log', '-1', '--format=%s')).toBe('Mine');
  });
});
