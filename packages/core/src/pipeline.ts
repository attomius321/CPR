import { resolve } from 'node:path';
import type { LanguageAdapter, LoadOptions } from './adapter.js';
import { diffSymbols, type SymbolChange } from './diff.js';
import { listChangedFilesInDirectories } from './fs-diff.js';
import { listChangedFiles, type ChangedFile } from './git/changed-files.js';
import { openRepo } from './git/repo.js';
import { resolveRevisions } from './git/revisions.js';
import { checkoutRevision } from './git/worktree.js';
import { typescriptAdapter } from './lang/typescript/index.js';
import { directorySource, type RevisionSource } from './revision.js';

/** What was compared. `sha` and `from` are null when comparing folders. */
export interface RevisionsInfo {
  base: { ref: string; sha: string | null; mergeBase: string | null };
  head: { ref: string; sha: string | null };
  from: string | null;
}

export interface Analysis {
  revisions: RevisionsInfo;
  files: ChangedFile[];
  changes: SymbolChange[];
}

export interface AnalyzeOptions extends LoadOptions {
  /** Default: the TypeScript adapter. */
  adapter?: LanguageAdapter;
}

export interface AnalyzeGitOptions extends AnalyzeOptions {
  cwd: string;
  base: string;
  head: string;
  /** Compare against merge-base(base, head). Default: true. */
  mergeBase?: boolean;
  /** Worktree cache root. Default: the platform cache folder. */
  cacheDir?: string;
}

/** Compares two git revisions of the repository containing `cwd`. */
export async function analyzeGit(options: AnalyzeGitOptions): Promise<Analysis> {
  const repo = await openRepo(options.cwd);
  const revisions = await resolveRevisions(repo, options.base, options.head, {
    ...(options.mergeBase === undefined ? {} : { mergeBase: options.mergeBase }),
  });
  const files = await listChangedFiles(repo, revisions.from, revisions.head.sha);
  if (!files.some((file) => isRelevant(file, options.adapter ?? typescriptAdapter))) {
    return { revisions, files, changes: [] };
  }

  const checkout = (sha: string, role: string) =>
    checkoutRevision(repo, sha, {
      role,
      ...(options.cacheDir === undefined ? {} : { cacheDir: options.cacheDir }),
    });
  const base = await checkout(revisions.from, 'base');
  try {
    const head = await checkout(revisions.head.sha, 'head');
    try {
      return { revisions, files, changes: await analyzeSources(base, head, files, options) };
    } finally {
      await head.dispose();
    }
  } finally {
    await base.dispose();
  }
}

/** Compares two folders, e.g. test fixtures. */
export async function analyzeDirectories(
  baseDir: string,
  headDir: string,
  options: AnalyzeOptions = {},
): Promise<Analysis> {
  const base = directorySource(baseDir);
  const head = directorySource(headDir);
  const files = await listChangedFilesInDirectories(base.root, head.root);
  return {
    revisions: {
      base: { ref: resolve(baseDir), sha: null, mergeBase: null },
      head: { ref: resolve(headDir), sha: null },
      from: null,
    },
    files,
    changes: await analyzeSources(base, head, files, options),
  };
}

async function analyzeSources(
  base: RevisionSource,
  head: RevisionSource,
  files: readonly ChangedFile[],
  { adapter = typescriptAdapter, ...load }: AnalyzeOptions,
): Promise<SymbolChange[]> {
  const relevant = files.filter((file) => isRelevant(file, adapter));
  if (relevant.length === 0) return [];

  const baseFiles = relevant.flatMap((file) =>
    file.status === 'added' || file.status === 'copied'
      ? []
      : [file.status === 'renamed' && file.previousPath ? file.previousPath : file.path],
  );
  const headFiles = relevant.filter((file) => file.status !== 'deleted').map((file) => file.path);
  const renames = new Map(
    relevant.flatMap((file) =>
      file.status === 'renamed' && file.previousPath
        ? [[file.previousPath, file.path] as const]
        : [],
    ),
  );

  // One side at a time keeps only one program in memory.
  const baseSymbols = adapter.extract(await adapter.load(base, load), baseFiles);
  const headSymbols = adapter.extract(await adapter.load(head, load), headFiles);
  return diffSymbols({ base: baseSymbols, head: headSymbols, renames });
}

function isRelevant(file: ChangedFile, adapter: LanguageAdapter): boolean {
  return (
    adapter.matches(file.path) ||
    (file.previousPath !== undefined && adapter.matches(file.previousPath))
  );
}
