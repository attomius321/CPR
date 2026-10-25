// The files a person gives with a brief (V40): kept in Symbiote's cache as uploads until a start
// moves them beside the workspace's record; removed with its worktree at Clean up.
import { randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type { WorkspaceDocument, WorkspaceRequest } from '@symbiote/core';
import type { ReviewPlace } from './reviews.js';
import { documentName, symbioteFolder, WorkspaceRefused } from './workspace-record.js';

/** Most files given with a brief (V40), the most one may weigh (V36's image limit), and all. */
export const MAX_DOCUMENTS = 20;
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_DOCUMENTS_BYTES = 100 * 1024 * 1024;

/** Uploads not started with within a week are removed when the next one is saved (V40). */
const UPLOADS_KEPT_MS = 7 * 24 * 3600 * 1000;

/** The names Symbiote gives the uploads it keeps: only those are ever removed. */
const UPLOAD = /^[0-9a-f]{32}$/;

/** `name`, or `name (2).ext`, `name (3).ext`… : the first not in `taken`, which then holds it. */
function freeName(name: string, taken: Set<string>): string {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let free = name;
  for (let n = 2; taken.has(free); n++) free = `${stem} (${n})${ext}`;
  taken.add(free);
  return free;
}

/** Where a workspace's documents go (V40): beside its record, the branch's slashes as folders. */
export const documentsDir = (where: ReviewPlace, branch: string) =>
  join(symbioteFolder(where), 'documents', ...branch.split('/'));

/**
 * Keeps a file for a workspace about to start (V40) in `uploads`, by an ID of its own, once the
 * uploads older than a week are removed: its ID, the name it will have, its size. Refuses one over
 * 20 MB (413).
 */
export async function saveUpload(
  uploads: string,
  name: string,
  bytes: Uint8Array,
  now: () => Date,
): Promise<WorkspaceDocument> {
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    throw new WorkspaceRefused(`a document of at most ${MAX_DOCUMENT_BYTES / 2 ** 20} MB`, 413);
  }
  await mkdir(uploads, { recursive: true, mode: 0o700 });
  await sweepUploads(uploads, now);
  const id = randomBytes(16).toString('hex');
  await writeFile(join(uploads, id), bytes, { mode: 0o600, flag: 'wx' });
  return { id, name: documentName(name), size: bytes.length };
}

/** Removes the uploads older than a week; only files Symbiote named. */
async function sweepUploads(uploads: string, now: () => Date): Promise<void> {
  const oldest = now().getTime() - UPLOADS_KEPT_MS;
  for (const name of await readdir(uploads).catch(() => [] as string[])) {
    if (!UPLOAD.test(name)) continue;
    const file = join(uploads, name);
    const info = await stat(file).catch(() => null);
    if (info && info.mtimeMs < oldest) await rm(file, { force: true });
  }
}

/**
 * A start's documents, checked before anything is made (V40): every upload still kept, none
 * twice, at most 20 and 100 MB in all; each with the name it will have.
 */
export async function uploadsOf(
  uploads: string,
  asked: WorkspaceRequest['documents'],
): Promise<{ from: string; name: string }[]> {
  if (!asked || asked.length === 0) return [];
  if (asked.length > MAX_DOCUMENTS) {
    throw new WorkspaceRefused(`at most ${MAX_DOCUMENTS} files with a brief`, 400);
  }
  const seen = new Set<string>();
  const kept: { from: string; name: string }[] = [];
  let total = 0;
  for (const { id, name } of asked) {
    if (!UPLOAD.test(id)) throw new WorkspaceRefused(`not a document: ${id}`, 400);
    const named = documentName(name);
    if (seen.has(id)) throw new WorkspaceRefused(`${named} is given twice`, 400);
    seen.add(id);
    const from = join(uploads, id);
    const info = await stat(from).catch(() => null);
    if (!info?.isFile()) {
      throw new WorkspaceRefused(`${named} is no longer kept: add it again`, 400);
    }
    total += info.size;
    kept.push({ from, name: named });
  }
  if (total > MAX_DOCUMENTS_BYTES) {
    throw new WorkspaceRefused(
      `at most ${MAX_DOCUMENTS_BYTES / 2 ** 20} MB of files with a brief`,
      400,
    );
  }
  return kept;
}

/** Moves a start's uploads into `folder` under their names, a taken one numbered; the names. */
export async function placeDocuments(
  folder: string,
  files: { from: string; name: string }[],
): Promise<string[]> {
  await mkdir(folder, { recursive: true });
  const taken = new Set<string>();
  const names: string[] = [];
  for (const { from, name } of files) {
    const to = join(folder, freeName(name, taken));
    try {
      await rename(from, to);
    } catch (error) {
      // The cache on another file system than the repository.
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await copyFile(from, to, fsConstants.COPYFILE_EXCL);
      await rm(from, { force: true });
    }
    names.push(basename(to));
  }
  return names;
}

/** Removes a workspace's documents, and the folders left empty above them up to `documents/`. */
export async function removeDocuments(where: ReviewPlace, branch: string): Promise<void> {
  const top = join(symbioteFolder(where), 'documents');
  let folder = documentsDir(where, branch);
  await rm(folder, { recursive: true, force: true });
  while (folder !== top && folder.startsWith(top)) {
    folder = dirname(folder);
    const removed = await rmdir(folder).then(
      () => true,
      () => false,
    );
    if (!removed) break;
  }
}
