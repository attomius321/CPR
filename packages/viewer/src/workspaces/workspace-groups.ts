// The workspaces in groups: the sidenav's (V48), Hive's (V92), every row, and History's marks on
// their branches (V18b, V23).
import {
  checkoutLine,
  landingLine,
  pauseWords,
  requestName,
  waitsForCheckout,
} from './hive-rounds.js';
import { clockWords } from './hive-live.js';
import type { BranchReviewList, WorkspaceSummary } from '@symbiote/core';
import {
  type AgentChip,
  type WorkspaceNext,
  mergedForCard,
  workspaceNext,
} from './workspace-next.js';
import { workspaceHref, workspaceName } from './workspaces.js';

export interface WorkspaceRow {
  workspace: WorkspaceSummary;
  next: WorkspaceNext;
}

/** The sidenav's groups (V48), each in the order the workspaces were started. */
export interface WorkspaceGroups {
  waiting: WorkspaceRow[];
  review: WorkspaceRow[];
  stopped: WorkspaceRow[];
  hive: WorkspaceRow[];
  working: WorkspaceRow[];
  done: WorkspaceRow[];
}

/**
 * The workspaces view's groups, each in the order the workspaces were started. In Hive mode
 * (`hiveMode`, HV4, decision 774) only Hive and Done: every workspace not done is Hive's.
 */
export function workspaceGroups(
  workspaces: readonly WorkspaceSummary[],
  reviews: BranchReviewList | null,
  { hiveMode = false }: { hiveMode?: boolean } = {},
): WorkspaceGroups {
  const groups: WorkspaceGroups = {
    waiting: [],
    review: [],
    stopped: [],
    hive: [],
    working: [],
    done: [],
  };
  for (const workspace of workspaces) {
    const review = reviews?.reviews.find((r) => r.branch === workspace.branch);
    const next = workspaceNext(workspace, review);
    const group = hiveMode && next.group !== 'done' ? 'hive' : next.group;
    groups[group].push({ workspace, next });
  }
  return groups;
}

/** A row of Hive's Landed today: when it landed, or its spike was answered. */
export type LandedRow = WorkspaceRow & { at: string };

/** The sidenav's groups in Hive mode (V92, decision 868). */
export interface HiveGroups {
  /** Writing, checking, reviewing, landing, or paused for usage. */
  flight: WorkspaceRow[];
  /** Stuck (the round cap, the budget, a note), or its branch gone. */
  stopped: WorkspaceRow[];
  /** Landed or answered since the browser's local midnight (850), the newest first. */
  today: LandedRow[];
  /** Landed or answered before today, or when is not known. */
  earlier: WorkspaceRow[];
}

/** The browser's local midnight of `now`'s day (V91, decision 850). */
export const midnight = (now: number) => new Date(now).setHours(0, 0, 0, 0);

/** When a landed or answered workspace ended: its landing's end, else its agent's last act. */
export function endedAt(workspace: WorkspaceSummary): string | undefined {
  const landing = workspace.hive?.landing;
  if (landing?.outcome === 'landed' && landing.ended) return landing.ended;
  return workspace.lastAction;
}

/**
 * The sidenav's groups in Hive mode (V92, decision 868; replaces 774's Hive and Done): In flight,
 * Stopped, Landed today, Earlier; each in the order the workspaces were started, today's newest
 * first.
 */
export function hiveGroups(
  workspaces: readonly WorkspaceSummary[],
  reviews: BranchReviewList | null,
  now = Date.now(),
): HiveGroups {
  const groups: HiveGroups = { flight: [], stopped: [], today: [], earlier: [] };
  const today = midnight(now);
  for (const workspace of workspaces) {
    const review = reviews?.reviews.find((r) => r.branch === workspace.branch);
    const next = workspaceNext(workspace, review, now);
    const row = { workspace, next };
    if (next.group === 'done') {
      const at = endedAt(workspace);
      if (at !== undefined && Date.parse(at) >= today) groups.today.push({ ...row, at });
      else groups.earlier.push(row);
    } else if (next.group === 'stopped' || workspace.hive?.step === 'stuck') {
      groups.stopped.push(row);
    } else {
      groups.flight.push(row);
    }
  }
  groups.today.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return groups;
}

/** A Hive row's second line (V92, decision 869): the state's word in its tone, then the rest. */
export interface HiveRowWords {
  word: string;
  tone: 'run' | 'ok' | 'fail' | 'info' | 'idle' | 'you';
  detail: string;
}

/** What a Hive row says under its title, at `now`: "Checking 4/4 · round 2 · 7:23". */
export function hiveRowWords(workspace: WorkspaceSummary, now = Date.now()): HiveRowWords {
  const hive = workspace.hive;
  if (workspace.tip === null)
    return { word: 'Stopped', tone: 'fail', detail: 'its branch is gone' };
  if (!hive) {
    return workspace.merged
      ? { word: 'Merged', tone: 'ok', detail: `into ${workspace.from ?? 'its branch'}` }
      : { word: 'Normal mode', tone: 'idle', detail: 'started before Hive' };
  }
  const round = `round ${hive.round}`;
  if (hive.step !== 'landed' && waitsForCheckout(hive.request)) {
    return { word: 'Waiting for you', tone: 'you', detail: checkoutLine(hive.request) };
  }
  if (hive.step === 'landed' || mergedForCard(workspace)) {
    const into = hive.landing?.into ?? workspace.from ?? 'its branch';
    const by =
      hive.landing?.via === 'request' && hive.request ? ` · ${requestName(hive.request)}` : '';
    return { word: 'Landed', tone: 'ok', detail: `into ${into}${by}` };
  }
  if (hive.step === 'answered') return { word: 'Answered', tone: 'ok', detail: 'read its report' };
  if (hive.step === 'stuck') {
    const note = hive.note ?? 'Hive cannot go on';
    const detail = note.startsWith('its spend reached its budget')
      ? 'budget reached'
      : hive.round >= hive.rounds
        ? `${hive.round} of ${hive.rounds} rounds`
        : note;
    return { word: 'Stopped', tone: 'fail', detail };
  }
  if (hive.off) return { word: 'Hive off', tone: 'idle', detail: `paused · ${round}` };
  if (hive.pause && workspace.agent.state !== 'working') {
    return {
      word: 'Paused',
      tone: 'info',
      detail: pauseWords(hive.pause, now).replace(/^Paused: /, ''),
    };
  }
  const since = (iso: string) => clockWords(now - Date.parse(iso));
  if (hive.live?.kind === 'check') {
    const word =
      hive.live.commands.length > 1
        ? `Checking ${hive.live.step + 1}/${hive.live.commands.length}`
        : 'Checking';
    return { word, tone: 'run', detail: `${round} · ${since(hive.live.started)}` };
  }
  if (hive.live?.kind === 'review') {
    return { word: 'Reviewing', tone: 'run', detail: `${round} · ${since(hive.live.started)}` };
  }
  switch (hive.step) {
    case 'checking':
      return { word: 'Checking', tone: 'run', detail: round };
    case 'reviewing':
      return { word: 'Reviewing', tone: 'run', detail: round };
    case 'landing': {
      // By request (HV8): its merge on the forge is the person's turn.
      const request = hive.landing?.via === 'request' ? hive.request : undefined;
      if (request && request.state === 'open' && !hive.landing?.outcome) {
        return { word: 'Waiting for your merge', tone: 'you', detail: requestName(request) };
      }
      const line = landingLine(
        hive.landing,
        hive.landing?.via === 'request' ? hive.request : undefined,
      );
      return { word: 'Landing', tone: 'run', detail: line.replace(/^[^:]*:\s*/, '') };
    }
    default:
      return { word: 'Writing', tone: 'run', detail: round };
  }
}

/** Whether a workspace's card offers Clean up (V55): once it is merged, the Done group's. */
export const cleanableOnCard = (row: WorkspaceRow): boolean => row.next.group === 'done';

/** Every row of the groups, the person's first (as History's badges and V23 order them). */
export const allRows = (groups: WorkspaceGroups): WorkspaceRow[] => [
  ...groups.waiting,
  ...groups.review,
  ...groups.stopped,
  ...groups.hive,
  ...groups.working,
  ...groups.done,
];

/**
 * Each open workspace's mark by ref name — its branch, and that branch on each remote once pushed
 * (`remotes`: the remote branches and the branch each is) — titled with the workspace's name and
 * what is next, linking to the workspace. A branch that is gone has none.
 */
export function workspaceChips(
  workspaces: readonly WorkspaceSummary[],
  reviews: BranchReviewList | null,
  remotes: readonly { name: string; branch: string }[],
): Map<string, AgentChip & { href: string }> {
  const chips = new Map<string, AgentChip & { href: string }>();
  for (const { workspace, next } of allRows(workspaceGroups(workspaces, reviews))) {
    if (workspace.tip === null) continue;
    const value = {
      ...next.chip,
      title: `Workspace: ${workspaceName(workspace)} — ${next.text}`,
      href: workspaceHref(workspace.branch),
    };
    chips.set(workspace.branch, value);
    for (const remote of remotes)
      if (remote.branch === workspace.branch) chips.set(remote.name, value);
  }
  return chips;
}

/** A workspace's branch, listed first in the branches panel, and when its agent last acted. */
export interface FirstBranch {
  branch: string;
  at: string;
}

/**
 * The branches the branches panel lists first (V23): the open workspaces that need the person,
 * then those whose agent works, each by its agent's last action (else when the workspace was made),
 * newest first. Merged workspaces and gone branches need nothing: they are left out.
 */
export function workspacesFirst(
  workspaces: readonly WorkspaceSummary[],
  reviews: BranchReviewList | null,
): FirstBranch[] {
  const { waiting, review, stopped, working } = workspaceGroups(workspaces, reviews);
  const newest = (rows: WorkspaceRow[]) =>
    rows
      .filter(({ workspace }) => workspace.tip !== null)
      .map(({ workspace }) => ({
        branch: workspace.branch,
        at: workspace.lastAction ?? workspace.created,
      }))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.branch.localeCompare(b.branch));
  return [...newest([...waiting, ...review, ...stopped]), ...newest(working)];
}
