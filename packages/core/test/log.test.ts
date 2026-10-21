import { afterAll, describe, expect, it } from 'vitest';
import {
  commitDetails,
  hasCommitGraph,
  historyState,
  isCommit,
  openRepo,
  parseLog,
  streamHistory,
  type GitRepo,
  type HistoryRow,
  type HistoryScope,
} from '../src/index.js';
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
      'refs/symbiote/github/7/head',
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

// Every kind of tip, dated so graph order and date order differ nowhere but where a test says:
//
//   A ── B ── M ── C        main (HEAD); tag v1 on B; a stash on C
//    │    \── F ──/         feature, merged by M
//    │    \── W             wip, not merged
//    ├── T                  origin/topic: a remote branch only
//    ├── X                  tag old only (its branch deleted)
//    └── Y                  refs/symbiote/github/7/head only
function historyRepo() {
  const repo = createRepo();
  const commit = (name: string) => {
    repo.write({ [`${name}.ts`]: `export const ${name} = 1;\n` });
    return repo.commit(name);
  };
  const A = commit('A');
  const B = commit('B');
  repo.git('tag', 'v1', B);
  repo.git('switch', '--quiet', '--create', 'feature');
  const F = commit('F');
  repo.git('switch', '--quiet', '--create', 'wip', B);
  const W = commit('W');
  repo.git('switch', '--quiet', 'main');
  repo.git('merge', '--quiet', '--no-ff', '--message', 'M', 'feature');
  const M = repo.git('rev-parse', 'HEAD');
  const C = commit('C');
  const aside = (name: string) => {
    repo.git('switch', '--quiet', '--detach', A);
    const sha = commit(name);
    repo.git('switch', '--quiet', 'main');
    return sha;
  };
  const T = aside('T');
  repo.git('update-ref', 'refs/remotes/origin/topic', T);
  const X = aside('X');
  repo.git('tag', 'old', X);
  const Y = aside('Y');
  repo.git('update-ref', 'refs/symbiote/github/7/head', Y);
  repo.write({ 'C.ts': 'export const C = 2;\n' });
  repo.git('stash', '--quiet');
  return { repo, shas: { A, B, F, W, M, C, T, X, Y } };
}

async function listAll(repo: GitRepo, scope: HistoryScope): Promise<HistoryRow[]> {
  const rows: HistoryRow[] = [];
  await streamHistory(repo, scope, (batch) => rows.push(...batch));
  return rows;
}

/** Every commit listed above its parents. */
function inGraphOrder(rows: readonly HistoryRow[]): boolean {
  const at = new Map(rows.map((row, i) => [row.sha, i]));
  return rows.every((row, i) => row.parents.every((p) => (at.get(p) ?? Infinity) > i));
}

describe('streamHistory', () => {
  const { repo, shas } = historyRepo();
  const { A, B, F, W, M, C, T } = shas;
  afterAll(() => repo.cleanup());

  it('lists every branch, local and remote, in graph order; no tag, stash or symbiote ref', async () => {
    const rows = await listAll(await openRepo(repo.root), 'all');
    expect(new Set(rows.map((r) => r.sha))).toEqual(new Set([A, B, F, W, M, C, T]));
    expect(rows).toHaveLength(7);
    expect(inGraphOrder(rows)).toBe(true);
    expect(rows.find((r) => r.sha === M)?.parents).toEqual([B, F]);
    expect(rows.find((r) => r.sha === C)?.parents).toEqual([M]);
  });

  it("lists the current branch's commits alone, as git log --topo-order does", async () => {
    const rows = await listAll(await openRepo(repo.root), 'current');
    expect(rows.map((r) => r.sha)).toEqual(
      repo.git('rev-list', '--topo-order', 'HEAD').split('\n'),
    );
    expect(rows[0]).toEqual({ sha: C, parents: [M] });
  });

  it('lists a child above its parent even when dated before it', async () => {
    const skewed = createRepo();
    try {
      skewed.write({ 'a.ts': '1' });
      const parent = skewed.commitAt('parent', '2026-01-02T00:00:00Z');
      skewed.git('switch', '--quiet', '--create', 'newer');
      skewed.write({ 'b.ts': '1' });
      skewed.commitAt('newer', '2026-01-03T00:00:00Z');
      skewed.git('switch', '--quiet', 'main');
      skewed.write({ 'c.ts': '1' });
      const child = skewed.commitAt('child dated before its parent', '2026-01-01T00:00:00Z');
      // In date order git lists the parent first (the newer tip pulls it up).
      const byDate = skewed.git('log', '--format=%H', 'HEAD', '--branches').split('\n');
      expect(byDate.indexOf(parent)).toBeLessThan(byDate.indexOf(child));

      const rows = await listAll(await openRepo(skewed.root), 'all');
      expect(inGraphOrder(rows)).toBe(true);
      expect(rows.findIndex((r) => r.sha === child)).toBeLessThan(
        rows.findIndex((r) => r.sha === parent),
      );
    } finally {
      skewed.cleanup();
    }
  });

  it('lists nothing in a repository without commits', async () => {
    const empty = createRepo();
    try {
      expect(await listAll(await openRepo(empty.root), 'all')).toEqual([]);
      expect(await listAll(await openRepo(empty.root), 'current')).toEqual([]);
    } finally {
      empty.cleanup();
    }
  });
});

describe('commitDetails', () => {
  const { repo, shas } = historyRepo();
  afterAll(() => repo.cleanup());

  it('gives the commits asked for, in that order, with their branches and tags', async () => {
    const git = await openRepo(repo.root);
    const commits = await commitDetails(git, [shas.C, shas.X, shas.B]);
    expect(commits.map((c) => c.subject)).toEqual(['C', 'X', 'B']);
    expect(commits[0]).toMatchObject({
      sha: shas.C,
      parents: [shas.M],
      author: 'Symbiote Test',
      refs: [
        { kind: 'head', name: 'HEAD' },
        { kind: 'branch', name: 'main' },
      ],
    });
    expect(Number.isNaN(Date.parse(commits[0]?.date ?? ''))).toBe(false);
    expect(commits[1]?.refs).toEqual([{ kind: 'tag', name: 'old' }]);
    expect(commits[2]?.refs).toEqual([{ kind: 'tag', name: 'v1' }]);
    expect(await commitDetails(git, [])).toEqual([]);
  });
});

describe('historyState', () => {
  const { repo, shas } = historyRepo();
  afterAll(() => repo.cleanup());

  it('names the branch and HEAD; its version moves with HEAD and the branches only', async () => {
    const git = await openRepo(repo.root);
    const state = await historyState(git);
    expect(state).toMatchObject({ branch: 'main', head: shas.C });
    expect((await historyState(git)).version).toBe(state.version);

    repo.git('tag', 'v2', shas.C);
    expect((await historyState(git)).version).toBe(state.version);

    repo.git('branch', '--force', 'wip', shas.C);
    const moved = await historyState(git);
    expect(moved.version).not.toBe(state.version);

    repo.git('update-ref', 'refs/remotes/origin/other', shas.A);
    const fetched = await historyState(git);
    expect(fetched.version).not.toBe(moved.version);

    repo.git('switch', '--quiet', '--detach', shas.M);
    try {
      const detached = await historyState(git);
      expect(detached).toMatchObject({ branch: null, head: shas.M });
      expect(detached.version).not.toBe(fetched.version);
    } finally {
      repo.git('switch', '--quiet', 'main');
    }
  });

  it('has no HEAD in a repository without commits', async () => {
    const empty = createRepo();
    try {
      expect(await historyState(await openRepo(empty.root))).toMatchObject({
        branch: 'main',
        head: null,
      });
    } finally {
      empty.cleanup();
    }
  });
});

describe('hasCommitGraph', () => {
  it('says whether git keeps a commit-graph file', async () => {
    const repo = createRepo();
    try {
      repo.write({ 'a.ts': '1' });
      repo.commit('one');
      const git = await openRepo(repo.root);
      expect(hasCommitGraph(git)).toBe(false);
      repo.git('commit-graph', 'write', '--reachable');
      expect(hasCommitGraph(git)).toBe(true);
    } finally {
      repo.cleanup();
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
