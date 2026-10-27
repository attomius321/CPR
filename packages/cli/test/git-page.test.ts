import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openRepo } from '@symbiote/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import type { FolderAt, OpenFolder } from '../src/editor.js';
import {
  BadGitWrite,
  GitOpenRefused,
  gitPage,
  parseGitOpen,
  parseGitWrite,
} from '../src/git-page.js';

const repos: TestRepo[] = [];
const folders: string[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
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

describe('parseGitOpen (V70)', () => {
  it("reads a commit's file, or a change's on its side", () => {
    expect(parseGitOpen('{"sha":"abc","path":"a.txt"}')).toEqual({ sha: 'abc', path: 'a.txt' });
    expect(parseGitOpen('{"path":"a.txt","staged":true}')).toEqual({ path: 'a.txt', staged: true });
    expect(parseGitOpen('{"path":"a.txt"}')).toEqual({ path: 'a.txt', staged: false });
  });

  it('refuses anything else', () => {
    expect(() => parseGitOpen('{}')).toThrow(BadGitWrite);
    expect(() => parseGitOpen('{"path":""}')).toThrow(BadGitWrite);
    expect(() => parseGitOpen('{"path":"a.txt","sha":1}')).toThrow(BadGitWrite);
    expect(() => parseGitOpen('{"path":"a.txt","staged":"yes"}')).toThrow(BadGitWrite);
    expect(() => parseGitOpen('"a.txt"')).toThrow(BadGitWrite);
  });
});

describe("gitPage's open: a file's diff in VS Code (V70)", () => {
  /** A repository, the page on it with a fake editor, and what the editor was asked. */
  function setUp() {
    const repo = createRepo();
    repos.push(repo);
    repo.git('config', 'user.name', 'Symbiote Test');
    repo.git('config', 'user.email', 'test@example.com');
    repo.git('config', 'commit.gpgsign', 'false');
    const revisions = tempDir();
    folders.push(revisions);
    const asked: { folder: string; at: FolderAt | undefined }[] = [];
    const openFolder: OpenFolder = (folder, at) => {
      asked.push({ folder, at });
      return Promise.resolve({ opened: true });
    };
    const page = async () => gitPage(await openRepo(repo.root), { openFolder, revisions });
    /** The one diff asked for: each side's path and content ("" for an empty side). */
    const last = () => {
      const { folder, at } = asked.at(-1)!;
      expect(folder).toBe(repo.root);
      if (!at || !('left' in at)) return { alone: at && 'path' in at ? at.path : undefined };
      return {
        left: at.left,
        right: at.right,
        before: readFileSync(at.left, 'utf8'),
        after: readFileSync(at.right, 'utf8'),
      };
    };
    return { repo, revisions, page, last };
  }

  it("opens a commit's file against its first parent, the checkout's own file on the right", async () => {
    const { repo, revisions, page, last } = setUp();
    repo.write({ 'a.txt': 'one\n', 'b.txt': 'b\n' });
    const first = repo.commit('First');
    repo.write({ 'a.txt': 'two\n' });
    const second = repo.commit('Second');
    await (await page()).open({ sha: second, path: 'a.txt' });
    expect(last()).toEqual({
      left: join(revisions, first, 'a.txt'),
      right: join(repo.root, 'a.txt'),
      before: 'one\n',
      after: 'two\n',
    });
    // Changed since: the commit's own copy, not what is on disk.
    repo.write({ 'a.txt': 'three\n' });
    await (await page()).open({ sha: second, path: 'a.txt' });
    expect(last()).toMatchObject({ right: join(revisions, second, 'a.txt'), after: 'two\n' });
  });

  it('opens a renamed file against its old path, a new one alone, a deleted one against nothing', async () => {
    const { repo, revisions, page, last } = setUp();
    const body = 'a body long enough\nfor git to find\nthe rename\n';
    repo.write({ 'old.txt': body, 'gone.txt': 'g\n' });
    const root = repo.commit('First');
    repo.git('mv', 'old.txt', 'new.txt');
    repo.git('rm', '--quiet', 'gone.txt');
    repo.write({ 'added.txt': 'new\n' });
    const sha = repo.commit('Second');
    const opened = await page();
    await opened.open({ sha, path: 'new.txt' });
    expect(last()).toMatchObject({ left: join(revisions, root, 'old.txt'), before: body });
    await opened.open({ sha, path: 'added.txt' });
    expect(last()).toEqual({ alone: join(repo.root, 'added.txt') });
    await opened.open({ sha, path: 'gone.txt' });
    expect(last()).toEqual({
      left: join(revisions, root, 'gone.txt'),
      right: join(revisions, 'empty', 'gone.txt'),
      before: 'g\n',
      after: '',
    });
    // A root commit's file: nothing before it.
    await opened.open({ sha: root, path: 'gone.txt' });
    expect(last()).toEqual({ alone: join(revisions, root, 'gone.txt') });
  });

  it('opens a staged file from HEAD to the index, a change not staged from the index to the disk', async () => {
    const { repo, revisions, page, last } = setUp();
    repo.write({ 'a.txt': 'one\n', 'b.txt': 'b\n', 'c.txt': 'c\n' });
    const head = repo.commit('First');
    repo.write({ 'a.txt': 'staged\n', 'b.txt': 'b2\n' });
    repo.git('add', 'a.txt', 'b.txt');
    repo.write({ 'a.txt': 'on disk\n', 'new.txt': 'n\n' });
    repo.git('rm', '--quiet', '--cached', 'c.txt');
    const blob = repo.git('rev-parse', ':a.txt');
    const opened = await page();
    // Changed again on disk: the index's copy on the right.
    await opened.open({ path: 'a.txt', staged: true });
    expect(last()).toEqual({
      left: join(revisions, head, 'a.txt'),
      right: join(revisions, 'index', blob, 'a.txt'),
      before: 'one\n',
      after: 'staged\n',
    });
    // Nothing else changed it: the checkout's own file.
    await opened.open({ path: 'b.txt', staged: true });
    expect(last()).toMatchObject({ right: join(repo.root, 'b.txt'), after: 'b2\n' });
    await opened.open({ path: 'a.txt', staged: false });
    expect(last()).toEqual({
      left: join(revisions, 'index', blob, 'a.txt'),
      right: join(repo.root, 'a.txt'),
      before: 'staged\n',
      after: 'on disk\n',
    });
    // Staged as deleted: HEAD's against nothing. New and not staged: alone.
    await opened.open({ path: 'c.txt', staged: true });
    expect(last()).toMatchObject({ before: 'c\n', after: '' });
    await opened.open({ path: 'new.txt', staged: false });
    expect(last()).toEqual({ alone: join(repo.root, 'new.txt') });
  });

  it('opens a conflicted file from HEAD to the disk, its markers in it', async () => {
    const { repo, revisions, page, last } = setUp();
    repo.write({ 'a.txt': 'one\n' });
    repo.commit('First');
    repo.git('checkout', '--quiet', '-b', 'other');
    repo.write({ 'a.txt': 'theirs\n' });
    repo.commit('Theirs');
    repo.git('checkout', '--quiet', 'main');
    repo.write({ 'a.txt': 'ours\n' });
    const head = repo.commit('Ours');
    expect(() => repo.git('merge', '--quiet', 'other')).toThrow();
    await (await page()).open({ path: 'a.txt', staged: false });
    const opened = last();
    expect(opened).toMatchObject({ left: join(revisions, head, 'a.txt'), before: 'ours\n' });
    expect(opened.after).toContain('<<<<<<<');
  });

  it("refuses a file the commit or the status does not list, and says the editor's failure", async () => {
    const { repo, page } = setUp();
    repo.write({ 'a.txt': 'one\n', 'b.txt': 'b\n' });
    repo.commit('First');
    repo.write({ 'a.txt': 'two\n' });
    const sha = repo.commit('Second');
    const opened = await page();
    const refusal = (request: Parameters<typeof opened.open>[0]) =>
      opened.open(request).then(
        () => null,
        (error: unknown) =>
          error instanceof GitOpenRefused ? [error.status, error.message] : String(error),
      );
    expect(await refusal({ sha, path: 'b.txt' })).toEqual([400, 'b.txt is not among its files']);
    expect(await refusal({ sha: 'f'.repeat(40), path: 'a.txt' })).toEqual([
      404,
      `no commit ${'f'.repeat(40)}`,
    ]);
    expect(await refusal({ path: 'a.txt', staged: false })).toEqual([
      400,
      'a.txt has no change not staged',
    ]);
    const spare = tempDir();
    folders.push(spare);
    const without = gitPage(await openRepo(repo.root), { revisions: spare });
    await expect(without.open({ sha, path: 'a.txt' })).rejects.toMatchObject({
      status: 409,
      message: 'no editor to open it in',
    });
    const failing = gitPage(await openRepo(repo.root), {
      revisions: spare,
      openFolder: () => Promise.resolve({ opened: false, message: 'code: not found' }),
    });
    await expect(failing.open({ sha, path: 'a.txt' })).rejects.toMatchObject({
      status: 502,
      message: 'code: not found',
    });
  });
});
