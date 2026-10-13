import { afterEach, describe, expect, it } from 'vitest';
import { CprError, mapLine, openRepo, workingLine } from '../src/index.js';
import { createRepo, type TestRepo } from './helpers/git-repo.js';

const lines = (n: number, prefix = 'line') =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n';

/**
 * Ten lines, then: two inserted after line 1, line 3 removed, lines 6–7 replaced by three.
 * Git's hunks for it (`-U0`): +2,2 after 1; -3 at 4; -6,2 +7,3.
 */
const TEN = lines(10);
const EDITED =
  [
    'line 1',
    'new a',
    'new b',
    'line 2',
    'line 4',
    'line 5',
    'six',
    'seven',
    'more',
    'line 8',
    'line 9',
    'line 10',
  ].join('\n') + '\n';
const HUNKS = [
  { oldStart: 1, oldLines: 0, newStart: 2, newLines: 2 },
  { oldStart: 3, oldLines: 1, newStart: 4, newLines: 0 },
  { oldStart: 6, oldLines: 2, newStart: 7, newLines: 3 },
];
/** Where each of the ten lines is in EDITED. */
const WHERE = [
  { how: 'exact', line: 1 },
  { how: 'exact', line: 4 },
  { how: 'nearest', line: 5 }, // removed: the line after the removal
  { how: 'exact', line: 5 },
  { how: 'exact', line: 6 },
  { how: 'nearest', line: 7 }, // replaced: the replacement's first line
  { how: 'nearest', line: 7 },
  { how: 'exact', line: 10 },
  { how: 'exact', line: 11 },
  { how: 'exact', line: 12 },
];

describe('mapLine', () => {
  it('keeps a line when nothing changed', () => {
    expect(mapLine([], 7)).toEqual({ how: 'exact', line: 7 });
  });

  it('moves a line by what was added and removed above it; a changed one to its hunk', () => {
    expect(WHERE.map((_, i) => mapLine(HUNKS, i + 1))).toEqual(WHERE);
  });

  it('leaves the line just before an insertion where it is', () => {
    const insertAfter5 = [{ oldStart: 5, oldLines: 0, newStart: 6, newLines: 2 }];
    expect(mapLine(insertAfter5, 5)).toEqual({ how: 'exact', line: 5 });
    expect(mapLine(insertAfter5, 6)).toEqual({ how: 'exact', line: 8 });
  });

  it('maps lines removed from the start or the end of a file', () => {
    expect(mapLine([{ oldStart: 1, oldLines: 3, newStart: 0, newLines: 0 }], 2)).toEqual({
      how: 'nearest',
      line: 1,
    });
    // The last two of ten removed: line 9 is past the end now; VS Code clamps it.
    expect(mapLine([{ oldStart: 9, oldLines: 2, newStart: 8, newLines: 0 }], 10)).toEqual({
      how: 'nearest',
      line: 9,
    });
  });
});

describe('workingLine', () => {
  let repo: TestRepo;
  afterEach(() => repo.cleanup());

  it('maps lines of a commit to the working copy, uncommitted edits included', async () => {
    repo = createRepo();
    repo.write({ 'src/a.ts': TEN });
    const sha = repo.commit('ten lines');
    const git = await openRepo(repo.root);

    expect(await workingLine(git, sha, 'src/a.ts', 8)).toEqual({ how: 'exact', line: 8 });
    repo.write({ 'src/a.ts': EDITED });
    expect(
      await Promise.all(WHERE.map((_, i) => workingLine(git, sha, 'src/a.ts', i + 1))),
    ).toEqual(WHERE);
  });

  it('maps through later commits checked out', async () => {
    repo = createRepo();
    repo.write({ 'src/a.ts': TEN });
    const sha = repo.commit('ten lines');
    repo.write({ 'src/a.ts': `// header\n${TEN}` });
    repo.commit('a header');

    const git = await openRepo(repo.root);
    expect(await workingLine(git, sha, 'src/a.ts', 3)).toEqual({ how: 'exact', line: 4 });
  });

  it('says when the working copy has no such file: deleted or renamed since', async () => {
    repo = createRepo();
    repo.write({ 'src/a.ts': TEN, 'src/b.ts': TEN });
    const sha = repo.commit('two files');
    repo.git('rm', '--quiet', 'src/a.ts');
    repo.git('mv', 'src/b.ts', 'src/c.ts');
    repo.commit('one removed, one renamed');

    const git = await openRepo(repo.root);
    expect(await workingLine(git, sha, 'src/a.ts', 3)).toEqual({ how: 'missing' });
    expect(await workingLine(git, sha, 'src/b.ts', 3)).toEqual({ how: 'missing' });
  });

  it('reads a path as it is, not as a pattern (Qwik routes: src/routes/[id]/)', async () => {
    repo = createRepo();
    repo.write({ 'src/[id].ts': TEN, 'src/i.ts': TEN, 'src/d.ts': TEN });
    const sha = repo.commit('three files');
    // `[id].ts` as a glob matches i.ts and d.ts: their edits must not move its lines.
    repo.write({ 'src/i.ts': `// one\n// two\n${TEN}`, 'src/d.ts': '' });

    const git = await openRepo(repo.root);
    expect(await workingLine(git, sha, 'src/[id].ts', 3)).toEqual({ how: 'exact', line: 3 });
  });

  it('refuses what is not a commit SHA', async () => {
    repo = createRepo();
    repo.write({ 'src/a.ts': TEN });
    repo.commit('ten lines');
    const git = await openRepo(repo.root);
    await expect(workingLine(git, '--output=x', 'src/a.ts', 1)).rejects.toThrow(CprError);
  });
});
