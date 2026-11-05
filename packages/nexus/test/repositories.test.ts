import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { knownRepositories, scanSummary, scanTree } from '../src/repositories.js';
import type { ScanResult } from '../src/scan.js';

const dir = tempDir();
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function repository(name: string, branch = 'main'): string {
  const path = join(dir, name);
  mkdirSync(join(path, '.git'), { recursive: true });
  writeFileSync(join(path, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
  return path;
}

const scan = (repositories: ScanResult['repositories']): ScanResult => ({
  folder: dir,
  at: '2026-11-04T11:02:00.000Z',
  folders: 38,
  ms: 3,
  short: false,
  repositories,
  tree: repositories.map((r) => r.path),
  unread: [],
});

describe('knownRepositories (decisions 912, 925)', () => {
  it('merges the history and the scan by path, each with what it has checked out', async () => {
    const ky = repository('ky', 'feature/x');
    const zod = repository('zod');
    const infra = repository('infra');
    const known = await knownRepositories({
      opened: [
        { path: infra, name: 'infra', seen: '2026-11-03T10:00:00.000Z' },
        { path: ky, name: 'ky', seen: '2026-11-02T10:00:00.000Z' },
      ],
      scan: scan([
        { name: 'ky', path: ky, branch: 'feature/x' },
        { name: 'zod', path: zod, branch: 'main' },
      ]),
    });
    expect(known).toEqual([
      { name: 'infra', path: infra, branch: 'main', opened: '2026-11-03T10:00:00.000Z' },
      {
        name: 'ky',
        path: ky,
        branch: 'feature/x',
        opened: '2026-11-02T10:00:00.000Z',
        found: true,
      },
      { name: 'zod', path: zod, branch: 'main', found: true },
    ]);
  });

  it('leaves out a repository opened before whose folder is gone, or is no repository now', async () => {
    const notes = join(dir, 'notes');
    mkdirSync(notes);
    expect(
      await knownRepositories({
        opened: [
          { path: join(dir, 'gone'), name: 'gone', seen: '2026-11-03T10:00:00.000Z' },
          { path: notes, name: 'notes', seen: '2026-11-03T10:00:00.000Z' },
        ],
        scan: null,
      }),
    ).toEqual([]);
  });
});

describe('scanSummary', () => {
  it("is the scan's facts without its repositories and its tree, or null", () => {
    expect(scanSummary(null)).toBeNull();
    expect(scanSummary(scan([{ name: 'ky', path: '/x/ky' }]))).toEqual({
      folder: dir,
      at: '2026-11-04T11:02:00.000Z',
      folders: 38,
      ms: 3,
      short: false,
      repositories: 1,
    });
  });
});

describe('scanTree (decision 926)', () => {
  it("is the scan's folders and the ones it did not read, or null", () => {
    expect(scanTree(null)).toBeNull();
    expect(scanTree(scan([{ name: 'ky', path: '/x/ky' }]))).toEqual({
      folder: dir,
      at: '2026-11-04T11:02:00.000Z',
      tree: ['/x/ky'],
      unread: [],
    });
  });
});
