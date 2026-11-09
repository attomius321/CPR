// Normal mode's sidenav rows (V93, decisions 876, 877; `nkit.js`'s `.ws`): two lines — the state's
// icon and the title, then the state's word, its facts and its time. What the row leaves out (the
// branch, the kind, the model, the facts in words, the whole state) is its tip. Pure: tested in
// `test/row-words.test.ts`.
import type { BranchMerge, MergeEntry } from '@symbiote/core';
import { clockWords } from './hive-live.js';
import {
  activityVerb,
  AGENT_NAMES,
  runsOnWords,
  shortAge,
  workspaceFacts,
  workspaceName,
  type LandedRow,
  type WorkspaceRow,
} from './workspaces.js';
import { plural } from '../ui/plural.js';

/** A row's icon (`icons.tsx` names them): a merge, a bell, a question, an eye, a spinner… */
export type RowIcon = 'merge' | 'bell' | 'question' | 'eye' | 'spin' | 'alert' | 'idle' | 'check';
/** Its colour: amber the agent's turn, violet the person's, red failed, green done. */
export type RowTone = 'run' | 'you' | 'fail' | 'gone' | 'idle' | 'ok';

export interface RowWords {
  icon: RowIcon;
  tone: RowTone;
  /** The state's word, in 500 muted: "Plan ready", "3 commits", "Editing". */
  word: string;
  /** What a tool works on, right after its verb, no dot between: "Editing list.ts". */
  object?: string;
  /** After it, each after " · ": "npm test", "1 error". */
  detail: string[];
  /** At the line's end: how long it has waited ("4m"), or worked ("7:40"). */
  time?: string;
  /** The rest, for the row's tip: its name, its state whole, kind and branch, model, facts. */
  tip: string;
  /** A review row's findings, when the graph of its change is known (decision 892). */
  findings?: RowFindings;
}

export interface RowFindings {
  errors: number;
  warnings: number;
}

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1) || path;
const FILE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'Read', 'NotebookEdit']);

/** "A: b" → ["A", "b"]; a text without a colon is its word alone. */
function split(text: string): [string, string[]] {
  const at = text.indexOf(': ');
  return at < 0 ? [text, []] : [text.slice(0, at), [text.slice(at + 2)]];
}

/** Its agent and what it runs on: "Claude Code · Opus 5.5 · xhigh effort". */
function runsOn(workspace: WorkspaceRow['workspace']): string | undefined {
  const kind = workspace.agent.kind;
  const words = runsOnWords(workspace.agent)?.text;
  return kind && words ? `${AGENT_NAMES[kind]} · ${words}` : words;
}

/** The row's tip: what its two lines leave out. */
function tipOf(row: WorkspaceRow, merge: BranchMerge | null): string {
  const { workspace, next } = row;
  const facts = workspaceFacts(workspace, merge)
    .filter((fact) => fact.kind !== 'hive')
    .map((fact) => fact.words);
  return [
    workspaceName(workspace),
    next.doing ?? next.text,
    next.blocked,
    [workspace.kind, workspace.branch].filter(Boolean).join(' · '),
    runsOn(workspace),
    facts.length > 0 && workspace.ahead > 0 ? facts.join(' · ') : undefined,
  ]
    .filter((line): line is string => !!line)
    .join('\n');
}

/**
 * What a normal-mode row says at `now`. `merge` is its merge check (V17), `findings` its change's
 * findings when its graph was analyzed (decision 892).
 */
export function rowWords(
  row: WorkspaceRow,
  now: number,
  { merge = null, findings }: { merge?: BranchMerge | null; findings?: RowFindings } = {},
): RowWords {
  const { workspace, next } = row;
  const tip = tipOf(row, merge);
  const since = workspace.activity?.since;
  const age = since ? shortAge(since, now) : undefined;
  const words = (
    icon: RowIcon,
    tone: RowTone,
    word: string,
    detail: string[] = [],
    time?: string,
  ): RowWords => ({ icon, tone, word, detail, ...(time ? { time } : {}), tip });

  if (workspace.tip === null) return words('alert', 'fail', 'Branch gone');
  if (next.group === 'done')
    return words('check', 'ok', 'Merged', [`into ${workspace.from ?? 'its branch'}`]);
  // What stops its merge or its work takes the line, in its colour (V79's facts, now in words).
  if (merge && 'conflicts' in merge && next.group !== 'working') {
    return words('alert', 'fail', plural(merge.conflicts.length, 'conflict'), [
      `with ${merge.into}`,
    ]);
  }
  if (!workspace.worktree.exists) return words('alert', 'gone', 'Worktree gone');

  switch (next.group) {
    case 'waiting': {
      const { agent, activity } = workspace;
      if (agent.state === 'plan-ready') return words('bell', 'you', 'Plan ready', [], age);
      if (agent.interrupted) return words('bell', 'you', 'Interrupted', [], age);
      if (activity?.asks?.questions) return words('question', 'you', 'Asked a question', [], age);
      if (activity?.asks) return words('bell', 'you', 'Asks permission', [], age);
      if (workspace.hive?.step === 'stuck') return words('bell', 'you', 'Hive stopped', [], age);
      return words('bell', 'you', 'Waiting', [], age);
    }
    case 'review': {
      const counted = findings
        ? [
            ...(findings.errors > 0 ? [plural(findings.errors, 'error')] : []),
            ...(findings.warnings > 0 ? [plural(findings.warnings, 'warning')] : []),
          ]
        : [];
      // A row of commits says its findings, not its age (the proof's "3 commits · 1 error").
      const review = (word: string, detail: string[], aged = true) => ({
        ...words('eye', 'you', word, detail, aged ? age : undefined),
        ...(findings ? { findings } : {}),
      });
      const commits = plural(workspace.ahead, 'commit');
      if (workspace.ahead === 0) {
        return workspace.activity?.report
          ? review('Answered', [workspace.kind === 'spike' ? 'spike' : 'no commits'])
          : review('Finished', ['no commits']);
      }
      const again = /^(\d+) commits? since your review/.exec(next.text);
      if (again) return review('Review again', [`${plural(Number(again[1]), 'commit')} since`]);
      if (next.text.startsWith('Approved')) return review('Approved', [commits]);
      if (next.text.startsWith('Changes requested')) return review('Changes requested', [commits]);
      if (next.text.startsWith('Commented')) return review('Commented', [commits]);
      if (next.text === 'Review in progress') return review('In review', [commits]);
      if (next.text === 'Ready for review') return review(commits, counted, false);
      const [word, rest] = split(next.text);
      return review(word, rest);
    }
    case 'working':
    case 'hive': {
      const clock = since ? clockWords(now - Date.parse(since)) : undefined;
      const doing = workspace.activity?.doing;
      if (!doing || !next.doing) return words('spin', 'run', 'Working', [], clock);
      if ('thinking' in doing) return words('spin', 'run', 'Thinking', [], clock);
      const verb = activityVerb(doing.tool);
      if (verb && next.doing.startsWith(`${verb} `)) {
        const subject = next.doing.slice(verb.length + 1);
        const shown = FILE_TOOLS.has(doing.tool) ? basename(subject) : subject;
        return { ...words('spin', 'run', verb.replace(/:$/, ''), [], clock), object: shown };
      }
      return words('spin', 'run', next.doing, [], clock);
    }
    case 'stopped': {
      const { agent } = workspace;
      const first = (text?: string) => (text ? [text.split('\n')[0] ?? ''].filter(Boolean) : []);
      if (agent.state === 'failed') return words('alert', 'fail', 'Failed', first(agent.error));
      if (agent.state === 'not-started')
        return words('alert', 'fail', 'Not started', first(agent.error));
      if (agent.state === 'no-agent')
        return words('alert', 'fail', 'No agent', ['give it the prompt']);
      if (agent.state === 'unknown') return words('idle', 'idle', 'Unknown', first(agent.error));
      const [word, rest] = split(next.text);
      return words('idle', 'idle', word, rest);
    }
    default:
      return words('idle', 'idle', next.text);
  }
}

/** A merge's subject after "Merge <branch>: ", the workspace's title as the merger wrote it. */
function mergeSubject(entry: MergeEntry): string | undefined {
  const prefix = `Merge ${entry.branch}: `;
  return entry.title.startsWith(prefix) ? entry.title.slice(prefix.length) : undefined;
}

/** A row of the Merging group (V93): its workspace's title, the merge's state, its check's clock. */
export function mergeRowWords(
  entry: MergeEntry,
  title: string | undefined,
  now: number,
): RowWords & { title: string } {
  const name = title ?? mergeSubject(entry) ?? entry.branch;
  const tip = `${name}\n${entry.branch} → ${entry.into}`;
  const words = (
    icon: RowIcon,
    tone: RowTone,
    word: string,
    detail: string[] = [],
    time?: string,
  ) => ({ title: name, icon, tone, word, detail, ...(time ? { time } : {}), tip });
  const { check } = entry;
  switch (entry.state) {
    case 'queued':
      return words('merge', 'run', 'Queued', [`into ${entry.into}`]);
    case 'merging':
      return words('merge', 'run', 'Merging', [`into ${entry.into}`]);
    case 'resolving':
      return words('merge', 'run', 'Resolving', [plural(entry.conflicts?.length ?? 0, 'conflict')]);
    case 'checking': {
      const running = check?.commands[check.steps?.length ?? 0] ?? check?.commands.join(' && ');
      const clock = check?.started ? clockWords(now - Date.parse(check.started)) : undefined;
      return words('merge', 'run', 'Checking', running ? [running] : [], clock);
    }
    case 'ready':
      return words('merge', 'you', 'Ready to land', [`into ${entry.into}`]);
    case 'failed':
      return check?.ok === false
        ? words('alert', 'fail', 'Check failed', check.failed ? [check.failed] : [])
        : words(
            'alert',
            'fail',
            'Failed',
            entry.message ? [entry.message.split('\n')[0] ?? ''] : [],
          );
    case 'landed':
      return words('check', 'ok', 'Landed', [`into ${entry.into}`]);
    case 'needs-you':
      return words(
        'bell',
        'you',
        'Needs you',
        entry.message ? [entry.message.split('\n')[0] ?? ''] : [],
      );
    default:
      return words('merge', 'idle', entry.state);
  }
}

/** The browser's local midnight of `now`'s day (V91, decision 850). */
const midnight = (now: number) => new Date(now).setHours(0, 0, 0, 0);

/**
 * Normal mode's Done (V93, decision 877): Done today, merged since local midnight — when its merge
 * landed, else its agent's last act —, the newest first; Earlier, the rest, in their order.
 */
export function doneGroups(
  done: readonly WorkspaceRow[],
  merges: readonly MergeEntry[],
  now: number,
): { today: LandedRow[]; earlier: WorkspaceRow[] } {
  const today: LandedRow[] = [];
  const earlier: WorkspaceRow[] = [];
  for (const row of done) {
    const landed = merges.find(
      (entry) => entry.branch === row.workspace.branch && entry.state === 'landed' && entry.landed,
    )?.landed;
    const at = landed ?? row.workspace.lastAction;
    if (at !== undefined && Date.parse(at) >= midnight(now)) today.push({ ...row, at });
    else earlier.push(row);
  }
  today.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return { today, earlier };
}
