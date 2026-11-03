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

/** A changed file with its blob: the head's, the base's for a deleted file (V90). */
export type ChangedBlob = ChangedFile & { blob: string };

/**
 * `listChangedFiles`' files, each with its blob (`git diff --raw`): what a file's "viewed" mark
 * is kept against (V90, decision 843), so a file changed since shows unviewed again.
 */
export async function listChangedBlobs(
  repo: GitRepo,
  from: string,
  to: string,
): Promise<ChangedBlob[]> {
  const output = await git(repo.root, [
    'diff',
    '--raw',
    '--no-abbrev',
    '-z',
    '-M',
    '--no-color',
    '--no-ext-diff',
    '--no-relative',
    from,
    to,
    '--',
  ]);
  return parseRaw(output);
}

/**
 * Parses `git diff --raw --no-abbrev -z`: `:<mode> <mode> <blob> <blob> <code>\0<path>\0`, or for a
 * rename or copy `…R<score>\0<old>\0<new>\0`.
 */
export function parseRaw(output: string): ChangedBlob[] {
  const fields = output.split('\0');
  const files: ChangedBlob[] = [];
  let i = 0;
  const next = () => {
    const field = fields[i++];
    if (field === undefined) throw new Error('truncated git diff --raw output');
    return field;
  };
  while (i < fields.length) {
    const record = next();
    if (record === '') continue;
    const match = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) ([A-Z])(\d*)$/.exec(record);
    const status = match && STATUS[match[3] ?? ''];
    if (!match || !status) throw new Error(`unexpected git diff --raw record '${record}'`);
    const [, before = '', after = '', , score = ''] = match;
    const blob = status === 'deleted' ? before : after;
    if (status === 'renamed' || status === 'copied') {
      const previousPath = next();
      files.push({ status, path: next(), previousPath, similarity: Number(score), blob });
    } else {
      files.push({ status, path: next(), blob });
    }
  }
  return files;
}

/** A file's lines added and removed (V29d); null for a binary file. */
export interface LineCount {
  /** Repo-relative POSIX path: in `to`, or in `from` for a deleted file. */
  path: string;
  /** Path in `from`, for renamed and copied files. */
  previousPath?: string;
  added: number | null;
  removed: number | null;
}

/**
 * Lines added and removed per file between two commits, with rename detection; without `to`,
 * between `from` and the working copy at `repo.root` (tracked files only).
 */
export async function listLineCounts(
  repo: GitRepo,
  from: string,
  to?: string,
): Promise<LineCount[]> {
  const output = await git(repo.root, [
    'diff',
    '--numstat',
    '-z',
    '-M',
    '--no-color',
    '--no-ext-diff',
    '--no-relative',
    from,
    ...(to === undefined ? [] : [to]),
    '--',
  ]);
  return parseNumstat(output);
}

/**
 * Parses `git diff --numstat -z`: `<added>\t<removed>\t<path>\0`, or for a rename
 * `<added>\t<removed>\t\0<old>\0<new>\0`; `-` for both counts of a binary file.
 */
export function parseNumstat(output: string): LineCount[] {
  const fields = output.split('\0');
  const counts: LineCount[] = [];
  for (let i = 0; i < fields.length; i++) {
    const record = fields[i] ?? '';
    if (record === '') continue;
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(record);
    if (!match) throw new Error(`unexpected git diff --numstat record '${record}'`);
    const [, added = '', removed = '', path = ''] = match;
    const lines = {
      added: added === '-' ? null : Number(added),
      removed: removed === '-' ? null : Number(removed),
    };
    if (path !== '') {
      counts.push({ path, ...lines });
      continue;
    }
    const previousPath = fields[++i];
    const next = fields[++i];
    if (previousPath === undefined || next === undefined) {
      throw new Error('truncated git diff --numstat output');
    }
    counts.push({ path: next, previousPath, ...lines });
  }
  return counts;
}

/**
 * Each of `shas`' lines added and removed against its first parent (V92: a Hive round's writer),
 * binary files left out; a merge commit counts none. One `git log --no-walk` for them all.
 */
export async function commitLineCounts(
  repo: GitRepo,
  shas: readonly string[],
): Promise<Map<string, { added: number; removed: number }>> {
  const counts = new Map<string, { added: number; removed: number }>();
  if (shas.length === 0) return counts;
  const output = await git(repo.root, [
    'log',
    '--no-walk=unsorted',
    '--numstat',
    '--no-color',
    '--no-ext-diff',
    '--no-renames',
    '--format=%x1e%H',
    ...shas,
    '--',
  ]);
  for (const block of output.split('\x1e')) {
    const [sha, ...lines] = block.split('\n');
    if (!sha) continue;
    let added = 0;
    let removed = 0;
    for (const line of lines) {
      const [a, r] = line.split('\t');
      if (!a || !r || a === '-' || r === '-') continue;
      added += Number(a);
      removed += Number(r);
    }
    counts.set(sha.trim(), { added, removed });
  }
  return counts;
}
