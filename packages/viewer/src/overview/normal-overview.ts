// Normal mode's Overview (V91, decisions 853–855): its figures, the inbox with one action a
// workspace, the merges under way and merged this week, from the list's read and the day read.
// Pure: what Symbiote and git record, never a guess.
import type { BranchReviewList, MergeEntry, WorkspaceDay, WorkspaceSummary } from '@symbiote/core';
import { mergeState } from '../workspaces/merges.js';
import type { StepMark } from '../workspaces/workspace-steps.js';
import { AGENT_NAMES, workspaceName } from '../workspaces/workspaces.js';
import type { WorkspaceGroups, WorkspaceRow } from '../workspaces/workspace-groups.js';
import { dayStarts, isToday, median, perDay } from './day.js';
import { plural } from '../ui/plural.js';

/** What an inbox row asks of the person. */
export type InboxKind = 'plan' | 'asks' | 'review' | 'approved' | 'answered' | 'merge';

/**
 * The one action of a row (decision 854), each the way the workspace page or the sidenav card
 * already does it: Respond (`respondTo`), Review (`openReview`), Merge into (`MergeControl`), Open
 * (the merge's page), Read (the workspace).
 */
export type InboxAction = 'respond' | 'review' | 'merge' | 'open' | 'read';

export interface InboxRow {
  /** The workspace's branch, or `merge:<id>`. */
  key: string;
  branch: string;
  title: string;
  kind: InboxKind;
  /** Its words in bold: "Plan ready", "Asks", "To review". */
  words: string;
  /** After them: what it asks, its commits, the merge's state. */
  detail?: string;
  /** Since when it waits; absent when not recorded. */
  since?: string;
  action: InboxAction;
  /** A merge's row: the entry. */
  entry?: MergeEntry;
  /** A review's row: its commits, and those since the person's review. */
  commits?: number;
  sinceReview?: number;
}

export interface NormalFigures {
  waiting: { count: number; answers: number; reviews: number; merges: number };
  working: { count: number; agents: string[] };
  toReview: { workspaces: number; commits: number; sinceReview: number };
  merged: { week: number; perDay: number[]; today: number; into: string[] };
  timeToMerge: { medianMs: number | null; count: number };
}

/** A merge into the default branch (decision 855). */
export interface MergedRow {
  sha: string;
  at: string;
  title: string;
  branch?: string;
  into: string;
  pushed?: boolean;
  /** Who approved it, when recorded: the person or Hive. */
  by?: 'you' | 'hive';
}

/** A merge in the queue on its track: Merge, Check, Land. */
export interface MergeSteps {
  steps: readonly string[];
  at: number;
  mark: StepMark;
  word: string;
}

/** When a workspace's current state began, as recorded; else when it last acted or started. */
const sinceOf = (workspace: WorkspaceSummary) =>
  workspace.activity?.since ?? workspace.lastAction ?? workspace.created;

/** "Asks: X; Y" → “X; Y”: a question in the person's quotes; a permission as said. */
function asked(blocked: string): string {
  return blocked.startsWith('Asks: ') ? `“${blocked.slice('Asks: '.length)}”` : blocked;
}

/** A waiting row: its plan, its question or permission, its interruption, Hive stopped. */
function waitingRow({ workspace, next }: WorkspaceRow): InboxRow {
  const base = {
    key: workspace.branch,
    branch: workspace.branch,
    title: workspaceName(workspace),
    since: sinceOf(workspace),
    action: 'respond' as const,
  };
  if (workspace.agent.state === 'plan-ready') {
    return { ...base, kind: 'plan', words: 'Plan ready', detail: 'read it and answer' };
  }
  if (next.blocked) return { ...base, kind: 'asks', words: 'Asks', detail: asked(next.blocked) };
  // "Waiting: for you", "Interrupted: waiting for you", "Hive stopped: …": its words, then why.
  const [words = next.text, ...rest] = next.text.split(': ');
  const detail = rest.join(': ');
  return {
    ...base,
    kind: 'asks',
    words: words === 'Waiting' ? 'Asks' : words,
    ...(detail ? { detail } : {}),
  };
}

/** A review group's row: to review, approved, or a report without commits. */
function reviewRow({ workspace, next }: WorkspaceRow, reviews: BranchReviewList | null): InboxRow {
  const base = {
    key: workspace.branch,
    branch: workspace.branch,
    title: workspaceName(workspace),
    since: sinceOf(workspace),
  };
  if (next.text === 'Finished without commits') {
    return {
      ...base,
      kind: 'answered',
      words: 'Answered',
      detail: 'a report, no commits',
      action: 'read',
    };
  }
  const review = reviews?.reviews.find((r) => r.branch === workspace.branch);
  const sinceReview = review?.refs.find((r) => r.name === workspace.branch)?.since ?? 0;
  const counts = { commits: workspace.ahead, sinceReview };
  // As the sidenav says it (`workspaceNext`): an approval of its tip is the merge's to take.
  if (next.text.startsWith('Approved')) {
    return {
      ...base,
      ...counts,
      kind: 'approved',
      words: 'Approved',
      detail: 'ready to merge',
      action: 'merge',
    };
  }
  const commits = plural(workspace.ahead, 'commit');
  return {
    ...base,
    ...counts,
    kind: 'review',
    words: 'To review',
    detail: sinceReview > 0 ? `${commits} · ${sinceReview} since your review` : commits,
    action: 'review',
  };
}

/** The inbox: each workspace that waits for the person and each merge that does, oldest first. */
export function inbox(
  groups: WorkspaceGroups,
  merges: readonly MergeEntry[],
  reviews: BranchReviewList | null,
): InboxRow[] {
  const rows: InboxRow[] = [
    ...groups.waiting.map(waitingRow),
    ...groups.review.map((row) => reviewRow(row, reviews)),
    // A merge that needs the person (`mergesWaiting`): its page answers it.
    ...merges
      .filter((entry) => entry.state === 'needs-you')
      .map((entry): InboxRow => ({
        key: `merge:${entry.id}`,
        branch: entry.branch,
        title: entry.title.replace(/^Merge [^:]+: /, ''),
        kind: 'merge',
        words: 'Merge',
        detail: mergeState(entry).text,
        since: entry.updated,
        action: 'open',
        entry,
      })),
  ];
  const time = (row: InboxRow) => (row.since ? Date.parse(row.since) : Number.POSITIVE_INFINITY);
  return rows.sort((a, b) => time(a) - time(b));
}

/** The merger's subject, `Merge <branch>: <title>`: the title; else the subject as git has it. */
const titleOf = (subject: string, branch: string | undefined) =>
  branch && subject.startsWith(`Merge ${branch}: `)
    ? subject.slice(`Merge ${branch}: `.length)
    : subject;

/**
 * Merges into the default branch in the day read's week (decision 855): git's first-parent merges,
 * and the queue's fast-forwards, which make no merge commit; oldest first. Who approved it, when
 * recorded: the queue's entry (Hive's or the person's), else the branch's approving verdict.
 */
export function mergedRows(
  day: WorkspaceDay | null,
  merges: readonly MergeEntry[],
  list: readonly WorkspaceSummary[],
  reviews: BranchReviewList | null,
): MergedRow[] {
  const named = (branch: string | undefined) => {
    const workspace = branch ? list.find((w) => w.branch === branch) : undefined;
    return workspace ? workspaceName(workspace) : undefined;
  };
  const approver = (branch: string | undefined, sha: string): MergedRow['by'] => {
    if (!branch) return undefined;
    const entry = merges.find((e) => e.branch === branch && e.merge === sha);
    if (entry) return entry.by === 'hive' ? 'hive' : 'you';
    const verdict = reviews?.reviews.find((r) => r.branch === branch)?.verdict;
    if (verdict?.event !== 'approve') return undefined;
    return verdict.via === 'hive' ? 'hive' : 'you';
  };
  // A workspace Symbiote knows, listed or in the day's starts: the merger's subject names it. A
  // person's "Merge V90: …" names no branch, and is said whole.
  const known = (branch: string | undefined) =>
    branch !== undefined && day?.started[branch] !== undefined ? branch : undefined;
  const rows: MergedRow[] = (day?.merges ?? []).map((merge) => {
    const by = approver(merge.branch, merge.sha);
    return {
      sha: merge.sha,
      at: merge.at,
      title: named(merge.branch) ?? titleOf(merge.subject, known(merge.branch)),
      into: merge.into,
      ...(merge.branch ? { branch: merge.branch } : {}),
      ...(merge.pushed !== undefined ? { pushed: merge.pushed } : {}),
      ...(by ? { by } : {}),
    };
  });
  const since = day ? Date.parse(day.since) : Number.POSITIVE_INFINITY;
  for (const entry of merges) {
    if (entry.state !== 'landed' || entry.strategy !== 'fast-forward') continue;
    if (!entry.merge || !entry.landed || Date.parse(entry.landed) < since) continue;
    if (rows.some((row) => row.sha === entry.merge)) continue;
    rows.push({
      sha: entry.merge,
      at: entry.landed,
      title: named(entry.branch) ?? titleOf(entry.title, entry.branch),
      branch: entry.branch,
      into: entry.into,
      ...(entry.pushed ? { pushed: entry.pushed.ok } : {}),
      by: entry.by === 'hive' ? 'hive' : 'you',
    });
  }
  return rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Normal mode's five figures (decision 853). */
export function normalFigures(
  rows: readonly InboxRow[],
  groups: WorkspaceGroups,
  merged: readonly MergedRow[],
  day: WorkspaceDay | null,
  now: number,
): NormalFigures {
  const of = (...kinds: InboxKind[]) => rows.filter((row) => kinds.includes(row.kind));
  const reviewing = of('review', 'approved');
  const agents = [
    ...new Set(
      groups.working.flatMap(({ workspace }) =>
        workspace.agent.kind ? [AGENT_NAMES[workspace.agent.kind]] : [],
      ),
    ),
  ];
  const first = dayStarts(now)[0] ?? now;
  const week = merged.filter((row) => Date.parse(row.at) >= first);
  const toMerge = week.flatMap((row) => {
    const started = row.branch ? day?.started[row.branch] : undefined;
    return started ? [Date.parse(row.at) - Date.parse(started)] : [];
  });
  return {
    waiting: {
      count: rows.length,
      answers: of('plan', 'asks').length,
      reviews: of('review', 'approved', 'answered').length,
      merges: of('merge').length,
    },
    working: { count: groups.working.length, agents },
    toReview: {
      workspaces: reviewing.length,
      commits: reviewing.reduce((sum, row) => sum + (row.commits ?? 0), 0),
      sinceReview: reviewing.reduce((sum, row) => sum + (row.sinceReview ?? 0), 0),
    },
    merged: {
      week: week.length,
      perDay: perDay(
        week.map((row) => row.at),
        now,
      ),
      today: week.filter((row) => isToday(row.at, now)).length,
      into: [...new Set(week.filter((row) => isToday(row.at, now)).map((row) => row.into))],
    },
    timeToMerge: { medianMs: median(toMerge), count: toMerge.length },
  };
}

/** A queued merge's steps: Merge, Check, Land; the person's turn violet, a failure red. */
export function mergeSteps(entry: MergeEntry): MergeSteps {
  const steps = ['Merge', 'Check', 'Land'] as const;
  const step = (at: number, mark: StepMark, word: string): MergeSteps => ({
    steps,
    at,
    mark,
    word,
  });
  switch (entry.state) {
    case 'queued':
      return step(0, 'now', 'Queued');
    case 'merging':
      return step(0, 'now', 'Merging');
    case 'resolving':
      return step(0, 'now', 'Resolving conflicts');
    case 'needs-you':
      return step(0, 'you', 'Needs you');
    case 'checking':
      return step(1, 'now', 'Checking the merge');
    case 'ready':
      return step(2, 'you', 'Ready to land');
    case 'failed':
      return entry.check?.ok === false ? step(1, 'bad', 'Check failed') : step(0, 'bad', 'Failed');
    case 'landed':
      return step(3, 'now', 'Landed');
  }
}

/** A kept graph's findings, counted (`/api/workspaces/findings`, decision 892). */
export interface CountedFindings {
  head: string;
  errors: number;
  warnings: number;
}

/** A workspace's change's findings, by its tip: when its graph was analyzed (V93, decision 892). */
export function findingsOf(
  tip: string | null,
  graphs: readonly CountedFindings[],
): { errors: number; warnings: number } | undefined {
  const graph = tip ? graphs.find((g) => g.head === tip) : undefined;
  return graph ? { errors: graph.errors, warnings: graph.warnings } : undefined;
}

/**
 * The Overview's "Findings to read" (V93, proof 01): the errors and warnings of the reviews whose
 * change was analyzed, by their tips, and how many such reviews; none when none was.
 */
export function findingsToRead(
  tips: readonly (string | null)[],
  graphs: readonly CountedFindings[],
): { count: number; reviews: number; errors: number; warnings: number } | null {
  const found = tips.flatMap((tip) => findingsOf(tip, graphs) ?? []);
  if (found.length === 0) return null;
  const errors = found.reduce((sum, f) => sum + f.errors, 0);
  const warnings = found.reduce((sum, f) => sum + f.warnings, 0);
  return { count: errors + warnings, reviews: found.length, errors, warnings };
}
