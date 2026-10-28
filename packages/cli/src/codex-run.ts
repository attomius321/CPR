// Symbiote's runner for Codex (V20a, decision 129): started detached by `symbiote view` in a
// workspace's worktree, it runs `codex exec --json …` and writes what Codex does into the
// workspace's thread (`symbiote/threads/<branch>.jsonl`, V18c's entries) as it happens — Codex's
// events carry no times, and it has no hooks Symbiote can register without the person's trust —,
// and what it runs and changes into its activity (`symbiote/activity/<branch>.jsonl`, V48f). It
// outlives `symbiote view`, as Claude Code's background sessions do. Node's own modules only: it
// starts with every run.
//
//   node codex-run.js <thread file> <activity file> <startup|resume> <run> <codex> <args…, the
//   prompt last>
import { spawn } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ActivityEntry, ThreadEntry } from '@symbiote/core';

/**
 * What a run is: the thread it writes, how it started, its ID (on each entry it writes), and
 * the program with its arguments.
 */
export interface CodexRun {
  thread: string;
  /** Where what it runs and changes goes (V48f). */
  activity?: string;
  source: 'startup' | 'resume';
  run: string;
  command: string;
  /** Codex's arguments; the last is what it was given (Symbiote's prompt, or the person's message).
   * */
  args: string[];
}

/** Longest subject kept of an item (V48f), as Claude Code's hooks keep theirs. */
const SUBJECT = 160;

/** Codex's items the activity keeps (V48f), by `exec --json`'s type, as the app server names them. */
const TOOLS: Record<string, string> = {
  command_execution: 'command',
  file_change: 'fileChange',
  mcp_tool_call: 'mcp',
  web_search: 'webSearch',
};

/**
 * What an item works on (V48f): a command's first line, the files changed (from `worktree` when
 * inside it), an MCP server's tool, a search's query; cut at 160 characters.
 */
function subjectOf(item: Record<string, unknown>, worktree: string): string | undefined {
  const words = (value: unknown) => (typeof value === 'string' ? value : '');
  let subject = '';
  if (item.type === 'command_execution') subject = words(item.command);
  else if (item.type === 'file_change' && Array.isArray(item.changes)) {
    subject = (item.changes as { path?: unknown }[])
      .map((change) => words(change?.path))
      .filter((path) => path !== '')
      .map((path) => (path.startsWith(`${worktree}/`) ? path.slice(worktree.length + 1) : path))
      .join(', ');
  } else if (item.type === 'mcp_tool_call') {
    subject = [words(item.server), words(item.tool)].filter((w) => w !== '').join('.');
  } else if (item.type === 'web_search') subject = words(item.query);
  const line =
    subject
      .split('\n')
      .find((l) => l.trim() !== '')
      ?.trim() ?? '';
  return line === '' ? undefined : line.slice(0, SUBJECT);
}

/** Longest command kept whole (V73), as Claude Code's hooks keep theirs (`thread.ts`). */
const MAX_COMMAND = 8192;

/** How much of a command's output is kept (V73): its end, as `thread.ts` keeps Claude Code's. */
const MAX_OUTPUT = 2048;

/**
 * A command's output as its activity line keeps it (V73), as `outputOf` in `thread.ts` does: this
 * runner is run as its own program, from its source in tests, and imports nothing of its own.
 */
function outputOf(value: string): Pick<ActivityEntry, 'output' | 'clipped'> {
  const whole = value.trimEnd();
  if (whole === '') return {};
  if (whole.length <= MAX_OUTPUT) return { output: whole };
  const end = whole.slice(-MAX_OUTPUT);
  const from = end.indexOf('\n') + 1;
  return { output: from > 0 ? end.slice(from) : end, clipped: true };
}

/** How much of Codex's error output is kept for its last words. */
const STDERR_KEPT = 4096;

/** Codex's note when its stdin is not a terminal: not its words about a failure. */
const STDIN_NOTE = /^Reading additional input from stdin\.\.\.$/;

/**
 * Runs Codex and records its run in the thread: `start` and `prompt` once its thread starts,
 * a `report` (the turn's last message) when a turn completes, and `end` with its reason —
 * `completed`, `stopped`, or the failure in Codex's words. `done` resolves with its exit code
 * once everything is written; `stop` ends it (SIGTERM).
 */
export function runCodex(
  run: CodexRun,
  {
    now = () => new Date().toISOString(),
    cwd,
    worktree = cwd ?? process.cwd(),
  }: { now?: () => string; cwd?: string; worktree?: string } = {},
): { done: Promise<number>; stop: () => void } {
  let session = '';
  let message: string | null = null;
  let completed = false;
  let failure: string | null = null;
  let lastError: string | null = null;
  let stderr = '';
  let stopped = false;
  // Entries are appended one after the other, in the order Codex's events came.
  let written: Promise<unknown> = mkdir(dirname(run.thread), { recursive: true });
  const write = (entry: Record<string, unknown> & { kind: ThreadEntry['kind'] }) => {
    const line = `${JSON.stringify({ at: now(), session, run: run.run, ...entry })}\n`;
    written = written.then(() => appendFile(run.thread, line)).catch(() => undefined);
  };
  /** Items seen started: a completed one seen first (a file change) gets its start too. */
  const started = new Set<string>();
  /** A tool's start or end in the activity (V48f), in the order Codex's events came. */
  const tool = (phase: 'start' | 'end', item: Record<string, unknown>) => {
    const kind = typeof item.type === 'string' ? TOOLS[item.type] : undefined;
    if (!run.activity || !kind || typeof item.id !== 'string') return;
    if (phase === 'end' && !started.has(item.id)) tool('start', item);
    started.add(item.id);
    const subject = subjectOf(item, worktree);
    const code = item.exit_code;
    const failed =
      phase === 'end' && (item.status === 'failed' || (typeof code === 'number' && code !== 0));
    // Since V73 a command's whole text on its start, its exit code and output's end on its end.
    const command = kind === 'command' && typeof item.command === 'string' ? item.command : '';
    const output = typeof item.aggregated_output === 'string' ? item.aggregated_output : '';
    const details: Partial<ActivityEntry> =
      phase === 'start'
        ? command !== ''
          ? { input: command.slice(0, MAX_COMMAND) }
          : {}
        : {
            ...(typeof code === 'number' ? { exit: code } : {}),
            ...(kind === 'command' ? outputOf(output) : {}),
          };
    const entry: ActivityEntry = {
      at: now(),
      session,
      run: run.run,
      id: item.id,
      tool: kind,
      ...(subject ? { subject } : {}),
      phase,
      ...(failed ? { failed: true } : {}),
      ...details,
    };
    const file = run.activity;
    const line = `${JSON.stringify(entry)}\n`;
    written = written
      .then(() => mkdir(dirname(file), { recursive: true }))
      .then(() => appendFile(file, line))
      .catch(() => undefined);
  };

  const event = (line: string) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    if (!value || typeof value !== 'object') return;
    const v = value as {
      type?: unknown;
      thread_id?: unknown;
      message?: unknown;
      error?: { message?: unknown };
      item?: { type?: unknown; text?: unknown } & Record<string, unknown>;
    };
    switch (v.type) {
      case 'thread.started':
        if (typeof v.thread_id !== 'string' || session !== '') return;
        session = v.thread_id;
        write({ kind: 'start', source: run.source });
        write({ kind: 'prompt', text: run.args.at(-1) ?? '' });
        return;
      case 'turn.started':
        message = null;
        completed = false;
        return;
      case 'item.started':
        if (v.item) tool('start', v.item);
        return;
      case 'item.completed':
        if (v.item?.type === 'agent_message' && typeof v.item.text === 'string') {
          message = v.item.text;
        }
        if (v.item) tool('end', v.item);
        return;
      case 'turn.completed':
        completed = true;
        if (message) write({ kind: 'report', text: message });
        message = null;
        return;
      case 'turn.failed':
        failure = typeof v.error?.message === 'string' ? v.error.message : 'its turn failed';
        return;
      case 'error':
        if (typeof v.message === 'string') lastError = v.message;
        return;
      default:
        return;
    }
  };

  let resolve!: (code: number) => void;
  const done = new Promise<number>((r) => (resolve = r));
  let finished = false;
  const finish = (code: number, reason: string) => {
    if (finished) return;
    finished = true;
    write({ kind: 'end', reason });
    void written.then(() => resolve(code));
  };

  const child = spawn(run.command, run.args, {
    ...(cwd ? { cwd } : {}),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let pending = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    pending += chunk;
    let at: number;
    while ((at = pending.indexOf('\n')) >= 0) {
      event(pending.slice(0, at));
      pending = pending.slice(at + 1);
    }
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_KEPT);
  });
  child.on('error', (error) => finish(1, `could not run ${run.command}: ${error.message}`));
  child.on('close', (code, signal) => {
    if (pending !== '') event(pending);
    const words = stderr
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line !== '' && !STDIN_NOTE.test(line))
      .slice(-3)
      .join('\n');
    const reason = stopped
      ? 'stopped'
      : completed && !failure && code === 0
        ? 'completed'
        : (failure ??
          lastError ??
          (words ||
            (signal
              ? `Codex ended on ${signal}`
              : code === 0
                ? 'Codex exited before its turn ended'
                : `Codex exited with code ${code ?? 'none'}`)));
    finish(code ?? 1, reason);
  });
  return {
    done,
    stop() {
      stopped = true;
      child.kill('SIGTERM');
    },
  };
}

/**
 * `node codex-run.js <thread> <activity> <source> <run> <codex> <args…>`: runs it, stopping on a
 * signal.
 */
function main(argv: string[]): void {
  const [thread, activity, source, run, command, ...args] = argv;
  if (!thread || !activity || (source !== 'startup' && source !== 'resume') || !run || !command) {
    process.stderr.write(
      'usage: codex-run <thread file> <activity file> <startup|resume> <run> <codex> <args…>\n',
    );
    process.exitCode = 2;
    return;
  }
  const running = runCodex({ thread, activity, source, run, command, args });
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(signal, () => running.stop());
  }
  void running.done.then((code) => {
    process.exitCode = code;
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
