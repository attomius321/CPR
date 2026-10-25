// A workspace's Activity tab (V48c): what happened, in time order, from the records Symbiote has —
// its thread (V18c), its agent's tools (V48f), its branch's commits and its review's verdict.
// Nothing is made up: a source Symbiote does not have adds no row.
import type {
  ActivityEntry,
  ThreadEntry,
  WorkspaceCommit,
  WorkspaceSummary,
  WorkspaceThread,
} from '@symbiote/core';
import { AGENT_NAMES, askedFor } from './workspaces.js';

export interface TimelineItem {
  /** Stable while the sources only grow: a row keeps its key, a folded row its first's. */
  key: string;
  kind:
    | 'made'
    | 'start'
    | 'prompt'
    | 'message'
    | 'asks'
    | 'report'
    | 'end'
    | 'verdict'
    | 'commit'
    | 'command'
    | 'edits'
    | 'reads';
  /** When; absent for Codex's items on its app server, which carry no time. */
  at?: string;
  text: string;
  /** What the row opens to: a prompt or a message in full, a report (Markdown). */
  detail?: string;
  failed?: true;
}

/** A row before the sort, with what it is sorted by. */
interface Row extends TimelineItem {
  time: number;
  /** Which source and where in it: rows at one time keep their sources' order. */
  order: number;
  /** A tool's row: its files (edits), its verbs (reads), to fold with its neighbours. */
  paths?: string[];
  counts?: Record<Verb, number>;
}

type Verb = 'read' | 'searched' | 'fetched' | 'subagent' | 'other';

const COMMANDS = new Set(['Bash', 'command']);
const EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'fileChange']);
const VERBS: Record<string, Verb> = {
  Read: 'read',
  Grep: 'searched',
  Glob: 'searched',
  WebSearch: 'searched',
  webSearch: 'searched',
  WebFetch: 'fetched',
  Task: 'subagent',
  Agent: 'subagent',
};
/** Tools a row of their own says better: a question is the thread's ask; reasoning is no act. */
const SKIPPED = new Set(['AskUserQuestion', 'reasoning']);

const firstLine = (text: string) =>
  (text.split('\n').find((line) => line.trim() !== '') ?? '').trim();
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/** Its files, three at most, then how many more. */
function files(paths: string[]): string {
  const shown = paths.slice(0, 3).join(', ');
  return paths.length > 3 ? `${shown} and ${paths.length - 3} more` : shown;
}

/** What reads, searches and the rest came to: "Read 2 files · searched once · 1 other tool". */
function readsText(counts: Record<Verb, number>): string {
  const parts = [
    counts.read ? `read ${plural(counts.read, 'file', 'files')}` : '',
    counts.searched ? `searched ${times(counts.searched)}` : '',
    counts.fetched ? `fetched ${plural(counts.fetched, 'page', 'pages')}` : '',
    counts.subagent ? `ran ${plural(counts.subagent, 'subagent', 'subagents')}` : '',
    counts.other ? plural(counts.other, 'other tool', 'other tools') : '',
  ].filter((part) => part !== '');
  const text = parts.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** How a session ended, in words; a Codex run's other reasons are its failure (V20a). */
function endText(entry: Extract<ThreadEntry, { kind: 'end' }>, codex: boolean) {
  const reason = entry.reason;
  if (reason === 'completed') return { text: 'Its run completed' };
  if (reason === 'stopped') return { text: 'Stopped' };
  if (!reason || ['other', 'clear', 'logout', 'prompt_input_exit'].includes(reason)) {
    return { text: 'Its session ended' };
  }
  return codex
    ? { text: `Failed: ${firstLine(reason)}`, failed: true as const }
    : { text: `Its session ended: ${firstLine(reason)}` };
}

const VERDICTS = {
  approve: 'Approved',
  'request-changes': 'Changes requested',
  comment: 'Commented',
} as const;

/**
 * The Activity tab's rows (V48c): the workspace made; each session's start and end, Symbiote's
 * prompt and the person's messages, what the agent asked and reported; its commands, its edits
 * and — folded, one row for each run of them — its reads and searches; the branch's commits; the
 * review's verdict. Oldest first; rows at one time in their sources' order.
 */
export function timelineItems(
  workspace: WorkspaceSummary,
  thread: WorkspaceThread | null,
  commits: readonly WorkspaceCommit[] | null,
): TimelineItem[] {
  const rows: Row[] = [];
  const seen = new Map<string, number>();
  const add = (row: Omit<Row, 'key' | 'time' | 'order'>, sortAt: string) => {
    const id = `${row.kind}:${sortAt}`;
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    rows.push({ ...row, key: `${id}:${n}`, time: Date.parse(sortAt), order: rows.length });
  };
  const kind = workspace.agent.kind;
  const short = workspace.base.slice(0, 7);
  add(
    {
      kind: 'made',
      at: workspace.created,
      text: workspace.from
        ? `Workspace made from ${workspace.from} at ${short}`
        : `Workspace made at ${short}`,
    },
    workspace.created,
  );

  let started = false;
  let prompted = false;
  for (const entry of thread?.entries ?? []) {
    const { at } = entry;
    switch (entry.kind) {
      case 'start': {
        const text = !started
          ? `${AGENT_NAMES[kind ?? 'claude']} started`
          : entry.source === 'resume'
            ? 'Continued'
            : entry.source === 'fork'
              ? 'A copy of the session started'
              : 'Started again';
        started = true;
        add({ kind: 'start', at, text }, at);
        break;
      }
      case 'prompt': {
        const line = firstLine(entry.text);
        const more = entry.text.trim() !== line ? { detail: entry.text } : {};
        if (!prompted)
          add({ kind: 'prompt', at, text: "Symbiote's prompt", detail: entry.text }, at);
        else add({ kind: 'message', at, text: `You: ${line}`, ...more }, at);
        prompted = true;
        break;
      }
      case 'asks': {
        const asked = askedFor(entry, workspace.worktree.path);
        const text = entry.questions
          ? `Asked: ${asked.slice('Asks: '.length)}`
          : `Asked for p${asked.slice(1)}`;
        add({ kind: 'asks', at, text }, at);
        break;
      }
      case 'report':
        add(
          { kind: 'report', at, text: `Reported: ${firstLine(entry.text)}`, detail: entry.text },
          at,
        );
        break;
      case 'end':
        add(
          { kind: 'end', at, ...endText(entry, kind === 'codex' || entry.run !== undefined) },
          at,
        );
        break;
      default:
        break;
    }
  }

  const verdict = thread?.verdict;
  if (verdict) {
    add(
      { kind: 'verdict', at: verdict.at, text: `Review: ${VERDICTS[verdict.event]}` },
      verdict.at,
    );
  }

  // Each call once: its start (its end when the start was not kept), failed by its end.
  const tools = thread?.tools ?? [];
  const failed = new Set(tools.filter((t) => t.phase === 'end' && t.failed).map((t) => t.id));
  const shownCalls = new Set<string>();
  const calls: ActivityEntry[] = [];
  for (const tool of tools) {
    if (shownCalls.has(tool.id) || SKIPPED.has(tool.tool)) continue;
    shownCalls.add(tool.id);
    calls.push(tool);
  }
  for (const call of calls) {
    const at = call.untimed ? undefined : call.at;
    const when = at ? { at } : {};
    if (COMMANDS.has(call.tool)) {
      add(
        {
          kind: 'command',
          ...when,
          text: call.subject ? `Ran ${call.subject}` : 'Ran a command',
          ...(failed.has(call.id) ? { failed: true as const } : {}),
        },
        call.at,
      );
    } else if (EDITS.has(call.tool)) {
      add({ kind: 'edits', ...when, text: '', paths: call.subject ? [call.subject] : [] }, call.at);
    } else {
      const counts: Record<Verb, number> = {
        read: 0,
        searched: 0,
        fetched: 0,
        subagent: 0,
        other: 0,
      };
      counts[VERBS[call.tool] ?? 'other'] += 1;
      add({ kind: 'reads', ...when, text: '', counts }, call.at);
    }
  }

  for (const commit of commits ?? []) {
    add(
      {
        kind: 'commit',
        at: commit.date,
        text: `Committed ${commit.sha.slice(0, 7)}: ${commit.subject}`,
      },
      commit.date,
    );
  }

  rows.sort((a, b) => a.time - b.time || a.order - b.order);

  // Edits and reads one after the other are one row: the first's, keeping its key.
  const folded: Row[] = [];
  for (const row of rows) {
    const last = folded.at(-1);
    if (last && row.kind === 'edits' && last.kind === 'edits') {
      for (const path of row.paths ?? []) if (!last.paths?.includes(path)) last.paths?.push(path);
      continue;
    }
    if (last && row.kind === 'reads' && last.kind === 'reads' && last.counts && row.counts) {
      for (const verb of Object.keys(row.counts) as Verb[]) last.counts[verb] += row.counts[verb];
      continue;
    }
    folded.push({
      ...row,
      ...(row.paths ? { paths: [...row.paths] } : {}),
      ...(row.counts ? { counts: { ...row.counts } } : {}),
    });
  }
  return folded.map(({ key, kind, at, text, detail, failed, paths, counts }) => ({
    key,
    kind,
    ...(at ? { at } : {}),
    text:
      kind === 'edits'
        ? paths && paths.length > 0
          ? `Edited ${files(paths)}`
          : 'Edited files'
        : kind === 'reads' && counts
          ? readsText(counts)
          : text,
    ...(detail !== undefined ? { detail } : {}),
    ...(failed ? { failed } : {}),
  }));
}
