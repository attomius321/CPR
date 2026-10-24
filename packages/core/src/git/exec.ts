import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { SymbioteError } from '../errors.js';

const execFileAsync = promisify(execFile);

export class GitError extends Error {
  override name = 'GitError';
  /** What git wrote to stdout before failing (some commands answer there with exit 1). */
  stdout = '';

  constructor(
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string,
    options?: ErrorOptions,
  ) {
    super(
      `git ${args.join(' ')} failed${exitCode === null ? '' : ` (exit ${exitCode})`}: ${stderr.trim()}`,
      options,
    );
  }
}

/**
 * git's environment: messages in English, no prompts, and no optional lock. Symbiote reads working
 * trees the person and agents work in, on its own schedule; `git status` would otherwise rewrite
 * their index under `index.lock`, and a `git add` or `git commit` made then fails ("index.lock:
 * File exists"). Writes still take the locks they need.
 */
const gitEnv = () => ({
  ...process.env,
  LC_ALL: 'C',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
});

/** Runs git in `cwd` and returns stdout, in {@link gitEnv}'s environment. */
export async function git(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      env: gitEnv(),
    });
    return stdout;
  } catch (error) {
    throw failure(error, cwd, args);
  }
}

/** As {@link git}, its stdout as bytes: a file as git gives it, a binary one too (V43). */
export async function gitBytes(cwd: string, args: readonly string[]): Promise<Buffer> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'buffer',
      maxBuffer: 256 * 1024 * 1024,
      env: gitEnv(),
    });
    return stdout;
  } catch (error) {
    throw failure(error, cwd, args);
  }
}

/** What a failed run of git throws: why it did not start, else a {@link GitError}. */
function failure(error: unknown, cwd: string, args: readonly string[]): Error {
  const { code, stdout, stderr, message } = error as {
    code?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    message: string;
  };
  if (code === 'ENOENT') {
    // Spawn reports a missing cwd and a missing git binary the same way.
    if (!existsSync(cwd)) return new Error(`directory does not exist: ${cwd}`, { cause: error });
    return new SymbioteError('git is not installed or not on PATH', { cause: error });
  }
  const text = (value: unknown) => (Buffer.isBuffer(value) ? value.toString('utf8') : value);
  const words = text(stderr);
  const failed = new GitError(
    args,
    typeof code === 'number' ? code : null,
    typeof words === 'string' && words ? words : message,
    { cause: error },
  );
  const out = text(stdout);
  if (typeof out === 'string') failed.stdout = out;
  return failed;
}

/**
 * Runs git in `cwd` and hands its stdout to `onData` as it comes, for output too long to wait
 * for (a whole history). Resolves when git exits; rejects as `git` does.
 */
export function gitStream(
  cwd: string,
  args: readonly string[],
  onData: (chunk: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: gitEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', onData);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') return reject(error);
      if (!existsSync(cwd)) reject(new Error(`directory does not exist: ${cwd}`, { cause: error }));
      else reject(new SymbioteError('git is not installed or not on PATH', { cause: error }));
    });
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new GitError(args, code, stderr || 'git failed')),
    );
  });
}

/**
 * Runs git in `cwd` with `input` on its stdin and returns stdout as bytes: the batch commands
 * (`cat-file --batch`, `check-attr --stdin`) that read many objects or paths in one process (RM1).
 */
export function gitInput(cwd: string, args: readonly string[], input: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env: gitEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    // git may exit before reading all of its input (a bad argument): its exit code says why.
    child.stdin.on('error', () => {});
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') return reject(error);
      if (!existsSync(cwd)) reject(new Error(`directory does not exist: ${cwd}`, { cause: error }));
      else reject(new SymbioteError('git is not installed or not on PATH', { cause: error }));
    });
    child.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new GitError(args, code, stderr || 'git failed')),
    );
    child.stdin.end(input);
  });
}
