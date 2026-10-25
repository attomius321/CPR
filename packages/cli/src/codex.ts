// Codex as a workspace's agent: what Symbiote asks of it, and what its state is. On the person's
// app-server daemon (V27a), Symbiote starts and reads its threads there; without one, Symbiote runs
// `codex exec` through its runner (`codex-run.ts`, V20a), which records the thread. This module
// never reads Codex's own files.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type {
  ActivityEntry,
  AgentEfforts,
  AgentModels,
  AgentStateName,
  WorkspaceAgentState,
  ThreadEntry,
} from '@symbiote/core';
import {
  AppServerUnreachable,
  codexServer,
  type CodexServer,
  type CodexThread,
  type CodexTurn,
} from './app-server.js';
import { localHost, onPath } from './editor.js';
import { runProgram, type Run } from './programs.js';
import type { WorkspaceFile } from './workspace-record.js';

/** Starts a program detached from `symbiote view` (its own process group), in `cwd`; its process
 * ID. */
export type DetachedRun = (command: string, args: string[], cwd: string) => Promise<number>;

const detachProgram: DetachedRun = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve(child.pid as number);
    });
  });

/** What Symbiote asks of Codex (V20a); tests pass a fake. */
export interface Codex {
  /** The program, as found. */
  command: string;
  /**
   * Starts `codex exec` in `cwd` through Symbiote's runner, which writes `thread`, each entry
   * marked with `run`; its process ID.
   */
  start(request: {
    cwd: string;
    thread: string;
    /** Where the runner writes what Codex runs and changes (V48f). */
    activity: string;
    run: string;
    /** The folders its sandbox may also write: the branch's git folders. */
    writable: string[];
    prompt: string;
    /** Its effort level (V30b); Codex's configured one when absent. */
    effort?: string;
    /** Its model (V47); Codex's configured one when absent. */
    model?: string;
  }): Promise<{ ok: true; pid: number } | { ok: false; error: string }>;
  /**
   * Continues the thread `sessionId` with `text` (`codex exec resume`), the same way, at `effort`
   * and on `model` again: a resume keeps none of the start's options (V30 spike).
   */
  resume(request: {
    cwd: string;
    thread: string;
    activity: string;
    run: string;
    writable: string[];
    sessionId: string;
    text: string;
    effort?: string;
    model?: string;
  }): Promise<{ ok: true; pid: number } | { ok: false; error: string }>;
  /** Whether the runner started as `pid` still runs. */
  alive(pid: number): boolean;
  /** Stops a run: its runner and Codex under it; waits at most 2 s for them to go. */
  stop(pid: number): Promise<void>;
  /** Archives a thread (`codex archive`): out of Codex's lists, and back with `unarchive`. */
  archive(sessionId: string): Promise<void>;
  /** Whose account it runs on (`codex login status`). */
  account(): Promise<string | undefined>;
  /**
   * Codex's app server (V27a, decision 154): the person's daemon, started when it does not run
   * (`codex app-server daemon start`); null when Codex starts none (one older than 0.163, or a
   * daemon that fails), asked again a minute later.
   */
  server(): Promise<CodexServer | null>;
  /** The effort levels it takes (V30b), from its app server; null without one. */
  efforts(): Promise<AgentEfforts | null>;
  /** The models it lists (V47), from its app server; null without one. */
  models(): Promise<AgentModels | null>;
}

/** Whether a process runs (signal 0 asks without signalling). */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Someone else's process with that ID: it runs, but it is not ours to signal.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** A TOML array of strings: JSON's string escapes are TOML's. */
const tomlList = (values: readonly string[]) =>
  `[${values.map((v) => JSON.stringify(v)).join(',')}]`;

/**
 * Codex's arguments (decision 130): `exec` in the worktree, or `exec resume` of a thread, in the
 * `workspace-write` sandbox with the branch's git folders writable, at the effort level and on
 * the model given (V30b, V47) — on every run, since a resume keeps none of the first run's options
 * (V20a and V30 spikes). Never a bypass, never `--add-dir`. What it is given comes after `--`: a
 * message may start with `-`.
 */
export function codexArgs(
  request: {
    writable: readonly string[];
    prompt: string;
    effort?: string | undefined;
    model?: string | undefined;
  } & ({ cwd: string; sessionId?: undefined } | { sessionId: string; cwd?: undefined }),
): string[] {
  const roots = `sandbox_workspace_write.writable_roots=${tomlList(request.writable)}`;
  const effort = [
    ...(request.effort ? ['-c', `model_reasoning_effort=${JSON.stringify(request.effort)}`] : []),
    ...(request.model ? ['-m', request.model] : []),
  ];
  if (request.sessionId !== undefined) {
    return [
      'exec',
      'resume',
      '--json',
      '-c',
      'sandbox_mode="workspace-write"',
      '-c',
      roots,
      ...effort,
      '--',
      request.sessionId,
      request.prompt,
    ];
  }
  return [
    'exec',
    '--json',
    '-C',
    request.cwd,
    '-s',
    'workspace-write',
    '-c',
    roots,
    ...effort,
    '--',
    request.prompt,
  ];
}

/** The statuses `codex app-server daemon start` answers with when its daemon runs (Codex 0.163). */
const RUNNING = ['started', 'alreadyRunning', 'running'];

/**
 * The daemon's socket from `codex app-server daemon start`: its last line of output is its state
 * as JSON, after log lines (V27a); null when it failed or did not say.
 */
export function parseDaemon(result: {
  code: number | null;
  stdout: string;
  stderr: string;
}): string | null {
  if (result.code !== 0) return null;
  const last = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .findLast((line) => line !== '');
  try {
    const v = JSON.parse(last ?? '') as { status?: unknown; socketPath?: unknown } | null;
    if (v && RUNNING.includes(v.status as string) && typeof v.socketPath === 'string') {
      return v.socketPath === '' ? null : v.socketPath;
    }
  } catch {
    // Not Codex 0.163's answer.
  }
  return null;
}

/**
 * Codex's server at `socket`, its daemon started again when the socket stops answering (the person
 * stopped it, an update restarted it): each call is asked once more after `again` found a socket.
 * A call the server answered, or a connection cut after it, is not asked twice.
 */
function lastingServer(
  socket: string,
  again: () => Promise<string | null>,
  make: (address: string) => CodexServer,
): CodexServer {
  let inner = make(`unix://${socket}`);
  const retried =
    <A extends unknown[], R>(call: (server: CodexServer, ...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await call(inner, ...args);
      } catch (error) {
        if (!(error instanceof AppServerUnreachable)) throw error;
        const found = await again();
        if (!found) throw error;
        inner = make(`unix://${found}`);
        return call(inner, ...args);
      }
    };
  return {
    get address() {
      return inner.address;
    },
    start: retried((server, request: Parameters<CodexServer['start']>[0]) => server.start(request)),
    send: retried((server, request: Parameters<CodexServer['send']>[0]) => server.send(request)),
    load: retried((server, request: Parameters<CodexServer['load']>[0]) => server.load(request)),
    interrupt: retried((server, thread: string) => server.interrupt(thread)),
    trust: retried((server, cwd: string) => server.trust(cwd)),
    read: retried((server, thread: string, view: Parameters<CodexServer['read']>[1]) =>
      server.read(thread, view),
    ),
    archive: retried((server, thread: string) => server.archive(thread)),
    limits: retried((server) => server.limits()),
    efforts: retried((server, cwd: string) => server.efforts(cwd)),
    models: retried((server, cwd: string) => server.models(cwd)),
  };
}

/** Whose account Codex runs on, from `codex login status` (it writes to stderr); undefined when
 * unknown. */
export function parseCodexAccount(result: {
  code: number | null;
  stdout: string;
  stderr: string;
}): string | undefined {
  const text = `${result.stdout}\n${result.stderr}`;
  if (/not logged in/i.test(text)) return 'not logged in';
  if (result.code !== 0) return undefined;
  if (/chatgpt/i.test(text)) return 'your ChatGPT account';
  if (/api key/i.test(text)) return 'an API key';
  return undefined;
}

/**
 * Codex at `command`, run through Symbiote's runner (`dist/codex-run.js`) with this Node. The
 * account is asked for at most every minute.
 */
export function codex(
  command: string,
  {
    runner = fileURLToPath(new URL('./codex-run.js', import.meta.url)),
    node = process.execPath,
    run = runProgram,
    detach = detachProgram,
    cwd = process.cwd(),
    platform = process.platform,
    version,
  }: {
    runner?: string;
    node?: string;
    run?: Run;
    detach?: DetachedRun;
    /** Where `codex login status`, `codex archive` and `codex app-server daemon` run. */
    cwd?: string;
    platform?: NodeJS.Platform;
    /** Symbiote's version, as it introduces itself to the app server. */
    version?: string;
  } = {},
): Codex {
  let account: { at: number; text: Promise<string | undefined> } | null = null;
  let daemon: { at: number; none: boolean; server: Promise<CodexServer | null> } | null = null;
  // 57 ms when it runs, 1.25 s to start it (Codex 0.163, V27a).
  const startDaemon = () =>
    run(command, ['app-server', 'daemon', 'start'], { cwd, timeoutMs: 30_000 }).then(parseDaemon);
  const make = (address: string) => codexServer(address, version ? { version } : {});
  const alive = processAlive;
  const runner_ = async (
    files: { thread: string; activity: string },
    source: 'startup' | 'resume',
    id: string,
    args: string[],
    folder: string,
  ): Promise<{ ok: true; pid: number } | { ok: false; error: string }> => {
    try {
      const argv = [runner, files.thread, files.activity, source, id, command, ...args];
      return { ok: true, pid: await detach(node, argv, folder) };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  };
  const server = (): Promise<CodexServer | null> => {
    // None found: asked again a minute later (the person may update Codex meanwhile).
    if (!daemon || (daemon.none && Date.now() - daemon.at > 60_000)) {
      const found: NonNullable<typeof daemon> = {
        at: Date.now(),
        none: false,
        server: startDaemon().then((socket) => {
          found.none = socket === null;
          return socket ? lastingServer(socket, startDaemon, make) : null;
        }),
      };
      daemon = found;
    }
    return daemon.server;
  };
  return {
    command,
    start: ({ cwd: folder, thread, activity, run: id, writable, prompt, effort, model }) =>
      runner_(
        { thread, activity },
        'startup',
        id,
        codexArgs({ cwd: folder, writable, prompt, effort, model }),
        folder,
      ),
    resume: ({
      cwd: folder,
      thread,
      activity,
      run: id,
      writable,
      sessionId,
      text,
      effort,
      model,
    }) =>
      runner_(
        { thread, activity },
        'resume',
        id,
        codexArgs({ sessionId, writable, prompt: text, effort, model }),
        folder,
      ),
    alive,
    async stop(pid) {
      if (!alive(pid)) return;
      try {
        // The runner leads its process group (detached): Codex and its commands go with it.
        if (platform === 'win32') {
          await run('taskkill', ['/pid', String(pid), '/T', '/F'], { cwd, timeoutMs: 10_000 });
        } else process.kill(-pid, 'SIGTERM');
      } catch {
        return;
      }
      for (let waited = 0; waited < 2_000 && alive(pid); waited += 50) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
    async archive(sessionId) {
      await run(command, ['archive', sessionId], { cwd, timeoutMs: 20_000 });
    },
    account() {
      if (!account || Date.now() - account.at > 60_000) {
        const text = run(command, ['login', 'status'], { cwd, timeoutMs: 20_000 }).then(
          (result) => {
            const words = parseCodexAccount(result);
            // Asked again next time: the person may log in meanwhile, and a start checks it.
            if (words === 'not logged in') account = null;
            return words;
          },
        );
        account = { at: Date.now(), text };
      }
      return account.text;
    },
    server,
    async efforts() {
      const found = await server();
      return found ? found.efforts(cwd).catch(() => null) : null;
    },
    async models() {
      const found = await server();
      return found ? found.models(cwd).catch(() => null) : null;
    },
  };
}

/** Codex's program: `SYMBIOTE_CODEX` (a path or a command on PATH), else `codex` on PATH. */
export async function findCodex(
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  const host = localHost(env);
  const custom = env.SYMBIOTE_CODEX?.trim();
  if (custom) {
    if (/[\\/]/.test(custom)) return (await host.isFile(custom)) ? custom : null;
    return onPath(host, custom);
  }
  return onPath(host, 'codex');
}

/**
 * What the page says of a Codex workspace's agent (decision 131): its last run — the thread's
 * entries marked with the record's `run` — and whether its runner still runs. An `end` decides
 * (completed, stopped, or failed with Codex's words); without one it works while the runner lives,
 * else it finished if it reported, and failed if not. `exec` never stops to ask: never "needs you".
 * `ahead` (commits since the fork point) tells a finished plan from finished work, as for Claude
 * Code.
 */
export function codexState(
  workspace: WorkspaceFile,
  entries: readonly ThreadEntry[],
  alive: boolean,
  ahead: number,
): WorkspaceAgentState {
  const { agent } = workspace;
  if (!agent) return { state: 'no-agent' };
  const kind = agent.kind;
  if (agent.error) return { state: 'not-started', kind, error: agent.error };
  const last = agent.run ? entries.filter((entry) => entry.run === agent.run) : entries;
  const session = (
    last.findLast((e) => e.kind === 'start') ?? entries.findLast((e) => e.kind === 'start')
  )?.session;
  const head = { kind, ...(session ? { id: session } : {}) };
  const finished = (): AgentStateName =>
    ahead > 0 ? 'ready' : workspace.planFirst ? 'plan-ready' : 'done';
  const end = last.findLast((e): e is Extract<ThreadEntry, { kind: 'end' }> => e.kind === 'end');
  if (end) {
    if (end.reason === 'completed') return { state: finished(), ...head };
    if (end.reason === 'stopped') return { state: 'stopped', ...head };
    return { state: 'failed', ...head, error: end.reason ?? 'Codex failed' };
  }
  if (alive) return { state: 'working', ...head };
  if (last.some((e) => e.kind === 'report')) return { state: finished(), ...head };
  return { state: 'failed', ...head, error: 'Codex ended without a word' };
}

/** Unix seconds as the thread's times are written. */
const isoOf = (seconds: number) => new Date(seconds * 1000).toISOString();

/**
 * A thread on Codex's app server as V18c's entries (V27a, decision 155): its start (when `first`:
 * its first turn is among those read), each turn's messages (Symbiote's prompt, then the person's —
 * from the panel or Codex's own terminal, steered ones too), each finished turn's final answer, a
 * stop or a failure as an end; and, while it waits for the person, what it last said.
 */
export function serverEntries(
  thread: CodexThread,
  { first = true }: { first?: boolean } = {},
): ThreadEntry[] {
  const session = thread.id;
  const entries: ThreadEntry[] = [];
  if (first)
    entries.push({ at: isoOf(thread.createdAt), session, kind: 'start', source: 'startup' });
  const last = thread.turns.at(-1);
  for (const turn of thread.turns) {
    const began = isoOf(turn.startedAt ?? thread.updatedAt);
    for (const text of turn.prompts) entries.push({ at: began, session, kind: 'prompt', text });
    const ended = isoOf(turn.completedAt ?? turn.startedAt ?? thread.updatedAt);
    if (turn.status === 'completed') {
      if (turn.report) entries.push({ at: ended, session, kind: 'report', text: turn.report });
    } else if (turn.status === 'interrupted') {
      entries.push({ at: ended, session, kind: 'end', reason: 'stopped' });
    } else if (turn.status === 'failed') {
      entries.push({ at: ended, session, kind: 'end', reason: turn.error ?? 'Codex failed' });
    } else if (turn === last && thread.status === 'active' && thread.waiting && turn.report) {
      // Often what it asks: "May I run it outside the sandbox?" (the request itself is not read).
      entries.push({ at: isoOf(thread.updatedAt), session, kind: 'report', text: turn.report });
    }
  }
  return entries;
}

/**
 * A turn's items read in full as activity lines (V48f): each item's start, and its end once Codex
 * says it ended — an item with no status (reasoning, a web search) ended unless it is the last of
 * a running turn. Items carry no time: each line is at its turn's start, `untimed`, in the turn's order.
 * Paths inside `worktree` are said from it.
 */
export function serverTools(turn: CodexTurn, session: string, worktree: string): ActivityEntry[] {
  const at = isoOf(turn.startedAt ?? 0);
  const inside = (subject: string) =>
    subject
      .split(', ')
      .map((path) => (path.startsWith(`${worktree}/`) ? path.slice(worktree.length + 1) : path))
      .join(', ');
  const items = turn.items ?? [];
  return items.flatMap((item, index) => {
    const line = {
      at,
      session,
      untimed: true as const,
      id: item.id,
      tool: item.kind,
      ...(item.subject
        ? { subject: item.kind === 'fileChange' ? inside(item.subject) : item.subject }
        : {}),
    };
    // Reasoning and a web search have no status: running while they are a running turn's last.
    const running =
      item.status === undefined
        ? turn.status === 'inProgress' && index === items.length - 1
        : item.status === 'inProgress';
    const start: ActivityEntry = { ...line, phase: 'start' };
    if (running) return [start];
    return [start, { ...line, phase: 'end', ...(item.failed ? { failed: true as const } : {}) }];
  });
}

/**
 * When Codex last handed the turn back (V23): since the thread's last change while it waits on
 * the person, else its newest finished turn's end.
 */
export function serverLastAction(read: CodexThread): string | undefined {
  if (read.status === 'active' && read.waiting) return isoOf(read.updatedAt);
  const done = read.turns.findLast((turn) => turn.status === 'completed');
  return done?.completedAt === undefined ? undefined : isoOf(done.completedAt);
}

/**
 * Whether Codex's terminal will ask to trust a worktree (decision 160): Codex's configuration has
 * no entry, trusted or not, for it or a folder above it, under any of its `names` (its path and
 * its real path). Codex asks per folder (a linked worktree's repository does not count); whether
 * a folder above counts is not known, so one never makes Symbiote say Codex will ask.
 */
export function asksTrust(
  entries: Readonly<Record<string, string>>,
  names: readonly string[],
): boolean {
  const folders = Object.keys(entries).map((folder) => folder.replace(/\/+$/, ''));
  return !names.some((name) =>
    folders.some((folder) => folder !== '' && (name === folder || name.startsWith(`${folder}/`))),
  );
}

/** What an active thread waits on, in the words the page shows after "Waiting:". */
const WAITING: Record<NonNullable<CodexThread['waiting']>, string> = {
  approval: 'approval prompt',
  input: 'question',
};

/**
 * What the page says of a Codex workspace on the app server (V27a): an active thread works, or
 * needs the person while it waits on an approval or a question; otherwise its last turn decides —
 * finished (by `ahead`, as for Claude Code), stopped, or failed in Codex's words. `read` is the
 * error when the thread could not be read; `address` the server's, for `codex resume --remote`.
 */
export function serverState(
  workspace: WorkspaceFile,
  read: CodexThread | Error,
  ahead: number,
  address: string | null,
): WorkspaceAgentState {
  const { agent } = workspace;
  if (!agent) return { state: 'no-agent' };
  if (agent.error) return { state: 'not-started', kind: agent.kind, error: agent.error };
  const head = {
    kind: agent.kind,
    ...(agent.thread ? { id: agent.thread } : {}),
    ...(address ? { remote: address } : {}),
  };
  if (read instanceof Error) {
    return { state: 'unknown', ...head, error: `Codex's app server: ${read.message}` };
  }
  if (read.status === 'active') {
    return read.waiting
      ? { state: 'needs-you', ...head, waitingFor: WAITING[read.waiting] }
      : { state: 'working', ...head };
  }
  if (read.status === 'systemError') {
    return {
      state: 'failed',
      ...head,
      error: "Codex's app server reported an error on its thread",
    };
  }
  const last = read.turns.at(-1);
  if (!last) return { state: 'failed', ...head, error: 'Codex ended without a word' };
  switch (last.status) {
    case 'completed':
      return { state: ahead > 0 ? 'ready' : workspace.planFirst ? 'plan-ready' : 'done', ...head };
    case 'interrupted':
      return { state: 'stopped', ...head };
    case 'failed':
      return { state: 'failed', ...head, error: last.error ?? 'Codex failed' };
    default:
      // A turn still in progress on a thread that is not active: the moment between the two.
      return { state: 'working', ...head };
  }
}
