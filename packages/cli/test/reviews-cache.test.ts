// `/api/reviews` cached (V94a, decision 900): each review's summary is kept under a key of its file
// and the tips it depends on, so a list with nothing changed runs no git for it, and a ref that
// moved runs git only for the reviews it touches. Git's calls are counted through core's helpers.
import { rmSync, writeFileSync } from 'node:fs';
import * as core from '@symbiote/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';

const calls = vi.hoisted(() => ({ commitsBetween: 0, isAncestor: 0, isCommit: 0 }));
vi.mock('@symbiote/core', async (original) => {
  const real = await original<typeof core>();
  return {
    ...real,
    commitsBetween: (...args: Parameters<typeof real.commitsBetween>) => {
      calls.commitsBetween += 1;
      return real.commitsBetween(...args);
    },
    isAncestor: (...args: Parameters<typeof real.isAncestor>) => {
      calls.isAncestor += 1;
      return real.isAncestor(...args);
    },
    isCommit: (...args: Parameters<typeof real.isCommit>) => {
      calls.isCommit += 1;
      return real.isCommit(...args);
    },
  };
});
const { branchReviews, reviewPath, reviewPlace, readReview, serializeReview } =
  await import('../src/reviews.js');

const gitCalls = () => calls.commitsBetween + calls.isAncestor + calls.isCommit;
const resetCalls = () => {
  calls.commitsBetween = 0;
  calls.isAncestor = 0;
  calls.isCommit = 0;
};

/** main: A ── B ── M; two agents' branches from B, one and two commits ahead. */
function twoAgents() {
  const repo = createRepo();
  const commit = (name: string) => {
    repo.write({ [`src/${name}.ts`]: `export const ${name} = 1;\n` });
    return repo.commit(name);
  };
  commit('A');
  commit('B');
  repo.git('switch', '--quiet', '--create', 'one');
  commit('O1');
  repo.git('switch', '--quiet', 'main');
  repo.git('switch', '--quiet', '--create', 'two');
  commit('T1');
  commit('T2');
  repo.git('switch', '--quiet', 'main');
  commit('M');
  repo.git('config', 'user.email', 'ada@example.com');
  return { repo, commit };
}

const repos: TestRepo[] = [];
const caches: string[] = [];
let cache: string;
beforeEach(() => {
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

async function reviewed() {
  const made = twoAgents();
  repos.push(made.repo);
  const open = await core.openRepo(made.repo.root);
  const reviews = branchReviews(open, cache, { now: () => new Date('2026-11-03T10:00:00Z') });
  for (const branch of ['one', 'two']) {
    const { info } = await reviews.resolve(branch);
    await reviews.state(info).write('review', { [`src/${branch}.ts#x`]: 'x' });
  }
  return { ...made, open, reviews };
}

describe('the reviews list, cached (V94a)', () => {
  it('runs no git for a review when nothing it depends on changed', async () => {
    const { reviews } = await reviewed();
    const first = await reviews.list();
    expect(first.reviews.map((r) => r.branch)).toEqual(['one', 'two']);
    resetCalls();
    expect(await reviews.list()).toEqual(first);
    expect(gitCalls()).toBe(0);
  });

  it('runs git again only for the review whose branch moved, and says what came since', async () => {
    const { repo, commit, reviews } = await reviewed();
    await reviews.list();
    repo.git('switch', '--quiet', 'two');
    const t3 = commit('T3');
    repo.git('switch', '--quiet', 'main');
    resetCalls();
    const list = await reviews.list();
    expect(list.reviews.find((r) => r.branch === 'two')).toMatchObject({
      refs: [{ name: 'two', tip: t3, since: 1 }],
      added: [t3],
    });
    expect(list.reviews.find((r) => r.branch === 'one')).toMatchObject({
      refs: [{ name: 'one', since: 0 }],
    });
    expect(calls.commitsBetween).toBe(1);
  });

  it("reads a review's file every time: a verdict written by another process shows", async () => {
    const { open, reviews } = await reviewed();
    await reviews.list();
    // Another process (an agent, Symbiote's MCP in another view) approves `one` at its tip.
    const where = await reviewPlace(open, cache);
    const path = reviewPath(where.dir, 'one', where.reviewer);
    const review = await readReview(path);
    if (!review) throw new Error('no review');
    review.verdicts.push({
      at: '2026-11-03T10:05:00Z',
      event: 'approve',
      head: review.head,
      into: 'main',
      summary: '',
      comments: [],
    });
    writeFileSync(path, serializeReview(review));
    resetCalls();
    const list = await reviews.list();
    expect(list.reviews.find((r) => r.branch === 'one')?.verdict).toMatchObject({
      event: 'approve',
      merged: false,
      number: 1,
    });
    // Only the changed review's merge check ran.
    expect(calls.isAncestor).toBe(1);
  });

  it('sees an approved commit merged once the branch it goes into moves', async () => {
    const { repo, open, reviews } = await reviewed();
    const where = await reviewPlace(open, cache);
    const path = reviewPath(where.dir, 'one', where.reviewer);
    const review = await readReview(path);
    if (!review) throw new Error('no review');
    review.verdicts.push({
      at: '2026-11-03T10:05:00Z',
      event: 'approve',
      head: review.head,
      into: 'main',
      summary: '',
      comments: [],
    });
    writeFileSync(path, serializeReview(review));
    expect((await reviews.list()).reviews[0]?.verdict).toMatchObject({ merged: false });
    repo.git('merge', '--quiet', '--no-ff', '--no-edit', 'one');
    expect((await reviews.list()).reviews[0]?.verdict).toMatchObject({ merged: true });
  });
});
