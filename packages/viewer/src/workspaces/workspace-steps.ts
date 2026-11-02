// A workspace's steps in its head (V89, decisions 823–826) and its agent's tab (827), derived from
// what Symbiote records: the agent's state, the thread, the commits, the merge queue, the review's
// verdict (through the sidenav's `workspaceNext`), and Hive's record. Kept pure.
import type {
  MergeEntry,
  ThreadEntry,
  WorkspaceAgentState,
  WorkspaceHive,
  WorkspaceSummary,
} from '@symbiote/core';
import { HIVE_STAGES, NORMAL_STAGES } from '../ui/StageTrack.js';
import type { StatusTone } from '../ui/StatusLabel.js';
import { mergeState } from './merges.js';
import { AGENT_NAMES, mergedForCard, type WorkspaceNext } from './workspaces.js';

/** The track's mark at the step it is at: in progress, the person's, or failed. */
export type StepMark = 'now' | 'you' | 'bad';

/** What the head's steps draw: the track, the step's word and what it waits on. */
export interface StepsModel {
  steps: readonly string[];
  /** The step it is at; `steps.length` once every step is done. */
  at: number;
  mark: StepMark;
  /** The word's colour: amber the agent's turn, violet the person's, red failed, green done. */
  tone: Extract<StatusTone, 'run' | 'you' | 'error' | 'ok' | 'info' | 'idle'>;
  word: string;
  detail: string;
  /** When what `detail` says began: the head counts the time since. */
  since?: string;
}

/** Prompts that are not the person's answer: Symbiote's start, a background job, a subagent. */
const NOT_AN_ANSWER = new Set(['start', 'task', 'subagent']);

/**
 * Whether a message followed the plan's report (plan first): the person's answer, by its box, its
 * terminal or Approve plan. Until then the agent plans.
 */
export function planAnswered(entries: readonly ThreadEntry[]): boolean {
  const report = entries.findIndex((entry) => entry.kind === 'report');
  if (report < 0) return false;
  return entries
    .slice(report + 1)
    .some((entry) => entry.kind === 'prompt' && !NOT_AN_ANSWER.has(entry.from ?? 'person'));
}

/** What the review's state says, as the sidenav words it (`workspaceNext`), for the Review step. */
const REVIEWS: [prefix: string, step: 'Review' | 'Merge', detail: string][] = [
  ['Approved', 'Merge', 'approved'],
  ['Changes requested', 'Review', 'changes requested'],
  ['Commented', 'Review', 'commented'],
  ['Review in progress', 'Review', 'in progress'],
  ['Finished without commits', 'Review', 'its report'],
];

/**
 * Normal mode's steps (decision 824): Build, Review, Merge, Plan and Your OK first with plan first.
 * The person's turn (an ask, a plan ready, a review, a stopped agent) is violet; the agent's amber;
 * a failure red; merged, every step done.
 */
export function normalSteps({
  workspace,
  next,
  planAnswered: answered,
  merge,
}: {
  workspace: WorkspaceSummary;
  next: WorkspaceNext;
  planAnswered: boolean;
  /** Its newest entry in the merge queue, if any. */
  merge?: MergeEntry;
}): StepsModel {
  const steps = workspace.planFirst ? NORMAL_STAGES : NORMAL_STAGES.slice(2);
  const { agent, activity } = workspace;
  const since = activity?.since;
  const at = (
    word: (typeof NORMAL_STAGES)[number],
    mark: StepMark,
    tone: StepsModel['tone'],
    detail: string,
    from?: string,
  ): StepsModel => ({
    steps,
    at: steps.indexOf(word),
    mark,
    tone,
    word,
    detail,
    ...(from ? { since: from } : {}),
  });
  if (mergedForCard(workspace)) {
    return { steps, at: steps.length, mark: 'now', tone: 'ok', word: 'Merged', detail: '' };
  }
  if (merge) {
    const { tone } = mergeState(merge);
    if (tone === 'done') {
      return { steps, at: steps.length, mark: 'now', tone: 'ok', word: 'Merged', detail: '' };
    }
    if (tone === 'bad') return at('Merge', 'bad', 'error', 'failed');
    if (tone === 'you') return at('Merge', 'you', 'you', 'asks you');
    return at('Merge', 'now', 'run', merge.state);
  }
  const working = workspace.planFirst && workspace.ahead === 0 && !answered ? 'Plan' : 'Build';
  if (workspace.tip === null) return at(working, 'bad', 'error', 'branch gone');
  switch (agent.state) {
    case 'working':
      return at(working, 'now', 'run', 'working', since);
    case 'needs-you':
      return at(working, 'you', 'you', agent.interrupted ? 'interrupted' : 'asks you', since);
    case 'plan-ready':
      return workspace.planFirst
        ? at('Your OK', 'you', 'you', 'waiting', since)
        : at('Review', 'you', 'you', 'its plan', since);
    case 'failed':
      return at(working, 'bad', 'error', 'failed');
    case 'not-started':
      return at(working, 'bad', 'error', 'not started');
    case 'no-agent':
      return at(working, 'bad', 'error', 'no agent');
    case 'unknown':
      return at(working, 'bad', 'error', 'state unknown');
    default:
      break;
  }
  if (next.group === 'review') {
    const known = REVIEWS.find(([prefix]) => next.text.startsWith(prefix));
    if (known) return at(known[1], 'you', 'you', known[2]);
    if (next.text.includes('since your review')) return at('Review', 'you', 'you', 'review again');
    return at('Review', 'you', 'you', 'yours');
  }
  return at(working, 'you', 'you', agent.state === 'stopped' ? 'stopped' : 'not running');
}

const HIVE_AT: Partial<Record<WorkspaceHive['step'], number>> = {
  writing: 0,
  checking: 1,
  reviewing: 2,
  landing: 3,
};

/** Where Hive stopped: its landing, else its review, else its check, else the writer. */
function stuckAt(hive: WorkspaceHive): number {
  if (hive.landing?.outcome && hive.landing.outcome !== 'landed') return 3;
  if (hive.review && hive.review.verdict !== 'approved') return 2;
  if (hive.check && !hive.check.ok) return 1;
  return 0;
}

/**
 * Hive's steps (decision 825): Write, Check, Review, Land from its step; landed or answered, all
 * done; stopped, red where it stopped; paused, its step in the paused tone.
 */
export function hiveSteps(hive: WorkspaceHive): StepsModel {
  const steps = HIVE_STAGES;
  const round = `round ${hive.round} of ${hive.rounds}`;
  if (hive.step === 'landed' || hive.step === 'answered') {
    const word = hive.step === 'landed' ? 'Landed' : 'Answered';
    return { steps, at: steps.length, mark: 'now', tone: 'ok', word, detail: round };
  }
  if (hive.step === 'stuck') {
    const at = stuckAt(hive);
    return { steps, at, mark: 'bad', tone: 'error', word: steps[at] ?? '', detail: 'stopped' };
  }
  const at = HIVE_AT[hive.step] ?? 0;
  const word = steps[at] ?? '';
  if (hive.pause || hive.paused) {
    return { steps, at, mark: 'now', tone: 'info', word, detail: 'paused' };
  }
  return { steps, at, mark: 'now', tone: 'run', word, detail: round };
}

/** The agent's tab (decision 827): its agent's name; Hive's writer is the writer. */
export function agentTabName(
  agent: WorkspaceAgentState,
  hive: boolean,
): { name: string; what?: string } {
  const name = agent.kind ? AGENT_NAMES[agent.kind] : 'Terminal';
  return hive ? { name: 'Writer', what: name } : { name };
}

/** The dot on the agent's tab: violet when it waits for the person, amber while it works. */
export function agentDot(agent: WorkspaceAgentState): 'you' | 'run' | null {
  if (agent.state === 'needs-you' || agent.state === 'plan-ready') return 'you';
  return agent.state === 'working' ? 'run' : null;
}
