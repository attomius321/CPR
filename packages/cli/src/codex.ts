// Codex as a workspace's agent (V20a): what CPR asks of it, and what its state is. CPR starts it
// through its runner (`codex-run.ts`), which records the thread; this module never reads
// Codex's own files.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { AgentStateName, FeatureAgentState, ThreadEntry } from '@cpr/core';
import { localHost, onPath } from './editor.js';
import { runProgram, type FeatureFile, type Run } from './features.js';

/** Starts a program detached from `cpr view` (its own process group), in `cwd`; its process ID. */
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

/** What CPR asks of Codex (V20a); tests pass a fake. */
export interface Codex {
  /** The program, as found. */
  command: string;
  /**
   * Starts `codex exec` in `cwd` through CPR's runner, which writes `thread`, each entry marked
   * with `run`; its process ID.
   */
  start(request: {
    cwd: string;
    thread: string;
    run: string;
    /** The folders its sandbox may also write: the branch's git folders. */
    writable: string[];
    prompt: string;
  }): Promise<{ ok: true; pid: number } | { ok: false; error: string }>;
  /** Continues the thread `sessionId` with `text` (`codex exec resume`), the same way. */
  resume(request: {
    cwd: string;
    thread: string;
    run: string;
    writable: string[];
    sessionId: string;
    text: string;
  }): Promise<{ ok: true; pid: number } | { ok: false; error: string }>;
  /** Whether the runner started as `pid` still runs. */
  alive(pid: number): boolean;
  /** Stops a run: its runner and Codex under it; waits at most 2 s for them to go. */
  stop(pid: number): Promise<void>;
  /** Archives a thread (`codex archive`): out of Codex's lists, and back with `unarchive`. */
  archive(sessionId: string): Promise<void>;
  /** Whose account it runs on (`codex login status`). */
  account(): Promise<string | undefined>;
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
 * `workspace-write` sandbox with the branch's git folders writable — on every run, since a
 * resume keeps none of the first run's options (V20a spike). Never a bypass, never `--add-dir`.
 * What it is given comes after `--`: a message may start with `-`.
 */
export function codexArgs(
  request: { writable: readonly string[]; prompt: string } & (
    { cwd: string; sessionId?: undefined } | { sessionId: string; cwd?: undefined }
  ),
): string[] {
  const roots = `sandbox_workspace_write.writable_roots=${tomlList(request.writable)}`;
  if (request.sessionId !== undefined) {
    return [
      'exec',
      'resume',
      '--json',
      '-c',
      'sandbox_mode="workspace-write"',
      '-c',
      roots,
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
    '--',
    request.prompt,
  ];
}

/** Whose account Codex runs on, from `codex login status` (it writes to stderr); undefined when unknown. */
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
 * Codex at `command`, run through CPR's runner (`dist/codex-run.js`) with this Node. The account
 * is asked for at most every minute.
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
  }: {
    runner?: string;
    node?: string;
    run?: Run;
    detach?: DetachedRun;
    /** Where `codex login status` and `codex archive` run. */
    cwd?: string;
    platform?: NodeJS.Platform;
  } = {},
): Codex {
  let account: { at: number; text: Promise<string | undefined> } | null = null;
  const alive = processAlive;
  const runner_ = async (
    thread: string,
    source: 'startup' | 'resume',
    id: string,
    args: string[],
    folder: string,
  ): Promise<{ ok: true; pid: number } | { ok: false; error: string }> => {
    try {
      const argv = [runner, thread, source, id, command, ...args];
      return { ok: true, pid: await detach(node, argv, folder) };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  };
  return {
    command,
    start: ({ cwd: folder, thread, run: id, writable, prompt }) =>
      runner_(thread, 'startup', id, codexArgs({ cwd: folder, writable, prompt }), folder),
    resume: ({ cwd: folder, thread, run: id, writable, sessionId, text }) =>
      runner_(thread, 'resume', id, codexArgs({ sessionId, writable, prompt: text }), folder),
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
  };
}

/** Codex's program: `CPR_CODEX` (a path or a command on PATH), else `codex` on PATH. */
export async function findCodex(
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  const host = localHost(env);
  const custom = env.CPR_CODEX?.trim();
  if (custom) {
    if (/[\\/]/.test(custom)) return (await host.isFile(custom)) ? custom : null;
    return onPath(host, custom);
  }
  return onPath(host, 'codex');
}

/**
 * What the page says of a Codex workspace's agent (decision 131): its last run — the thread's
 * entries marked with the record's `run` — and whether its runner still runs. An `end` decides (completed,
 * stopped, or failed with Codex's words); without one it works while the runner lives, else it
 * finished if it reported, and failed if not. `exec` never stops to ask: never "needs you".
 * `ahead` (commits since the base) tells a finished plan from finished work, as for Claude Code.
 */
export function codexState(
  feature: FeatureFile,
  entries: readonly ThreadEntry[],
  alive: boolean,
  ahead: number,
): FeatureAgentState {
  const { agent } = feature;
  if (!agent) return { state: 'no-agent' };
  const kind = agent.kind;
  if (agent.error) return { state: 'not-started', kind, error: agent.error };
  const last = agent.run ? entries.filter((entry) => entry.run === agent.run) : entries;
  const session = (
    last.findLast((e) => e.kind === 'start') ?? entries.findLast((e) => e.kind === 'start')
  )?.session;
  const head = { kind, ...(session ? { id: session } : {}) };
  const finished = (): AgentStateName =>
    ahead > 0 ? 'ready' : feature.planFirst ? 'plan-ready' : 'done';
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
