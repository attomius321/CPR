// The files a diff in VS Code's diff editor is opened with (V43, V70): a commit's file or the
// index's, kept read-only in Symbiote's cache, and an empty one for the side with no file.
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileForCheckout, fileInIndex, type GitRepo } from '@symbiote/core';

/**
 * A commit's file kept for a diff (V43): written the first time, as a checkout in `checkout`
 * writes it, and read-only; null when the commit has no file there.
 */
export async function keptFile(
  revisions: string,
  checkout: GitRepo,
  sha: string,
  path: string,
): Promise<string | null> {
  const file = join(revisions, sha, ...path.split('/'));
  if (existsSync(file)) return file;
  const bytes = await fileForCheckout(checkout, sha, path);
  return bytes && keep(file, bytes);
}

/**
 * The index's file kept for a diff (V70), by its blob: a staged change's right side, a change not
 * staged's left. Null when the index has none at `path`.
 */
export async function keptIndexFile(
  revisions: string,
  checkout: GitRepo,
  path: string,
): Promise<string | null> {
  const entry = await fileInIndex(checkout, path);
  if (!entry) return null;
  const file = join(revisions, 'index', entry.object, ...path.split('/'));
  return existsSync(file) ? file : keep(file, await entry.read());
}

/** An empty file by that name: the side of a diff with no file. */
export const emptyFile = (revisions: string, path: string) =>
  keep(join(revisions, 'empty', ...path.split('/')), new Uint8Array());

/** Writes a read-only file once: to a name of its own, then renamed (two clicks at once). */
async function keep(file: string, bytes: Uint8Array): Promise<string> {
  if (existsSync(file)) return file;
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomBytes(4).toString('hex')}`;
  await writeFile(temporary, bytes, { mode: 0o444 });
  try {
    await rename(temporary, file);
  } catch (error) {
    // Windows does not rename onto a file: the other click's copy is the same.
    await rm(temporary, { force: true });
    if (!existsSync(file)) throw error;
  }
  return file;
}

/** Whether `path` is a file. */
export const isFile = (path: string) =>
  stat(path).then(
    (s) => s.isFile(),
    () => false,
  );
