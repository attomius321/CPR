// What a workspace's agent did last, and since when (V48): from its thread (Claude Code's hooks,
// Symbiote's Codex runner), its recorded tools (V48f), or the turns Codex's app server answered.
// Only what was recorded: a field Symbiote cannot read is left out, never guessed.
import type {
  ActivityEntry,
  ThreadEntry,
  WorkspaceActivity,
  WorkspaceAgentState,
} from '@symbiote/core';
import type { CodexThread } from './app-server.js';
import { serverEntries, serverTools } from './codex.js';

/** Longest line of a report the list carries. */
const REPORT_LINE = 200;

/** A text's first line that says something, cut at `max` characters. */
const firstLine = (text: string, max: number) =>
  (text.split('\n').find((line) => line.trim() !== '') ?? '').trim().slice(0, max);

const time = (at: string) => Date.parse(at);

/**
 * What runs this turn (V48f): of the tools started since `turn` (its prompt), the newest whose
 * end is not recorded — a start and its end paired by ID, whatever order two async hooks wrote
 * them in — else none running: thinking. Codex's reasoning running is thinking too.
 */
export function doingOf(
  tools: readonly ActivityEntry[],
  turn: string | undefined,
): NonNullable<WorkspaceActivity['doing']> {
  const from = turn ? time(turn) : -Infinity;
  const mine = tools.filter((tool) => time(tool.at) >= from);
  const ended = new Set(mine.filter((tool) => tool.phase === 'end').map((tool) => tool.id));
  // Lines at one time keep their order: Codex's items are untimed, in their turn's order.
  const running = mine
    .map((tool, index) => ({ tool, index }))
    .filter(({ tool }) => tool.phase === 'start' && !ended.has(tool.id))
    .sort((a, b) => time(a.tool.at) - time(b.tool.at) || a.index - b.index)
    .at(-1)?.tool;
  if (!running || running.tool === 'reasoning') return { thinking: true };
  return { tool: running.tool, ...(running.subject ? { subject: running.subject } : {}) };
}

/**
 * What the list says of an agent from its thread's entries (V48): since when its state holds —
 * its turn's prompt while it works, this turn's ask while it waits, its last report once it
 * finished, its end once it stopped or failed —, that ask, and its newest report's first line.
 * `tools`: its recorded tools (V48f), null when they are not recorded: then nothing is said of
 * what it does.
 */
export function activityOf(
  entries: readonly ThreadEntry[],
  agent: WorkspaceAgentState,
  tools: readonly ActivityEntry[] | null = null,
): WorkspaceActivity | undefined {
  const prompt = entries.findLastIndex((e) => e.kind === 'prompt');
  const report = entries.findLast(
    (e): e is Extract<ThreadEntry, { kind: 'report' }> => e.kind === 'report',
  );
  const asks =
    agent.state === 'needs-you' && !agent.interrupted
      ? entries
          .slice(prompt + 1)
          .findLast((e): e is Extract<ThreadEntry, { kind: 'asks' }> => e.kind === 'asks')
      : undefined;
  const turn = prompt >= 0 ? entries[prompt]?.at : undefined;
  let since: string | undefined;
  switch (agent.state) {
    case 'working':
      since = turn;
      break;
    case 'needs-you':
      since = asks?.at;
      break;
    case 'plan-ready':
    case 'ready':
    case 'done':
      since = report?.at;
      break;
    case 'stopped':
    case 'failed':
    case 'not-running':
      since = entries.findLast((e) => e.kind === 'end')?.at;
      break;
    default:
      break;
  }
  const activity: WorkspaceActivity = {
    ...(since ? { since } : {}),
    ...(asks ? { asks } : {}),
    ...(report ? { report: { at: report.at, text: firstLine(report.text, REPORT_LINE) } } : {}),
    ...(agent.state === 'working' && tools ? { doing: doingOf(tools, turn) } : {}),
  };
  return Object.keys(activity).length > 0 ? activity : undefined;
}

/**
 * What the list says of Codex on its app server (V48): as of a thread's entries (its turns read),
 * waiting since the thread last changed (what it said then is its report); what runs from the
 * last turn's items, when it was read in full.
 */
export function serverActivity(
  read: CodexThread,
  agent: WorkspaceAgentState,
  worktree: string,
): WorkspaceActivity | undefined {
  const entries = serverEntries(read, { first: false });
  const last = read.turns.at(-1);
  const tools = last?.items ? serverTools(last, read.id, worktree) : null;
  const activity = activityOf(entries, agent, tools);
  if (agent.state !== 'needs-you') return activity;
  const since = new Date(read.updatedAt * 1000).toISOString();
  return { ...activity, since };
}
