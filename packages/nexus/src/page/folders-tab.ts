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

/** What a repository has checked out (decision 548): its branch, the commit it is detached at, or null. */
export function checkoutWords(folder: Folder): string | null {
  if (folder.branch !== undefined) return folder.branch;
  return folder.detached === undefined ? null : `detached at ${folder.detached.slice(0, 7)}`;
}

/** The repositories of a listing that no Symbiote serves: Symbiotes' "Repositories in" (NX3). */
export function idleRepositories(
  folders: readonly Folder[],
  running: ReadonlySet<string>,
): Folder[] {
  return folders.filter((folder) => folder.repository && !running.has(folder.path));
}

/** A listing's counts, at its card's head: "16 repositories · 30 folders". */
export function countsText(folders: readonly Folder[]): string {
  const repositories = folders.filter((folder) => folder.repository).length;
  const others = folders.length - repositories;
  return [
    repositories > 0 ? `${repositories} ${repositories === 1 ? 'repository' : 'repositories'}` : '',
    others > 0 ? `${others} ${others === 1 ? 'folder' : 'folders'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** An item's box on the page, as `getBoundingClientRect` gives it. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where an arrow key moves on Folders' cards and rows, in reading order (`boxes`): → and ← the
 * next and the previous, ↓ and ↑ the nearest in the line under or over, Home and End the ends;
 * null to stay.
 */
export function nextOnGrid(boxes: readonly Box[], at: number, key: string): number | null {
  const here = boxes[at];
  if (!here) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return boxes.length - 1;
  if (key === 'ArrowRight') return at + 1 < boxes.length ? at + 1 : null;
  if (key === 'ArrowLeft') return at > 0 ? at - 1 : null;
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return null;
  const down = key === 'ArrowDown';
  const middle = (box: Box) => box.top + box.height / 2;
  const others = boxes
    .map((box, index) => ({ box, index }))
    .filter(({ box }) => (down ? middle(box) > middle(here) + 1 : middle(box) < middle(here) - 1));
  if (others.length === 0) return null;
  // The line under (over): the items whose top is the nearest one's, within 2 px.
  const lineTop = down
    ? Math.min(...others.map(({ box }) => box.top))
    : Math.max(...others.map(({ box }) => box.top));
  const centre = (box: Box) => box.left + box.width / 2;
  let best: { index: number; distance: number } | null = null;
  for (const { box, index } of others) {
    if (Math.abs(box.top - lineTop) > 2) continue;
    const distance = Math.abs(centre(box) - centre(here));
    if (best === null || distance < best.distance) best = { index, distance };
  }
  return best?.index ?? null;
}

/** The folders past the listing's cap. */
export function moreText(more: number): string {
  return `and ${more.toLocaleString('en')} more ${more === 1 ? 'folder' : 'folders'}`;
}
