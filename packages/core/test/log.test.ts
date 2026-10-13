import { afterAll, describe, expect, it } from 'vitest';
import { isCommit, listCommits, openRepo, parseLog } from '../src/index.js';
import { createRepo } from './helpers/git-repo.js';

const US = '\x1f';
const record = (fields: string[]) => `${fields.join(US)}\0`;
const sha = (c: string) => c.repeat(40);

describe('parseLog', () => {
  it('reads commits, merges with two parents and the root commit', () => {
    const output =
      record([
        sha('c'),
        `${sha('a')} ${sha('b')}`,
        'Ada',
        '2026-10-01T10:00:00+02:00',
        '',
        'Merge',
      ]) + record([sha('a'), '', 'Grace Hopper', '2026-09-30T08:00:00Z', '', 'First']);
    expect(parseLog(output)).toEqual([
      {
        sha: sha('c'),
        parents: [sha('a'), sha('b')],
        author: 'Ada',
        date: '2026-10-01T10:00:00+02:00',
        subject: 'Merge',
        refs: [],
      },
      {
        sha: sha('a'),
        parents: [],
        author: 'Grace Hopper',
        date: '2026-09-30T08:00:00Z',
        subject: 'First',
        refs: [],
      },
    ]);
  });

  it('keeps a subject holding the separators', () => {
    const subject = `odd${US}subject, HEAD -> x`;
    const [commit] = parseLog(record([sha('a'), '', 'Ada', '2026-01-01T00:00:00Z', '', subject]));
    expect(commit?.subject).toBe(subject);
  });

  it('reads HEAD, branches, remote branches and tags; leaves out other refs', () => {
    const refs = [
      'HEAD -> refs/heads/main',
      'refs/remotes/origin/main',
      'refs/remotes/origin/HEAD',
      'tag: refs/tags/v1.0',
      'refs/heads/feature/x',
      'refs/cpr/github/7/head',
      'refs/stash',
    ].join(', ');
    const [commit] = parseLog(record([sha('a'), '', 'Ada', '2026-01-01T00:00:00Z', refs, 's']));
    expect(commit?.refs).toEqual([
      { kind: 'head', name: 'HEAD' },
      { kind: 'branch', name: 'main' },
      { kind: 'remote', name: 'origin/main' },
      { kind: 'tag', name: 'v1.0' },
      { kind: 'branch', name: 'feature/x' },
    ]);
  });

  it('reads a detached HEAD', () => {
    const [commit] = parseLog(record([sha('a'), '', 'Ada', '2026-01-01T00:00:00Z', 'HEAD', 's']));
    expect(commit?.refs).toEqual([{ kind: 'head', name: 'HEAD' }]);
  });

  it('returns nothing for empty output', () => {
    expect(parseLog('')).toEqual([]);
  });
});

describe('listCommits', () => {
  const repo = createRepo();
  const shas: string[] = [];
  for (let i = 1; i <= 5; i++) {
    repo.write({ 'a.ts': `export const a = ${i};\n` });
    shas.push(repo.commit(`commit ${i}`));
  }
  repo.git('tag', 'v1', shas[1] ?? '');
  afterAll(() => repo.cleanup());

  it("lists the current branch's commits, newest first, in pages", async () => {
    const git = await openRepo(repo.root);
    const first = await listCommits(git, { limit: 2 });
    expect(first.branch).toBe('main');
    expect(first.more).toBe(true);
    expect(first.commits.map((c) => c.subject)).toEqual(['commit 5', 'commit 4']);
    expect(first.commits[0]).toMatchObject({
      sha: shas[4],
      parents: [shas[3]],
      author: 'CPR Test',
      refs: [
        { kind: 'head', name: 'HEAD' },
        { kind: 'branch', name: 'main' },
      ],
    });
    expect(Number.isNaN(Date.parse(first.commits[0]?.date ?? ''))).toBe(false);

    const last = await listCommits(git, { skip: 2, limit: 3 });
    expect(last.more).toBe(false);
    expect(last.commits.map((c) => c.sha)).toEqual([shas[2], shas[1], shas[0]]);
    expect(last.commits[1]?.refs).toEqual([{ kind: 'tag', name: 'v1' }]);
    expect(last.commits[2]?.parents).toEqual([]);
  });

  it('says when HEAD is detached', async () => {
    repo.git('checkout', '--quiet', '--detach', shas[3] ?? '');
    try {
      const page = await listCommits(await openRepo(repo.root), { limit: 1 });
      expect(page.branch).toBeNull();
      expect(page.commits[0]?.sha).toBe(shas[3]);
    } finally {
      repo.git('checkout', '--quiet', 'main');
    }
  });

  it('lists nothing in a repository without commits', async () => {
    const empty = createRepo();
    try {
      expect(await listCommits(await openRepo(empty.root))).toEqual({
        branch: 'main',
        commits: [],
        more: false,
      });
    } finally {
      empty.cleanup();
    }
  });
});

describe('isCommit', () => {
  const repo = createRepo();
  repo.write({ 'a.ts': 'export {};\n' });
  const commit = repo.commit('one');
  afterAll(() => repo.cleanup());

  it('accepts only full SHAs of commits', async () => {
    const git = await openRepo(repo.root);
    const tree = repo.git('rev-parse', 'HEAD^{tree}');
    expect(await isCommit(git, commit)).toBe(true);
    expect(await isCommit(git, commit.slice(0, 7))).toBe(false);
    expect(await isCommit(git, 'HEAD')).toBe(false);
    expect(await isCommit(git, tree)).toBe(false);
    expect(await isCommit(git, sha('0'))).toBe(false);
    expect(await isCommit(git, `--output=${commit}`)).toBe(false);
  });
});
