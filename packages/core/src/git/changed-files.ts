import { git } from './exec.js';
import type { GitRepo } from './repo.js';

export type FileChangeStatus =
  'added' | 'deleted' | 'modified' | 'renamed' | 'copied' | 'type-changed';

export interface ChangedFile {
  status: FileChangeStatus;
  /** Repo-relative POSIX path: in head, or in base for deleted files. */
  path: string;
  /** Path in base, for renamed and copied files. */
  previousPath?: string;
  /** Rename or copy similarity, 0–100. */
  similarity?: number;
}

/** Files that differ between two commits, with rename detection. */
export async function listChangedFiles(
  repo: GitRepo,
  from: string,
  to: string,
): Promise<ChangedFile[]> {
  const output = await git(repo.root, [
    'diff',
    '--name-status',
    '-z',
    '-M',
    '--no-color',
    '--no-ext-diff',
    '--no-relative',
    from,
    to,
    '--',
  ]);
  return parseNameStatus(output);
}

const STATUS: Record<string, FileChangeStatus> = {
  A: 'added',
  D: 'deleted',
  M: 'modified',
  R: 'renamed',
  C: 'copied',
  T: 'type-changed',
};

/** Parses `git diff --name-status -z` output: `<code>\0<path>\0` or `R<score>\0<old>\0<new>\0`. */
export function parseNameStatus(output: string): ChangedFile[] {
  const fields = output.split('\0');
  const files: ChangedFile[] = [];
  let i = 0;
  const next = () => {
    const field = fields[i++];
    if (field === undefined) throw new Error('truncated git diff --name-status output');
    return field;
  };

  while (i < fields.length) {
    const code = next();
    if (code === '') continue;
    const status = STATUS[code.charAt(0)];
    if (!status) throw new Error(`unexpected git diff status '${code}'`);

    if (status === 'renamed' || status === 'copied') {
      const previousPath = next();
      files.push({ status, path: next(), previousPath, similarity: Number(code.slice(1)) });
    } else {
      files.push({ status, path: next() });
    }
  }
  return files;
}
