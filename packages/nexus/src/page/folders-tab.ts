// The folders' pure part (NX2b, decisions 539, 540), under Symbiotes since decision 626: their place
// in the address, the crumbs of a folder, what a typed folder is and the words; since NX3 a
// repository's card, the counts and the arrows on a grid; since NX4 the pins' names. Their DOM is
// `folders-view.ts`'s.
import type { Folder, Place } from '../folders.js';
import type { Pin } from '../pins.js';

/**
 * The folder browsed in the address, `#folders:<path>` (Folders' tab before decision 626): a
 * Symbiote's tab is its root, always absolute.
 */
export const FOLDERS = 'folders';

/** The address's hash for Symbiotes with a folder browsed. */
export function foldersHash(path: string | null): string {
  return path === null ? '#folders' : `#folders:${encodeURIComponent(path)}`;
}

/** The folder browsed in the address's hash; null for none (or a Symbiote's tab). */
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

/** What a repository has checked out (decision 555): its branch, the commit it is detached at, or null. */
export function checkoutWords(folder: Pick<Folder, 'branch' | 'detached'>): string | null {
  if (folder.branch !== undefined) return folder.branch;
  return folder.detached === undefined ? null : `detached at ${folder.detached.slice(0, 7)}`;
}

/** A listing's counts, at its card's head: "16 repositories · 30 folders". */
export function countsText(folders: readonly Folder[]): string {
  const repositories = folders.filter((folder) => folder.repository).length;
  const others = folders.length - repositories;
  const count = (n: number, one: string, many: string) =>
    n > 0 ? `${n.toLocaleString('en')} ${n === 1 ? one : many}` : '';
  return [count(repositories, 'repository', 'repositories'), count(others, 'folder', 'folders')]
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

/**
 * Each pin's name in the places card (NX4): its folder's, and for two of one name their parent's
 * too ("Symbiote · Symbiote.worktrees"), or the parent's path when those are alike as well.
 */
export function pinNames(pins: readonly Pin[]): string[] {
  const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';
  const lastOf = (path: string) => path.split('/').filter(Boolean).at(-1) ?? '/';
  const count = <T>(items: readonly T[], item: T) => items.filter((other) => other === item).length;
  const names = pins.map((pin) => pin.name);
  const near = pins.map((pin) => `${pin.name} · ${lastOf(parentOf(pin.path))}`);
  return pins.map((pin, at) => {
    const name = names[at] ?? pin.name;
    if (count(names, name) === 1) return name;
    const withParent = near[at] ?? name;
    return count(near, withParent) === 1 ? withParent : `${pin.name} · ${parentOf(pin.path)}`;
  });
}

/** The places the nexus found, but a running Symbiote's folder that is pinned: drawn as the pin. */
export function placesShown(places: readonly Place[], pins: readonly Pin[]): Place[] {
  const pinned = new Set(pins.map((pin) => pin.path));
  return places.filter((place) => place.kind !== 'symbiotes' || !pinned.has(place.path));
}

/**
 * The pins drawn under the places: the folders, and the pins whose folder is gone. A pinned
 * repository is a card among the Symbiotes (decision 628).
 */
export function pinnedPlaces(pins: readonly Pin[]): Pin[] {
  return pins.filter((pin) => !pin.repository);
}

/** Whether the folder listed takes a pin: not home, the top or a drive, always places (decision 620). */
export function pinnable(answer: { path: string; places: readonly Place[] }): boolean {
  return !answer.places.some((place) => place.kind !== 'symbiotes' && place.path === answer.path);
}
