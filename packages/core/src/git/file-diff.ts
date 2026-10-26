import type { ChangedFile } from './changed-files.js';
import { git } from './exec.js';
import type { GitRepo } from './repo.js';

/**
 * A changed file of a graph with git's lines (V60, `GET ./api/files`): the Files page's list.
 * `binary` where git counts no lines.
 */
export type ReviewFile = ChangedFile & {
  ignored?: true;
  added?: number;
  removed?: number;
  binary?: true;
};

/**
 * One changed file's diff between two commits as git gives it (V60): the whole file as context,
 * so its one hunk has every line, the unchanged ones too; a rename from its old path. Counted by
 * the same rules as `listLineCounts`, so the lines a list shows are the ones this diff shows.
 * Empty when the commits do not differ in it.
 */
export function fileDiff(
  repo: GitRepo,
  from: string,
  to: string,
  file: Pick<ChangedFile, 'path' | 'previousPath'>,
): Promise<string> {
  return git(repo.root, [
    '-c',
    'core.quotePath=false',
    'diff',
    // The largest context git takes: one hunk, the whole file.
    '--unified=2147483647',
    '-M',
    '--no-color',
    '--no-ext-diff',
    '--no-relative',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    from,
    to,
    '--',
    ...(file.previousPath && file.previousPath !== file.path ? [file.previousPath] : []),
    file.path,
  ]);
}
