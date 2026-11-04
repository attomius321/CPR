// A repository's checkouts (NX5, decision 914): its folder and its worktrees, as git keeps them in
// `.git/worktrees/*/gitdir`, read with no git process. Symbiote's own analysis worktrees live in
// its cache (25 of this repository's 26): the caller leaves that folder out.
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { checkoutOf, within } from './folders.js';
import type { Found } from './scan.js';

/** A file's first line, trimmed; null when it cannot be read. */
async function line(path: string): Promise<string | null> {
  try {
    return (await readFile(path, 'utf8')).split('\n')[0]?.trim() || null;
  } catch {
    return null;
  }
}

const isFolder = (path: string) =>
  stat(path).then(
    (stats) => stats.isDirectory(),
    () => false,
  );

/**
 * The repository's git folder shared by all its checkouts, and its main folder (none for a bare
 * one); null when `folder` holds no `.git`.
 */
async function commonOf(folder: string): Promise<{ common: string; main: string | null } | null> {
  const dotGit = join(folder, '.git');
  const stats = await stat(dotGit).catch(() => null);
  if (!stats) return null;
  if (stats.isDirectory()) return { common: dotGit, main: folder };
  // A worktree's `.git` file names its own git folder; that one's `commondir` the shared one.
  const named = /^gitdir:\s*(.+)$/m.exec(
    (await readFile(dotGit, 'utf8').catch(() => '')) ?? '',
  )?.[1];
  if (!named) return null;
  const own = resolve(folder, named.trim());
  const common = resolve(own, (await line(join(own, 'commondir'))) ?? '../..');
  return { common, main: basename(common) === '.git' ? dirname(common) : null };
}

/**
 * The checkouts of the repository `folder` is (its folder or one of its worktrees): its main
 * folder first, then its worktrees by path, each with what it has checked out. A worktree whose
 * folder is gone (pruned, or not yet) and any under `leaveOut` are left out. Null when `folder` is
 * no repository.
 */
export async function checkoutsOf(
  folder: string,
  { leaveOut = [] }: { leaveOut?: readonly string[] } = {},
): Promise<Found[] | null> {
  const repository = await commonOf(resolve(folder));
  if (!repository) return null;
  const worktrees: string[] = [];
  const names = await readdir(join(repository.common, 'worktrees')).catch(() => [] as string[]);
  await Promise.all(
    names.map(async (name) => {
      const gitFile = await line(join(repository.common, 'worktrees', name, 'gitdir'));
      if (!gitFile) return;
      const path = dirname(resolve(repository.common, 'worktrees', name, gitFile));
      if (leaveOut.some((out) => within(path, out))) return;
      if (await isFolder(path)) worktrees.push(path);
    }),
  );
  worktrees.sort();
  const main =
    repository.main !== null && (await isFolder(repository.main)) ? [repository.main] : [];
  return Promise.all(
    [...main, ...worktrees].map(async (path): Promise<Found> => ({
      name: basename(path),
      path,
      ...(await checkoutOf(path)),
    })),
  );
}
