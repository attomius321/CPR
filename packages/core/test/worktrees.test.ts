import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addWorktree,
  branchNameProblem,
  listRefs,
  listWorktrees,
  mainWorktree,
  openRepo,
  uncommittedFiles,
  WorktreeRefused,
} from '../src/index.js';
import { createRepo, tempDir, type TestRepo } from './helpers/git-repo.js';

/** main: A ── B; a remote `origin` (never fetched) with origin/taken at A. */
function featureRepo() {
  const repo = createRepo();
  repo.write({ 'a.ts': 'export const a = 1;\n' });
  const A = repo.commit('A');
  repo.write({ 'b.ts': 'export const b = 1;\n' });
  const B = repo.commit('B');
  repo.git('remote', 'add', 'origin', 'https://example.com/never-fetched.git');
  repo.git('update-ref', 'refs/remotes/origin/taken', A);
  return { repo, shas: { A, B } };
}

const repos: TestRepo[] = [];
const fresh = () => {
  const made = featureRepo();
  repos.push(made.repo);
  return made;
};
// Worktrees go beside a repository, in folders of their own.
const folders: string[] = [];
const elsewhere = () => {
  const folder = tempDir();
  folders.push(folder);
  return folder;
};
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('addWorktree', () => {
  it('creates the branch at the base, checked out in a new worktree; the checkout stays', async () => {
    const { repo, shas } = fresh();
    const git = await openRepo(repo.root);
    const folder = join(elsewhere(), 'feature-csv');
    const made = await addWorktree(git, { folder, branch: 'feature/csv', base: shas.A });
    expect(made).toEqual({ path: folder, head: shas.A, branch: 'feature/csv' });
    expect(repo.git('rev-parse', 'feature/csv')).toBe(shas.A);
    expect(repo.git('branch', '--show-current')).toBe('main');
    expect(repo.git('status', '--porcelain')).toBe('');
    expect(existsSync(join(folder, 'a.ts'))).toBe(true);
    expect(existsSync(join(folder, 'b.ts'))).toBe(false);
  });

  it('refuses a branch that exists, a folder that exists, a bad name and a base not a commit', async () => {
    const { repo, shas } = fresh();
    const git = await openRepo(repo.root);
    const place = elsewhere();
    const add = (branch: string, folder: string, base = shas.B) =>
      addWorktree(git, { folder: join(place, folder), branch, base });

    await expect(add('main', 'one')).rejects.toThrow(WorktreeRefused);
    await expect(add('main', 'one')).rejects.toThrow(/already exists/);
    expect(existsSync(join(place, 'one'))).toBe(false);

    mkdirSync(join(place, 'two'));
    await expect(add('feature/two', 'two')).rejects.toThrow(/two.* exists/);
    expect(repo.git('branch', '--list', 'feature/two')).toBe('');

    await expect(add('feature/a..b', 'three')).rejects.toThrow(WorktreeRefused);
    await expect(add('-x', 'four')).rejects.toThrow(WorktreeRefused);
    await expect(add('feature/five', 'five', 'main')).rejects.toThrow(/full SHA/);
    await expect(add('feature/six', 'six', '0'.repeat(40))).rejects.toThrow(/not a commit/);
    expect(repo.git('branch', '--list', 'feature/*')).toBe('');
  });
});

describe('listWorktrees and mainWorktree', () => {
  it('lists the checkout and its worktrees; from either, the main one is the checkout', async () => {
    const { repo, shas } = fresh();
    const git = await openRepo(repo.root);
    const folder = join(elsewhere(), 'feature-csv');
    await addWorktree(git, { folder, branch: 'feature/csv', base: shas.A });
    repo.git('worktree', 'add', '--quiet', '--detach', join(elsewhere(), 'loose'), shas.B);

    // The main worktree first; git orders the others by their folders.
    const [main, ...linked] = (await listWorktrees(git)).map((w) => ({
      ...w,
      path: realpathSync(w.path),
    }));
    expect(main).toEqual({ path: repo.root, head: shas.B, branch: 'main' });
    expect(linked).toHaveLength(2);
    expect(linked).toContainEqual({
      path: realpathSync(folder),
      head: shas.A,
      branch: 'feature/csv',
    });
    expect(linked).toContainEqual(
      expect.objectContaining({ head: shas.B, detached: true }) as unknown,
    );

    expect(realpathSync(mainWorktree(git))).toBe(repo.root);
    const fromFeature = await openRepo(folder);
    expect(realpathSync(mainWorktree(fromFeature))).toBe(repo.root);
  });
});

describe('listRefs and worktrees', () => {
  it("names the worktree of a branch checked out elsewhere, not the checkout's own", async () => {
    const { repo, shas } = fresh();
    const git = await openRepo(repo.root);
    const folder = join(elsewhere(), 'feature-csv');
    await addWorktree(git, { folder, branch: 'feature/csv', base: shas.A });
    repo.git('branch', 'idle', shas.A);

    const branches = (await listRefs(git)).branches;
    expect(branches.find((b) => b.name === 'main')).toEqual({ name: 'main', sha: shas.B });
    expect(branches.find((b) => b.name === 'idle')).toEqual({ name: 'idle', sha: shas.A });
    const feature = branches.find((b) => b.name === 'feature/csv');
    expect(realpathSync(feature?.worktree ?? '')).toBe(realpathSync(folder));

    // From the feature's worktree, `main` is the one checked out elsewhere.
    const fromFeature = (await listRefs(await openRepo(folder))).branches;
    expect(realpathSync(fromFeature.find((b) => b.name === 'main')?.worktree ?? '')).toBe(
      repo.root,
    );
    expect(fromFeature.find((b) => b.name === 'feature/csv')?.worktree).toBeUndefined();
  });
});

describe('branchNameProblem', () => {
  it('accepts a free, valid name; says why a name is refused', async () => {
    const { repo } = fresh();
    const git = await openRepo(repo.root);
    expect(await branchNameProblem(git, 'feature/csv')).toBeNull();
    expect(await branchNameProblem(git, 'main')).toBe('a branch main exists');
    expect(await branchNameProblem(git, 'taken')).toBe('origin has a branch taken');
    expect(await branchNameProblem(git, 'a..b')).toBe('not a valid branch name: a..b');
    expect(await branchNameProblem(git, 'has space')).toBe('not a valid branch name: has space');
    expect(await branchNameProblem(git, '-x')).toBe('a branch name cannot start with -');
    expect(await branchNameProblem(git, '')).toBe('a branch needs a name');
  });
});

describe('uncommittedFiles', () => {
  it("counts a worktree's files not committed yet: changed, added, new; ignored ones not", async () => {
    const { repo, shas } = fresh();
    const folder = join(elsewhere(), 'feature-csv');
    await addWorktree(await openRepo(repo.root), { folder, branch: 'feature/csv', base: shas.B });
    expect(await uncommittedFiles(folder)).toBe(0);
    writeFileSync(join(folder, 'a.ts'), 'export const a = 2;\n');
    mkdirSync(join(folder, 'src'));
    writeFileSync(join(folder, 'src', 'new.ts'), 'export const n = 1;\n');
    writeFileSync(join(folder, 'src', 'other.ts'), 'export const o = 1;\n');
    writeFileSync(join(folder, '.gitignore'), 'build/\n');
    mkdirSync(join(folder, 'build'));
    writeFileSync(join(folder, 'build', 'out.js'), '1;\n');
    // a.ts, src/new.ts, src/other.ts, .gitignore; build/ is ignored.
    expect(await uncommittedFiles(folder)).toBe(4);
    // The checkout it came from is not counted.
    expect(await uncommittedFiles(repo.root)).toBe(0);
  });
});
