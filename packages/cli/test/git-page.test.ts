import { openRepo } from '@symbiote/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepo, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { BadGitWrite, gitPage, parseGitWrite } from '../src/git-page.js';

const repos: TestRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

describe('parseGitWrite (V66)', () => {
  it("reads each write's body", () => {
    expect(parseGitWrite('stage', '{"paths":["a.txt"]}')).toEqual({
      kind: 'stage',
      paths: ['a.txt'],
    });
    expect(parseGitWrite('commit', '{"message":"m","amend":true}')).toEqual({
      kind: 'commit',
      message: 'm',
      amend: true,
    });
    expect(
      parseGitWrite('branch', '{"action":"create","name":"x","at":"abc","checkout":false}'),
    ).toEqual({ kind: 'branch', action: 'create', name: 'x', at: 'abc' });
    expect(
      parseGitWrite('tag', '{"action":"create","name":"v1","at":"abc","message":"m"}'),
    ).toEqual({ kind: 'tag', action: 'create', name: 'v1', at: 'abc', message: 'm' });
    expect(parseGitWrite('pull', '')).toEqual({ kind: 'pull', mode: 'ff-only' });
    expect(parseGitWrite('pull', '{"mode":"rebase"}')).toEqual({ kind: 'pull', mode: 'rebase' });
    expect(parseGitWrite('fetch', '')).toEqual({ kind: 'fetch' });
  });

  it('refuses anything else', () => {
    expect(() => parseGitWrite('stage', '{"paths":"a.txt"}')).toThrow(BadGitWrite);
    expect(() => parseGitWrite('commit', '{}')).toThrow(BadGitWrite);
    expect(() => parseGitWrite('branch', '{"action":"move","name":"x"}')).toThrow(BadGitWrite);
    expect(() => parseGitWrite('pull', '{"mode":"force"}')).toThrow(BadGitWrite);
    expect(() => parseGitWrite('reset', '{}')).toThrow(BadGitWrite);
    expect(() => parseGitWrite('commit', '"m"')).toThrow(BadGitWrite);
  });
});

describe('gitPage (V66)', () => {
  it("refuses renaming or deleting a workspace's branch", async () => {
    const repo = createRepo();
    repos.push(repo);
    repo.write({ 'a.txt': 'a\n' });
    repo.commit('A');
    repo.git('branch', 'feature/x');
    const page = gitPage(await openRepo(repo.root), {
      workspaceBranches: () => Promise.resolve(['feature/x']),
    });
    await expect(
      page.write({ kind: 'branch', action: 'delete', name: 'feature/x', force: true }),
    ).rejects.toThrow("feature/x is a workspace's branch");
    await expect(
      page.write({ kind: 'branch', action: 'rename', name: 'feature/x', to: 'y' }),
    ).rejects.toThrow("a workspace's branch");
    expect(repo.git('branch', '--list', 'feature/x')).toContain('feature/x');
  });

  it('runs writes one at a time, in the order asked, a refusal not stopping the next', async () => {
    const repo = createRepo();
    repos.push(repo);
    repo.git('config', 'user.name', 'Symbiote Test');
    repo.git('config', 'user.email', 'test@example.com');
    repo.git('config', 'commit.gpgsign', 'false');
    repo.write({ 'a.txt': 'a\n' });
    repo.commit('A');
    repo.write({ 'a.txt': 'a2\n', 'b.txt': 'b\n' });
    const page = gitPage(await openRepo(repo.root));
    const [staged, refused, committed] = await Promise.allSettled([
      page.write({ kind: 'stage', paths: ['a.txt', 'b.txt'] }),
      page.write({ kind: 'stage', paths: ['nope.txt'] }),
      page.write({ kind: 'commit', message: 'Both' }),
    ]);
    expect(staged.status).toBe('fulfilled');
    expect(refused.status).toBe('rejected');
    expect(committed.status).toBe('fulfilled');
    expect(repo.git('show', '--name-only', '--format=%s', 'HEAD')).toBe('Both\n\na.txt\nb.txt');
  });
});
