// Starting and stopping `symbiote view` from the nexus (NX2, decisions 541–543). A start runs this
// checkout's CLI, `view --no-open`, in the folder asked for: detached, so it outlives the nexus,
// its output in `<cache>/nexus/<pid>.log` (a pipe would break once the nexus ends). It has started
// once its record says so (NX1's `running/<pid>.json`). A stop signals only a Symbiote whose record
// is live, as Ctrl+C does.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, renameSync, statSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { Logger } from '@symbiote/log';
import { readRecord, readRecords, type Running } from './registry.js';
import type { Probe } from './symbiotes.js';

type Env = Readonly<Record<string, string | undefined>>;

/** A start's answer: the Symbiote serving the folder, or why none does. */
export type StartAnswer = { symbiote: Running } | { error: string };

export interface Starter {
  /** Starts `symbiote view` in `folder`, unless a live one serves its repository already. */
  start(folder: string): Promise<StartAnswer>;
  /** Stops the live Symbiotes of `root`: false when none runs there. */
  stop(root: string): Promise<boolean>;
}

export interface StarterOptions {
  /** The cache the nexus reads: the started CLI's too (`env` names the same). */
  cache: string;
  /** The node that runs the CLI: the nexus's own. */
  node: string;
  /** The CLI's script, `packages/cli/dist/bin.js`. */
  script: string;
  env: Env;
  probe: Probe;
  /** The repository root a folder's Symbiote would serve; null outside one. */
  repositoryOf: (folder: string) => Promise<string | null>;
  /** How long a start may take, in ms (default 30 s; 216–223 ms measured). */
  timeout?: number;
  log?: Logger;
}

/** How often a start or a stop looks again. */
const POLL = 50;
/** How long a stop waits for the processes to end. */
const STOP_WAIT = 5000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function starter(options: StarterOptions): Starter {
  const { cache, probe, log } = options;
  const timeout = options.timeout ?? 30_000;
  const outputs = join(cache, 'nexus');

  /** The records of `root` whose process lives and whose server answers as a Symbiote. */
  async function live(root: string): Promise<Running[]> {
    const records = readRecords(cache).filter((record) => record.root === root);
    const checked = await Promise.all(
      records.map(async (record) =>
        probe.alive(record.pid) && (await probe.status(record.url)) ? record : null,
      ),
    );
    return checked
      .filter((record) => record !== null)
      .sort((a, b) => b.started.localeCompare(a.started));
  }

  /** The output of Symbiotes whose process is gone. */
  async function prune(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(outputs);
    } catch {
      return;
    }
    for (const name of names) {
      const pid = Number(/^(\d+)\.log$/.exec(name)?.[1]);
      if (Number.isInteger(pid) && !probe.alive(pid))
        await rm(join(outputs, name), { force: true });
    }
  }

  async function start(folder: string): Promise<StartAnswer> {
    if (!isAbsolute(folder)) return { error: `Not an absolute path: ${folder}` };
    const path = resolve(folder);
    try {
      if (!statSync(path).isDirectory()) return { error: `Not a folder: ${path}` };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return { error: code === 'ENOENT' ? `No such folder: ${path}` : (error as Error).message };
    }
    if (!existsSync(options.script)) {
      return { error: `symbiote is not built (${options.script}): run pnpm build` };
    }
    const root = await options.repositoryOf(path);
    const running = root === null ? undefined : (await live(root))[0];
    if (running) return { symbiote: running };

    await mkdir(outputs, { recursive: true });
    await prune();
    const temp = join(outputs, `starting-${process.pid}-${Date.now()}.log`);
    const out = openSync(temp, 'a');
    let child;
    try {
      child = spawn(options.node, [options.script, 'view', '--no-open'], {
        cwd: path,
        env: options.env,
        detached: true,
        stdio: ['ignore', out, out],
      });
    } finally {
      closeSync(out);
    }
    // Set by the child's events: why it ended before saying it runs.
    const end: { why: string | null } = { why: null };
    child.once('error', (error) => (end.why = error.message));
    child.once(
      'exit',
      (code, signal) => (end.why ??= `symbiote view exited with ${code ?? signal}`),
    );
    child.unref();
    const pid = child.pid;
    if (pid === undefined) {
      await sleep(0);
      return fail(path, end.why ?? 'symbiote view did not start');
    }
    const output = join(outputs, `${pid}.log`);
    renameSync(temp, output);

    const deadline = Date.now() + timeout;
    for (;;) {
      const record = readRecord(cache, pid);
      if (record) {
        log?.info({ root: record.root, pid, url: record.url }, 'symbiote started');
        return { symbiote: record };
      }
      if (end.why !== null) return fail(path, lastLine(output) ?? end.why);
      if (Date.now() >= deadline) {
        signal(pid);
        const last = lastLine(output);
        return fail(
          path,
          `symbiote view did not start within ${timeout / 1000} s${last ? `: ${last}` : ''}`,
        );
      }
      await sleep(POLL);
    }
  }

  function fail(folder: string, error: string): StartAnswer {
    log?.warn({ folder, error }, 'symbiote did not start');
    return { error };
  }

  async function stop(root: string): Promise<boolean> {
    const running = await live(root);
    if (running.length === 0) return false;
    for (const record of running) signal(record.pid);
    const deadline = Date.now() + STOP_WAIT;
    while (running.some((record) => probe.alive(record.pid))) {
      if (Date.now() >= deadline)
        throw new Error(`the Symbiote of ${root} did not stop within 5 s`);
      await sleep(POLL);
    }
    log?.info({ root, pids: running.map((record) => record.pid) }, 'symbiote stopped');
    return true;
  }

  return { start, stop };
}

/** What Ctrl+C sends: `symbiote view` removes its records and ends. */
function signal(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Ended already.
  }
}

/** The output's last line: the CLI's own error (`symbiote: …`) when it printed one. */
function lastLine(file: string): string | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return lines.findLast((line) => line.startsWith('symbiote:')) ?? lines.at(-1) ?? null;
}
