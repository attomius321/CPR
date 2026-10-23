// The files given with a brief on the start page (V40): pure helpers for the list, its limits and
// what the draft keeps. Each file is uploaded when added (`/api/workspaces/documents`) and moved
// beside the workspace's record when it starts.
import type { WorkspaceOptions } from '@symbiote/core';

/** A file on the start page's list: on its way, kept by `symbiote view` (its `id`), or not. */
export interface DocumentEntry {
  /** Its row's and its upload's: two files of one name are two entries. */
  key: string;
  name: string;
  size: number;
  state: 'uploading' | 'kept' | 'failed';
  id?: string;
  /** Why it was not added. */
  error?: string;
}

type Limits = Pick<WorkspaceOptions['documents'], 'maxFiles' | 'maxBytes' | 'maxTotal'>;

const UPLOAD = /^[0-9a-f]{32}$/;

/** The documents the draft kept (V24c's draft): each already uploaded; anything else is none. */
export function readDocuments(draft: unknown): DocumentEntry[] {
  const listed = (draft as { documents?: unknown } | null)?.documents;
  if (!Array.isArray(listed)) return [];
  const entries: DocumentEntry[] = [];
  for (const item of listed as unknown[]) {
    const { id, name, size } = (item ?? {}) as { id?: unknown; name?: unknown; size?: unknown };
    if (typeof id !== 'string' || !UPLOAD.test(id) || typeof name !== 'string') continue;
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) continue;
    entries.push({ key: id, name, size, state: 'kept', id });
  }
  return entries;
}

/** What a paste carries, as the page reads it. */
interface Clipboard {
  getData(type: string): string;
  files: ArrayLike<File>;
}

/**
 * The files a paste gives with the brief: the clipboard's, of any kind, unless it holds text,
 * which pastes as text (V36's rule: a copied spreadsheet range carries an image too).
 */
export function pastedFiles(clipboard: Clipboard | null): File[] {
  if (!clipboard || clipboard.getData('text/plain') !== '') return [];
  return Array.from(clipboard.files);
}

let added = 0;

/**
 * The list with `files` added in their order: each to upload, or not added and why — larger
 * than a file may be, one more than the files allowed, or more than all may weigh. Files not
 * added count for nothing.
 */
export function addDocuments(
  listed: readonly DocumentEntry[],
  files: readonly { name: string; size: number }[],
  { maxFiles, maxBytes, maxTotal }: Limits,
): DocumentEntry[] {
  const next = [...listed];
  const active = () => next.filter((d) => d.state !== 'failed');
  for (const file of files) {
    added += 1;
    const entry: DocumentEntry = {
      key: `added-${added}`,
      name: file.name,
      size: file.size,
      state: 'uploading',
    };
    const total = active().reduce((sum, d) => sum + d.size, 0) + file.size;
    const error =
      file.size > maxBytes
        ? `Larger than ${documentSize(maxBytes)}.`
        : active().length + 1 > maxFiles
          ? `More than ${maxFiles} files.`
          : total > maxTotal
            ? `More than ${documentSize(maxTotal)} in all.`
            : undefined;
    next.push(error ? { ...entry, state: 'failed', error } : entry);
  }
  return next;
}

/** Why Start waits for the documents, or null: one not added is the person's to remove. */
export function documentsBlocking(entries: readonly DocumentEntry[]): string | null {
  const failed = entries.find((d) => d.state === 'failed');
  if (failed) return `${failed.name} was not added: remove it to start.`;
  return entries.some((d) => d.state === 'uploading') ? 'A file is being added.' : null;
}

/** The documents a start names, as kept. */
export function keptDocuments(entries: readonly DocumentEntry[]): { id: string; name: string }[] {
  return entries.flatMap((d) => (d.state === 'kept' && d.id ? [{ id: d.id, name: d.name }] : []));
}

/** A file's size as a person reads it: bytes, KB or MB, one decimal under 10. */
export function documentSize(bytes: number): string {
  const [value, unit] =
    bytes < 1024
      ? [bytes, 'B']
      : bytes < 1024 ** 2
        ? [bytes / 1024, 'KB']
        : [bytes / 1024 ** 2, 'MB'];
  const shown = value < 10 ? Number(value.toFixed(1)) : Math.round(value);
  return `${shown} ${unit}`;
}
