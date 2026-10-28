// The Folders tab's pure part (NX2b, decisions 539, 540): its place in the address, the crumbs of a
// folder, what a typed folder is, a row's action and the words. Its DOM is `folders-view.ts`'s.
import type { Folder, Place } from '../folders.js';

/** The Folders tab's key in the page's selection: a Symbiote's tab is its root, always absolute. */
export const FOLDERS = 'folders';

/** The address's hash for the Folders tab, with the folder shown. */
export function foldersHash(path: string | null): string {
  return path === null ? '#folders' : `#folders:${encodeURIComponent(path)}`;
}

/** The folder in the address's hash of the Folders tab; null for none (or another tab). */
export function folderFromHash(hash: string): string | null {
  const text = /^#folders:(.+)$/.exec(hash)?.[1];
  if (text === undefined) return null;
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/** A step of a folder's path: its name, and the folder it opens. */
export interface Crumb {
  name: string;
  path: string;
}

/** A folder's path as crumbs: from home or a drive when it is in one, else from the top. */
export function crumbsOf(path: string, places: readonly Place[]): Crumb[] {
  const under = (root: string) => path === root || path.startsWith(`${root}/`);
  const start = places
    .filter((place) => (place.kind === 'home' || place.kind === 'drive') && under(place.path))
    .sort((a, b) => b.path.length - a.path.length)[0] ?? { name: '/', path: '/' };
  const crumbs: Crumb[] = [{ name: start.name, path: start.path }];
  let at = start.path === '/' ? '' : start.path;
  for (const name of path.slice(at.length).split('/')) {
    if (name === '') continue;
    at = `${at}/${name}`;
    crumbs.push({ name, path: at });
  }
  return crumbs;
}

/** A typed or pasted folder: a full path (`~` is home), as the server takes it; null otherwise. */
export function typedFolder(input: string, home: string): string | null {
  const text = input.trim();
  if (text === '~') return home;
  if (text.startsWith('~/')) return `${home}/${text.slice(2)}`;
  return text.startsWith('/') ? text : null;
}

/** What a row offers: a repository opens its Symbiote, or shows the one that runs; a folder, none. */
export function actionOf(folder: Folder, running: ReadonlySet<string>): 'open' | 'show' | null {
  if (!folder.repository) return null;
  return running.has(folder.path) ? 'show' : 'open';
}

/** The folders past the listing's cap. */
export function moreText(more: number): string {
  return `and ${more.toLocaleString('en')} more ${more === 1 ? 'folder' : 'folders'}`;
}
