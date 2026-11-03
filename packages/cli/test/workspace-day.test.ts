// V91 (decision 852): `GET /api/workspaces/day?since=`, what Symbiote and git recorded since the
// page's local midnight six days back — threads' and Hive's events, Hive's records with their
// writer's timed totals, git's merges into the default branch — read, never written. A file not
// modified since `since` is not read.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openRepo } from '@symbiote/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { costPointsIn } from '../src/hive-pacing.js';
import { workspaceDay } from '../src/workspace-day.js';
import { serializeWorkspace, type WorkspaceFile } from '../src/workspace-record.js';

const repos: TestRepo[] = [];
const folders: string[] = [];
let cache: string;
beforeEach(() => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  cache = tempDir();
  folders.push(cache);
});
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const HOUR = 3_600_000;
const NOW = Date.now();
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString();
/** The page's `since`: two days back, enough room for "before" and "in" the window. */
const SINCE = ago(48);

const record = (over: Partial<WorkspaceFile> & { branch: string }): WorkspaceFile => ({
  agent: {
    kind: 'claude',
    permissionMode: 'default',
    started: over.created ?? ago(1),
    hooks: true,
    activity: true,
  },
  base: 'a'.repeat(40),
  brief: `# Feature: ${over.branch}\n`,
  by: 'ada@example.com',
  created: ago(1),
  from: 'main',
  planFirst: true,
  worktree: `/nowhere/${over.branch.replace('/', '-')}`,
  ...over,
});

/** A merge of `branch` into main, dated `at` (committer and author). */
function mergeAt(repo: TestRepo, branch: string, subject: string, at: string): string {
  repo.git('checkout', '--quiet', '-b', branch, 'main');
  repo.write({ [`src/${branch.replace('/', '-')}.ts`]: `export const x = 1;\n` });
  repo.commitAt(branch, at);
  repo.git('checkout', '--quiet', 'main');
  execFileSync('git', ['merge', '--quiet', '--no-ff', '-m', subject, branch], {
    cwd: repo.root,
    env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
  });
  return repo.git('rev-parse', 'HEAD');
}

const lines = (rows: unknown[]) => `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;

function setUp() {
  const repo = createRepo();
  repos.push(repo);
  repo.git('config', 'user.email', 'ada@example.com');
  repo.git('config', 'user.name', 'Ada');
  repo.write({ 'src/a.ts': 'export const a = 1;\n' });
  repo.commitAt('A', ago(200));
  mergeAt(repo, 'feature/old', 'Merge feature/old: Old', ago(100));
  const pushed = mergeAt(
    repo,
    'feature/receipt',
    'Merge feature/receipt: Email a receipt',
    ago(30),
  );
  const local = mergeAt(repo, 'fix/coupon', "Merge branch 'fix/coupon'", ago(2));
  // origin's main has the receipt's merge, not the coupon's.
  repo.git('update-ref', 'refs/remotes/origin/main', pushed);

  const symbiote = join(repo.root, 'symbiote');
  const put = (path: string, text: string, mtime?: string) => {
    const file = join(symbiote, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    if (mtime) utimesSync(file, new Date(mtime), new Date(mtime));
  };
  const transcripts = tempDir();
  folders.push(transcripts);
  const transcript = join(transcripts, 'writer.jsonl');
  writeFileSync(
    transcript,
    lines([
      { type: 'user', timestamp: ago(60) },
      { type: 'cost-state', totalCostUSD: 0.1 },
      { type: 'assistant', timestamp: ago(3) },
      { type: 'system', subtype: 'turn_duration', timestamp: ago(2) },
      { type: 'cost-state', totalCostUSD: 0.5 },
      { type: 'user', timestamp: ago(1) },
    ]),
  );

  for (const workspace of [
    record({ branch: 'feature/receipt', created: ago(40), finished: ago(20) }),
    record({ branch: 'feature/new', created: ago(5) }),
    record({ branch: 'feature/long-ago', created: ago(300) }),
    record({ branch: 'feature/hive-a', created: ago(4), hive: true }),
  ]) {
    put(`workspaces/${workspace.branch}.json`, serializeWorkspace(workspace));
  }
  const s = 's1';
  put(
    'threads/feature/new.jsonl',
    lines([
      { at: ago(5), session: s, kind: 'start', source: 'startup' },
      { at: ago(5), session: s, kind: 'prompt', text: 'Start: the brief' },
      {
        at: ago(4),
        session: s,
        kind: 'asks',
        tool: 'AskUserQuestion',
        questions: [{ question: 'EU only?', options: [] }],
      },
      { at: ago(3.5), session: s, kind: 'report', text: '# Plan\nDo it' },
      { at: ago(3), session: s, kind: 'prompt', text: 'Yes, build it' },
      { at: ago(2.5), session: s, kind: 'report', text: 'Built it' },
    ]),
  );
  // Not modified since `since`: not read, whatever it holds.
  put(
    'threads/feature/long-ago.jsonl',
    lines([{ at: ago(1), session: s, kind: 'report', text: 'never read' }]),
    ago(200),
  );
  put(
    'threads/feature/hive-a.jsonl',
    lines([{ at: ago(4), session: s, kind: 'start', source: 'startup', transcript }]),
  );
  const hiveRecord = (branch: string, over: Record<string, unknown>) => ({
    about: 'Hive',
    branch,
    step: 'writing',
    round: 1,
    rounds: 3,
    since: ago(1),
    started: ago(4),
    checks: [],
    reviews: [],
    ...over,
  });
  put(
    'hive/feature/hive-a.json',
    JSON.stringify(
      hiveRecord('feature/hive-a', {
        step: 'landed',
        round: 2,
        reviews: [
          {
            round: 1,
            at: 'c'.repeat(40),
            verdict: 'changes',
            ms: 1,
            cost: 0.3,
            findings: [
              { defect: 'd', test: 't', command: 'c', files: [], kept: true },
              { defect: 'e', test: 't', command: 'c', files: [], kept: false },
            ],
          },
        ],
        landings: [
          {
            round: 2,
            at: 'c'.repeat(40),
            into: 'main',
            entry: 'm1',
            queued: ago(1.5),
            ended: ago(1),
            outcome: 'landed',
          },
        ],
        spent: { writer: 0.5, at: ago(1) },
      }),
    ),
  );
  put(
    'hive/feature/hive-a.jsonl',
    lines([
      { at: ago(60), kind: 'started' },
      {
        at: ago(3),
        kind: 'review',
        round: 1,
        verdict: 'changes',
        kept: 1,
        dropped: 1,
        ms: 1,
        cost: 0.3,
      },
      { at: ago(1), kind: 'landed', into: 'main' },
    ]),
  );
  // A run's log beside the record is not its events.
  put('hive/feature/hive-a/r1.jsonl', lines([{ at: ago(1), out: 'log' }]));
  // In flight, nothing since: listed still.
  put(
    'hive/feature/flying.json',
    JSON.stringify(hiveRecord('feature/flying', { since: ago(100) })),
  );
  // Landed long ago, untouched since: not listed.
  put(
    'hive/feature/landed-long-ago.json',
    JSON.stringify(hiveRecord('feature/landed-long-ago', { step: 'landed', since: ago(100) })),
    ago(100),
  );
  put('hive/feature/landed-long-ago.jsonl', lines([{ at: ago(100), kind: 'landed' }]), ago(100));
  return { repo, pushed, local, transcript };
}

describe('the day read', () => {
  it("gives git's merges into the default branch since `since`, matched and pushed", async () => {
    const { repo, pushed, local } = setUp();
    const day = await workspaceDay(await openRepo(repo.root), cache).read(SINCE);
    expect(day.since).toBe(SINCE);
    expect(day.into).toBe('main');
    expect(
      day.merges.map(({ sha, subject, branch, pushed: p }) => ({
        sha,
        subject,
        branch,
        pushed: p,
      })),
    ).toEqual([
      {
        sha: pushed,
        subject: 'Merge feature/receipt: Email a receipt',
        branch: 'feature/receipt',
        pushed: true,
      },
      { sha: local, subject: "Merge branch 'fix/coupon'", branch: 'fix/coupon', pushed: false },
    ]);
    // git keeps a commit's time to the second.
    expect(Date.parse(day.merges[0]?.at ?? '')).toBe(Math.floor(Date.parse(ago(30)) / 1000) * 1000);
  });

  it("gives the threads' events since `since`, a report's answer, and skips stale files", async () => {
    const { repo } = setUp();
    const day = await workspaceDay(await openRepo(repo.root), cache).read(SINCE);
    const thread = day.events.filter((e) => e.source === 'thread');
    expect(thread.map((e) => [e.branch, e.kind, e.text, e.data])).toEqual([
      ['feature/new', 'asks', 'EU only?', { tool: 'AskUserQuestion' }],
      ['feature/new', 'report', '# Plan', { answered: false }],
      ['feature/new', 'prompt', 'Yes, build it', undefined],
      ['feature/new', 'report', 'Built it', { answered: true }],
    ]);
  });

  it("gives Hive's events, its records touched or in flight, and the writer's timed totals", async () => {
    const { repo } = setUp();
    const day = await workspaceDay(await openRepo(repo.root), cache).read(SINCE);
    expect(day.events.filter((e) => e.source === 'hive').map((e) => [e.kind, e.data])).toEqual([
      ['review', { round: 1, verdict: 'changes', kept: 1, dropped: 1, ms: 1, cost: 0.3 }],
      ['landed', { into: 'main' }],
    ]);
    expect(day.hive.map((r) => r.branch).sort()).toEqual(['feature/flying', 'feature/hive-a']);
    const a = day.hive.find((r) => r.branch === 'feature/hive-a');
    expect(a).toMatchObject({
      step: 'landed',
      round: 2,
      started: ago(4),
      reviews: [{ round: 1, kept: 1, cost: 0.3 }],
      spend: { writer: 0.5, reviews: 0.3, reviewed: 1, total: 0.8 },
      writer: [
        { transcript: 0, at: ago(60), total: 0.1 },
        { transcript: 0, at: ago(2), total: 0.5 },
      ],
    });
    expect(a?.landings?.[0]?.outcome).toBe('landed');
  });

  it('gives the starts of the workspaces started since `since` and of those merged', async () => {
    const { repo } = setUp();
    const day = await workspaceDay(await openRepo(repo.root), cache).read(SINCE);
    expect(day.started).toEqual({
      'feature/receipt': ago(40),
      'feature/new': ago(5),
      'feature/hive-a': ago(4),
    });
  });

  it('refuses a `since` that is not a time', async () => {
    const { repo } = setUp();
    await expect(workspaceDay(await openRepo(repo.root), cache).read('yesterday')).rejects.toThrow(
      /since/,
    );
  });
});

describe("a transcript's timed totals", () => {
  it('times each cost-state line by the nearest line before it with a timestamp', () => {
    const text = lines([
      { type: 'cost-state', totalCostUSD: 0.05 },
      { type: 'user', timestamp: '2026-11-03T08:00:00.000Z' },
      { type: 'system', subtype: 'turn_duration', timestamp: '2026-11-03T08:10:00.000Z' },
      { type: 'cost-state', totalCostUSD: 0.4 },
      { type: 'cost-state', totalCostUSD: 'x' },
      'not json',
    ]);
    // The first has no time before it: it is left out.
    expect(costPointsIn(text)).toEqual([{ at: '2026-11-03T08:10:00.000Z', total: 0.4 }]);
  });
});
