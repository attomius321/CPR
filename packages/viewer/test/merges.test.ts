import type { MergeEntry, MergeTargets } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  askedRegions,
  failedCheck,
  fastForwardBlocked,
  firstFile,
  gutterChars,
  mergeActions,
  mergeButtons,
  mergeLabel,
  mergeLive,
  mergeState,
  mergeTip,
  mergeTitle,
  regionFlags,
  removableOnCard,
  resolutionFiles,
  reviewRegion,
} from '../src/workspaces/merges.js';

const C = 'c'.repeat(40);
const M = 'm'.repeat(40);
const entry = (fields: Partial<MergeEntry>): MergeEntry => ({
  id: 'm1',
  branch: 'feature/csv',
  head: C,
  into: 'main',
  title: 'Merge feature/csv: CSV',
  state: 'queued',
  queued: '2026-10-19T12:00:00.000Z',
  updated: '2026-10-19T12:00:00.000Z',
  ...fields,
});
const check = { commands: ['pnpm check'], source: 'symbiote/config.json (merge.checks)' };

describe('mergeState (V26a)', () => {
  it('says where a merge is, in words and a tone', () => {
    expect(mergeState(entry({}))).toEqual({ text: 'Queued: ccccccc into main', tone: 'wait' });
    expect(mergeState(entry({ state: 'merging' })).text).toBe('Merging into main');
    expect(mergeState(entry({ state: 'checking', check })).text).toBe('Checking: pnpm check');
    expect(
      mergeState(entry({ state: 'ready', check: { ...check, ok: true, ms: 81_400 } })),
    ).toEqual({ text: 'Checked in 1 min 21 s: ready to land', tone: 'you' });
    expect(
      mergeState(entry({ state: 'ready', message: 'no check to run: set merge.checks' })),
    ).toEqual({ text: 'Merged, not checked: no check to run: set merge.checks', tone: 'you' });
    expect(
      mergeState(entry({ state: 'landed', merge: M, check: { ...check, ok: true, ms: 4_200 } })),
    ).toEqual({ text: 'Landed: main is at mmmmmmm · checked in 4.2 s', tone: 'done' });
    expect(
      mergeState(
        entry({ state: 'landed', merge: M, pushed: { ok: false, remote: 'origin', error: 'no' } }),
      ).text,
    ).toBe('Landed: main is at mmmmmmm · not pushed to origin: no');
    expect(
      mergeState(entry({ state: 'failed', check: { ...check, ok: false, failed: 'pnpm check' } })),
    ).toEqual({ text: 'The check failed: pnpm check', tone: 'bad' });
    expect(mergeState(entry({ state: 'needs-you', conflicts: ['a.ts', 'b.ts'] }))).toEqual({
      text: 'Conflicts with main in 2 files',
      tone: 'bad',
    });
  });
});

describe('a resolution to review (V26c)', () => {
  const region = {
    path: 'src/a.ts',
    line: 1,
    ours: ['a = 1'],
    base: ['a = 0'],
    theirs: ['a = 2'],
    text: 'a = 3',
  };
  const resolution = { agent: 'claude' as const, model: 'sonnet', regions: [region], ms: 4000 };

  it('says the agent is resolving, then what it resolved and how the check went', () => {
    expect(mergeState(entry({ state: 'resolving', conflicts: ['src/a.ts'] }))).toEqual({
      text: 'Resolving 1 conflicting file: the merger agent answers each region',
      tone: 'wait',
    });
    expect(
      mergeState(
        entry({
          state: 'needs-you',
          merge: M,
          resolution: { ...resolution, usage: { input: 3100, output: 120 } },
          check: { ...check, ok: true, ms: 4200 },
        }),
      ),
    ).toEqual({
      text: 'Resolved 1 region (sonnet, 3.2K tokens) · checked in 4.2 s: review it',
      tone: 'you',
    });
    // A failed check is said, not taken for a wrong resolution: it is still the person's turn.
    expect(
      mergeState(
        entry({
          state: 'needs-you',
          merge: M,
          resolution,
          check: { ...check, ok: false, failed: 'pnpm check' },
        }),
      ),
    ).toEqual({
      text: 'Resolved 1 region (sonnet) · its check failed (pnpm check): review it',
      tone: 'you',
    });
    expect(
      mergeState(
        entry({
          state: 'needs-you',
          conflicts: ['src/a.ts'],
          resolution: { ...resolution, regions: [], needsYou: 'a: two values' },
          message: 'the merger agent: a: two values',
        }),
      ),
    ).toEqual({ text: 'The merger agent: a: two values', tone: 'you' });
  });

  it('offers Approve and Request changes on a resolution, and Check again when its check failed', () => {
    const resolved = entry({ state: 'needs-you', merge: M, resolution });
    expect(mergeActions(resolved)).toEqual(['approve', 'change', 'retry', 'remove']);
    expect(mergeActions({ ...resolved, check: { ...check, ok: true } })).toEqual([
      'approve',
      'change',
      'retry',
      'remove',
    ]);
    expect(mergeActions({ ...resolved, check: { ...check, ok: false } })).toEqual([
      'approve',
      'change',
      'recheck',
      'retry',
      'remove',
    ]);
    // A clean merge whose check failed: Retry merges and checks it again, no agent asked.
    expect(
      mergeActions(entry({ state: 'failed', merge: M, check: { ...check, ok: false } })),
    ).toEqual(['retry', 'remove']);
  });

  it('says a resolution waits for its check to run again', () => {
    expect(mergeState(entry({ state: 'queued', merge: M, resolution, recheck: true }))).toEqual({
      text: 'Queued: its check runs again on mmmmmmm',
      tone: 'wait',
    });
  });

  it('keeps saying the check failed once an approved resolution is ready or landed', () => {
    const failed = { ...check, ok: false, ms: 151_000, failed: 'pnpm check' };
    expect(
      mergeState(
        entry({
          state: 'ready',
          merge: M,
          resolution,
          check: failed,
          message: 'main was not moved: local changes',
        }),
      ),
    ).toEqual({
      text: 'Approved, its check failed (pnpm check): ready to land · main was not moved: local changes',
      tone: 'you',
    });
    expect(mergeState(entry({ state: 'landed', merge: M, resolution, check: failed }))).toEqual({
      text: 'Landed: main is at mmmmmmm · its check failed (pnpm check)',
      tone: 'done',
    });
  });
});

describe('failedCheck (fix/fix-merger)', () => {
  const commands = ['pnpm install', 'pnpm check', 'pnpm build', 'pnpm test:e2e'];
  const run = { commands, source: 'symbiote/config.json (merge.checks)' };

  it('says which commands passed, which failed and after how long, and which did not run', () => {
    expect(failedCheck({ ...run, ok: false, ms: 151_000, failed: 'pnpm test:e2e' })).toBe(
      'pnpm install, pnpm check and pnpm build passed; pnpm test:e2e failed after 2 min 31 s',
    );
    expect(failedCheck({ ...run, ok: false, ms: 40_000, failed: 'pnpm check' })).toBe(
      'pnpm install passed; pnpm check failed after 40.0 s; pnpm build and pnpm test:e2e did not run',
    );
    expect(failedCheck({ ...check, ok: false, failed: 'pnpm check' })).toBe('pnpm check failed');
  });

  it('says nothing of a check that passed, runs, or does not name what failed', () => {
    expect(failedCheck({ ...run, ok: true, ms: 1000 })).toBeNull();
    expect(failedCheck(run)).toBeNull();
    expect(failedCheck({ ...run, ok: false })).toBeNull();
  });
});

describe('mergeActions (V26a)', () => {
  it('offers Land when ready, Retry when stopped, Remove unless it runs', () => {
    expect(mergeActions(entry({}))).toEqual(['remove']);
    expect(mergeActions(entry({ state: 'merging' }))).toEqual([]);
    expect(mergeActions(entry({ state: 'checking' }))).toEqual([]);
    expect(mergeActions(entry({ state: 'ready' }))).toEqual(['land', 'remove']);
    expect(mergeActions(entry({ state: 'failed' }))).toEqual(['retry', 'remove']);
    expect(mergeActions(entry({ state: 'needs-you' }))).toEqual(['retry', 'remove']);
    expect(mergeActions(entry({ state: 'landed' }))).toEqual(['remove']);
  });

  it('reads the queue again while a merge is queued, merging or checking', () => {
    expect(mergeLive([entry({ state: 'landed' }), entry({ state: 'ready' })])).toBe(false);
    expect(mergeLive([entry({ state: 'landed' }), entry({ state: 'checking' })])).toBe(true);
  });
});

describe('mergeButtons and removableOnCard (V55)', () => {
  it("draws a landed merge's Remove in its head; Retry and Remove of any other under ⋯", () => {
    expect(mergeButtons(entry({ state: 'landed' }))).toEqual({ buttons: ['remove'], more: [] });
    expect(mergeButtons(entry({}))).toEqual({ buttons: [], more: ['remove'] });
    expect(mergeButtons(entry({ state: 'ready' }))).toEqual({
      buttons: ['land'],
      more: ['remove'],
    });
    expect(mergeButtons(entry({ state: 'failed' }))).toEqual({
      buttons: [],
      more: ['retry', 'remove'],
    });
    const region = { path: 'src/a.ts', line: 1, ours: ['a'], base: null, theirs: ['b'], text: 'c' };
    const resolution = { agent: 'claude' as const, model: 'sonnet', regions: [region], ms: 4000 };
    expect(mergeButtons(entry({ state: 'needs-you', merge: M, resolution }))).toEqual({
      buttons: ['approve', 'change'],
      more: ['retry', 'remove'],
    });
    expect(mergeButtons(entry({ state: 'checking' }))).toEqual({ buttons: [], more: [] });
  });

  it('offers Remove on a card only once its merge landed: any other is removed from its page', () => {
    const states = [
      'queued',
      'merging',
      'resolving',
      'checking',
      'needs-you',
      'ready',
      'landed',
      'failed',
    ] as const;
    expect(states.filter((state) => removableOnCard(entry({ state })))).toEqual(['landed']);
  });
});

describe('a resolution, line by line (the merge page remake)', () => {
  const DOUBLE = 'export const double = (a: number) => a * 2;';
  const SQUARE = ['export function square(a: number): number {', '  return a * a;', '}'];
  const CUBE = ['export function cube(a: number): number {', '  return a * a * a;', '}'];
  const added = {
    path: 'src/math.ts',
    line: 8,
    ours: [DOUBLE],
    base: [],
    theirs: [...SQUARE, '', ...CUBE],
  };

  it('marks the lines a resolution dropped from a side', () => {
    const review = reviewRegion({ ...added, text: DOUBLE });
    expect(review.lines).toEqual([{ text: DOUBLE, from: 'ours' }]);
    expect(review.kept).toEqual({ ours: { kept: 1, of: 1 }, theirs: { kept: 0, of: 6 } });
    expect(review.dropped).toEqual({ ours: [], theirs: [...SQUARE, ...CUBE] });
    expect(review.twice).toBe(0);
    expect(review.written).toBe(0);
    expect(regionFlags(review, 'main', 'agent')).toEqual([
      { tone: 'bad', text: 'Drops all 6 lines from agent' },
    ]);
  });

  it('says a resolution keeps every line of both sides; blank lines are not counted', () => {
    const review = reviewRegion({
      ...added,
      text: [DOUBLE, '', ...SQUARE, '', ...CUBE].join('\n'),
    });
    expect(review.lines.map((l) => l.from)).toEqual([
      'ours',
      'blank',
      'theirs',
      'theirs',
      'theirs',
      'blank',
      'theirs',
      'theirs',
      'theirs',
    ]);
    expect(review.kept).toEqual({ ours: { kept: 1, of: 1 }, theirs: { kept: 6, of: 6 } });
    expect(regionFlags(review, 'main', 'agent')).toEqual([
      { tone: 'ok', text: 'Keeps every line of both sides, nothing new' },
    ]);
  });

  it("finds a line kept twice, a line the agent wrote, and a side's line dropped", () => {
    const review = reviewRegion({
      path: 'docs/PLAN.md',
      line: 441,
      ours: ['| V25 | Workspaces |', '| V27 | Codex |'],
      base: ['| V25 | Workspaces |'],
      theirs: ['| V26 | A merger | built |', '| V27 | Codex |'],
      text: [
        '| V25 | Workspaces |',
        '| V26 | A merger | merged |',
        '| V27 | Codex |',
        '| V27 | Codex |',
      ].join('\n'),
    });
    // Lines are read in order (fix/merge-viewer-on-conflict): only the second copy is the extra one.
    expect(review.lines).toEqual([
      { text: '| V25 | Workspaces |', from: 'ours' },
      { text: '| V26 | A merger | merged |', from: 'new' },
      { text: '| V27 | Codex |', from: 'both' },
      { text: '| V27 | Codex |', from: 'both', twice: true },
    ]);
    // The ancestor's line is no side's own: neither side added it.
    expect(review.kept).toEqual({ ours: { kept: 1, of: 1 }, theirs: { kept: 1, of: 2 } });
    expect(review.dropped).toEqual({ ours: [], theirs: ['| V26 | A merger | built |'] });
    expect(regionFlags(review, 'main', 'milestone/v26')).toEqual([
      { tone: 'bad', text: 'Drops 1 of 2 lines from milestone/v26' },
      { tone: 'bad', text: '1 line kept twice' },
      { tone: 'new', text: '1 line written by the agent' },
    ]);
  });

  it('keeps once what both sides added alike, and reads past indentation', () => {
    const review = reviewRegion({
      path: 'a.ts',
      line: 1,
      ours: ['  x();', 'y();'],
      base: null,
      theirs: ['x();'],
      text: 'x();\n  y();',
    });
    expect(review.lines).toEqual([
      { text: 'x();', from: 'both' },
      { text: '  y();', from: 'ours' },
    ]);
    expect(regionFlags(review, 'main', 'b')).toEqual([
      { tone: 'ok', text: 'Keeps every line of both sides, nothing new' },
    ]);
  });

  it('a side that only removed lines leaves nothing to keep', () => {
    const review = reviewRegion({
      path: 'a.ts',
      line: 1,
      ours: [],
      base: ['old();'],
      theirs: ['old();', 'b();'],
      text: 'b();',
    });
    expect(review.kept).toEqual({ ours: { kept: 0, of: 0 }, theirs: { kept: 1, of: 1 } });
    expect(regionFlags(review, 'main', 'b')).toEqual([
      { tone: 'ok', text: 'Keeps every line of both sides, nothing new' },
    ]);
  });
});

describe('a fast-forward (V67)', () => {
  const ff = (fields: Partial<MergeEntry>) => entry({ strategy: 'fast-forward', ...fields });

  it('says it is a fast-forward in each state, and where the target moved', () => {
    expect(mergeState(ff({})).text).toBe('Queued: ccccccc into main, by fast-forward');
    expect(mergeState(ff({ state: 'merging' })).text).toBe('Fast-forwarding main');
    expect(mergeState(ff({ state: 'checking', check })).text).toBe('Checking: pnpm check');
    expect(mergeState(ff({ state: 'ready', merge: C, message: 'no check to run' })).text).toBe(
      'Not checked: no check to run',
    );
    expect(
      mergeState(ff({ state: 'landed', merge: C, check: { ...check, ok: true, ms: 4200 } })),
    ).toEqual({ text: 'Landed: main fast-forwarded to ccccccc · checked in 4.2 s', tone: 'done' });
    expect(mergeState(ff({ state: 'landed', message: 'already in main' })).text).toBe(
      'Landed: already in main',
    );
  });

  it("is the person's turn when the target can no longer take it: Merge commit instead", () => {
    const waiting = ff({ state: 'needs-you', behind: 2, message: 'main has 2 commits…' });
    expect(mergeState(waiting)).toEqual({
      text: 'Cannot fast-forward: main has 2 commits feature/csv does not. Merge with a merge commit, or bring main into the branch and review it again',
      tone: 'you',
    });
    expect(mergeLabel(waiting)).toBe('Needs you');
    expect(mergeButtons(waiting)).toEqual({
      buttons: ['merge-commit'],
      more: ['retry', 'remove'],
    });
    // A merge commit waiting for the person is offered no other way.
    expect(mergeActions(entry({ state: 'needs-you' }))).not.toContain('merge-commit');
  });

  it('says no merge commit is made, where a merge says its subject', () => {
    expect(mergeTitle(entry({}))).toBe('Merge feature/csv: CSV');
    expect(mergeTitle(ff({}))).toBe(
      'No merge commit: a fast-forward to ccccccc, the approved commit',
    );
  });

  it('offers a fast-forward only to a target that can take it, and says why not', () => {
    const targets: MergeTargets = {
      branches: ['develop', 'main'],
      into: 'main',
      head: C,
      strategy: 'merge',
      fastForward: ['develop'],
    };
    expect(fastForwardBlocked(targets, 'feature/csv', 'develop')).toBeNull();
    expect(fastForwardBlocked(targets, 'feature/csv', 'main')).toBe(
      'main has commits feature/csv does not: it cannot fast-forward. Merge with a merge commit, or bring main into the branch and review it again.',
    );
    expect(mergeTip(targets, 'main', 'merge')).toBe(
      "Merge ccccccc into main\nThe approved commit, in Symbiote's own worktree: checked, then landed",
    );
    expect(mergeTip(targets, 'develop', 'fast-forward')).toBe(
      "Fast-forward develop to ccccccc\nNo merge commit: develop moves to the approved commit itself, once its check passes in Symbiote's own worktree",
    );
  });
});

describe('mergeLabel (the merge page remake)', () => {
  it('names where a merge is in a word or two', () => {
    const resolution = {
      agent: 'claude' as const,
      regions: [{ path: 'a', line: 1, ours: [], base: null, theirs: [], text: '' }],
      ms: 1,
    };
    expect(mergeLabel(entry({}))).toBe('Queued');
    expect(mergeLabel(entry({ state: 'resolving' }))).toBe('Resolving');
    expect(mergeLabel(entry({ state: 'needs-you', merge: M, resolution }))).toBe(
      'Review resolution',
    );
    expect(mergeLabel(entry({ state: 'needs-you' }))).toBe('Needs you');
    expect(mergeLabel(entry({ state: 'ready' }))).toBe('Ready to land');
    expect(mergeLabel(entry({ state: 'landed' }))).toBe('Landed');
    expect(mergeLabel(entry({ state: 'failed' }))).toBe('Failed');
  });
});

describe("a resolution's files (V46c)", () => {
  /** A region of `path` whose resolution is `text`; both sides added, nothing before. */
  const region = (path: string, line: number, ours: string[], theirs: string[], text: string) => ({
    path,
    line,
    ours,
    base: [],
    theirs,
    text,
  });
  const resolved = (regions: ReturnType<typeof region>[], conflicts?: string[]) =>
    entry({
      state: 'needs-you',
      merge: M,
      conflicts: conflicts ?? [...new Set(regions.map((r) => r.path))],
      resolution: { agent: 'claude', model: 'sonnet', regions, ms: 4000 },
    });

  it('lists each conflicting file once, with its regions in order and what they did together', () => {
    const files = resolutionFiles(
      resolved([
        region('docs/JOURNAL.md', 10, ['main entry'], ['csv entry'], 'main entry\ncsv entry'),
        region('docs/PLAN.md', 4, ['| V1 | main |'], ['| V2 | csv |'], '| V1 | main |'),
        region('docs/PLAN.md', 30, ['a', 'b'], ['c'], 'a\nb\nc\nnew line'),
      ]),
    );
    expect(files.map((f) => [f.path, f.regions.map((r) => r.line)])).toEqual([
      ['docs/JOURNAL.md', [10]],
      ['docs/PLAN.md', [4, 30]],
    ]);
    expect(files[0]).toMatchObject({
      tone: 'ok',
      flags: [{ tone: 'ok', text: 'Keeps every line of both sides, nothing new' }],
    });
    // Both regions' flags put together: one dropped line, one written.
    expect(files[1]).toMatchObject({
      tone: 'bad',
      flags: [
        { tone: 'bad', text: 'Drops 1 of 2 lines from feature/csv' },
        { tone: 'new', text: '1 line written by the agent' },
      ],
    });
  });

  it('shows first the first file that loses or doubles lines, else the first', () => {
    const files = resolutionFiles(
      resolved([
        region('a.ts', 1, ['x'], ['y'], 'x\ny'),
        region('b.ts', 1, ['x'], ['y'], 'x'),
        region('c.ts', 1, ['x'], ['y'], 'x'),
      ]),
    );
    expect(firstFile(files)?.path).toBe('b.ts');
    expect(firstFile(files.slice(0, 1))?.path).toBe('a.ts');
    expect(firstFile([])).toBeUndefined();
  });

  it('lists the files nobody resolved, and why one was not given to the agent', () => {
    const files = resolutionFiles(
      entry({
        state: 'needs-you',
        conflicts: ['README.md', 'jslib', 'logo.png', 'src/gone.ts'],
        unresolvable: [
          { path: 'jslib', kind: 'submodule' },
          { path: 'logo.png', kind: 'binary' },
          { path: 'src/gone.ts', kind: 'deleted' },
        ],
      }),
    );
    expect(files.map((f) => [f.path, f.regions.length, f.tone, f.why])).toEqual([
      ['README.md', 0, 'none', 'Not resolved'],
      ['jslib', 0, 'none', 'A submodule: not given to the merger agent'],
      ['logo.png', 0, 'none', 'Binary: not given to the merger agent'],
      ['src/gone.ts', 0, 'none', 'Deleted on one side: not given to the merger agent'],
    ]);
    expect(firstFile(files)?.path).toBe('README.md');
  });

  it('says a file is being resolved while the agent works', () => {
    const [file] = resolutionFiles(entry({ state: 'resolving', conflicts: ['src/a.ts'] }));
    expect(file).toMatchObject({ path: 'src/a.ts', regions: [], tone: 'none', why: 'Resolving…' });
  });

  it('has no files without a conflict', () => {
    expect(resolutionFiles(entry({ state: 'landed', merge: M }))).toEqual([]);
  });
});

describe('red for what is lost or doubled, amber for what the agent wrote (fix/merge-viewer-on-conflict)', () => {
  // A merge of feature/discounts (discount codes) into main (rounding), as the person's: four
  // files, each resolved the way the agent did.
  const region = (
    path: string,
    ours: string[],
    base: string[],
    theirs: string[],
    text: string[],
    around?: { before: string[]; after: string[] },
  ) => ({
    path,
    line: 3,
    ours,
    base,
    theirs,
    text: text.join('\n'),
    ...(around ? { around } : {}),
  });
  const files = (regions: ReturnType<typeof region>[]) =>
    resolutionFiles(
      entry({
        branch: 'feature/discounts',
        state: 'needs-you',
        merge: M,
        conflicts: [...new Set(regions.map((r) => r.path))],
        resolution: { agent: 'claude', model: 'sonnet', regions, ms: 11_000 },
      }),
    );
  const verdicts = (list: ReturnType<typeof resolutionFiles>) =>
    list.map((f) => [f.path, f.tone, f.flags.map((flag) => flag.text)]);

  // Both sides change one paragraph; the agent keeps both sides' words, wrapped again.
  const readme = region(
    'README.md',
    ['Totals are the sum of the item prices, rounded to', 'cents at the end.'],
    ['Totals are the sum of the item prices.'],
    ['Totals are the sum of the item prices, less any', 'discount code given at checkout.'],
    [
      'Totals are the sum of the item prices, less any',
      'discount code given at checkout, rounded to cents at',
      'the end.',
    ],
  );
  // Both sides add two tests at the end: each closed by its own `});`.
  const test1 = (name: string, body: string) => [`  it('${name}', () => {`, `    ${body}`, '  });'];
  const tests = region(
    'src/pricing.test.ts',
    [
      ...test1('rounds to cents', 'expect(total([0.1, 0.2])).toBe(0.3);'),
      ...test1('rounds halves up', 'expect(total([0.005])).toBe(0.01);'),
    ],
    [],
    [
      ...test1('applies a code', "expect(total([10], 'TEN')).toBe(9);"),
      ...test1('ignores an unknown code', "expect(total([10], 'NOPE')).toBe(10);"),
    ],
    [
      ...test1('rounds to cents', 'expect(total([0.1, 0.2])).toBe(0.3);'),
      ...test1('rounds halves up', 'expect(total([0.005])).toBe(0.01);'),
      ...test1('applies a code', "expect(total([10], 'TEN')).toBe(9);"),
      ...test1('ignores an unknown code', "expect(total([10], 'NOPE')).toBe(10);"),
    ],
  );
  // The doc comment both sides changed, merged into one.
  const comment = region(
    'src/pricing.ts',
    ['/** The total of the prices, rounded to cents. */'],
    ['/** The total of the prices. */'],
    ['/** The total of the prices, less the discount code. */'],
    ['/** The total of the prices, less the discount code, rounded to cents. */'],
  );
  // Both add an entry under "## Unreleased", just above the region: the agent writes it again.
  const changelog = region(
    'CHANGELOG.md',
    ['- Totals are rounded to cents.'],
    [],
    ['- Discount codes at checkout.'],
    ['## Unreleased', '- Totals are rounded to cents.', '- Discount codes at checkout.'],
    { before: ['# Changelog', '', '## Unreleased'], after: ['', '## 1.0.0', '- First release.'] },
  );

  it('reads a correct merge without red, and the line copied from above the region in red', () => {
    const list = files([readme, tests, comment, changelog]);
    expect(verdicts(list)).toEqual([
      [
        'README.md',
        'new',
        ['2 lines written by the agent, with the changes of the 3 they replace'],
      ],
      ['src/pricing.test.ts', 'ok', ['Keeps every line of both sides, nothing new']],
      [
        'src/pricing.ts',
        'new',
        ['1 line written by the agent, with the changes of the 2 it replaces'],
      ],
      ['CHANGELOG.md', 'bad', ['Repeats “## Unreleased” from just above it']],
    ]);
    expect(firstFile(list)?.path).toBe('CHANGELOG.md');
  });

  it('marks the copied line, and the lines rewritten from each side', () => {
    const copied = reviewRegion(changelog);
    expect(copied.lines[0]).toEqual({ text: '## Unreleased', from: 'new', repeats: 'above' });
    expect(copied.written).toBe(0);
    const merged = reviewRegion(comment);
    expect(merged.kept).toEqual({ ours: { kept: 1, of: 1 }, theirs: { kept: 1, of: 1 } });
    expect(merged.dropped).toEqual({ ours: [], theirs: [] });
    expect(merged.rewritten).toEqual({ ours: comment.ours, theirs: comment.theirs });
  });

  it('reads a wrong merge in red, apart from a right one, and shows it first', () => {
    // The discount lost: main's line kept as it was, the branch's dropped.
    const wrong = region(
      'src/pricing.ts',
      ['  return Math.round(sum * 100) / 100;'],
      ['  return sum;'],
      ['  return sum * (1 - discountOf(code));'],
      ['  return Math.round(sum * 100) / 100;'],
    );
    const right = {
      ...wrong,
      text: '  return Math.round(sum * (1 - discountOf(code)) * 100) / 100;',
    };
    expect(verdicts(files([readme, wrong]))).toEqual([
      [
        'README.md',
        'new',
        ['2 lines written by the agent, with the changes of the 3 they replace'],
      ],
      ['src/pricing.ts', 'bad', ['Drops the line from feature/discounts']],
    ]);
    expect(firstFile(files([readme, wrong]))?.path).toBe('src/pricing.ts');
    expect(verdicts(files([right]))).toEqual([
      [
        'src/pricing.ts',
        'new',
        ['1 line written by the agent, with the changes of the 2 it replaces'],
      ],
    ]);
    expect(firstFile(files([tests, readme]))?.path).toBe('README.md');
  });

  it("reads what each side changed, not its line word for word: a real merger agent's resolution", () => {
    // Claude Code (sonnet) on this merge: the discount applied in a variable, then rounded.
    const signature = region(
      'src/pricing.ts',
      [
        '/** The total of the prices, rounded to cents. */',
        'export function total(prices: number[]): number {',
      ],
      ['/** The total of the prices. */', 'export function total(prices: number[]): number {'],
      [
        'const CODES: Record<string, number> = { TEN: 0.1 };',
        '',
        '/** The total of the prices, less the discount code. */',
        'export function total(prices: number[], code?: string): number {',
      ],
      [
        'const CODES: Record<string, number> = { TEN: 0.1 };',
        '',
        '/** The total of the prices, less the discount code, rounded to cents. */',
        'export function total(prices: number[], code?: string): number {',
      ],
    );
    const body = region(
      'src/pricing.ts',
      ['  return Math.round(sum * 100) / 100;'],
      ['  return sum;'],
      ['  return sum * (1 - (code ? (CODES[code] ?? 0) : 0));'],
      [
        '  const discounted = sum * (1 - (code ? (CODES[code] ?? 0) : 0));',
        '  return Math.round(discounted * 100) / 100;',
      ],
    );
    expect(verdicts(files([signature, body]))).toEqual([
      [
        'src/pricing.ts',
        'new',
        ['3 lines written by the agent, with the changes of the 4 they replace'],
      ],
    ]);
    // Without the discount, the branch's change is lost: red.
    const lost = {
      ...body,
      text: '  const rounded = Math.round(sum * 100) / 100;\n  return rounded;',
    };
    expect(verdicts(files([lost]))[0]?.[1]).toBe('bad');
  });

  it('keeps code strict: a changed operator is a dropped line, not a rewritten one', () => {
    const review = reviewRegion(
      region('a.ts', ['x = a + 1;'], ['x = a;'], ['x = a - b;'], ['x = a + b + 1;']),
    );
    expect(review.dropped).toEqual({ ours: [], theirs: ['x = a - b;'] });
    expect(regionFlags(review, 'main', 'b')).toEqual([
      { tone: 'bad', text: 'Drops the line from b' },
      {
        tone: 'new',
        text: '1 line written by the agent, with the changes of the line it replaces',
      },
    ]);
  });

  it('reads lines a resolution moved as kept, not dropped and kept twice', () => {
    const review = reviewRegion(
      region(
        'a.ts',
        ['import { a } from "a";', 'import { b } from "b";'],
        [],
        ['c();'],
        ['import { b } from "b";', 'import { a } from "a";', 'c();'],
      ),
    );
    expect(review.twice).toBe(0);
    expect(regionFlags(review, 'main', 'b')).toEqual([
      { tone: 'ok', text: 'Keeps every line of both sides, nothing new' },
    ]);
  });
});

describe('the merger agent asks you (fix/merge-viewer-on-conflict)', () => {
  const conflict = (path: string, line: number) => ({
    path,
    line,
    ours: ['a = 1'],
    base: ['a = 0'],
    theirs: ['a = 2'],
    around: { before: ['// above'], after: ['// below'] },
  });
  const asking = (needsYou: string) =>
    entry({
      state: 'needs-you',
      conflicts: ['README.md', 'src/pricing.ts'],
      message: `the merger agent: ${needsYou}`,
      resolution: {
        agent: 'claude',
        regions: [],
        needsYou,
        asked: [conflict('README.md', 3), conflict('README.md', 20), conflict('src/pricing.ts', 8)],
        ms: 11_000,
      },
    });

  it("is the person's turn: they answer it", () => {
    expect(mergeState(asking('Region 3: which discount?'))).toEqual({
      text: 'The merger agent: Region 3: which discount?',
      tone: 'you',
    });
    expect(mergeLabel(asking('Region 3: which discount?'))).toBe('Needs you');
  });

  it('lists each file with the regions it asked about, and opens the one the question names', () => {
    const files = resolutionFiles(asking('Region 3: keep the discount or the rounding?'));
    expect(files.map((f) => [f.path, f.asked.map((r) => r.line), f.tone, f.why])).toEqual([
      ['README.md', [3, 20], 'asked', 'Waiting for your answer'],
      ['src/pricing.ts', [8], 'asked', 'Waiting for your answer'],
    ]);
    expect(askedRegions('Region 3: keep the discount or the rounding?')).toEqual([3]);
    expect(askedRegions('Regions 1 and 2 disagree; region 4 too')).toEqual([1, 2, 4]);
    expect(askedRegions('Both values differ')).toEqual([]);
    const entryAsking = asking('Region 3: keep the discount or the rounding?');
    expect(firstFile(files, entryAsking)?.path).toBe('src/pricing.ts');
    expect(firstFile(files, asking('Which one?'))?.path).toBe('README.md');
  });

  it('keeps the files listed while it is asked again', () => {
    const again = entry({
      state: 'merging',
      conflicts: ['README.md'],
      again: { comments: 'Both.', previous: [], asked: 'Region 1?' },
    });
    expect(resolutionFiles(again).map((f) => [f.path, f.why])).toEqual([
      ['README.md', 'Resolving…'],
    ]);
    expect(resolutionFiles({ ...again, state: 'queued' }).map((f) => [f.path, f.why])).toEqual([
      ['README.md', 'Resolving…'],
    ]);
  });
});

describe("the sides' names in the gutter (fix/merge-viewer-on-conflict)", () => {
  it('is as wide as the longest name, at most 24 characters', () => {
    expect(gutterChars(['main', 'feature/discounts'])).toBe(17);
    expect(gutterChars(['main', 'agent'])).toBe(5);
    expect(gutterChars(['main', 'feature/a-very-long-branch-name-indeed'])).toBe(24);
  });
});
