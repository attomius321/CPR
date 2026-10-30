import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyStash,
  dropStash,
  GitRefused,
  listStashes,
  openRepo,
  stashChanges,
  workingChanges,
} from '../src/index.js';
import { createRepo, type TestRepo } from './helpers/git-repo.js';

const repos: TestRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

function repoWithChanges() {
  const repo = createRepo();
  repos.push(repo);
  repo.git('config', 'user.name', 'Symbiote Test');
  repo.git('config', 'user.email', 'test@example.com');
  repo.write({ 'a.txt': 'a\n' });
  repo.commit('A');
  repo.write({ 'a.txt': 'changed\n', 'new.txt': 'n\n' });
  return repo;
}

describe('stashes (decision 639)', () => {
  it('stashes every change, new files too, with a message; lists them newest first', async () => {
    const repo = repoWithChanges();
    const git = await openRepo(repo.root);
    await stashChanges(git, 'Halfway there');
    expect(await workingChanges(git)).toMatchObject({ staged: [], unstaged: [] });
    expect(existsSync(join(repo.root, 'new.txt'))).toBe(false);
    repo.write({ 'a.txt': 'again\n' });
    await stashChanges(git, '');
    const stashes = await listStashes(git);
    expect(stashes.map((s) => s.message)).toEqual(['WIP on main: A', 'Halfway there']);
    expect(stashes[1]).toMatchObject({ branch: 'main' });
    expect(stashes[0]!.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(stashes[0]!.date).toMatch(/^\d{4}-/);
  });

  it('applies a stash by its SHA and keeps it; pops one and drops it', async () => {
    const repo = repoWithChanges();
    const git = await openRepo(repo.root);
    await stashChanges(git, 'First');
    const [first] = await listStashes(git);
    expect(await applyStash(git, first!.sha, { pop: false })).toEqual({});
    expect(readFileSync(join(repo.root, 'new.txt'), 'utf8')).toBe('n\n');
    expect(await listStashes(git)).toHaveLength(1);
    repo.git('checkout', '--quiet', 'a.txt');
    repo.git('clean', '--quiet', '-f');
    expect(await applyStash(git, first!.sha, { pop: true })).toEqual({});
    expect(readFileSync(join(repo.root, 'a.txt'), 'utf8')).toBe('changed\n');
    expect(await listStashes(git)).toEqual([]);
  });

  it('drops a stash by its SHA, whatever its place; refuses one not listed', async () => {
    const repo = repoWithChanges();
    const git = await openRepo(repo.root);
    await stashChanges(git, 'Older');
    repo.write({ 'a.txt': 'newer\n' });
    await stashChanges(git, 'Newer');
    const older = (await listStashes(git))[1]!;
    await dropStash(git, older.sha);
    expect((await listStashes(git)).map((s) => s.message)).toEqual(['Newer']);
    await expect(dropStash(git, older.sha)).rejects.toThrow(GitRefused);
  });

  it('refuses with nothing to stash; a conflict on apply is said and the stash kept', async () => {
    const repo = repoWithChanges();
    const git = await openRepo(repo.root);
    await stashChanges(git, 'Mine');
    await expect(stashChanges(git, 'Empty')).rejects.toThrow('nothing to stash');
    repo.write({ 'a.txt': 'theirs\n' });
    repo.commit('Theirs');
    const [mine] = await listStashes(git);
    const { stopped } = await applyStash(git, mine!.sha, { pop: true });
    expect(stopped).toMatch(/conflict/i);
    expect(await listStashes(git)).toHaveLength(1);
    expect((await workingChanges(git)).unstaged.map((f) => f.status)).toContain('conflicted');
  });
});
