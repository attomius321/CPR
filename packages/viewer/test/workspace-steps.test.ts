import type {
  BranchReviewSummary,
  MergeEntry,
  ThreadEntry,
  WorkspaceHive,
  WorkspaceSummary,
} from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { workspaceNext } from '../src/workspaces/workspaces.js';
import {
  agentDot,
  agentTabName,
  hiveSteps,
  normalSteps,
  planAnswered,
  pipelineSteps,
  type StepsModel,
} from '../src/workspaces/workspace-steps.js';

// V89 (decisions 823–827): the steps in a workspace's head, derived from what Symbiote records.
const TIP = 'b'.repeat(40);
const summary = (over: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({
  branch: 'feature/csv',
  base: 'a'.repeat(40),
  from: 'main',
  created: '2026-10-15T09:00:00.000Z',
  planFirst: false,
  brief: 'Export a review as CSV',
  worktree: { path: '/work/app.worktrees/feature-csv', exists: true, changed: 0 },
  tip: TIP,
  ahead: 0,
  merged: false,
  agent: { state: 'working', kind: 'claude', id: 's1' },
  ...over,
});
const review = (over: Partial<BranchReviewSummary> = {}): BranchReviewSummary => ({
  branch: 'feature/csv',
  base: 'a'.repeat(40),
  head: TIP,
  updated: '2026-10-15T10:00:00Z',
  marks: 3,
  refs: [{ name: 'feature/csv', tip: TIP, since: 0 }],
  added: [],
  ...over,
});

/** The steps of `workspace`, its next step derived as the sidenav derives it. */
const steps = (
  workspace: WorkspaceSummary,
  more: { review?: BranchReviewSummary; answered?: boolean; merge?: MergeEntry } = {},
) =>
  normalSteps({
    workspace,
    next: workspaceNext(workspace, more.review),
    planAnswered: more.answered ?? false,
    ...(more.merge ? { merge: more.merge } : {}),
  });

const at = (when: string) => ({ at: when, session: 's' });
const PLAN: ThreadEntry[] = [
  { ...at('2026-10-15T09:00:00Z'), kind: 'prompt', text: 'Plan it', from: 'start' },
  { ...at('2026-10-15T09:05:00Z'), kind: 'report', text: '# The plan' },
];

describe('planAnswered (V89)', () => {
  it("is false until a message of the person's follows the plan's report", () => {
    expect(planAnswered(PLAN)).toBe(false);
    expect(planAnswered(PLAN.slice(0, 1))).toBe(false);
    expect(
      planAnswered([
        ...PLAN,
        { ...at('2026-10-15T09:06:00Z'), kind: 'prompt', text: 'OK', from: 'person' },
      ]),
    ).toBe(true);
    // A background job's end is not the person's answer.
    expect(
      planAnswered([
        ...PLAN,
        { ...at('2026-10-15T09:06:00Z'), kind: 'prompt', text: 'done', from: 'task' },
      ]),
    ).toBe(false);
  });
});

describe('normalSteps (V89, decision 824)', () => {
  it('has Plan and Your OK only with plan first', () => {
    expect(steps(summary()).steps).toEqual(['Build', 'Review', 'Merge']);
    expect(steps(summary({ planFirst: true })).steps).toEqual([
      'Plan',
      'Your OK',
      'Build',
      'Review',
      'Merge',
    ]);
  });

  it('plans while plan first has no answer, then builds', () => {
    const planning = steps(summary({ planFirst: true }));
    expect(planning).toMatchObject({ at: 0, mark: 'now', tone: 'run', word: 'Plan' });
    const building = steps(summary({ planFirst: true }), { answered: true });
    expect(building).toMatchObject({ at: 2, mark: 'now', tone: 'run', word: 'Build' });
    // Commits mean it builds, whatever the thread says.
    expect(steps(summary({ planFirst: true, ahead: 2 }))).toMatchObject({ at: 2, word: 'Build' });
    expect(steps(summary())).toMatchObject({ at: 0, word: 'Build', detail: 'working' });
  });

  it("waits for the person's OK on a plan ready: the person's turn, since its report", () => {
    const ready = summary({
      planFirst: true,
      agent: { state: 'plan-ready', kind: 'claude', id: 's1' },
      activity: { since: '2026-10-15T09:05:00Z' },
    });
    expect(steps(ready)).toMatchObject({
      at: 1,
      mark: 'you',
      tone: 'you',
      word: 'Your OK',
      detail: 'waiting',
      since: '2026-10-15T09:05:00Z',
    });
  });

  it("an ask, a question or an interrupted turn is the person's turn at its step", () => {
    const asks = summary({
      agent: { state: 'needs-you', kind: 'claude', id: 's1', waitingFor: 'permission prompt' },
    });
    expect(steps(asks)).toMatchObject({ at: 0, mark: 'you', tone: 'you', detail: 'asks you' });
    const interrupted = summary({
      agent: { state: 'needs-you', kind: 'claude', id: 's1', interrupted: true },
    });
    expect(steps(interrupted)).toMatchObject({ mark: 'you', detail: 'interrupted' });
    const planning = summary({
      planFirst: true,
      agent: { state: 'needs-you', kind: 'claude', id: 's1', waitingFor: 'question' },
    });
    expect(steps(planning)).toMatchObject({ at: 0, word: 'Plan', mark: 'you' });
  });

  it('stopped is the person to start it; failed and not started are red', () => {
    const stopped = summary({ agent: { state: 'stopped', kind: 'claude', id: 's1' } });
    expect(steps(stopped)).toMatchObject({ at: 0, mark: 'you', tone: 'you', detail: 'stopped' });
    const failed = summary({ agent: { state: 'failed', kind: 'claude', id: 's1' } });
    expect(steps(failed)).toMatchObject({ at: 0, mark: 'bad', tone: 'error', detail: 'failed' });
    const notStarted = summary({ agent: { state: 'not-started', kind: 'claude', error: 'x' } });
    expect(steps(notStarted)).toMatchObject({ mark: 'bad', detail: 'not started' });
    const gone = summary({ tip: null });
    expect(steps(gone)).toMatchObject({ mark: 'bad', tone: 'error', detail: 'branch gone' });
  });

  it("commits and its turn ended: the person's review; a verdict to send is still the review's", () => {
    const ready = summary({ ahead: 2, agent: { state: 'ready', kind: 'claude', id: 's1' } });
    expect(steps(ready)).toMatchObject({ at: 1, mark: 'you', word: 'Review', detail: 'yours' });
    const changes = steps(ready, {
      review: review({
        verdict: {
          event: 'request-changes',
          head: TIP,
          at: '2026-10-15T10:00:00Z',
          comments: 1,
          merged: false,
        },
      }),
    });
    expect(changes).toMatchObject({ at: 1, word: 'Review', detail: 'changes requested' });
    const finished = summary({ agent: { state: 'done', kind: 'claude', id: 's1' } });
    expect(steps(finished)).toMatchObject({ at: 1, word: 'Review', detail: 'its report' });
  });

  it('approved: Merge is next; in the queue it merges; a failed merge is red; merged, all done', () => {
    const ready = summary({ ahead: 2, agent: { state: 'ready', kind: 'claude', id: 's1' } });
    const approved = steps(ready, {
      review: review({
        verdict: {
          event: 'approve',
          head: TIP,
          at: '2026-10-15T10:00:00Z',
          comments: 0,
          merged: false,
        },
      }),
    });
    expect(approved).toMatchObject({ at: 2, mark: 'you', word: 'Merge', detail: 'approved' });
    const entry = (state: MergeEntry['state']): MergeEntry =>
      ({
        id: 'm1',
        branch: 'feature/csv',
        head: TIP,
        into: 'main',
        subject: 'Merge feature/csv',
        state,
        queued: '2026-10-15T10:00:00Z',
        updated: '2026-10-15T10:00:00Z',
      }) as unknown as MergeEntry;
    expect(steps(ready, { merge: entry('checking') })).toMatchObject({
      at: 2,
      mark: 'now',
      tone: 'run',
      word: 'Merge',
    });
    expect(steps(ready, { merge: entry('failed') })).toMatchObject({ at: 2, mark: 'bad' });
    const merged = steps(summary({ ahead: 2, merged: true }));
    expect(merged).toMatchObject({ at: 3, tone: 'ok', word: 'Merged' });
    expect(steps(summary({ planFirst: true, ahead: 2, merged: true })).at).toBe(5);
  });
});

const hive = (over: Partial<WorkspaceHive> = {}): WorkspaceHive => ({
  step: 'writing',
  round: 2,
  rounds: 3,
  ...over,
});

describe('hiveSteps (V89, decision 825)', () => {
  it("Write, Check, Review, Land from Hive's step, in progress amber, with the round", () => {
    expect(hiveSteps(hive())).toMatchObject({
      steps: ['Write', 'Check', 'Review', 'Land'],
      at: 0,
      mark: 'now',
      tone: 'run',
      word: 'Write',
      detail: 'round 2 of 3',
    });
    expect(hiveSteps(hive({ step: 'checking' }))).toMatchObject({ at: 1, word: 'Check' });
    expect(hiveSteps(hive({ step: 'reviewing' }))).toMatchObject({ at: 2, word: 'Review' });
    expect(hiveSteps(hive({ step: 'landing' }))).toMatchObject({ at: 3, word: 'Land' });
  });

  it('landed or answered: every step done', () => {
    expect(hiveSteps(hive({ step: 'landed' }))).toMatchObject({
      at: 4,
      tone: 'ok',
      word: 'Landed',
    });
    expect(hiveSteps(hive({ step: 'answered' }))).toMatchObject({
      at: 4,
      tone: 'ok',
      word: 'Answered',
    });
  });

  it('stopped: red at the step it stopped at', () => {
    const check = { round: 3, at: TIP, ok: false, ms: 100 };
    expect(hiveSteps(hive({ step: 'stuck', check }))).toMatchObject({
      at: 1,
      mark: 'bad',
      tone: 'error',
      word: 'Check',
      detail: 'stopped',
    });
    const reviewed = { round: 3, at: '2026-10-15T10:00:00Z', verdict: 'changes' as const, kept: 1 };
    expect(
      hiveSteps(hive({ step: 'stuck', check: { ...check, ok: true }, review: reviewed })),
    ).toMatchObject({ at: 2, word: 'Review' });
    const landing = {
      round: 3,
      at: TIP,
      into: 'main',
      entry: 'm1',
      queued: '2026-10-15T10:00:00Z',
      outcome: 'conflict' as const,
    };
    expect(hiveSteps(hive({ step: 'stuck', landing }))).toMatchObject({ at: 3, word: 'Land' });
    expect(hiveSteps(hive({ step: 'stuck' }))).toMatchObject({ at: 0, word: 'Write' });
  });

  it('paused: its step, in the paused tone', () => {
    const pause = { reason: 'usage' as const, pauseAt: 90, since: '2026-10-15T10:00:00Z' };
    expect(hiveSteps(hive({ step: 'checking', pause }))).toMatchObject({
      at: 1,
      tone: 'info',
      detail: 'paused',
    });
    expect(hiveSteps(hive({ paused: true }))).toMatchObject({ at: 0, tone: 'info' });
  });
});

describe("the agent's tab (V89, decision 827)", () => {
  it('is named by its agent; a Hive writer is the writer', () => {
    expect(agentTabName({ state: 'working', kind: 'claude' }, false)).toEqual({
      name: 'Claude Code',
    });
    expect(agentTabName({ state: 'working', kind: 'codex' }, false)).toEqual({ name: 'Codex' });
    expect(agentTabName({ state: 'working' }, false)).toEqual({ name: 'Terminal' });
    expect(agentTabName({ state: 'working', kind: 'claude' }, true)).toEqual({
      name: 'Writer',
      what: 'Claude Code',
    });
  });

  it('has a violet dot when it waits for the person, amber while it works, none else', () => {
    expect(agentDot({ state: 'needs-you', waitingFor: 'permission prompt' })).toBe('you');
    expect(agentDot({ state: 'needs-you', interrupted: true })).toBe('you');
    expect(agentDot({ state: 'plan-ready' })).toBe('you');
    expect(agentDot({ state: 'working' })).toBe('run');
    expect(agentDot({ state: 'stopped' })).toBeNull();
    expect(agentDot({ state: 'ready' })).toBeNull();
  });
});

describe('pipelineSteps (V93, decision 884: the pipeline card)', () => {
  const model = (over: Partial<StepsModel>): StepsModel => ({
    steps: ['Plan', 'Your OK', 'Build', 'Review', 'Merge'],
    at: 1,
    mark: 'you',
    tone: 'you',
    word: 'Your OK',
    detail: 'waiting',
    ...over,
  });

  it("normal mode, plan first: each step's words, the current one its own, the person's violet", () => {
    expect(pipelineSteps(model({}), { into: 'main', commits: 0 })).toEqual([
      { name: 'Plan', state: 'done', detail: 'written' },
      { name: 'Your OK', state: 'you', detail: 'waiting' },
      { name: 'Build', state: 'todo', detail: 'the agent commits' },
      { name: 'Review', state: 'todo', detail: 'yours, on its graph' },
      { name: 'Merge', state: 'todo', detail: 'queue → main' },
    ]);
  });

  it('building, then merged: its commits once built, every step done', () => {
    const building = pipelineSteps(
      model({ at: 2, mark: 'now', tone: 'run', word: 'Build', detail: 'working' }),
      {
        into: 'main',
        commits: 3,
      },
    );
    expect(building.map((s) => [s.state, s.detail])).toEqual([
      ['done', 'written'],
      ['done', 'answered'],
      ['now', 'working'],
      ['todo', 'yours, on its graph'],
      ['todo', 'queue → main'],
    ]);
    const merged = pipelineSteps(
      model({ at: 5, mark: 'now', tone: 'ok', word: 'Merged', detail: '' }),
      {
        into: 'main',
        commits: 3,
      },
    );
    expect(merged.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(merged[2]?.detail).toBe('3 commits');
    expect(merged[4]?.detail).toBe('into main');
  });

  it("Hive's: Write, Check, Review, Land; a stop red where it stopped", () => {
    const stopped = pipelineSteps(
      {
        steps: ['Write', 'Check', 'Review', 'Land'],
        at: 1,
        mark: 'bad',
        tone: 'error',
        word: 'Check',
        detail: 'stopped',
      },
      { into: 'main', commits: 2 },
    );
    expect(stopped.map((s) => [s.name, s.state, s.detail])).toEqual([
      ['Write', 'done', '2 commits'],
      ['Check', 'bad', 'stopped'],
      ['Review', 'todo', 'proves defects'],
      ['Land', 'todo', 'into main'],
    ]);
  });
});
