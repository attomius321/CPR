// How the CLI runs other programs: without a shell, with what they wrote (`runProgram`), with
// input on their stdin (`runWithInput`), or through the shell as a terminal would (`runShell`).
import { spawn } from 'node:child_process';

/** A program's run: its exit code (null when it could not start) and what it wrote. */
export type Run = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

/** How long a program's output may close after it exits, at most: a service it starts may hold it.
 * */
const OUTPUT_AFTER_EXIT_MS = 1_000;

/**
 * Runs a program without a shell; resolves once its output has closed, with all it wrote — its
 * exit can come first: under load, Codex's `app-server daemon start` had answered 0 of its 252
 * bytes when its exit was taken. A background service the program starts may keep its output
 * open: then it resolves `OUTPUT_AFTER_EXIT_MS` after the exit, with what it wrote by then.
 */
export const runProgram: Run = (command, args, { cwd, timeoutMs }) =>
  new Promise((done) => {
    let stdout = '';
    let stderr = '';
    let answered = false;
    let afterExit: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const answer = (result: { code: number | null; stdout: string; stderr: string }) => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      clearTimeout(afterExit);
      done(result);
    };
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error) => answer({ code: null, stdout, stderr: error.message }));
    child.on('close', (code) => answer({ code, stdout, stderr }));
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (answered) return;
      // Held by a service it started: its pipes stay open (closed, its next write would kill it).
      afterExit = setTimeout(() => answer({ code, stdout, stderr }), OUTPUT_AFTER_EXIT_MS);
    });
  });

/**
 * Runs a program with `input` on its stdin, without a shell; resolves when it exits. `onLine`:
 * each line of its stdout as it comes (V46b).
 */
export type RunWithInput = (
  command: string,
  args: string[],
  options: { cwd: string; input: string; timeoutMs: number; onLine?: (line: string) => void },
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

export const runWithInput: RunWithInput = (command, args, { cwd, input, timeoutMs, onLine }) =>
  new Promise((done) => {
    let stdout = '';
    let stderr = '';
    let line = '';
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      if (!onLine) return;
      const lines = (line + chunk).split('\n');
      line = lines.pop() ?? '';
      for (const each of lines) onLine(each);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      done({ code: null, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (line !== '') onLine?.(line);
      done({ code, stdout, stderr });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });

/**
 * Runs one check command in `cwd` through the shell: its exit code and what it wrote, and what it
 * writes as it comes (`onOutput`, V46a).
 */
export type RunCheck = (
  command: string,
  cwd: string,
  onOutput?: (chunk: string) => void,
) => Promise<{ code: number | null; output: string }>;

/** A check may take long (this repository's check, build and e2e: about 2.5 min). */
const CHECK_TIMEOUT_MS = 60 * 60_000;

/** The shell's run of a command, its output and errors together, as a terminal shows them. */
export const runShell: RunCheck = (command, cwd, onOutput) =>
  new Promise((done) => {
    let output = '';
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const timer = setTimeout(() => child.kill(), CHECK_TIMEOUT_MS);
    const keep = (chunk: string) => {
      onOutput?.(chunk);
      output += chunk;
      // Only the end is kept: a check can write megabytes.
      if (output.length > 1_000_000) output = output.slice(-200_000);
    };
    child.stdout.setEncoding('utf8').on('data', keep);
    child.stderr.setEncoding('utf8').on('data', keep);
    child.on('error', (error) => {
      clearTimeout(timer);
      onOutput?.(`${error.message}\n`);
      done({ code: null, output: `${output}${error.message}\n` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, output });
    });
  });

/** A command running in a process group of its own (HV2): its leader's pid, its end, and a stop. */
export interface GroupRun {
  pid: number | undefined;
  /** Its exit code (null when it could not start, or was killed) and its output's end. */
  done: Promise<{ code: number | null; output: string }>;
  /** Ends the whole group: SIGTERM, then SIGKILL after `graceMs`. */
  kill(graceMs?: number): void;
}

/** Starts a command in a process group of its own, `runShell`'s way. */
export type RunGroup = (command: string, cwd: string) => GroupRun;

/**
 * Runs a command through the shell in a process group of its own (HV2, decision 654): Hive's
 * check, which Hive off or a resume after a killed `symbiote view` ends whole, its children
 * (`pnpm`, `vitest`, a browser) with it. The output's end is kept, as `runShell` keeps it.
 */
export const runGroup: RunGroup = (command, cwd) => {
  let output = '';
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const kill = (graceMs = 3_000) => {
    if (child.pid === undefined) return;
    killGroup(child.pid, 'SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null)
        killGroup(child.pid ?? 0, 'SIGKILL');
    }, graceMs).unref();
  };
  const timer = setTimeout(() => kill(), CHECK_TIMEOUT_MS);
  const keep = (chunk: string) => {
    output += chunk;
    if (output.length > 1_000_000) output = output.slice(-200_000);
  };
  child.stdout.setEncoding('utf8').on('data', keep);
  child.stderr.setEncoding('utf8').on('data', keep);
  const done = new Promise<{ code: number | null; output: string }>((resolve) => {
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, output: `${output}${error.message}\n` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
  return { pid: child.pid, done, kill };
};

/**
 * Sends `signal` to the process group `pid` leads (a `runGroup` run, perhaps one a killed process
 * started); false when there is none. On Windows, where there are no groups, the process alone.
 */
export function killGroup(pid: number, signal: NodeJS.Signals): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal);
    return true;
  } catch {
    return false;
  }
}
