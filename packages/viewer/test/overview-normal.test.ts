// V91 (decisions 853–855): normal mode's Overview from what the list and the day read record — the
// inbox and its one action a workspace, the five figures, the merges under way and merged today.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  BranchReviewList,
  BranchReviewSummary,
  MergeEntry,
  WorkspaceDay,
  WorkspaceSummary,
} from '@symbiote/core';
import { workspaceGroups } from '../src/workspaces/workspaces.js';
import {
  inbox,
  mergeSteps,
  mergedRows,
  normalFigures,
  type InboxRow,
  type MergedRow,
  type NormalFigures,
} from '../src/overview/normal-overview.js';

const zone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Europe/Bucharest';
});
afterAll(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

// 3 November 2026, 13:00 local (UTC+2).
const NOW = Date.parse('2026-11-03T11:00:00.000Z');
/** 3 November at `hh:mm` local. */
const today = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 10, 3, (h ?? 0) - 2, m ?? 0)).toISOString();
};
const TIP = 'b'.repeat(40);

const summary = (branch: string, over: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({
  branch,
  title: branch,
  base: 'a'.repeat(40),
  from: 'main',
  created: '2026-11-03T06:00:00.000Z',
  planFirst: false,
  brief: 'A brief',
  worktree: { path: `/work/${branch}`, exists: true, changed: 0 },
  tip: TIP,
  ahead: 0,
  merged: false,
  agent: { state: 'done', kind: 'claude' },
  ...over,
});

const review = (branch: string, over: Partial<BranchReviewSummary> = {}): BranchReviewSummary => ({
  branch,
  base: 'a'.repeat(40),
  head: TIP,
  updated: today('12:00'),
  marks: 0,
  refs: [{ name: branch, since: 0 }] as BranchReviewSummary['refs'],
  added: [],
  ...over,
});

const reviews = (list: BranchReviewSummary[]): BranchReviewList => ({
  defaultBranch: 'main',
  reviewer: 'ada',
  place: 'repository',
  reviews: list,
});

const entry = (branch: string, over: Partial<MergeEntry> = {}): MergeEntry => ({
  id: `m-${branch}`,
  branch,
  head: TIP,
  into: 'main',
  title: `Merge ${branch}: ${branch}`,
  state: 'queued',
  queued: today('12:50'),
  updated: today('12:50'),
  ...over,
});

const plan = summary('feature/saved-carts', {
  title: 'Save a cart for later',
  planFirst: true,
  agent: { state: 'plan-ready', kind: 'claude' },
  activity: { since: today('12:49') },
});
const asks = summary('fix/shipping-tax', {
  title: 'Charge tax on shipping',
  agent: { state: 'needs-you', kind: 'claude' },
  activity: {
    since: today('12:52'),
    asks: {
      at: today('12:52'),
      session: 's',
      kind: 'asks',
      tool: 'AskUserQuestion',
      questions: [{ question: 'Tax shipping for EU orders only?', options: [] }],
    },
  },
});
const toReview = summary('feature/discount-code', {
  title: 'Add a discount code',
  ahead: 3,
  agent: { state: 'ready', kind: 'claude' },
  activity: { since: today('12:46') },
});
const again = summary('feature/again', {
  title: 'Reviewed once',
  ahead: 5,
  agent: { state: 'ready', kind: 'codex' },
  activity: { since: today('12:40') },
});
const approved = summary('feature/approved', {
  title: 'Approved one',
  ahead: 2,
  agent: { state: 'ready', kind: 'claude' },
  activity: { since: today('12:30') },
});
const answered = summary('spike/catalog-search', {
  title: 'Which search library fits the catalog?',
  agent: { state: 'done', kind: 'claude' },
  activity: { since: today('12:47') },
});
const working = summary('feature/stock-levels', {
  agent: { state: 'working', kind: 'claude' },
  activity: { since: today('12:55') },
});
const codexWorking = summary('feature/order-pages', {
  agent: { state: 'working', kind: 'codex' },
  activity: { since: today('12:53') },
});

const list = [plan, asks, toReview, again, approved, answered, working, codexWorking];
const reviewList = reviews([
  review('feature/again', {
    refs: [{ name: 'feature/again', since: 2 }] as BranchReviewSummary['refs'],
  }),
  review('feature/approved', {
    verdict: { event: 'approve', head: TIP, at: today('12:31'), comments: 0, merged: false },
  }),
]);
const waitingMerge = entry('feature/conflicted', {
  state: 'needs-you',
  conflicts: ['src/a.ts'],
  updated: today('12:20'),
});
const queued = entry('fix/order-total-rounding', { state: 'checking' });

describe('the inbox', () => {
  let rows: InboxRow[] = [];
  beforeAll(() => {
    rows = inbox(workspaceGroups(list, reviewList), [waitingMerge, queued], reviewList);
  });

  it('lists what waits for the person, the oldest first, and nothing at work', () => {
    expect(rows.map((r) => r.branch)).toEqual([
      'feature/conflicted',
      'feature/approved',
      'feature/again',
      'feature/discount-code',
      'spike/catalog-search',
      'feature/saved-carts',
      'fix/shipping-tax',
    ]);
  });

  it('gives each row its one action, the one the workspace page or the card already has', () => {
    const by = Object.fromEntries(rows.map((r) => [r.branch, [r.kind, r.action]]));
    expect(by).toEqual({
      'feature/saved-carts': ['plan', 'respond'],
      'fix/shipping-tax': ['asks', 'respond'],
      'feature/discount-code': ['review', 'review'],
      'feature/again': ['review', 'review'],
      'feature/approved': ['approved', 'merge'],
      'spike/catalog-search': ['answered', 'read'],
      'feature/conflicted': ['merge', 'open'],
    });
  });

  it('says what each waits on in its own words', () => {
    const of = (branch: string) => rows.find((r) => r.branch === branch);
    expect(of('feature/saved-carts')).toMatchObject({
      words: 'Plan ready',
      detail: 'read it and answer',
      title: 'Save a cart for later',
      since: today('12:49'),
    });
    expect(of('fix/shipping-tax')).toMatchObject({
      words: 'Asks',
      detail: '“Tax shipping for EU orders only?”',
    });
    expect(of('feature/discount-code')).toMatchObject({
      words: 'To review',
      detail: '3 commits',
      commits: 3,
      sinceReview: 0,
    });
    expect(of('feature/again')).toMatchObject({
      words: 'To review',
      detail: '5 commits · 2 since your review',
      commits: 5,
      sinceReview: 2,
    });
    expect(of('feature/approved')).toMatchObject({ words: 'Approved', detail: 'ready to merge' });
    expect(of('spike/catalog-search')).toMatchObject({
      words: 'Answered',
      detail: 'a report, no commits',
    });
    expect(of('feature/conflicted')).toMatchObject({
      key: 'merge:m-feature/conflicted',
      words: 'Merge',
      detail: 'Conflicts with main in 1 file',
      entry: waitingMerge,
    });
  });

  it('is empty without workspaces', () => {
    expect(inbox(workspaceGroups([], null), [], null)).toEqual([]);
  });
});

describe('merged today and this week', () => {
  const day: WorkspaceDay = {
    since: '2026-10-27T22:00:00.000Z',
    into: 'main',
    events: [],
    merges: [
      {
        sha: '0e44b7d'.padEnd(40, '0'),
        at: '2026-10-31T09:00:00.000Z',
        subject: "Merge branch 'old'",
        into: 'main',
        pushed: true,
      },
      {
        sha: '3c1e0f2'.padEnd(40, '0'),
        at: today('11:20'),
        subject: 'Merge feature/receipt: Email a receipt after checkout',
        into: 'main',
        branch: 'feature/receipt',
        pushed: true,
      },
      {
        // A person's merge, "Merge <ID>: <title>": no workspace of that name, its subject whole.
        sha: 'd74b372'.padEnd(40, '0'),
        at: today('06:27'),
        subject: "Merge V90: a review's pages redesigned",
        into: 'main',
        branch: 'V90',
        pushed: true,
      },
      {
        sha: '5a77b31'.padEnd(40, '0'),
        at: today('10:02'),
        subject: 'Merge fix/coupon: Rename the coupon field',
        into: 'main',
        branch: 'fix/coupon',
        pushed: false,
      },
    ],
    started: {
      'feature/receipt': today('09:20'),
      'fix/coupon': today('08:02'),
      old: '2026-10-30T09:00:00.000Z',
    },
    hive: [],
  };
  const fastForward = entry('feature/ff', {
    state: 'landed',
    strategy: 'fast-forward',
    merge: 'ffff'.padEnd(40, 'f'),
    landed: today('12:10'),
    pushed: { ok: true, remote: 'origin' },
    by: 'hive',
  });
  const landedReceipt = entry('feature/receipt', {
    state: 'landed',
    merge: '3c1e0f2'.padEnd(40, '0'),
    landed: today('11:20'),
  });
  let rows: MergedRow[] = [];
  beforeAll(() => {
    rows = mergedRows(
      day,
      [fastForward, landedReceipt],
      [summary('feature/receipt', { title: 'Email a receipt after checkout', merged: true })],
      reviews([
        review('fix/coupon', {
          verdict: { event: 'approve', head: TIP, at: today('10:00'), comments: 0, merged: true },
        }),
      ]),
    );
  });

  it("takes git's merges and the queue's fast-forwards, once each, oldest first", () => {
    expect(rows.map((r) => r.sha.slice(0, 7))).toEqual([
      '0e44b7d',
      'd74b372',
      '5a77b31',
      '3c1e0f2',
      'fffffff',
    ]);
  });

  it('names each by its workspace, else by the merger’s subject, and says who approved it', () => {
    const [old, person, coupon, receipt, ff] = rows;
    expect(old).toMatchObject({ title: "Merge branch 'old'", pushed: true });
    expect(person).toMatchObject({ title: "Merge V90: a review's pages redesigned" });
    expect(old?.by).toBeUndefined();
    expect(coupon).toMatchObject({ title: 'Rename the coupon field', pushed: false, by: 'you' });
    expect(receipt).toMatchObject({ title: 'Email a receipt after checkout', by: 'you' });
    expect(ff).toMatchObject({ branch: 'feature/ff', pushed: true, by: 'hive', into: 'main' });
  });

  it('counts the week by local day, today’s and where they went; the median time to merge', () => {
    const groups = workspaceGroups(list, reviewList);
    const figures = normalFigures(
      inbox(groups, [waitingMerge], reviewList),
      groups,
      rows,
      day,
      NOW,
    );
    expect(figures.merged).toEqual({
      week: 5,
      perDay: [0, 0, 0, 1, 0, 0, 4],
      today: 4,
      into: ['main'],
    });
    // Receipt: 09:20 → 11:20, coupon 08:02 → 10:02; git names no branch for the old one, and the
    // fast-forward's workspace has no start: two.
    expect(figures.timeToMerge).toEqual({ medianMs: 2 * 3_600_000, count: 2 });
  });
});

describe('the figures', () => {
  let figures: NormalFigures;
  beforeAll(() => {
    const groups = workspaceGroups(list, reviewList);
    figures = normalFigures(inbox(groups, [waitingMerge], reviewList), groups, [], null, NOW);
  });

  it('counts what waits, by answers, reviews and merges', () => {
    expect(figures.waiting).toEqual({ count: 7, answers: 2, reviews: 4, merges: 1 });
  });

  it('counts the agents at work and names their agents once each', () => {
    expect(figures.working).toEqual({ count: 2, agents: ['Claude Code', 'Codex'] });
  });

  it('counts the workspaces with commits to review (not findings: they are not recorded)', () => {
    expect(figures.toReview).toEqual({ workspaces: 3, commits: 10, sinceReview: 2 });
  });

  it('has nothing merged and no median before the day read', () => {
    expect(figures.merged).toEqual({ week: 0, perDay: [0, 0, 0, 0, 0, 0, 0], today: 0, into: [] });
    expect(figures.timeToMerge).toEqual({ medianMs: null, count: 0 });
  });
});

describe('a merge on its track', () => {
  it('goes Merge, Check, Land; the person’s turn violet, a failure red', () => {
    const at = (over: Partial<MergeEntry>) => {
      const steps = mergeSteps(entry('x', over));
      return [steps.at, steps.mark, steps.word];
    };
    expect(mergeSteps(entry('x')).steps).toEqual(['Merge', 'Check', 'Land']);
    expect(at({ state: 'queued' })).toEqual([0, 'now', 'Queued']);
    expect(at({ state: 'merging' })).toEqual([0, 'now', 'Merging']);
    expect(at({ state: 'resolving' })).toEqual([0, 'now', 'Resolving conflicts']);
    expect(at({ state: 'needs-you', conflicts: ['a'] })).toEqual([0, 'you', 'Needs you']);
    expect(at({ state: 'checking' })).toEqual([1, 'now', 'Checking the merge']);
    expect(at({ state: 'ready' })).toEqual([2, 'you', 'Ready to land']);
    expect(
      at({
        state: 'failed',
        check: { commands: ['npm test'], ok: false } as MergeEntry['check'],
      }),
    ).toEqual([1, 'bad', 'Check failed']);
    expect(at({ state: 'failed' })).toEqual([0, 'bad', 'Failed']);
    expect(at({ state: 'landed' })).toEqual([3, 'now', 'Landed']);
  });
});
