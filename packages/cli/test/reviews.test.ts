import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openRepo, readFileAtRevision, type BranchReviewInfo } from '@cpr/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import {
  AGENTS,
  branchReviews,
  GITIGNORE,
  readReview,
  REVIEW_ABOUT,
  reviewPath,
  reviewPlace,
  ReviewRefused,
  serializeReview,
  type BranchReviewFile,
} from '../src/reviews.js';

/**
 * main: A ── B ── M; agent: B ── W1 ── W2 (a branch written by an agent), and origin/topic at W1
 * with no local branch; origin/HEAD names main. The reviewer is ada@example.com.
 */
function agentRepo() {
  const repo = createRepo();
  const commit = (name: string, content = `export const ${name} = 1;\n`) => {
    repo.write({ [`src/${name}.ts`]: content });
    return repo.commit(name);
  };
  commit('A');
  const B = commit('B');
  repo.git('switch', '--quiet', '--create', 'agent');
  const W1 = commit('W1');
  const W2 = commit('W2');
  repo.git('switch', '--quiet', 'main');
  const M = commit('M');
  repo.git('remote', 'add', 'origin', 'https://example.com/never-fetched.git');
  repo.git('update-ref', 'refs/remotes/origin/main', M);
  repo.git('update-ref', 'refs/remotes/origin/topic', W1);
  repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  repo.git('config', 'user.email', 'ada@example.com');
  return { repo, shas: { B, W1, W2, M } };
}

const repos: TestRepo[] = [];
const caches: string[] = [];
let cache: string;
beforeEach(() => {
  // The developer's own git config (user.email) must not leak in.
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  cache = tempDir();
  caches.push(cache);
});
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
  for (const dir of caches.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const fresh = () => {
  const made = agentRepo();
  repos.push(made.repo);
  return made;
};
const NOW = new Date('2026-10-14T10:12:00Z');

describe('AGENTS', () => {
  it('tells agents about workspaces and where they are kept (V25)', () => {
    expect(AGENTS).toContain('## Workspaces');
    expect(AGENTS).toContain('`cpr/workspaces/<branch>.json`');
    expect(AGENTS).not.toMatch(/\bfeatures?\b/);
  });
});

describe('reviewPath', () => {
  it("nests a branch's folders and names the file by its reviewer", () => {
    expect(reviewPath('/r', 'milestone/v14-checkout', 'ada@example.com')).toBe(
      join('/r', 'milestone', 'v14-checkout', 'ada@example.com.json'),
    );
    expect(reviewPath('/r', 'wip', 'odd/name@x y')).toBe(join('/r', 'wip', 'odd_name@x_y.json'));
    expect(() => reviewPath('/r', '../out', 'ada@example.com')).toThrow();
  });
});

describe('serializeReview', () => {
  it('writes sorted keys, one mark per line: the same review gives the same bytes', () => {
    const review: BranchReviewFile = {
      updated: '2026-10-14T10:12:00Z',
      summary: '',
      reviewer: 'ada@example.com',
      marks: { 'src/b.ts#b': '2', 'src/a.ts#a': '1' },
      head: 'h',
      drafts: [{ symbol: 'src/a.ts#a', body: 'why?', id: 'x' }],
      branch: 'agent',
      base: 'b',
      verdicts: [],
    };
    const text = serializeReview(review);
    expect(text).toBe(
      [
        '{',
        `  "about": "${REVIEW_ABOUT}",`,
        '  "base": "b",',
        '  "branch": "agent",',
        '  "drafts": [',
        '    {',
        '      "body": "why?",',
        '      "id": "x",',
        '      "symbol": "src/a.ts#a"',
        '    }',
        '  ],',
        '  "head": "h",',
        '  "marks": {',
        '    "src/a.ts#a": "1",',
        '    "src/b.ts#b": "2"',
        '  },',
        '  "reviewer": "ada@example.com",',
        '  "summary": "",',
        '  "updated": "2026-10-14T10:12:00Z",',
        '  "verdicts": []',
        '}',
        '',
      ].join('\n'),
    );
    expect(serializeReview(JSON.parse(text) as BranchReviewFile)).toBe(text);
  });
});

describe('readReview', () => {
  it('reads a review, and nothing from a missing or invalid file', async () => {
    const dir = tempDir();
    caches.push(dir);
    expect(await readReview(join(dir, 'none.json'))).toBeNull();
    writeFileSync(join(dir, 'bad.json'), '{ not json');
    expect(await readReview(join(dir, 'bad.json'))).toBeNull();
    writeFileSync(join(dir, 'odd.json'), '[]');
    expect(await readReview(join(dir, 'odd.json'))).toBeNull();
  });
});

describe('reviewPlace', () => {
  it('is cpr/reviews/ as the git user, else the cache with why', async () => {
    const { repo } = fresh();
    const open = await openRepo(repo.root);
    expect(await reviewPlace(open, cache)).toEqual({
      dir: join(repo.root, 'cpr', 'reviews'),
      reviewer: 'ada@example.com',
      place: 'repository',
      gitignore: join(repo.root, 'cpr', '.gitignore'),
      agents: join(repo.root, 'cpr', 'AGENTS.md'),
    });
    // The project's own cpr/config.json is CPR's: still the repository; so are the agents'
    // instructions CPR writes, once a team commits its reviews with them (V17).
    repo.write({
      'cpr/config.json': '{ "plugins": [] }\n',
      'cpr/AGENTS.md': AGENTS,
    });
    repo.commit('config');
    expect((await reviewPlace(open, cache)).place).toBe('repository');
    // So are the merger's rules (V26c), which a team commits to share them.
    repo.write({ 'cpr/merge.md': 'Keep both changelog entries.\n' });
    repo.commit('merge rules');
    expect((await reviewPlace(open, cache)).place).toBe('repository');

    repo.git('config', '--unset', 'user.email');
    expect(await reviewPlace(open, cache)).toMatchObject({
      dir: join(cache, 'state', open.id, 'reviews'),
      agents: join(cache, 'state', open.id, 'AGENTS.md'),
      reviewer: 'local',
      place: 'cache',
      note: expect.stringContaining('git config user.email') as string,
    });
  });

  it("leaves a project's own cpr/ folder alone", async () => {
    const { repo } = fresh();
    repo.write({ 'cpr/__init__.py': '' });
    repo.commit('a package named cpr');
    const open = await openRepo(repo.root);
    expect(await reviewPlace(open, cache)).toMatchObject({
      place: 'cache',
      reviewer: 'ada@example.com',
      note: expect.stringContaining('cpr/') as string,
    });
  });
});

describe('branchReviews', () => {
  it('reviews a branch from its fork point to its tip', async () => {
    const { repo, shas } = fresh();
    const reviews = branchReviews(await openRepo(repo.root), cache, { now: () => NOW });
    expect(await reviews.resolve('agent')).toEqual({
      info: {
        branch: 'agent',
        ref: 'agent',
        base: shas.B,
        head: shas.W2,
        reviewed: null,
        since: null,
        // V17: what an approval merges into.
        into: 'main',
      },
      pair: { base: shas.B, head: shas.W2 },
    });
    // A remote branch is its branch name; one with no local branch is found by that name too.
    expect((await reviews.resolve('origin/topic')).info).toMatchObject({
      branch: 'topic',
      ref: 'origin/topic',
      head: shas.W1,
    });
    expect((await reviews.resolve('topic')).info.ref).toBe('origin/topic');
  });

  it('refuses unknown refs, the default branch and merged branches', async () => {
    const { repo } = fresh();
    repo.git('branch', 'done', 'main~1');
    const reviews = branchReviews(await openRepo(repo.root), cache, { now: () => NOW });
    await expect(reviews.resolve('nope')).rejects.toThrow(ReviewRefused);
    await expect(reviews.resolve('-x')).rejects.toThrow(ReviewRefused);
    await expect(reviews.resolve('main')).rejects.toThrow(/default branch/);
    await expect(reviews.resolve('origin/main')).rejects.toThrow(/default branch/);
    await expect(reviews.resolve('done')).rejects.toThrow(/merged into main/);
  });

  it('keeps marks and drafts in cpr/reviews/, out of git, and never stages them', async () => {
    const { repo, shas } = fresh();
    const reviews = branchReviews(await openRepo(repo.root), cache, { now: () => NOW });
    const { info } = await reviews.resolve('agent');
    const store = reviews.state(info);
    expect(await store.read('review')).toBeNull();
    expect(await store.read('drafts')).toBeNull();

    await store.write('review', { 'src/W1.ts#W1': 'x|y' });
    await store.write('drafts', { drafts: [{ id: 'd1', body: 'why?' }], body: 'Looks fine' });
    const file = join(repo.root, 'cpr', 'reviews', 'agent', 'ada@example.com.json');
    expect(await readReview(file)).toEqual({
      base: shas.B,
      branch: 'agent',
      drafts: [{ id: 'd1', body: 'why?' }],
      head: shas.W2,
      marks: { 'src/W1.ts#W1': 'x|y' },
      reviewer: 'ada@example.com',
      summary: 'Looks fine',
      updated: NOW.toISOString(),
      verdicts: [],
    });
    expect(await store.read('review')).toEqual({ 'src/W1.ts#W1': 'x|y' });
    expect(await store.read('drafts')).toEqual({
      drafts: [{ id: 'd1', body: 'why?' }],
      body: 'Looks fine',
    });

    // Out of git: nothing to commit, nothing staged; the agents' instructions beside them (V17).
    expect(readFileSync(join(repo.root, 'cpr', '.gitignore'), 'utf8')).toBe(GITIGNORE);
    expect(readFileSync(join(repo.root, 'cpr', 'AGENTS.md'), 'utf8')).toBe(AGENTS);
    expect(repo.git('status', '--porcelain', '--untracked-files=all')).toBe('');
    // Deleting cpr/.gitignore shares them: the review is an untracked file like any other.
    rmSync(join(repo.root, 'cpr', '.gitignore'));
    expect(repo.git('status', '--porcelain', '--untracked-files=all')).toBe(
      ['?? cpr/AGENTS.md', '?? cpr/reviews/agent/ada@example.com.json'].join('\n'),
    );
  });

  it("tells a workspace's agent about its record and plan first; CPR merges an approval (V18c, V26)", () => {
    expect(AGENTS).toContain('## Workspaces');
    expect(AGENTS).toContain('cpr/workspaces/<branch>.json');
    expect(AGENTS).toMatch(/`planFirst`.*stop/s);
    expect(AGENTS).not.toContain('## Approved in a linked worktree');
    expect(AGENTS).toMatch(/Do not merge it yourself/);
  });

  it("rewrites the agents' instructions when CPR's differ, and points every review at them", async () => {
    const { repo } = fresh();
    repo.write({ 'cpr/AGENTS.md': '# an older CPR\n' });
    const reviews = branchReviews(await openRepo(repo.root), cache, { now: () => NOW });
    const { info } = await reviews.resolve('agent');
    await reviews.state(info).write('review', {});
    expect(readFileSync(join(repo.root, 'cpr', 'AGENTS.md'), 'utf8')).toBe(AGENTS);
    expect(AGENTS).toMatch(/^# CPR reviews\n\nWritten by CPR, which rewrites this file/);
    const text = readFileSync(
      join(repo.root, 'cpr', 'reviews', 'agent', 'ada@example.com.json'),
      'utf8',
    );
    expect(text.split('\n')[1]).toBe(`  "about": "${REVIEW_ABOUT}",`);
    expect(REVIEW_ABOUT).toContain('AGENTS.md');
  });

  it('never changes an existing cpr/.gitignore', async () => {
    const { repo } = fresh();
    repo.write({ 'cpr/.gitignore': '# ours\n' });
    const reviews = branchReviews(await openRepo(repo.root), cache, { now: () => NOW });
    const { info } = await reviews.resolve('agent');
    await reviews.state(info).write('review', {});
    expect(readFileSync(join(repo.root, 'cpr', '.gitignore'), 'utf8')).toBe('# ours\n');
  });

  it("keeps the merger's rules in git, and updates the cpr/.gitignore an earlier CPR wrote", async () => {
    const { repo } = fresh();
    // What CPR wrote from V15 on: it hid cpr/merge.md, which the project means to share.
    const earlier =
      '# Written by CPR: reviews stay on this machine. Delete this file to commit and share them.\n' +
      '*\n!config.json\n';
    repo.write({ 'cpr/.gitignore': earlier, 'cpr/merge.md': 'Keep both changelog entries.\n' });
    const reviews = branchReviews(await openRepo(repo.root), cache, { now: () => NOW });
    const { info } = await reviews.resolve('agent');
    await reviews.state(info).write('review', {});
    expect(readFileSync(join(repo.root, 'cpr', '.gitignore'), 'utf8')).toBe(GITIGNORE);
    expect(repo.git('status', '--porcelain', '--untracked-files=all')).toBe('?? cpr/merge.md');
  });

  it('says what came after the last review, on the page and on the commits page', async () => {
    const { repo, shas } = fresh();
    const open = await openRepo(repo.root);
    const reviews = branchReviews(open, cache, { now: () => NOW });
    // Reviewed at W1 (the agent had made one commit), then the agent added W2.
    const first = await reviews.resolve('agent');
    await reviews.state({ ...first.info, head: shas.W1 }).write('review', { 'src/W1.ts#W1': 'x' });

    expect((await reviews.resolve('agent')).info).toMatchObject({ reviewed: shas.W1, since: 1 });
    expect(await reviews.list()).toEqual({
      defaultBranch: 'main',
      reviewer: 'ada@example.com',
      place: 'repository',
      reviews: [
        {
          branch: 'agent',
          base: shas.B,
          head: shas.W1,
          updated: NOW.toISOString(),
          marks: 1,
          refs: [{ name: 'agent', tip: shas.W2, since: 1 }],
          added: [shas.W2],
        },
      ],
    });

    // Reviewed at the tip: nothing since.
    await reviews.state(first.info).write('review', { 'src/W1.ts#W1': 'x' });
    expect((await reviews.resolve('agent')).info).toMatchObject({ reviewed: shas.W2, since: 0 });
    expect((await reviews.list()).reviews[0]).toMatchObject({
      refs: [{ name: 'agent', tip: shas.W2, since: 0 }],
      added: [],
    });
  });

  it("counts only the branch's own commits since: not the default branch's merged into it", async () => {
    const { repo, shas } = fresh();
    const open = await openRepo(repo.root);
    const reviews = branchReviews(open, cache, { now: () => NOW });
    const first = await reviews.resolve('agent');
    await reviews.state(first.info).write('review', { 'src/W1.ts#W1': 'x' });
    // main moves on by two, and the agent merges it in (as for a conflict).
    repo.write({ 'src/N1.ts': 'export const N1 = 1;\n' });
    repo.commit('N1');
    repo.write({ 'src/N2.ts': 'export const N2 = 1;\n' });
    repo.commit('N2');
    repo.git('switch', '--quiet', 'agent');
    repo.git('merge', '--quiet', '--no-edit', 'main');
    const merge = repo.git('rev-parse', 'HEAD');
    repo.git('switch', '--quiet', 'main');

    expect((await reviews.resolve('agent')).info).toMatchObject({ reviewed: shas.W2, since: 1 });
    expect((await reviews.list()).reviews[0]).toMatchObject({
      refs: [{ name: 'agent', tip: merge, since: 1 }],
      added: [merge],
    });
  });

  it('keeps reviews in the cache without a git user, and says so', async () => {
    const { repo } = fresh();
    repo.git('config', '--unset', 'user.email');
    const open = await openRepo(repo.root);
    const reviews = branchReviews(open, cache, { now: () => NOW });
    const { info } = await reviews.resolve('agent');
    expect(info.note).toContain('git config user.email');
    await reviews.state(info).write('review', { a: 'b' });
    expect(existsSync(join(repo.root, 'cpr'))).toBe(false);
    expect(existsSync(join(cache, 'state', open.id, 'reviews', 'agent', 'local.json'))).toBe(true);
    expect(readFileSync(join(cache, 'state', open.id, 'AGENTS.md'), 'utf8')).toBe(AGENTS);
    expect((await reviews.list()).place).toBe('cache');
  });
});

/** `agentRepo` with a bare `origin` holding main at M, main tracking it. */
function pushedRepo() {
  const made = fresh();
  const bare = tempDir();
  caches.push(bare);
  made.repo.git('init', '--quiet', '--bare', bare);
  made.repo.git('remote', 'set-url', 'origin', bare);
  made.repo.git('push', '--quiet', 'origin', 'main');
  made.repo.git('fetch', '--quiet', 'origin');
  made.repo.git('branch', '--set-upstream-to=origin/main', 'main');
  const remote = (...args: string[]) => made.repo.git('--git-dir', bare, ...args);
  return { ...made, remote };
}
const reader =
  (root: string, info: BranchReviewInfo) => async (side: 'base' | 'head', path: string) =>
    readFileAtRevision(await openRepo(root), side === 'head' ? info.head : info.base, path);
const APPROVE = { event: 'approve' as const, body: '', comments: [] };
const REQUEST = {
  event: 'request-changes' as const,
  body: 'Two things.',
  comments: [
    {
      id: 'c1',
      symbol: 'src/W2.ts#W2',
      side: 'head' as const,
      path: 'src/W2.ts',
      otherPath: 'src/W2.ts',
      line: 1,
      body: 'Rename it.',
    },
    { id: 'c2', symbol: 'src/W1.ts#W1', body: 'Why a constant?' },
  ],
};
const reviewFile = (root: string, branch = 'agent') =>
  readReview(join(root, 'cpr', 'reviews', branch, 'ada@example.com.json'));

describe('finishing a branch review (V16, V17)', () => {
  it('records the verdict with each comment and its code, clears the drafts, pushes nothing', async () => {
    const { repo, shas, remote } = pushedRepo();
    const reviews = branchReviews(await openRepo(repo.root), cache, { now: () => NOW });
    const { info } = await reviews.resolve('agent');
    await reviews.state(info).write('drafts', { drafts: [{ id: 'c1' }], body: 'Two things.' });

    const result = await reviews.finish(info, REQUEST, reader(repo.root, info));
    const file = await reviewFile(repo.root);
    expect(file?.verdicts).toEqual([
      {
        at: NOW.toISOString(),
        comments: [
          {
            body: 'Rename it.',
            code: 'export const W2 = 1;',
            id: 'c1',
            line: 1,
            path: 'src/W2.ts',
            side: 'head',
            symbol: 'src/W2.ts#W2',
          },
          { body: 'Why a constant?', id: 'c2', symbol: 'src/W1.ts#W1' },
        ],
        event: 'request-changes',
        head: shas.W2,
        summary: 'Two things.',
      },
    ]);
    expect(file).toMatchObject({ drafts: [], summary: '', head: shas.W2 });
    expect(result.verdict).toEqual(file?.verdicts[0]);
    expect(() => remote('rev-parse', '--verify', '--quiet', 'agent')).toThrow();
    // The text for a chat: the summary, then each comment with its place and code.
    expect(result.text).toBe(
      [
        `Address this review of the branch agent (ada@example.com, at ${shas.W2.slice(0, 7)}): ` +
          'changes requested.',
        '',
        'Two things.',
        '',
        'src/W2.ts:1 · W2',
        '    export const W2 = 1;',
        'Rename it.',
        '',
        'About W1:',
        'Why a constant?',
        '',
        'The review: cpr/reviews/agent/ada@example.com.json; how to act on it: cpr/AGENTS.md.',
        '',
      ].join('\n'),
    );
    // The commits page and the review page see the outcome.
    expect((await reviews.list()).reviews[0]?.verdict).toEqual({
      event: 'request-changes',
      head: shas.W2,
      at: NOW.toISOString(),
      comments: 2,
      merged: false,
    });
    expect((await reviews.resolve('agent')).info.verdict).toEqual({
      event: 'request-changes',
      head: shas.W2,
      at: NOW.toISOString(),
    });
  });

  it('records an approval of the reviewed commit and where it merges; pushes nothing (V17)', async () => {
    const { repo, shas, remote } = pushedRepo();
    const reviews = branchReviews(await openRepo(repo.root), cache, { now: () => NOW });
    const { info } = await reviews.resolve('agent');
    // The agent commits again while the review is open: not approved.
    repo.git('switch', '--quiet', 'agent');
    repo.write({ 'src/W3.ts': 'export const W3 = 1;\n' });
    repo.commit('W3');
    repo.git('switch', '--quiet', 'main');

    const result = await reviews.finish(info, APPROVE, reader(repo.root, info));
    expect(result).toEqual({
      verdict: {
        at: NOW.toISOString(),
        comments: [],
        event: 'approve',
        head: shas.W2,
        into: 'main',
        summary: '',
      },
      text: [
        `Approved the branch agent at ${shas.W2.slice(0, 7)}: CPR merges ${shas.W2.slice(0, 7)} into main; do not merge it yourself.`,
        '',
        'The review: cpr/reviews/agent/ada@example.com.json; how to act on it: cpr/AGENTS.md.',
        '',
      ].join('\n'),
    });
    expect(() => remote('rev-parse', '--verify', '--quiet', 'agent')).toThrow();
    expect(repo.git('rev-parse', 'main')).toBe(shas.M);
    expect((await reviews.list()).reviews[0]?.verdict).toEqual({
      event: 'approve',
      head: shas.W2,
      at: NOW.toISOString(),
      comments: 0,
      into: 'main',
      merged: false,
    });

    // The agent merges the approved commit: the commits page says so.
    repo.git('merge', '--quiet', '--no-ff', '--no-edit', shas.W2);
    expect((await reviews.list()).reviews[0]?.verdict).toMatchObject({ merged: true });
  });

  it('checks whether the branch merges cleanly into the default branch (V17)', async () => {
    const { repo } = fresh();
    const reviews = branchReviews(await openRepo(repo.root), cache, { now: () => NOW });
    expect(await reviews.merge((await reviews.resolve('agent')).info)).toEqual({
      into: 'main',
      clean: true,
    });
    // main changes W1.ts, which the agent wrote: both added it, differently.
    repo.write({ 'src/W1.ts': 'export const W1 = 2;\n' });
    repo.commit('W1 on main');
    expect(await reviews.merge((await reviews.resolve('agent')).info)).toEqual({
      into: 'main',
      conflicts: ['src/W1.ts'],
    });
  });

  it('reviews the default branch from where it was last pushed', async () => {
    const { repo, shas, remote } = pushedRepo();
    const reviews = branchReviews(await openRepo(repo.root), cache, { now: () => NOW });
    await expect(reviews.resolve('main')).rejects.toThrow(/no unpushed commits/);
    await expect(reviews.resolve('origin/main')).rejects.toThrow(/default branch/);
    // The agent commits on main itself.
    repo.write({ 'src/X.ts': 'export const X = 1;\n' });
    const X = repo.commit('X');
    const { info, pair } = await reviews.resolve('main');
    expect(pair).toEqual({ base: shas.M, head: X });
    // Nothing to merge into: an approval says the commits may be pushed (V17), and pushes none.
    expect(info.into).toBeUndefined();
    expect(await reviews.merge(info)).toBeNull();
    const result = await reviews.finish(info, APPROVE, reader(repo.root, info));
    expect(result.verdict).not.toHaveProperty('into');
    expect(result.text.split('\n')[0]).toBe(
      `Approved the unpushed commits of main up to ${X.slice(0, 7)}: they may be pushed.`,
    );
    expect(remote('rev-parse', 'main')).toBe(shas.M);
  });
});
