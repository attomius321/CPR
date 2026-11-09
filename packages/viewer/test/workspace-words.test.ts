// A workspace's page in words: moved out of Workspace.tsx (refactor/viewer-pages) with what they
// gave there.
import { describe, expect, it } from 'vitest';
import type { MergeEntry } from '@symbiote/core';
import { briefFirst, mergeOf, startedAt } from '../src/workspaces/workspace-words.js';

describe('mergeOf', () => {
  it("takes the workspace's newest entry in the queue, none without one", () => {
    const entry = (id: string, branch: string) => ({ id, branch }) as MergeEntry;
    const queue = [entry('1', 'feature/a'), entry('2', 'feature/b'), entry('3', 'feature/a')];
    expect(mergeOf(queue, 'feature/a')).toEqual({ merge: queue[2] });
    expect(mergeOf(queue, 'feature/c')).toEqual({});
  });
});

describe('startedAt', () => {
  it('says the time for today, the day before', () => {
    const today = new Date();
    today.setHours(9, 5, 0, 0);
    expect(startedAt(today.toISOString())).toBe(
      today.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    );
    const before = new Date(2026, 0, 15, 9, 5);
    expect(startedAt(before.toISOString())).toBe(
      before.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    );
  });
});

describe('briefFirst', () => {
  it("joins the brief's lines without its headings and Markdown marks", () => {
    expect(briefFirst('# Fix\n\n**Goal**: the `x` key\nworks again.\n')).toBe(
      'Goal: the x key works again.',
    );
  });

  it('cuts at 240 characters, and gives nothing for a brief of headings', () => {
    const long = 'word '.repeat(60);
    expect(briefFirst(long)).toBe(`${long.slice(0, 240).trimEnd()}…`);
    expect(briefFirst('# Title\n## Part\n')).toBeUndefined();
  });
});
