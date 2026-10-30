import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openRepo } from '@symbiote/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { hiddenBranches, repositoryHiddenBranches } from '../src/git-hidden.js';

// The branches hidden from Git's graph, in a file (decision 645).
describe('hiddenBranches', () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('hides and shows branches by their full refs, sorted, its folder made', async () => {
    const file = join(dir, 'symbiote', 'git.json');
    const record = hiddenBranches(file);
    expect(await record.list()).toEqual([]);
    expect(await record.set('refs/remotes/origin/old', true)).toEqual(['refs/remotes/origin/old']);
    await record.set('refs/heads/wip', true);
    await record.set('refs/heads/wip', true);
    expect(await hiddenBranches(file).list()).toEqual([
      'refs/heads/wip',
      'refs/remotes/origin/old',
    ]);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      hidden: ['refs/heads/wip', 'refs/remotes/origin/old'],
    });
    expect(await record.set('refs/heads/wip', false)).toEqual(['refs/remotes/origin/old']);
  });

  it('reads a broken or foreign file as nothing hidden, and keeps only branches', async () => {
    const file = join(dir, 'git.json');
    for (const text of ['{', '[]', 'null', '{"hidden":"x"}', '{}']) {
      writeFileSync(file, text);
      expect(await hiddenBranches(file).list()).toEqual([]);
    }
    writeFileSync(file, '{"hidden":["refs/heads/a",1,"refs/tags/v1","HEAD"]}');
    expect(await hiddenBranches(file).list()).toEqual(['refs/heads/a']);
  });
});

describe('repositoryHiddenBranches', () => {
  let repo: TestRepo;
  let cache: string;
  beforeEach(() => {
    repo = createRepo();
    cache = tempDir();
  });
  afterEach(() => {
    repo.cleanup();
    rmSync(cache, { recursive: true, force: true });
  });

  it("keeps them beside the reviews, in symbiote/ with a git user, never committed", async () => {
    repo.git('config', 'user.email', 'test@example.com');
    const record = repositoryHiddenBranches(await openRepo(repo.root), cache);
    await record.set('refs/heads/wip', true);
    expect(JSON.parse(readFileSync(join(repo.root, 'symbiote', 'git.json'), 'utf8'))).toEqual({
      hidden: ['refs/heads/wip'],
    });
    expect(readFileSync(join(repo.root, 'symbiote', '.gitignore'), 'utf8')).toContain('*');
  });
});
