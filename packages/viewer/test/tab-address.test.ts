// V92 (decision 860): a Hive workspace's Run tab in the address, `&review` kept for old links.
import { describe, expect, it } from 'vitest';
import { runHref, viewOfSearch } from '../src/workspaces/tab-address.js';

describe("a workspace's tab in its address", () => {
  it('opens Run by &run, and by &review as before the rename', () => {
    expect(viewOfSearch('?branch=feature%2Fx&run')).toBe('run');
    expect(viewOfSearch('?branch=feature%2Fx&review')).toBe('run');
  });

  it('reads the other tabs as before', () => {
    expect(viewOfSearch('?branch=x&thread')).toBe('thread');
    expect(viewOfSearch('?branch=x&terminal')).toBe('terminal');
    expect(viewOfSearch('?branch=x&activity')).toBe('activity');
    expect(viewOfSearch('?branch=x&brief')).toBe('brief');
    expect(viewOfSearch('?branch=x&shell=2')).toBe('shell');
    expect(viewOfSearch('?branch=x')).toBeNull();
  });

  it("links to a workspace's Run tab (Read why, decision 857)", () => {
    expect(runHref('feature/a b')).toBe('/?branch=feature%2Fa%20b&run');
  });
});
