import { chmodSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  commitStaged,
  GitRefused,
  openRepo,
  stageFiles,
  unstageFiles,
  workingChanges,
  workingFileDiff,
  workingLines,
} from '../src/index.js';
import { createRepo, type TestRepo } from './helpers/git-repo.js';

const repos: TestRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

/** A repository with one commit (a.txt, b.txt, c.txt), its identity its own. */
function fresh() {
  const repo = createRepo();
  repos.push(repo);
  repo.git('config', 'user.name', 'Symbiote Test');
  repo.git('config', 'user.email', 'test@example.com');
  repo.git('config', 'commit.gpgsign', 'false');
  repo.git('config', 'core.hooksPath', '/dev/null');
  repo.write({ 'a.txt': 'one\ntwo\n', 'b.txt': 'b\n', 'c.txt': 'c\n' });
  const first = repo.commit('first');
  return { repo, first };
}

describe('workingChanges (V66c)', () => {
  it('lists staged files and changes not staged apart, new files with them', async () => {
    const { repo } = fresh();
    repo.write({ 'a.txt': 'one\n2\n', 'b.txt': 'b2\n', 'new/d.txt': 'd\n' });
    repo.git('add', 'b.txt');
    repo.git('rm', '--quiet', 'c.txt');
    const changes = await workingChanges(await openRepo(repo.root));
    expect(changes.staged).toEqual([
      { path: 'b.txt', status: 'modified' },
      { path: 'c.txt', status: 'deleted' },
    ]);
    expect(changes.unstaged).toEqual([
      { path: 'a.txt', status: 'modified' },
      { path: 'new/d.txt', status: 'untracked' },
    ]);
    expect(changes.operation).toBeNull();
  });

  it('lists a file staged then changed again on both sides', async () => {
    const { repo } = fresh();
    repo.write({ 'a.txt': 'one\n2\n' });
    repo.git('add', 'a.txt');
    repo.write({ 'a.txt': 'one\n2\n3\n' });
    const changes = await workingChanges(await openRepo(repo.root));
    expect(changes.staged).toEqual([{ path: 'a.txt', status: 'modified' }]);
    expect(changes.unstaged).toEqual([{ path: 'a.txt', status: 'modified' }]);
    const lines = await workingLines(await openRepo(repo.root));
    expect(lines.staged).toEqual([{ path: 'a.txt', added: 1, removed: 1 }]);
    expect(lines.unstaged).toEqual([{ path: 'a.txt', added: 1, removed: 0 }]);
  });

  it('lists a conflicted file once, with the merge in progress', async () => {
    const { repo } = fresh();
    repo.git('switch', '--quiet', '--create', 'other');
    repo.write({ 'a.txt': 'one\nother\n' });
    repo.commit('other');
    repo.git('switch', '--quiet', 'main');
    repo.write({ 'a.txt': 'one\nmain\n' });
    repo.commit('main');
    expect(() => repo.git('merge', '--quiet', 'other')).toThrow();
    const changes = await workingChanges(await openRepo(repo.root));
    expect(changes.staged).toEqual([]);
    expect(changes.unstaged).toEqual([{ path: 'a.txt', status: 'conflicted' }]);
    expect(changes.operation).toBe('merge');
  });
});

describe('workingFileDiff (V66c)', () => {
  it('gives a staged file against HEAD, a file not staged against the index, a new one whole', async () => {
    const { repo } = fresh();
    repo.write({ 'a.txt': 'one\n2\n' });
    repo.git('add', 'a.txt');
    repo.write({ 'a.txt': 'one\n2\n3\n', 'new.txt': 'fresh\n' });
    const opened = await openRepo(repo.root);
    const staged = await workingFileDiff(opened, 'a.txt', true);
    expect(staged).toContain('-two\n+2\n');
    expect(staged).not.toContain('+3');
    const unstaged = await workingFileDiff(opened, 'a.txt', false);
    expect(unstaged).toContain('+3\n');
    expect(unstaged).not.toContain('-two');
    expect(await workingFileDiff(opened, 'new.txt', false)).toContain('+fresh\n');
    // Only what the status lists.
    expect(await workingFileDiff(opened, 'b.txt', false)).toBeNull();
    expect(await workingFileDiff(opened, 'new.txt', true)).toBeNull();
  });
});

describe('stageFiles, unstageFiles and commitStaged (V66c)', () => {
  it('stages and unstages listed files, a deletion and a new file too', async () => {
    const { repo } = fresh();
    repo.write({ 'a.txt': 'one\n2\n', 'new.txt': 'fresh\n' });
    repo.git('rm', '--quiet', 'c.txt');
    const opened = await openRepo(repo.root);
    await stageFiles(opened, ['a.txt', 'new.txt']);
    expect((await workingChanges(opened)).staged.map((f) => f.path)).toEqual([
      'a.txt',
      'c.txt',
      'new.txt',
    ]);
    await unstageFiles(opened, ['a.txt', 'c.txt']);
    const changes = await workingChanges(opened);
    expect(changes.staged).toEqual([{ path: 'new.txt', status: 'added' }]);
    expect(changes.unstaged.map((f) => f.path)).toEqual(['a.txt', 'c.txt']);
  });

  it('refuses paths the status does not list', async () => {
    const { repo } = fresh();
    const opened = await openRepo(repo.root);
    await expect(stageFiles(opened, ['b.txt'])).rejects.toThrow(GitRefused);
    await expect(stageFiles(opened, ['--all'])).rejects.toThrow(GitRefused);
    await expect(unstageFiles(opened, ['a.txt'])).rejects.toThrow(GitRefused);
  });

  it('commits what is staged, with its message; amends the last commit', async () => {
    const { repo, first } = fresh();
    repo.write({ 'a.txt': 'one\n2\n', 'b.txt': 'b2\n' });
    const opened = await openRepo(repo.root);
    await stageFiles(opened, ['a.txt']);
    const made = await commitStaged(opened, { message: 'Second\n\nWhy.\n' });
    expect(made.sha).toBe(repo.git('rev-parse', 'HEAD'));
    expect(repo.git('log', '-1', '--format=%P%n%B')).toBe(`${first}\nSecond\n\nWhy.`);
    // b.txt was not staged: still a change.
    expect((await workingChanges(opened)).unstaged).toEqual([
      { path: 'b.txt', status: 'modified' },
    ]);

    await stageFiles(opened, ['b.txt']);
    const amended = await commitStaged(opened, { message: '', amend: true });
    expect(repo.git('log', '-1', '--format=%P%n%s')).toBe(`${first}\nSecond`);
    expect(repo.git('show', '--name-only', '--format=', amended.sha)).toBe('a.txt\nb.txt');
  });

  it('refuses a commit with nothing staged or no message, in git words or its own', async () => {
    const { repo } = fresh();
    repo.write({ 'a.txt': 'one\n2\n' });
    const opened = await openRepo(repo.root);
    await expect(commitStaged(opened, { message: 'Nothing' })).rejects.toThrow(/nothing is staged/);
    await stageFiles(opened, ['a.txt']);
    await expect(commitStaged(opened, { message: '  \n' })).rejects.toThrow(/a message/);
  });

  it("says a hook's refusal in git's words; nothing is committed", async () => {
    const { repo, first } = fresh();
    repo.git('config', '--unset', 'core.hooksPath');
    repo.write({ '.git/hooks/pre-commit': '#!/bin/sh\necho "lint failed: a.txt" >&2\nexit 1\n' });
    chmodSync(`${repo.root}/.git/hooks/pre-commit`, 0o755);
    repo.write({ 'a.txt': 'one\n2\n' });
    const opened = await openRepo(repo.root);
    await stageFiles(opened, ['a.txt']);
    await expect(commitStaged(opened, { message: 'Second' })).rejects.toThrow(/lint failed: a.txt/);
    expect(repo.git('rev-parse', 'HEAD')).toBe(first);
  });
});
