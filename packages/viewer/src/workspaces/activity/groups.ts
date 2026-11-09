// The Activity tab's phases (V73, decisions 513, 515, 518): the events grouped as the work went —
// milestones (a prompt, the person's message, a question, a report, a commit, the verdict, a
// session's start and end) between phases of calls (exploring, implementing, documenting, testing,
// looking at screenshots, debugging, git). A presentation of the events: each event is in one
// group, as it is; a group says only what its events say.
import type { WorkspaceAgentState } from '@symbiote/core';
import type { ActivityEvent } from './events.js';
import type { ActivityGroup, Context, WorkEvent } from './group-parts.js';
import {
  TaskState,
  adjacent,
  commitsCut,
  commitsMade,
  debugging,
  runsOf,
  sandwiched,
  stragglers,
} from './runs.js';
import { workGroup } from './work-group.js';
import { milestone } from './milestones.js';

/** Calls the timeline leaves to the raw stream: a question (its ask says it), reasoning. */
const SAID_ELSEWHERE = new Set(['AskUserQuestion', 'reasoning']);

/**
 * The ask an agent may wait on: its newest, when no prompt or report came after it (a report ends
 * the turn the ask was in).
 */
export function waitingAsk(
  events: readonly ActivityEvent[],
): Extract<ActivityEvent, { kind: 'asks' }> | undefined {
  const last = events.findLast(
    (e) => e.kind === 'asks' || e.kind === 'prompt' || e.kind === 'report',
  );
  return last?.kind === 'asks' ? last : undefined;
}

/** The text a milestone is compared by, to find one recorded twice. */
function sameness(event: ActivityEvent): string | null {
  switch (event.kind) {
    case 'prompt':
    case 'report':
      return `${event.kind}:${event.entry.session}:${event.entry.text}`;
    case 'asks':
      return `asks:${event.entry.session}:${event.entry.tool}:${JSON.stringify(event.entry.questions ?? event.entry.input ?? '')}`;
    case 'end':
      return `end:${event.entry.session}:${event.entry.reason ?? ''}`;
    default:
      return null;
  }
}

/**
 * The Activity tab's groups (V73), oldest first: milestones, and the phases of the calls between
 * them. `agent`: its state, for what runs and what waits; `worktree`: to write paths short;
 * `nucleus`: Nucleus's activity (NU2), its answers and its own milestones in its words.
 */
export function activityGroups(
  events: readonly ActivityEvent[],
  {
    agent,
    worktree,
    nucleus,
    nucleusName,
  }: { agent: WorkspaceAgentState; worktree: string; nucleus?: true; nucleusName?: string },
): ActivityGroup[] {
  const lastPrompt = events.findLast((e) => e.kind === 'prompt');
  const asking = waitingAsk(events);
  const context: Context = {
    agent,
    worktree,
    ...(nucleus ? { nucleus } : {}),
    ...(nucleusName ? { nucleusName } : {}),
    turn: lastPrompt?.at ? Date.parse(lastPrompt.at) : -Infinity,
    ...(asking ? { lastAsks: asking.key } : {}),
  };

  // Each commit right after the call that made it.
  const made = commitsMade(events);
  const paired = new Set([...made.values()].map((e) => e.key));
  const ordered: ActivityEvent[] = [];
  for (const event of events) {
    if (paired.has(event.key)) continue;
    ordered.push(event);
    const commit = made.get(event.key);
    if (commit) ordered.push(commit);
  }

  const groups: ActivityGroup[] = [];
  const tasks = new TaskState();
  let stretch: WorkEvent[] = [];
  const flush = () => {
    if (stretch.length === 0) return;
    const runs = debugging(
      stragglers(sandwiched(adjacent(runsOf(stretch, tasks)), context)),
      context,
    );
    for (const run of runs)
      for (const part of commitsCut(run)) groups.push(workGroup(part, context));
    stretch = [];
  };
  let previous: { same: string; at: number; group: ActivityGroup } | null = null;
  for (const event of ordered) {
    // A question's call is said by its ask; Codex's reasoning is no act (V48c): the raw stream's.
    if (event.kind === 'call' && SAID_ELSEWHERE.has(event.call.tool)) continue;
    if (event.kind === 'call' || (event.kind === 'commit' && paired.has(event.key))) {
      stretch.push(event);
      continue;
    }
    if (event.kind === 'notice') continue;
    flush();
    // The same milestone recorded twice, one after the other: one group, both events in it.
    const same = sameness(event);
    const at = event.at ? Date.parse(event.at) : 0;
    if (
      same &&
      previous &&
      previous.same === same &&
      groups.at(-1) === previous.group &&
      at - previous.at <= 5000
    ) {
      previous.group.events.push(event);
      continue;
    }
    const group =
      event.kind === 'commit'
        ? workGroup({ kind: 'git', events: [event] }, context)
        : milestone(event, context);
    if (!group) continue;
    groups.push(group);
    previous = same ? { same, at, group } : null;
  }
  flush();
  return groups;
}
