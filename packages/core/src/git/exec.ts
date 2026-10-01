import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { CprError } from '../errors.js';

const execFileAsync = promisify(execFile);

export class GitError extends Error {
  override name = 'GitError';

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

/** Runs git in `cwd` and returns stdout. Messages are always in English, prompts are disabled. */
export async function git(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  } catch (error) {
    const { code, stderr, message } = error as {
      code?: unknown;
      stderr?: unknown;
      message: string;
    };
    if (code === 'ENOENT') {
      // Spawn reports a missing cwd and a missing git binary the same way.
      if (!existsSync(cwd)) throw new Error(`directory does not exist: ${cwd}`, { cause: error });
      throw new CprError('git is not installed or not on PATH', { cause: error });
    }
    throw new GitError(
      args,
      typeof code === 'number' ? code : null,
      typeof stderr === 'string' && stderr ? stderr : message,
      { cause: error },
    );
  }
}
