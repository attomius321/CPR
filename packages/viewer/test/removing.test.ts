import type { MergeEntry } from '@symbiote/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginRemoval,
  endRemoval,
  mergeKey,
  removingNow,
  subscribeRemovals,
  workspaceKey,
} from '../src/workspaces/removing.js';

// The server's answers and the list's reads, held until a test lets them go.
const server = vi.hoisted(() => ({
  posts: [] as { path: string; settle: (ok: boolean) => void }[],
  reads: [] as (() => void)[],
}));

vi.mock('../src/ui/http.js', () => ({
  postJson: (path: string) =>
    new Promise((resolve, reject) =>
      server.posts.push({
        path,
        settle: (ok) => (ok ? resolve({}) : reject(new Error('1 file not committed'))),
      }),
    ),
}));

vi.mock('../src/workspaces/useWorkspaces.js', () => ({
  reloadWorkspaces: () => new Promise<void>((resolve) => server.reads.push(resolve)),
}));

const { cleanUp, removeMerge } = await import('../src/workspaces/cleanup.js');

/** Lets the microtasks queued so far run. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  server.posts.length = 0;
  server.reads.length = 0;
});

// A card being cleaned up or removed (V57): marked from the request until the list is read again.
describe('removals under way (V57)', () => {
  it('holds each by its key, as many at once as were begun, and tells its readers', () => {
    const told = vi.fn();
    const stop = subscribeRemovals(told);
    beginRemoval(workspaceKey('feature/a'));
    beginRemoval(mergeKey('m1'));
    expect(removingNow(workspaceKey('feature/a'))).toBe(true);
    expect(removingNow(mergeKey('m1'))).toBe(true);
    // A merge's key is not its branch's workspace's.
    expect(removingNow(workspaceKey('m1'))).toBe(false);
    // Begun twice (its head and its card), it lasts until both end.
    beginRemoval(workspaceKey('feature/a'));
    endRemoval(workspaceKey('feature/a'));
    expect(removingNow(workspaceKey('feature/a'))).toBe(true);
    endRemoval(workspaceKey('feature/a'));
    endRemoval(mergeKey('m1'));
    expect(removingNow(workspaceKey('feature/a'))).toBe(false);
    expect(removingNow(mergeKey('m1'))).toBe(false);
    expect(told).toHaveBeenCalledTimes(6);
    // One not under way: nothing to tell.
    endRemoval(workspaceKey('feature/b'));
    expect(told).toHaveBeenCalledTimes(6);
    stop();
  });
});

describe('cleanUp and removeMerge mark the card (V57)', () => {
  const key = workspaceKey('feature/half');

  it('a clean-up: marked while it runs, and after it until the list is read again', async () => {
    const notice = cleanUp('feature/half');
    expect(removingNow(key)).toBe(true);
    expect(server.posts.map((p) => p.path)).toEqual(['/api/workspaces/clean']);
    server.posts[0]?.settle(true);
    // The notice does not wait for the read; the card stays marked until it is done.
    await expect(notice).resolves.toEqual({
      text: 'Cleaned up feature/half: its worktree is removed.',
    });
    expect(server.reads).toHaveLength(1);
    expect(removingNow(key)).toBe(true);
    server.reads[0]?.();
    await settled();
    expect(removingNow(key)).toBe(false);
  });

  it('a refusal: unmarked at once, the list read again all the same', async () => {
    const notice = cleanUp('feature/half', true);
    server.posts[0]?.settle(false);
    await expect(notice).rejects.toThrow('1 file not committed');
    expect(removingNow(key)).toBe(false);
    expect(server.reads).toHaveLength(1);
  });

  it("a merge's removal: by its id, until the list is read again", async () => {
    const entry = { id: 'm7', branch: 'feature/half', into: 'main' } as MergeEntry;
    const notice = removeMerge(entry);
    expect(removingNow(mergeKey('m7'))).toBe(true);
    expect(removingNow(key)).toBe(false);
    server.posts[0]?.settle(true);
    await expect(notice).resolves.toEqual({
      text: 'Removed the merge of feature/half from the queue.',
    });
    expect(removingNow(mergeKey('m7'))).toBe(true);
    server.reads[0]?.();
    await settled();
    expect(removingNow(mergeKey('m7'))).toBe(false);
  });
});
