// Paths typed into the list's field (NX5, decision 910): `~` or `/` first lists that folder's
// entries starting with what follows the last `/`; Tab completes, → goes in, Backspace right after
// a `/` goes up. Pure: the field's DOM is `list-view.ts`'s.
import type { Folder } from '../folders.js';

/** A typed path: the folder to list and the start of the name after the last `/`; null: a search. */
export function typedPath(input: string, home: string): { folder: string; prefix: string } | null {
  const text = input.trim();
  let path: string;
  if (text === '~') path = `${home}/`;
  else if (text.startsWith('~/')) path = `${home}${text.slice(1)}`;
  else if (text.startsWith('/')) path = text;
  else return null;
  const at = path.lastIndexOf('/');
  return { folder: path.slice(0, at) || '/', prefix: path.slice(at + 1) };
}

/**
 * The entries whose name starts with `prefix` (case aside), the others, and the hits' common
 * start, in the first hit's case.
 */
export function completion<T extends Pick<Folder, 'name'>>(
  entries: readonly T[],
  prefix: string,
): { hits: T[]; others: T[]; common: string } {
  const lower = prefix.toLowerCase();
  const hits = entries.filter((entry) => entry.name.toLowerCase().startsWith(lower));
  const others = entries.filter((entry) => !hits.includes(entry));
  let common = hits[0]?.name ?? '';
  for (const hit of hits) {
    while (!hit.name.toLowerCase().startsWith(common.toLowerCase())) common = common.slice(0, -1);
  }
  return { hits, others, common };
}

/** The input up to its last `/`. */
const base = (input: string) => input.slice(0, input.lastIndexOf('/') + 1);

/**
 * The input after Tab: the hits' common start filled in; one hit whole, a folder with its `/` (a
 * repository is the end of the way down, decision 554); as it was when there is nothing to add.
 */
export function completed(input: string, entries: readonly Folder[]): string {
  if (!input.includes('/')) return input;
  const prefix = input.slice(input.lastIndexOf('/') + 1);
  const { hits, common } = completion(entries, prefix);
  const [only] = hits;
  if (hits.length === 1 && only) return `${base(input)}${only.name}${only.repository ? '' : '/'}`;
  return common.length > prefix.length ? `${base(input)}${common}` : input;
}

/** The input after → or Enter on a folder: the folder whole, with its `/`. */
export function into(input: string, folder: Pick<Folder, 'name'>): string {
  return `${base(input)}${folder.name}/`;
}

/** The input after Backspace right after a `/`: the folder above; null when there is none. */
export function up(input: string): string | null {
  if (!input.endsWith('/')) return null;
  const folder = input.slice(0, -1);
  if (folder === '' || folder === '~') return null;
  const at = folder.lastIndexOf('/');
  return at < 0 ? null : folder.slice(0, at + 1);
}
