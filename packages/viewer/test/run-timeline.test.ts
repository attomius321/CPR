// V92 (decisions 861–866): a Hive workspace's Run tab — each round as a timeline (the writer, the
// check, the running review), older rounds folded to a line, a stop or a landing in words. Pure.
import type { HiveCheck, HiveReview, WorkspaceCommit, WorkspaceHiveDetail } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { checkRows, landedWords, runRounds, stopWords } from '../src/workspaces/run-timeline.js';

const sha = (c: string) => c.repeat(40);
const commit = (c: string, added: number, removed: number): WorkspaceCommit => ({
  sha: sha(c),
  subject: `Commit ${c}`,
  author: 'A',
  date: '2026-11-03T12:00:00+00:00',
  added,
  removed,
});
// Newest first, as the changes read lists them: round 1 wrote a and b, round 2 c, round 3 d.
const COMMITS = [commit('d', 22, 14), commit('c', 12, 1), commit('b', 30, 0), commit('a', 5, 1)];
const CREATED = '2026-11-03T12:34:00.000Z';
const check = (over: Partial<HiveCheck>): HiveCheck => ({
  round: 1,
  at: sha('b'),
  ok: true,
  ms: 41_000,
  ...over,
});
const review = (over: Partial<HiveReview>): HiveReview => ({
  round: 1,
  at: sha('b'),
  verdict: 'approved',
  ms: 91_000,
  cost: 0.42,
  findings: [],
  ...over,
});
const detail = (over: Partial<WorkspaceHiveDetail>): WorkspaceHiveDetail => ({
  branch: 'feature/discount',
  step: 'writing',
  round: 1,
  rounds: 3,
  on: true,
  checks: [],
  reviews: [],
  tests: '/s/hive/feature/discount',
  ...over,
});
const finding = (defect: string, kept = true) => ({
  defect,
  test: 'spaces',
  command: 'node --test test/review-spaces.test.ts',
  files: ['test/review-spaces.test.ts'],
  kept,
  code: 1,
});

describe('the rounds on a timeline (decision 861)', () => {
  // Round 1: written 12:34–12:37, checked 41 s, reviewed 1:31 with a defect proven; round 2:
  // written until 12:40, checked 38 s, approved.
  const landed = detail({
    step: 'landed',
    round: 2,
    checks: [
      check({ round: 1, at: sha('b'), started: '2026-11-03T12:37:00.000Z', ms: 41_000 }),
      check({ round: 2, at: sha('c'), started: '2026-11-03T12:40:00.000Z', ms: 38_000 }),
    ],
    reviews: [
      review({
        round: 1,
        at: sha('b'),
        verdict: 'changes',
        findings: [finding('applyCode refuses " save10 "'), finding('a guess', false)],
      }),
      review({ round: 2, at: sha('c'), cost: 0.42, summary: 'Codes are trimmed.' }),
    ],
  });

  it('lists the rounds newest first, the newest open and the others folded', () => {
    const rounds = runRounds(landed, COMMITS.slice(1), CREATED);
    expect(rounds.map((r) => [r.round, r.current])).toEqual([
      [2, true],
      [1, false],
    ]);
  });

  it("gives each round's writer its commits, their lines, its time and what it did", () => {
    const [two, one] = runRounds(landed, COMMITS.slice(1), CREATED);
    expect(one?.writer.commits.map((c) => c.subject)).toEqual(['Commit b', 'Commit a']);
    expect([one?.writer.added, one?.writer.removed]).toEqual([35, 1]);
    // From the workspace's start to its check's.
    expect(one?.writer.ms).toBe(3 * 60_000);
    expect(one?.writer.words).toBe('wrote the goal');
    expect(two?.writer.commits.map((c) => c.subject)).toEqual(['Commit c']);
    expect([two?.writer.added, two?.writer.removed]).toEqual([12, 1]);
    // From round 1's end (its check's start, 41 s, the review's 1:31) to its check's start.
    expect(two?.writer.ms).toBe(3 * 60_000 - 41_000 - 91_000);
    expect(two?.writer.words).toBe('fixed the proven defect');
  });

  it("says each round's verdict, its gist and its facts for the folded line", () => {
    const [two, one] = runRounds(landed, COMMITS.slice(1), CREATED);
    expect(two?.status).toEqual({ text: 'Approved', tone: 'ok' });
    expect(one?.status).toEqual({ text: '1 defect proven', tone: 'fail' });
    expect(one?.gist).toBe('applyCode refuses " save10 "');
    expect(one?.facts).toBe('check 0:41 · review $0.42');
    // The round's span: its writer's start to its review's end.
    expect(one?.from).toBe(Date.parse(CREATED));
    expect(one?.to).toBe(Date.parse('2026-11-03T12:37:00.000Z') + 41_000 + 91_000);
  });

  it('opens the round in progress with no check yet, its commits those after the last checked', () => {
    const writing = detail({
      step: 'writing',
      round: 3,
      checks: [
        check({ round: 1, at: sha('b'), ok: false, failed: 'pnpm check', ms: 121_000 }),
        check({ round: 2, at: sha('c'), started: '2026-11-03T12:45:00.000Z' }),
      ],
      reviews: [
        review({ round: 2, at: sha('c'), verdict: 'changes', findings: [finding('quoted comma')] }),
      ],
    });
    const rounds = runRounds(writing, COMMITS, CREATED);
    expect(rounds.map((r) => r.round)).toEqual([3, 2, 1]);
    expect(rounds[0]?.status).toEqual({ text: 'In progress', tone: 'run' });
    expect(rounds[0]?.writer.commits.map((c) => c.subject)).toEqual(['Commit d']);
    expect(rounds[0]?.check).toBeUndefined();
    expect(rounds[2]?.status).toEqual({ text: 'Check failed', tone: 'fail' });
    expect(rounds[2]?.gist).toBe('pnpm check');
    expect(rounds[2]?.facts).toBe('check 2:01');
    expect(rounds[1]?.writer.words).toBe('fixed the failing check');
    expect(rounds[0]?.writer.words).toBe('fixed the proven defect');
  });

  it('opens round 1 before anything ran, with no commit', () => {
    const rounds = runRounds(detail({}), [], CREATED);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.round).toBe(1);
    expect(rounds[0]?.writer.commits).toEqual([]);
    expect(rounds[0]?.status.text).toBe('In progress');
  });
});

describe("a finished check's commands (decision 862)", () => {
  it('marks each command passed or failed with its time, and those after a failure not run', () => {
    expect(
      checkRows(
        check({
          ok: false,
          commands: ['pnpm install', 'pnpm check', 'pnpm test:e2e', 'pnpm build'],
          steps: [
            { command: 'pnpm install', ok: true, ms: 20_000 },
            { command: 'pnpm check', ok: true, ms: 111_000 },
            { command: 'pnpm test:e2e', ok: false, ms: 408_000 },
          ],
        }),
      ),
    ).toEqual([
      { command: 'pnpm install', mark: 'passed', time: '0:20' },
      { command: 'pnpm check', mark: 'passed', time: '1:51' },
      { command: 'pnpm test:e2e', mark: 'failed', time: '6:48' },
      { command: 'pnpm build', mark: 'skipped', time: '' },
    ]);
  });

  it('reads a check recorded before its steps (decision 693) as one row', () => {
    expect(checkRows(check({ ok: false, failed: 'npm test', ms: 12_000 }))).toEqual([
      { command: 'npm test', mark: 'failed', time: '0:12' },
    ]);
    expect(checkRows(check({ ok: true, ms: 12_000 }))).toEqual([]);
  });
});

describe('a stop and a landing in words (decisions 865, 866)', () => {
  it('says Hive stopped at the round cap, at the budget, or for its note', () => {
    expect(
      stopWords(
        detail({ step: 'stuck', round: 3, note: 'the check failed 3 times: pnpm test:e2e' }),
      ),
    ).toEqual({
      title: 'Hive stopped after 3 rounds',
      why: 'The check failed 3 times: pnpm test:e2e. Each failure went back to the writer; at the round cap Hive stops and records why, and changes nothing else.',
    });
    expect(
      stopWords(
        detail({
          step: 'stuck',
          note: 'its spend reached its budget: $5.02 of $5.00 (writer $4.10, reviews $0.92). Raise the budget in Settings, then send it a message to go on',
        }),
      )?.title,
    ).toBe('Hive stopped at its budget');
    expect(stopWords(detail({ step: 'stuck', note: 'its agent failed twice: exit 1' }))).toEqual({
      title: 'Hive stopped',
      why: 'Its agent failed twice: exit 1.',
    });
    expect(stopWords(detail({ step: 'writing' }))).toBeNull();
  });

  it('says where it landed, the merge, what was pushed and when', () => {
    const ended = '2026-11-03T12:44:00.000Z';
    expect(
      landedWords(
        detail({
          branch: 'feature/discount-code',
          step: 'landed',
          landings: [
            {
              round: 2,
              at: sha('c'),
              into: 'main',
              entry: 'm1',
              queued: ended,
              ended,
              outcome: 'landed',
              merge: '20c37bc' + '0'.repeat(33),
              pushed: { ok: true, remote: 'origin' },
            },
          ],
          pushed: { at: ended, sha: sha('c'), ok: true },
        }),
      ),
    ).toEqual({
      title: 'Landed in main',
      line: 'Merged through the merge queue as 20c37bc; pushed main and feature/discount-code to origin',
      at: ended,
    });
    expect(landedWords(detail({ step: 'writing' }))).toBeNull();
  });
});
