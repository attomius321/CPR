// Changes from outside (V94c, decision 904): one plain `fs.watch` per folder, folders added as they
// appear. Node's recursive watch on Linux missed the third write by rename to one file and never
// fired on a folder made after it started (the spike): these are the cases it failed.
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { watchTree, type Watched } from '../src/events-watch.js';
import { writeFileWhole } from '../src/file-write.js';

const folders: string[] = [];
const watching: Watched[] = [];
afterEach(() => {
  for (const w of watching.splice(0)) w.close();
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'events-watch-'));
  folders.push(dir);
  return dir;
}

/** Watches, and the paths it reports. */
function watched(root: string, descend?: (rel: string) => boolean, replays?: boolean) {
  const seen: string[] = [];
  const w = watchTree(root, (path) => seen.push(path), descend, {
    ...(replays === undefined ? {} : { replays }),
  });
  watching.push(w);
  return seen;
}

/** Waits until `seen` holds a path that `test` takes, or 2 s pass. */
async function until(seen: string[], test: (path: string) => boolean): Promise<boolean> {
  for (let waited = 0; waited < 2_000; waited += 10) {
    if (seen.some(test)) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('watchTree (V94c)', () => {
  it('sees every write by rename to one file, the third too', async () => {
    const root = folder();
    mkdirSync(join(root, 'workspaces', 'feature'), { recursive: true });
    const seen = watched(root);
    await settle();
    const file = join(root, 'workspaces', 'feature', 'x.json');
    for (let i = 1; i <= 3; i++) {
      seen.length = 0;
      await writeFileWhole(file, `{"n":${i}}\n`);
      expect(await until(seen, (p) => p === file), `write ${i}`).toBe(true);
    }
  });

  it('sees a file in a folder made after it started, and in that folder’s own new folder', async () => {
    const root = folder();
    const seen = watched(root);
    await settle();
    mkdirSync(join(root, 'reviews'));
    await settle();
    mkdirSync(join(root, 'reviews', 'fix'));
    await settle();
    const file = join(root, 'reviews', 'fix', 'ada@example.com.json');
    writeFileSync(file, '{}');
    expect(await until(seen, (p) => p === file)).toBe(true);
  });

  it('sees its folder made after it started, and what is written in it', async () => {
    const parent = folder();
    const root = join(parent, 'heads');
    const seen = watched(root);
    await settle();
    mkdirSync(root);
    await settle();
    writeFileSync(join(root, 'main'), 'abc\n');
    expect(await until(seen, (p) => p === join(root, 'main'))).toBe(true);
  });

  it('goes into the folders `descend` takes only', async () => {
    const root = folder();
    mkdirSync(join(root, 'reviews'));
    mkdirSync(join(root, 'revisions'));
    const seen = watched(root, (rel) => rel.split(/[\\/]/)[0] === 'reviews');
    await settle();
    writeFileSync(join(root, 'revisions', 'copy'), 'x');
    writeFileSync(join(root, 'reviews', 'r.json'), 'x');
    writeFileSync(join(root, 'nucleus.json'), 'x');
    expect(await until(seen, (p) => p === join(root, 'reviews', 'r.json'))).toBe(true);
    expect(await until(seen, (p) => p === join(root, 'nucleus.json'))).toBe(true);
    expect(seen).not.toContain(join(root, 'revisions', 'copy'));
  });

  it('where the system replays changes, reports none to a file last written before it started (fix-ci-green)', async () => {
    // macOS's FSEvents also delivers changes made just before a watch (`replays`, on there): the
    // page's first read had them. Linux reports an old file's new dates, a change dated before.
    const root = folder();
    mkdirSync(join(root, 'activity'));
    const old = join(root, 'activity', 'old.jsonl');
    writeFileSync(old, '{}\n');
    // Dated well before: `Date.now()` drops the fraction of a millisecond macOS's dates keep.
    const before = new Date(Date.now() - 10_000);
    utimesSync(old, before, before);
    const seen = watched(root, undefined, true);
    await settle();
    utimesSync(old, before, before);
    const now = join(root, 'activity', 'now.jsonl');
    writeFileSync(now, '{}\n');
    expect(await until(seen, (p) => p === now)).toBe(true);
    await settle();
    expect(seen).not.toContain(old);
  });

  it('where the system replays changes, reports one in a folder made after it started, dated before (fix-ci-green)', async () => {
    // A folder made later had no first read: what is written in it is news, however it is dated
    // (macOS's runner: the folder's own watch began after the file in it was written).
    const root = folder();
    const seen = watched(root, undefined, true);
    await settle();
    mkdirSync(join(root, 'reviews'));
    await settle();
    const file = join(root, 'reviews', 'ada@example.com.json');
    writeFileSync(file, '{}');
    const before = new Date(Date.now() - 10_000);
    utimesSync(file, before, before);
    expect(await until(seen, (p) => p === file)).toBe(true);
  });

  it('keeps no watcher once closed', async () => {
    const watchers = () =>
      process.getActiveResourcesInfo().filter((kind) => kind === 'FSEventWrap').length;
    // A watcher closed leaves the list on the next turn of the loop.
    await settle();
    const before = watchers();
    const root = folder();
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    const w = watchTree(join(root, 'missing'), () => {});
    const v = watchTree(root, () => {});
    await settle();
    expect(watchers()).toBeGreaterThan(before);
    w.close();
    v.close();
    await settle();
    expect(watchers()).toBe(before);
  });
});
