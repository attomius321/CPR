// What a workspace waits on (V48): its card's chip and next step, what its agent does now in
// words, and its facts.
import {
  checkoutLine,
  landedLine,
  landingLine,
  pauseWords,
  requestName,
  waitsForCheckout,
} from './hive-rounds.js';
import { COMMAND_TOOLS, shownCommand } from './activity/classify.js';
import type {
  BranchMerge,
  BranchReviewSummary,
  WorkspaceSummary,
  ToolActivity,
} from '@symbiote/core';
import { plural } from '../ui/plural.js';
import { askedFor } from './thread-items.js';

/**
 * What a workspace needs from the person (V18b), the sidenav's groups: its agent waits for an
 * answer, its work is to look at, its agent does not run, works, or it is merged (V48).
 */
/** Where a workspace's card is listed (V48); Hive at work a group of its own (decision 698). */
export type WorkspaceGroup = 'waiting' | 'review' | 'stopped' | 'hive' | 'working' | 'done';

/** A workspace's mark on its branch's badges and in the workspaces view. */
export interface AgentChip {
  mark: string;
  tone: 'working' | 'hive' | 'waiting' | 'ready' | 'failed' | 'idle' | 'done';
  title: string;
}

export interface WorkspaceNext {
  group: WorkspaceGroup;
  /** What is next, in a few words: "Plan ready: read it and answer". */
  text: string;
  chip: AgentChip;
  /** While it waits (V48): what it asks, from its recorded ask, else its last message. */
  blocked?: string;
  /** While it works and its tools are recorded (V48f): "Running pnpm test", "Thinking". */
  doing?: string;
  /** Hive's words (HV2): Symbiote's, so no agent's mark before them. */
  hive?: true;
  /** A link at the end of `text` (HV8): the request Hive waits on, or landed through. */
  link?: { href: string; text: string };
  /** Hive holds its next start for usage (HV5): the status bar says when it pauses and goes on. */
  paused?: true;
}

export const chip = (mark: string, tone: AgentChip['tone'], title: string): AgentChip => ({
  mark,
  tone,
  title,
});

/**
 * Merged, as the pages count it: not while Hive's request, merged on its forge, waits for the
 * person's checkout (HV8). `merged` counts `origin`'s branch, which Hive's own fetch moved, while
 * the person's own branch has not moved and Hive has not landed it.
 */
export const mergedForCard = (workspace: Pick<WorkspaceSummary, 'merged' | 'hive'>): boolean =>
  workspace.merged &&
  !(workspace.hive && workspace.hive.step !== 'landed' && waitsForCheckout(workspace.hive.request));

/**
 * What a workspace needs next: merged, it is done; while its agent works, nothing; while it waits,
 * an answer; else — once it has commits, or its agent finished — what its review says; else its
 * agent does not run.
 */
export function workspaceNext(
  workspace: WorkspaceSummary,
  review?: BranchReviewSummary,
  now = Date.now(),
): WorkspaceNext {
  const next = (
    group: WorkspaceGroup,
    text: string,
    c: AgentChip['mark'],
    tone: AgentChip['tone'],
  ): WorkspaceNext => ({ group, text, chip: chip(c, tone, text) });
  const stopped = (text: string, c: AgentChip['mark'], tone: AgentChip['tone']) =>
    next('stopped', text, c, tone);
  if (workspace.tip === null) return stopped('Its branch is gone', '!', 'failed');
  const { agent, activity, hive } = workspace;
  /** What the agent does now, in words (V48f): "Running pnpm test", "Thinking". */
  const doingWords = () => {
    const doing = activity?.doing;
    // A command's leading `cd` to the worktree left out, its paths short (V73).
    const shown =
      doing && 'tool' in doing && doing.subject && COMMAND_TOOLS.has(doing.tool)
        ? { ...doing, subject: shownCommand(doing.subject, workspace.worktree.path) }
        : doing;
    return !shown ? undefined : 'thinking' in shown ? 'Thinking' : activityText(shown);
  };
  // Hive mode (HV4, decision 774): every state of a workspace Hive drives is Hive's, in its group,
  // from its brief to landed; landed or answered, Done. Nothing waits for the person.
  if (hive && !hive.off) {
    const said = (text: string, mark: string, tone: AgentChip['tone']): WorkspaceNext => ({
      ...next('hive', text, mark, tone),
      hive: true,
    });
    // HV8: by a pull or merge request, its link at the end of the card's line.
    const request = hive.landing?.via === 'request' ? hive.request : undefined;
    // Merged on the forge and the person's checkout refusing the fast-forward: Hive still waits,
    // in its group, whatever the step (770, 789); `merged` is its own fetch of origin's branch.
    if (hive.step !== 'landed' && waitsForCheckout(hive.request)) {
      const waiting = hive.request;
      return {
        ...said(checkoutLine(waiting), '⚙', 'hive'),
        link: { href: waiting.url, text: requestName(waiting) },
      };
    }
    if (mergedForCard(workspace) || hive.step === 'landed') {
      const done = next('done', landedLine(hive.landing, request), '✓', 'done');
      if (!request || hive.landing?.outcome !== 'landed') return done;
      return {
        ...done,
        link: { href: request.url, text: `${requestName(request).split(' ')[0]}` },
      };
    }
    if (hive.step === 'answered') return next('done', 'Answered: read its report', '✓', 'done');
    if (hive.step === 'stuck')
      return said(`Stopped: ${hive.note ?? 'Hive cannot go on'}`, '!', 'failed');
    // HV5: its next start held for usage, from its record; no agent at work, so no spinner.
    if (hive.pause && agent.state !== 'working') {
      return { ...said(pauseWords(hive.pause, now), '·', 'idle'), paused: true };
    }
    if (hive.step === 'landing') {
      const text = landingLine(hive.landing, request);
      const asked = said(text, '⚙', 'hive');
      if (!request || !text.endsWith(requestName(request))) return asked;
      return { ...asked, link: { href: request.url, text: requestName(request) } };
    }
    if (hive.step === 'checking') return said('Hive: running the check', '⚙', 'hive');
    if (hive.step === 'reviewing') return said('Hive: reviewing', '⚙', 'hive');
    switch (agent.state) {
      case 'working': {
        // The writer's words are its agent's: its mark before them.
        const words = doingWords();
        return { ...next('hive', 'Writing', '⚙', 'working'), ...(words ? { doing: words } : {}) };
      }
      case 'ready':
      case 'done':
        return said('Hive: reading its turn', '⚙', 'hive');
      case 'plan-ready':
        return said('Hive: OKing its plan', '⚙', 'hive');
      case 'needs-you':
        return said('Hive: answering for you', '⚙', 'hive');
      case 'failed':
      case 'not-started':
        return said('Hive: starting its agent again', '⚙', 'hive');
      default:
        return next('hive', 'Its agent is not running', '·', 'idle');
    }
  }
  // Hive off while its merged request waits for the person's checkout (HV8): not done yet.
  if (hive && waitsForCheckout(hive.request) && hive.step !== 'landed') {
    return stopped(`Hive off: ${checkoutLine(hive.request)}`, '·', 'idle');
  }
  if (workspace.merged) return next('done', 'Merged', '✓', 'done');
  const waits = (text: string): WorkspaceNext => {
    const blocked = blockedOn(workspace);
    return { ...next('waiting', text, '?', 'waiting'), ...(blocked ? { blocked } : {}) };
  };
  // Hive's steps (HV2): a turn that ended is Hive's to act on, not the person's to review; the
  // writer at work or waiting on the person reads as any workspace's.
  if (hive) {
    if (hive.paused && agent.state !== 'working') {
      if (hive.step === 'checking')
        return stopped('Hive off: paused before the check', '·', 'idle');
      if (hive.step === 'reviewing')
        return stopped('Hive off: paused before the review', '·', 'idle');
      if (hive.step === 'writing') return stopped('Hive off: paused', '·', 'idle');
    }
    if (hive.step === 'stuck' && agent.state !== 'working') {
      return waits(`Hive stopped: ${hive.note ?? 'it needs you'}`);
    }
  }
  switch (agent.state) {
    case 'working': {
      const words = doingWords();
      return { ...next('working', 'Working', '⚙', 'working'), ...(words ? { doing: words } : {}) };
    }
    case 'needs-you':
      if (agent.interrupted) return waits('Interrupted: waiting for you');
      return waits(`Waiting: ${agent.waitingFor ?? 'for you'}`);
    case 'plan-ready':
      return waits('Plan ready: read it and answer');
    case 'failed': {
      const why = agent.error?.split('\n')[0];
      return stopped(why ? `Its agent failed: ${why}` : 'Its agent failed', '!', 'failed');
    }
    case 'not-started':
      return stopped(`Not started: ${(agent.error ?? '').split('\n')[0] ?? ''}`, '!', 'failed');
    case 'no-agent':
      return stopped('No agent: give it the prompt', '!', 'failed');
    case 'unknown':
      return stopped(`Its agent's state is unknown: ${agent.error ?? ''}`, '·', 'idle');
    default:
      break;
  }
  if (workspace.ahead === 0) {
    // Finished without commits: its report is the work to look at (V48).
    if (agent.state === 'done' || agent.state === 'ready') {
      return next('review', 'Finished without commits', '●', 'ready');
    }
    return stopped(agent.state === 'stopped' ? 'Stopped' : 'Not running', '·', 'idle');
  }
  // Commits to look at: the review says what is next.
  const toReview = (text: string) => next('review', text, '●', 'ready');
  const since = review?.refs.find((r) => r.name === workspace.branch)?.since ?? 0;
  if (since > 0) return toReview(`${plural(since, 'commit')} since your review: review again`);
  const verdict = review?.verdict?.head === workspace.tip ? review.verdict : undefined;
  if (verdict?.event === 'approve') return toReview('Approved: ask your agent to merge it');
  if (verdict?.event === 'request-changes') {
    return toReview('Changes requested: send them to the agent');
  }
  if (verdict?.event === 'comment') return toReview('Commented: send it to the agent');
  if (review) return toReview('Review in progress');
  // Landing asked by Hive, Hive off since (HV2): the person's review, as for any workspace.
  if (hive?.step === 'landing') {
    return toReview(
      hive.note ? 'No check ran: review, check and land it' : 'Checked: review and land it',
    );
  }
  return toReview('Ready for review');
}

/**
 * What a waiting agent asks (V48): its recorded ask in the thread's words, else what it said as it
 * began to wait (Codex on its app server); none when nothing was recorded, or for a plan (its first
 * line is mostly a heading: "Plan ready" says more).
 */
export function blockedOn({ activity, agent, worktree }: WorkspaceSummary): string | undefined {
  if (activity?.asks) return askedFor(activity.asks, worktree.path);
  const said = activity?.report;
  if (agent.state !== 'needs-you' || agent.interrupted || !said || !activity.since)
    return undefined;
  // A report from before the wait began is an earlier turn's, not what it asks now.
  return Date.parse(said.at) >= Date.parse(activity.since) ? said.text : undefined;
}

/** Each tool's verb (V48f): Claude Code's tools by name, Codex's items by kind. */
export const TOOL_WORDS: Record<string, [verb: string, alone: string]> = {
  Bash: ['Running', 'Running a command'],
  command: ['Running', 'Running a command'],
  Edit: ['Editing', 'Editing a file'],
  MultiEdit: ['Editing', 'Editing a file'],
  NotebookEdit: ['Editing', 'Editing a notebook'],
  fileChange: ['Editing', 'Editing files'],
  Write: ['Writing', 'Writing a file'],
  Read: ['Reading', 'Reading a file'],
  Grep: ['Searching for', 'Searching'],
  Glob: ['Finding files:', 'Finding files'],
  WebFetch: ['Fetching', 'Fetching a page'],
  WebSearch: ['Searching the web:', 'Searching the web'],
  webSearch: ['Searching the web:', 'Searching the web'],
  Task: ['Running a subagent:', 'Running a subagent'],
  Agent: ['Running a subagent:', 'Running a subagent'],
  TodoWrite: ['Updating its to-do list', 'Updating its to-do list'],
};

/** A tool's verb with a subject ("Running", "Editing"); none for a tool not known. */
export const activityVerb = (tool: string): string | undefined => TOOL_WORDS[tool]?.[0];

/** A tool running, as the page says it (V48f): "Running pnpm test", "Editing src/auth.ts". */
export function activityText({ tool, subject }: ToolActivity): string {
  const words = TOOL_WORDS[tool];
  if (!words) return `Using ${subject && tool === 'mcp' ? subject : tool}`;
  const [verb, alone] = words;
  return subject && verb !== alone ? `${verb} ${subject}` : alone;
}

/** A workspace's fact (V48): its card shows it as an icon and `shown` (V79), its head says `words`. */
export interface WorkspaceFact {
  kind: 'hive' | 'commits' | 'changed' | 'gone' | 'clean' | 'conflicts';
  /** Beside its icon on the card: "3", "1 conflict". */
  shown: string;
  /** In the workspace's head, and the card's tip: "3 commits", "Conflicts with main in 1 file". */
  words: string;
}

/**
 * A workspace's facts: that Hive drives it (HV2), its commits, its files not committed, a worktree
 * gone, then whether it merges into the branch it is reviewed against (V17's check, V65); a check
 * git could not make says nothing.
 */
export function workspaceFacts(
  workspace: WorkspaceSummary,
  merge: BranchMerge | null,
): WorkspaceFact[] {
  const { ahead, worktree, hive } = workspace;
  const facts: WorkspaceFact[] = [
    // Hive drives it (HV2): first, and its round.
    ...(hive
      ? [
          hive.paused
            ? { kind: 'hive' as const, shown: 'off', words: 'Hive is off: its step waits' }
            : {
                kind: 'hive' as const,
                shown: `${hive.round}/${hive.rounds}`,
                words: `Hive drives it: round ${hive.round} of ${hive.rounds}`,
              },
        ]
      : []),
    {
      kind: 'commits',
      shown: `${ahead}`,
      words: ahead > 0 ? plural(ahead, 'commit') : 'no commits yet',
    },
  ];
  if (worktree.changed) {
    facts.push({
      kind: 'changed',
      shown: `${worktree.changed}`,
      words: `${plural(worktree.changed, 'file')} not committed yet`,
    });
  }
  if (!worktree.exists) {
    facts.push({ kind: 'gone', shown: 'worktree gone', words: 'its worktree is gone' });
  }
  if (merge && 'clean' in merge) {
    facts.push({ kind: 'clean', shown: 'clean', words: `Merges cleanly into ${merge.into}` });
  } else if (merge && 'conflicts' in merge) {
    const files = merge.conflicts.length;
    facts.push({
      kind: 'conflicts',
      shown: plural(files, 'conflict'),
      words: `Conflicts with ${merge.into} in ${plural(files, 'file')}`,
    });
  }
  return facts;
}
