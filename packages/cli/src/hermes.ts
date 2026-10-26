// Hermes Agent as a workspace's agent (V58): what Symbiote asks of it, and what its state is.
// Hermes runs in a kept terminal of `symbiote view` (decision 415); Symbiote reads its sessions
// through Hermes's own CLI (`hermes sessions list`, `hermes sessions export`, decision 416), never
// its files.
import {
  EFFORT_LEVEL,
  type ActivityEntry,
  type AgentEfforts,
  type AgentStateName,
  type ThreadEntry,
  type WorkspaceAgentState,
} from '@symbiote/core';
import { localHost, onPath } from './editor.js';
import { runProgram, type Run } from './programs.js';
import { MAX_SUBJECT } from './thread.js';
import type { WorkspaceFile } from './workspace-record.js';

/** A tool call in one of Hermes's steps: its ID, the tool, its arguments as Hermes kept them (JSON). */
export interface HermesToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** A message of a Hermes session, as its export gives it (rewound and hidden ones left out). */
export interface HermesMessage {
  /** `user`, `assistant`, `tool`. */
  role: string;
  content: string;
  /** When Hermes stored it, in Unix seconds. */
  at: number;
  /**
   * An assistant's: `tool_calls` for a step of its turn, `stop` (or `length`) for a final answer;
   * absent for a turn that failed or was interrupted, which also ends it (V58 spike).
   */
  finish?: string;
  toolCalls?: HermesToolCall[];
  /** A tool result's: the call it answers, and its tool. */
  toolCallId?: string;
  toolName?: string;
}

/** A Hermes session: its ID, folder, times and messages, oldest first. */
export interface HermesSession {
  id: string;
  cwd?: string;
  /** Unix seconds. */
  startedAt: number;
  /** Set when its Hermes closed (`end_reason`: `cli_close`), cleared when it is resumed. */
  endedAt?: number;
  endReason?: string;
  messages: HermesMessage[];
}

/** What Symbiote asks of Hermes (V58); tests pass a fake. */
export interface Hermes {
  /** The program, as found. */
  command: string;
  /** The levels `--reasoning` takes, from `hermes chat --help`; null when they cannot be read. */
  efforts(): Promise<AgentEfforts | null>;
  /**
   * The IDs of the sessions Hermes lists for `folder` (`hermes sessions list --workspace`), open
   * ones too, its newest activity first. Hermes matches the folder by substring: a session's own
   * folder is read with `read`. Rejects with Hermes's words.
   */
  sessions(folder: string): Promise<string[]>;
  /** A session and its messages (`hermes sessions export --session-id`); null when there is none.
   * Rejects with Hermes's words. */
  read(id: string): Promise<HermesSession | null>;
}

/**
 * Hermes's arguments (decision 415): a new interactive session in the folder it runs in, seeded
 * with the prompt (`chat --query=…`: one argument, whatever the prompt starts with), or a session
 * continued with no turn (`--resume`); at the level it was started at, which a run does not keep.
 * Never `--yolo` (its approvals stay the person's), never `--worktree` (Symbiote made it).
 */
export function hermesArgs(
  request: { prompt: string; effort?: string } | { session: string; effort?: string },
): string[] {
  const level = request.effort ? ['--reasoning', request.effort] : [];
  if ('session' in request) return ['--resume', request.session, ...level];
  return ['chat', `--query=${request.prompt}`, ...level];
}

/**
 * The levels `hermes chat --help` lists for `--reasoning`, in its order: the list after the colon
 * of that option's description ("…: none, minimal, low, …, or ultra."), which runs until the next
 * option. Null without the option, or when the list holds anything but lowercase words.
 */
export function parseHermesEfforts(help: string): string[] | null {
  const lines = help.split('\n');
  const at = lines.findIndex((line) => /^\s*--reasoning\b/.test(line));
  if (at < 0) return null;
  const rest = lines.slice(at + 1);
  const next = rest.findIndex((line) => /^\s*-/.test(line));
  const description = [lines[at], ...(next < 0 ? rest : rest.slice(0, next))].join(' ');
  const list = /:\s*([^.]*)\./.exec(description)?.[1];
  if (!list) return null;
  const levels = list
    .split(/,\s*(?:or\s+)?|\s+or\s+/)
    .map((level) => level.trim())
    .filter((level) => level !== '');
  return levels.length > 0 && levels.every((level) => EFFORT_LEVEL.test(level)) ? levels : null;
}

/** Hermes's session IDs: `20261026_101430_6ffcdc`. */
const SESSION_ID = /^\d{8}_\d{6}_[0-9a-f]{6,}$/;

/** The IDs ending the rows of `hermes sessions list`'s table, in its order. */
export function parseSessionIds(text: string): string[] {
  const ids: string[] = [];
  for (const line of text.split('\n')) {
    const last = line.trim().split(/\s+/).at(-1) ?? '';
    if (SESSION_ID.test(last) && !ids.includes(last)) ids.push(last);
  }
  return ids;
}

const words = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;
const seconds = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** A step's tool calls, as OpenAI's shape keeps them (`function.name`, `function.arguments`). */
function toolCallsOf(value: unknown): HermesToolCall[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).flatMap((item) => {
    const v = (item ?? {}) as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const id = words(v.id);
    const name = words(v.function?.name);
    if (!id || !name) return [];
    const args = v.function?.arguments;
    return [{ id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}) }];
  });
}

/**
 * One exported message, or null for one that is not a message, was rewound (`active: 0`) or is
 * one Hermes's own interface hides (`display_kind: hidden`: an empty one it adds itself).
 */
function messageOf(item: unknown): HermesMessage | null {
  const v = (item ?? {}) as Record<string, unknown>;
  const role = words(v.role);
  const at = seconds(v.timestamp);
  if (!role || at === undefined || v.active === 0 || v.display_kind === 'hidden') return null;
  const finish = words(v.finish_reason);
  const toolCalls = toolCallsOf(v.tool_calls);
  const toolCallId = words(v.tool_call_id);
  const toolName = words(v.tool_name);
  return {
    role,
    content: typeof v.content === 'string' ? v.content : '',
    at,
    ...(finish ? { finish } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(toolName ? { toolName } : {}),
  };
}

/**
 * The sessions of `hermes sessions export --format jsonl` (one JSON object a line, its
 * `messages` inside); anything else — Hermes's words for a session it does not have, a broken
 * line — is skipped.
 */
export function parseHermesExport(text: string): HermesSession[] {
  const sessions: HermesSession[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const id = words(value.id);
    const startedAt = seconds(value.started_at);
    if (!id || startedAt === undefined || !Array.isArray(value.messages)) continue;
    const cwd = words(value.cwd);
    const endedAt = seconds(value.ended_at);
    const endReason = words(value.end_reason);
    sessions.push({
      id,
      ...(cwd ? { cwd } : {}),
      startedAt,
      ...(endedAt === undefined ? {} : { endedAt }),
      ...(endReason ? { endReason } : {}),
      messages: (value.messages as unknown[])
        .map(messageOf)
        .filter((m): m is HermesMessage => m !== null),
    });
  }
  return sessions;
}

/** Hermes's last words, for a failure: its error output's last lines, else its output's. */
function wordsOf(result: { stdout: string; stderr: string }): string {
  return (result.stderr.trim() || result.stdout.trim()).split('\n').slice(-3).join('\n');
}

/** Hermes as Symbiote asks it (V58): its levels read once, its sessions each time. */
export function hermes(
  command: string,
  { run = runProgram, cwd = process.cwd() }: { run?: Run; cwd?: string } = {},
): Hermes {
  let efforts: Promise<AgentEfforts | null> | null = null;
  const ask = async (args: string[]) => {
    const result = await run(command, args, { cwd, timeoutMs: 20_000 });
    if (result.code !== 0) throw new Error(wordsOf(result) || `${command} exited ${result.code}`);
    return result.stdout;
  };
  return {
    command,
    efforts() {
      efforts ??= run(command, ['chat', '--help'], { cwd, timeoutMs: 20_000 }).then((result) => {
        const levels = parseHermesEfforts(result.stdout);
        return levels ? { levels } : null;
      });
      return efforts;
    },
    async sessions(folder) {
      return parseSessionIds(
        await ask(['sessions', 'list', '--workspace', folder, '--limit', '20']),
      );
    },
    async read(id) {
      const text = await ask(['sessions', 'export', '--session-id', id, '--format', 'jsonl', '-']);
      return parseHermesExport(text).find((session) => session.id === id) ?? null;
    },
  };
}

/** Hermes's program: `SYMBIOTE_HERMES` (a path or a command on PATH), else `hermes` on PATH. */
export async function findHermes(
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  const host = localHost(env);
  const custom = env.SYMBIOTE_HERMES?.trim();
  if (custom) {
    if (/[\\/]/.test(custom)) return (await host.isFile(custom)) ? custom : null;
    return onPath(host, custom);
  }
  return onPath(host, 'hermes');
}

/** Whether a session's last turn ended: an assistant's message last that is not a step. */
function turnEnded(session: HermesSession): boolean {
  const last = session.messages.findLast((m) => ['user', 'assistant', 'tool'].includes(m.role));
  return last?.role === 'assistant' && last.finish !== 'tool_calls';
}

/**
 * What the page says of a Hermes workspace's agent (decision 417), from its session and whether
 * Symbiote's terminal runs it: a turn that ended is finished (plan ready, ready or done by the
 * branch's commits, as for the other agents), else it works while Hermes runs and is stopped
 * once it does not; stopped too once Symbiote's Stop hung it up (`agent.stopped`), until it runs
 * again. No session yet: working while it runs, failed when its terminal ended
 * (`ended`), else not running (a `symbiote view` started since). Never "needs you": Hermes's
 * approvals are drawn in its terminal only.
 */
export function hermesState(
  workspace: WorkspaceFile,
  read: HermesSession | null | Error,
  { running, ended, ahead }: { running: boolean; ended: boolean; ahead: number },
): WorkspaceAgentState {
  const { agent } = workspace;
  if (!agent) return { state: 'no-agent' };
  const kind = agent.kind;
  if (agent.error) return { state: 'not-started', kind, error: agent.error };
  if (read instanceof Error) {
    return { state: 'unknown', kind, error: `Hermes could not read its session: ${read.message}` };
  }
  // Hung up by Stop, Hermes closes its turn with a message of its own (V58 real run, 0.3 s):
  // stopped until it runs again, or a message was given since (in another terminal).
  const stopped = agent.stopped ? Date.parse(agent.stopped) / 1000 : undefined;
  if (
    !running &&
    stopped !== undefined &&
    !read?.messages.some((m) => m.role === 'user' && m.at > stopped)
  ) {
    return { state: 'stopped', kind, ...(read ? { id: read.id } : {}) };
  }
  if (!read) {
    if (running) return { state: 'working', kind };
    if (ended) {
      return {
        state: 'failed',
        kind,
        error:
          'Hermes ended before its first message: start the agent again to see why in its terminal',
      };
    }
    return { state: 'not-running', kind };
  }
  const finished = (): AgentStateName =>
    ahead > 0 ? 'ready' : workspace.planFirst ? 'plan-ready' : 'done';
  if (turnEnded(read)) return { state: finished(), kind, id: read.id };
  return { state: running ? 'working' : 'stopped', kind, id: read.id };
}

/** Unix seconds as the thread's times are written. */
const isoOf = (at: number) => new Date(at * 1000).toISOString();

/**
 * A Hermes session as V18c's entries: its start, each message it was given (Symbiote's prompt,
 * then the person's, typed in its terminal), each final answer, and its end once its Hermes closed.
 */
export function hermesEntries(session: HermesSession): ThreadEntry[] {
  const id = session.id;
  const entries: ThreadEntry[] = [
    { at: isoOf(session.startedAt), session: id, kind: 'start', source: 'startup' },
  ];
  for (const message of session.messages) {
    const at = isoOf(message.at);
    if (message.role === 'user') {
      entries.push({ at, session: id, kind: 'prompt', text: message.content });
    } else if (
      message.role === 'assistant' &&
      message.finish !== 'tool_calls' &&
      message.content.trim() !== ''
    ) {
      entries.push({ at, session: id, kind: 'report', text: message.content });
    }
  }
  if (session.endedAt !== undefined) {
    entries.push({ at: isoOf(session.endedAt), session: id, kind: 'end' });
  }
  return entries;
}

/**
 * Hermes's tools as the page words them (V48f): by the name of Claude Code's tool or Codex's item
 * that does the same, and the argument that says what it works on (`path` marks a file's path).
 * Any other tool keeps its own name, without a subject.
 */
const TOOLS: Record<string, { tool: string; field?: string; path?: true }> = {
  terminal: { tool: 'command', field: 'command' },
  read_file: { tool: 'Read', field: 'path', path: true },
  write_file: { tool: 'Write', field: 'path', path: true },
  patch: { tool: 'Edit', field: 'path', path: true },
  search_files: { tool: 'Grep', field: 'pattern' },
  web_search: { tool: 'WebSearch', field: 'query' },
  web_extract: { tool: 'WebFetch', field: 'urls' },
  browser_navigate: { tool: 'WebFetch', field: 'url' },
  delegate_task: { tool: 'Task' },
};

/** A call's tool and subject: its argument's first line (a list's first item), cut at 160. */
function toolOf(call: HermesToolCall, worktree: string): { tool: string; subject?: string } {
  const spec = TOOLS[call.name];
  if (!spec) return { tool: call.name };
  let value: unknown;
  try {
    value = spec.field ? (JSON.parse(call.arguments) as Record<string, unknown>)[spec.field] : null;
  } catch {
    value = null;
  }
  if (Array.isArray(value)) value = (value as unknown[])[0];
  let subject =
    typeof value === 'string'
      ? (value
          .split('\n')
          .find((line) => line.trim() !== '')
          ?.trim() ?? '')
      : '';
  if (spec.path && subject.startsWith(`${worktree}/`)) subject = subject.slice(worktree.length + 1);
  return subject === ''
    ? { tool: spec.tool }
    : { tool: spec.tool, subject: subject.slice(0, MAX_SUBJECT) };
}

/**
 * A session's tool calls as activity lines (V48f): each call's start at its step's time and its
 * end at its result's, in the order Hermes stored them.
 */
export function hermesTools(session: HermesSession, worktree: string): ActivityEntry[] {
  const calls = new Map<string, { tool: string; subject?: string }>();
  const lines: ActivityEntry[] = [];
  for (const message of session.messages) {
    const at = isoOf(message.at);
    for (const call of message.toolCalls ?? []) {
      const tool = toolOf(call, worktree);
      calls.set(call.id, tool);
      lines.push({ at, session: session.id, id: call.id, ...tool, phase: 'start' });
    }
    if (message.role === 'tool' && message.toolCallId) {
      const tool = calls.get(message.toolCallId) ?? { tool: message.toolName ?? 'tool' };
      lines.push({ at, session: session.id, id: message.toolCallId, ...tool, phase: 'end' });
    }
  }
  return lines;
}
