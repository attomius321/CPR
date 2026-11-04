import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { history, readOpened } from '../src/opened.js';

const dir = tempDir();
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const at = (minute: number) => new Date(Date.UTC(2026, 10, 4, 10, minute)).getTime();

describe('readOpened (decision 912)', () => {
  it('is the Symbiotes seen, newest first; none when the file is missing or broken', async () => {
    const folder = join(dir, 'read');
    mkdirSync(folder);
    const file = join(folder, 'opened.json');
    expect(await readOpened(file)).toEqual([]);
    for (const text of ['{', 'null', '[]', '{"opened":"x"}']) {
      writeFileSync(file, text);
      expect(await readOpened(file), text).toEqual([]);
    }
    writeFileSync(
      file,
      JSON.stringify({
        opened: [
          { path: '/a', name: 'a', seen: '2026-11-01T10:00:00.000Z' },
          { path: 'relative', name: 'r', seen: '2026-11-02T10:00:00.000Z' },
          { path: '/b', name: 'b', seen: '2026-11-03T10:00:00.000Z' },
          { path: '/c', seen: 7 },
          { path: '/a', name: 'a', seen: '2026-10-01T10:00:00.000Z' },
        ],
      }),
    );
    expect(await readOpened(file)).toEqual([
      { path: '/b', name: 'b', seen: '2026-11-03T10:00:00.000Z' },
      { path: '/a', name: 'a', seen: '2026-11-01T10:00:00.000Z' },
    ]);
  });
});

describe('history (decision 912)', () => {
  it('notes each Symbiote seen running, newest first, written whole in its file', async () => {
    const folder = join(dir, 'note', 'nexus');
    const file = join(folder, 'opened.json');
    let now = at(0);
    const opened = history({ file, now: () => now });
    await opened.note([{ root: '/home/me/ky', name: 'ky' }]);
    now = at(1);
    await opened.note([
      { root: '/home/me/ky', name: 'ky' },
      { root: '/home/me/zod', name: 'zod' },
    ]);
    // Seen at the same time: in the order they were listed.
    expect(await opened.read()).toEqual([
      { path: '/home/me/ky', name: 'ky', seen: new Date(at(1)).toISOString() },
      { path: '/home/me/zod', name: 'zod', seen: new Date(at(1)).toISOString() },
    ]);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ opened: await opened.read() });
    // Through a file beside it, renamed: none of those left.
    expect(readdirSync(folder)).toEqual(['opened.json']);
  });

  it('writes again for one already noted only a minute after the last time it wrote', async () => {
    const file = join(dir, 'minute', 'opened.json');
    let now = at(0);
    const opened = history({ file, now: () => now });
    await opened.note([{ root: '/a', name: 'a' }]);
    const first = readFileSync(file, 'utf8');
    now = at(0) + 30_000;
    await opened.note([{ root: '/a', name: 'a' }]);
    expect(readFileSync(file, 'utf8')).toBe(first);
    now = at(2);
    await opened.note([{ root: '/a', name: 'a' }]);
    expect(await opened.read()).toEqual([
      { path: '/a', name: 'a', seen: new Date(at(2)).toISOString() },
    ]);
  });

  it('keeps the 50 seen last', async () => {
    const file = join(dir, 'cap', 'opened.json');
    let now = at(0);
    const opened = history({ file, now: () => now });
    for (let i = 0; i < 55; i++) {
      now = at(0) + i * 1000;
      await opened.note([{ root: `/r${i}`, name: `r${i}` }]);
    }
    const read = await opened.read();
    expect(read).toHaveLength(50);
    expect(read[0]?.path).toBe('/r54');
    expect(read.at(-1)?.path).toBe('/r5');
  });

  it('starts from what its file kept, from one nexus to the next', async () => {
    const file = join(dir, 'next', 'opened.json');
    await history({ file, now: () => at(0) }).note([{ root: '/a', name: 'a' }]);
    const next = history({ file, now: () => at(5) });
    await next.note([{ root: '/b', name: 'b' }]);
    expect((await next.read()).map((o) => o.path)).toEqual(['/b', '/a']);
  });
});
