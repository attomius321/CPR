import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import { CprError } from '../errors.js';
import { git, GitError } from './exec.js';

export interface GitRepo {
  /** Absolute path of the working tree root. */
  readonly root: string;
  /** Absolute, real path of the git directory shared by all linked worktrees. */
  readonly commonDir: string;
  /** Stable, filesystem-safe ID for cache paths: `<folder name>-<hash of commonDir>`. */
  readonly id: string;
}

export async function openRepo(cwd: string): Promise<GitRepo> {
  let output: string;
  try {
    output = await git(cwd, [
      'rev-parse',
      '--path-format=absolute',
      '--show-toplevel',
      '--git-common-dir',
    ]);
  } catch (error) {
    if (error instanceof GitError)
      throw new CprError(`not inside a git working tree: ${cwd}`, { cause: error });
    throw error;
  }

  const [root, commonDir] = output.trimEnd().split('\n');
  if (!root || !commonDir) throw new Error(`unexpected git rev-parse output: ${output}`);

  const realCommonDir = await realpath(commonDir);
  const hash = createHash('sha256').update(realCommonDir).digest('hex').slice(0, 12);
  const name = basename(root).replace(/[^\w.-]/g, '_');
  return { root, commonDir: realCommonDir, id: `${name}-${hash}` };
}
