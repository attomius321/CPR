import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepo, type TestRepo } from '../../core/test/helpers/git-repo.js';

// `scripts/plan/mark-merged.mjs`: the index rows, plan Status lines and journals of branches
// Symbiote's merger merged, marked as merged on `main` (what chore/plan-index-status did by hand).
const script = fileURLToPath(new URL('../../../scripts/plan/mark-merged.mjs', import.meta.url));

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Symbiote Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Symbiote Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

const INDEX = `# Plan

## Index

### The area

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [V1](plan/v1-a.md) | A | built, ready for review | 1 | [journal](journal/v1-a.md) |
| [V2](plan/v2-b.md) | B | ready for review | 2 | [journal](journal/v2-b.md) |
| Fix | C | ready for review | | [journal](journal/fix-c.md) |
| [V3](plan/v3-d.md) | D | planned | 3 | [journal](journal/v3-d.md) |
| [V4](plan/v4-e.md) | E | ready for review | 4 | [journal](journal/v4-e.md) |
| [V5](plan/v5-f.md) | F | ✅ | 5 | [journal](journal/v5-f.md) |
| [V6](plan/v6-g.md) | G | built | 6 | [journal](journal/v6-g.md) |
| [Chore](plan/v6-g.md#chore-h) | H | ready for review | | [journal](journal/chore-h.md#h) |
| [V7](plan/v7-i.md) | I | ✅ | 7 | [journal](journal/v7-i.md) |
| Fix | J | merged | | [journal](journal/fix-j.md) |
| Fix | K | ready for review | | [journal](journal/k-shared.md) |
| Fix | L | ready for review | | [journal](journal/l-shared.md) |
| [V10](plan/v10-m.md) | M | ready for review | 10 | [journal](journal/v10-m.md) |
`;

const plan = (id: string, status: string) =>
  `# ${id} — a plan\n\n[Index](../PLAN.md)\n\n**Status:** ${status}\n\n**Problem**: none.\n`;
const journal = (heading: string) =>
  `# Journal\n\n[Index](../JOURNAL.md)\n\n## ${heading}\n\nWhat was built.\n`;

/** A journal two branches wrote in, one entry each. */
const shared = (first: string, second: string) =>
  `${journal(first)}\n## ${second}\n\nWhat was fixed.\n`;

let repo: TestRepo;

/** A branch from `main` with one commit, merged back with `--no-ff` on `date` unless `open`. */
function branch(name: string, date: string | null, then?: () => void) {
  repo.git('checkout', '--quiet', '-b', name, 'main');
  repo.write({ [`src/${name.replace('/', '-')}.txt`]: `${name}\n` });
  repo.commitAt(`${name}: work`, '2026-10-29T10:00:00Z');
  repo.git('checkout', '--quiet', 'main');
  if (date) {
    execFileSync('git', ['merge', '--quiet', '--no-ff', '-m', `Merge ${name}: work`, name], {
      cwd: repo.root,
      env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
  }
  then?.();
}

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repo.root,
    env,
    encoding: 'utf8',
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const read = (path: string) => readFileSync(join(repo.root, path), 'utf8');

beforeEach(() => {
  repo = createRepo();
  repo.write({
    'docs/PLAN.md': INDEX,
    'docs/plan/v1-a.md': plan(
      'V1',
      "built, ready for review (2026-10-29), on branch `feature/a` (the workspace's).",
    ),
    'docs/plan/v2-b.md': plan('V2', 'ready for review (2026-10-29), on branch `feature/b`.'),
    'docs/plan/v3-d.md': plan('V3', 'planned (2026-10-29), on branch `feature/d`; not started.'),
    'docs/plan/v4-e.md': plan('V4', 'ready for review (2026-10-29), on branch `feature/e`.'),
    'docs/plan/v5-f.md': plan('V5', 'merged into `main` on 2026-10-20, on branch `feature/f`.'),
    'docs/plan/v6-g.md': plan(
      'V6',
      'built (2026-10-29), on branch `feature/g`; ready\nfor review.',
    ),
    'docs/plan/v7-i.md': plan(
      'V7',
      'ready for review (2026-10-29), on branch `feature/i`, after V6 (`feature/g`), which merged\ninto `main` before it.',
    ),
    'docs/journal/v7-i.md': journal('V7 — I (2026-10-29, branch `feature/i`)'),
    'docs/journal/fix-j.md': journal('Fix — J (2026-10-29, branch `fix/j`)'),
    'docs/journal/v1-a.md': journal('V1 — A (2026-10-29, branch `feature/a`)'),
    'docs/journal/v2-b.md': journal('V2 — B (2026-10-29, branch `feature/b`)'),
    'docs/journal/fix-c.md': journal('Fix — C (2026-10-29, branch `fix/c`)'),
    'docs/journal/v3-d.md': journal('V3 spike — D (2026-10-29, branch `feature/d`)'),
    'docs/journal/v4-e.md': journal('V4 — E (2026-10-29, branch `feature/e`)'),
    'docs/journal/v5-f.md': journal('V5 — F (2026-10-19, branch `feature/f`)'),
    'docs/journal/v6-g.md': journal('V6 — G (2026-10-29, branch `feature/g`)'),
    'docs/journal/chore-h.md': journal('H (2026-10-29, branch `chore/h`)'),
    'docs/journal/k-shared.md': shared(
      'K — first (2026-10-29, branch `feature/k1`)',
      'K — second (2026-10-30, branch `feature/k2`)',
    ),
    'docs/journal/l-shared.md': shared(
      'L — first (2026-10-29, branch `fix/l1`)',
      'L — second (2026-10-30, branch `fix/l2`)',
    ),
    'docs/plan/v10-m.md': plan('V10', 'ready for review (2026-10-29), on branch `feature/m`.'),
    'docs/journal/v10-m.md': shared(
      'V10 — M (2026-10-29, branch `feature/m`)',
      'Fix — after M (2026-10-31, branch `fix/m2`)',
    ),
  });
  repo.commitAt('Docs', '2026-10-28T10:00:00Z');
  branch('feature/a', '2026-10-30T12:00:00Z');
  branch('feature/b', null);
  // Merged, then deleted: only the merge's subject names it.
  branch('fix/c', '2026-10-31T09:00:00Z', () => repo.git('branch', '-D', 'fix/c'));
  branch('feature/d', '2026-10-30T13:00:00Z');
  // Merged, then moved on: its tip is not in `main`.
  branch('feature/e', '2026-10-30T14:00:00Z', () => {
    repo.git('checkout', '--quiet', 'feature/e');
    repo.write({ 'src/more.txt': 'more\n' });
    repo.commitAt('feature/e: more', '2026-10-31T10:00:00Z');
    repo.git('checkout', '--quiet', 'main');
  });
  branch('feature/g', '2026-10-31T15:00:00Z');
  branch('chore/h', '2026-11-01T16:00:00Z');
  branch('feature/i', '2026-11-01T17:00:00Z');
  branch('fix/j', '2026-11-01T18:00:00Z');
  branch('feature/k1', '2026-10-30T10:00:00Z');
  branch('feature/k2', '2026-11-01T10:00:00Z');
  branch('fix/l1', '2026-10-30T10:00:00Z');
  branch('fix/l2', null);
  branch('feature/m', '2026-10-30T11:00:00Z');
  branch('fix/m2', null);
});

afterEach(() => repo.cleanup());

describe('mark-merged', () => {
  it('lists what it would mark and changes nothing without --write', () => {
    const { code, out } = run();
    expect(code).toBe(0);
    expect(out).toContain('V1');
    expect(out).toContain('fix/c');
    expect(out).toContain('V6');
    expect(out).toContain('chore/h');
    // Merged, but a plan only: its row is left for a person to read.
    expect(out).toMatch(/V3.*planned/);
    // Merged, then moved on: a later commit is not in main, so a person decides.
    expect(out).toMatch(/V4.*1 later commit/);
    expect(out).not.toMatch(/V2|V5/);
    // A journal two branches wrote in: its row waits for both.
    expect(out).toMatch(/fix\/l1, fix\/l2: fix\/l2 not in main yet/);
    expect(repo.git('status', '--porcelain')).toBe('');
  });

  it('marks merged rows ✅ and their Status lines and journals with the merge date', () => {
    expect(run('--write').code).toBe(0);
    const index = read('docs/PLAN.md');
    expect(index).toContain('| [V1](plan/v1-a.md) | A | ✅ | 1 |');
    expect(index).toContain('| Fix | C | ✅ | |');
    expect(index).toContain('| [V6](plan/v6-g.md) | G | ✅ | 6 |');
    expect(index).toContain('| [Chore](plan/v6-g.md#chore-h) | H | ✅ | |');
    // Not merged, a plan only, merged and moved on, already marked: as they were.
    expect(index).toContain('| [V2](plan/v2-b.md) | B | ready for review | 2 |');
    expect(index).toContain('| [V3](plan/v3-d.md) | D | planned | 3 |');
    expect(index).toContain('| [V4](plan/v4-e.md) | E | ready for review | 4 |');

    expect(read('docs/plan/v1-a.md')).toContain(
      "**Status:** merged into `main` on 2026-10-30 (built 2026-10-29), on branch `feature/a` (the workspace's).",
    );
    expect(read('docs/plan/v6-g.md')).toContain(
      '**Status:** built (2026-10-29), on branch `feature/g`; merged into `main` on 2026-10-31.',
    );
    // A row marked ✅ by hand whose Status fell behind, naming another merge: only its Status.
    expect(read('docs/plan/v7-i.md')).toContain(
      '**Status:** merged into `main` on 2026-11-01 (built 2026-10-29), on branch `feature/i`',
    );
    expect(read('docs/journal/v7-i.md')).not.toContain('Merged into main');
    // A journal two branches wrote in: ✅ once both are merged; its last line is its last entry's.
    expect(index).toContain('| Fix | K | ✅ | |');
    expect(read('docs/journal/k-shared.md')).toMatch(
      /K — second[^]*What was fixed\.\n\nMerged into main \(2026-11-01\)\.\n$/,
    );
    expect(read('docs/journal/k-shared.md').match(/Merged into main/g)).toHaveLength(1);
    expect(index).toContain('| Fix | L | ready for review | |');
    expect(read('docs/journal/l-shared.md')).not.toContain('Merged into main');
    // Its own plan says merged; its journal's last entry is another branch's, not merged.
    expect(index).toContain('| [V10](plan/v10-m.md) | M | ✅ | 10 |');
    expect(read('docs/journal/v10-m.md')).not.toContain('Merged into main');
    // A row that says "merged" without ✅.
    expect(index).toContain('| Fix | J | ✅ | |');
    expect(read('docs/plan/v2-b.md')).toContain('**Status:** ready for review (2026-10-29)');
    expect(read('docs/plan/v3-d.md')).toContain('**Status:** planned (2026-10-29)');

    expect(read('docs/journal/v1-a.md')).toMatch(
      /What was built\.\n\nMerged into main \(2026-10-30\)\.\n$/,
    );
    expect(read('docs/journal/fix-c.md')).toMatch(/Merged into main \(2026-10-31\)\.\n$/);
    // A chore inside another plan: its plan's Status and an anchored journal are not its own.
    expect(read('docs/journal/chore-h.md')).not.toContain('Merged into main');
    expect(read('docs/plan/v6-g.md')).not.toContain('2026-11-01');
    expect(read('docs/journal/v2-b.md')).not.toContain('Merged into main');
  });

  it('finds nothing more to do on a second run', () => {
    run('--write');
    const before = repo.git('status', '--porcelain');
    const { code, out } = run('--write');
    expect(code).toBe(0);
    expect(out).toMatch(/nothing to mark/i);
    expect(repo.git('status', '--porcelain')).toBe(before);
  });
});
