// Git's head line (V66e): moved out of HistoryPage.tsx (refactor/viewer-pages) with what it gave
// there.
import { describe, expect, it } from 'vitest';
import type { SyncState } from '@symbiote/core';
import { headLine } from '../src/history/details.js';

const base: SyncState = { branch: 'main', ahead: 0, behind: 0, remotes: ['origin'] };

describe('headLine', () => {
  it('names the branch alone until the upstream is read, and HEAD detached', () => {
    expect(headLine('main', null)).toBe('main');
    expect(headLine(null, null)).toBe('HEAD detached');
    expect(headLine(null, { ...base, branch: null })).toBe('HEAD detached');
  });

  it('says where the branch is against its upstream, the name once', () => {
    expect(headLine('main', { ...base, upstream: 'origin/main' })).toBe(
      'main · Up to date with origin/main',
    );
    expect(headLine('main', { ...base, upstream: 'origin/main', ahead: 2, behind: 1 })).toBe(
      'main · 2 to push, 1 to pull, against origin/main',
    );
    expect(headLine('main', base)).toBe('main has no upstream: Push sets origin/main');
  });
});
