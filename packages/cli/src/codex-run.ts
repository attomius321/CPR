// Symbiote's runner for Codex (V20a, decision 129): started detached by `symbiote view` in a workspace's
// worktree, it runs `codex exec --json …` and writes what Codex does into the workspace's thread
// (`symbiote/threads/<branch>.jsonl`, V18c's entries) as it happens — Codex's events carry no times,
// and it has no hooks Symbiote can register without the person's trust. It outlives `symbiote view`, as
// Claude Code's background sessions do. Node's own modules only: it starts with every run.
//
//   node codex-run.js <thread file> <startup|resume> <run> <codex> <args…, the prompt last>
import { spawn } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ThreadEntry } from '@symbiote/core';

/**
 * What a run is: the thread it writes, how it started, its ID (on each entry it writes), and
 * the program with its arguments.
 */
export interface CodexRun {
  thread: string;
  source: 'startup' | 'resume';
  run: string;
  command: string;
  /** Codex's arguments; the last is what it was given (Symbiote's prompt, or the person's message). */
  args: string[];
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
  { now = () => new Date().toISOString(), cwd }: { now?: () => string; cwd?: string } = {},
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
      item?: { type?: unknown; text?: unknown };
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
      case 'item.completed':
        if (v.item?.type === 'agent_message' && typeof v.item.text === 'string') {
          message = v.item.text;
        }
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

/** `node codex-run.js <thread> <source> <run> <codex> <args…>`: runs it, stopping on a signal. */
function main(argv: string[]): void {
  const [thread, source, run, command, ...args] = argv;
  if (!thread || (source !== 'startup' && source !== 'resume') || !run || !command) {
    process.stderr.write('usage: codex-run <thread file> <startup|resume> <run> <codex> <args…>\n');
    process.exitCode = 2;
    return;
  }
  const running = runCodex({ thread, source, run, command, args });
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
