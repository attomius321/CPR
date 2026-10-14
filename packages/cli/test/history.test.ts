import type { Commit, HistoryRow, HistoryScope, HistoryState } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import { Histories, slowListingHint, type HistorySource } from '../src/history.js';

const sha = (c: string) => c.repeat(40);
const row = (c: string, parents: string[] = []): HistoryRow => ({
  sha: sha(c),
  parents: parents.map(sha),
});
const details = (s: string): Commit => ({
  sha: s,
  parents: [],
  author: 'Ada',
  date: '2026-10-13T08:00:00Z',
  subject: `commit ${s[0] ?? ''}`,
  refs: [],
});

interface Stream {
  scope: HistoryScope;
  push(rows: HistoryRow[]): void;
  end(): void;
  fail(error: Error): void;
}

/** A source whose listings the test feeds row by row. */
function fakeSource() {
  let state: HistoryState = { branch: 'main', head: sha('c'), version: 'v1' };
  const streams: Stream[] = [];
  const asked: string[][] = [];
  const source: HistorySource = {
    state: () => Promise.resolve(state),
    stream: (scope, onRows) =>
      new Promise((resolve, reject) =>
        streams.push({ scope, push: onRows, end: () => resolve(), fail: reject }),
      ),
    details: (shas) => {
      asked.push(shas.map((s) => s[0] ?? ''));
      return Promise.resolve(shas.map(details));
    },
  };
  return {
    source,
    streams,
    asked,
    setState(next: Partial<HistoryState>) {
      state = { ...state, ...next };
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
// c ← b ← a, and x a branch from a: c, b, x, a in graph order.
const ROWS = [row('c', ['b']), row('b', ['a']), row('x', ['a']), row('a')];

describe('Histories', () => {
  it('answers the first rows before the whole history is listed', async () => {
    const fake = fakeSource();
    const histories = new Histories(fake.source);
    const page = histories.page('all', 0, 2);
    await settle();
    expect(fake.streams).toHaveLength(1);
    fake.streams[0]?.push(ROWS.slice(0, 1));
    await settle();
    let answered = false;
    void page.then(() => (answered = true));
    await settle();
    expect(answered).toBe(false);

    fake.streams[0]?.push(ROWS.slice(1, 3));
    expect(await page).toEqual({
      version: 'v1',
      branch: 'main',
      head: sha('c'),
      from: 0,
      commits: [details(sha('c')), details(sha('b'))],
      listed: 3,
      done: false,
    });
  });

  it("gives the shape once listed: parents as row numbers, and HEAD's row", async () => {
    const fake = fakeSource();
    const histories = new Histories(fake.source);
    void histories.page('all', 0, 1);
    await settle();
    fake.streams[0]?.push(ROWS);
    const shape = histories.shape('all', 'v1');
    let answered = false;
    void shape.then(() => (answered = true));
    await settle();
    expect(answered).toBe(false);

    fake.streams[0]?.end();
    expect(await shape).toEqual({ version: 'v1', rows: 4, head: 0, parents: [[1], [3], [3], []] });
  });

  it("gives the default branch's tips as rows: those listed, else none (V10c)", async () => {
    const fake = fakeSource();
    // x's line is the default branch; z, a remote's tip, is not listed in this scope.
    fake.source.defaultBranch = () => Promise.resolve({ name: 'main', tips: [sha('x'), sha('z')] });
    const histories = new Histories(fake.source);
    void histories.page('all', 0, 1);
    await settle();
    fake.streams[0]?.push(ROWS);
    fake.streams[0]?.end();
    expect(await histories.shape('all', 'v1')).toMatchObject({
      defaultBranch: { name: 'main', rows: [2] },
    });

    const none = fakeSource();
    none.source.defaultBranch = () => Promise.resolve({ name: 'main', tips: [sha('z')] });
    const unlisted = new Histories(none.source);
    void unlisted.page('all', 0, 1);
    await settle();
    none.streams[0]?.push(ROWS);
    none.streams[0]?.end();
    expect(await unlisted.shape('all', 'v1')).not.toHaveProperty('defaultBranch');
  });

  it('reads rows anywhere in the history from the order kept, without listing again', async () => {
    const fake = fakeSource();
    const histories = new Histories(fake.source);
    void histories.page('all', 0, 1);
    await settle();
    fake.streams[0]?.push(ROWS);
    fake.streams[0]?.end();
    await settle();

    const page = await histories.page('all', 2, 10, 'v1');
    expect(page?.commits.map((c) => c.sha)).toEqual([sha('x'), sha('a')]);
    expect(page).toMatchObject({ from: 2, listed: 4, done: true });
    expect(fake.streams).toHaveLength(1);
    expect(fake.asked.at(-1)).toEqual(['x', 'a']);
  });

  it('lists anew when HEAD or a branch moved; rows and shapes of the old version are stale', async () => {
    const fake = fakeSource();
    const histories = new Histories(fake.source);
    void histories.page('all', 0, 1);
    await settle();
    fake.streams[0]?.push(ROWS);
    fake.streams[0]?.end();
    expect((await histories.page('all', 0, 1))?.version).toBe('v1');
    expect(fake.streams).toHaveLength(1);

    fake.setState({ version: 'v2' });
    const fresh = histories.page('all', 0, 1);
    await settle();
    expect(fake.streams).toHaveLength(2);
    fake.streams[1]?.push(ROWS);
    expect((await fresh)?.version).toBe('v2');
    expect(await histories.page('all', 0, 1, 'v1')).toBeNull();
    expect(await histories.shape('all', 'v1')).toBeNull();
  });

  it('keeps one listing per scope', async () => {
    const fake = fakeSource();
    const histories = new Histories(fake.source);
    void histories.page('all', 0, 1);
    void histories.page('current', 0, 1);
    void histories.page('all', 0, 1);
    await settle();
    expect(fake.streams.map((s) => s.scope)).toEqual(['all', 'current']);
  });

  it('fails the requests of a listing that failed, and lists anew on the next', async () => {
    const fake = fakeSource();
    const histories = new Histories(fake.source);
    const page = histories.page('all', 0, 1);
    await settle();
    fake.streams[0]?.fail(new Error('git log failed'));
    await expect(page).rejects.toThrow('git log failed');

    void histories.page('all', 0, 1);
    await settle();
    expect(fake.streams).toHaveLength(2);
  });

  it('says how long a listing took, once it is done', async () => {
    const fake = fakeSource();
    const listed: [HistoryScope, number][] = [];
    const histories = new Histories(fake.source, {
      onListed: (scope, rows) => listed.push([scope, rows]),
    });
    void histories.page('all', 0, 1);
    await settle();
    fake.streams[0]?.push(ROWS);
    expect(listed).toEqual([]);
    fake.streams[0]?.end();
    await settle();
    expect(listed).toEqual([['all', 4]]);
  });
});

describe('slowListingHint', () => {
  it('names the commit-graph file when git took long and the repository has none', () => {
    expect(slowListingHint(150_182, 1185, false)).toBe(
      'hint: listing 150,182 commits took 1.2 s; `git commit-graph write --reachable` (or ' +
        '`git maintenance start`) lets git list them at once\n',
    );
    expect(slowListingHint(150_182, 1185, true)).toBeNull();
    expect(slowListingHint(12_362, 90, false)).toBeNull();
  });
});
