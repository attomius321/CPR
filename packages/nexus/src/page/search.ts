// The list's pure part (NX5, decisions 909, 910): the rows from the running Symbiotes, the pins
// and the repositories the nexus knows, in their groups and orders; the search over them, and
// where its words are in a row's words. The list's DOM is `list-view.ts`'s.
import type { Folder } from '../folders.js';
import type { Pin } from '../pins.js';
import type { Known } from '../repositories.js';
import type { Tab } from './tabs.js';

/** A row of the list: a repository (running or not), a pinned folder, or a pin whose folder is gone. */
export interface Row extends Pick<Folder, 'branch' | 'detached'> {
  name: string;
  /** Its folder: the row's key. */
  path: string;
  /** A repository; else a folder (a pinned one, or one listed while a path is typed). */
  repository: boolean;
  /** Its running Symbiote's tab. */
  tab?: Tab & { url: string };
  pinned?: true;
  /** A pin whose folder is gone. */
  missing?: true;
  /** The last time the nexus saw its Symbiote run (ISO). */
  opened?: string;
  /** The scan found it in the folder chosen. */
  found?: true;
}

export type GroupKey = 'running' | 'pinned' | 'opened' | 'found' | 'hits' | 'others';

export interface Group {
  key: GroupKey;
  name: string;
  /** How its rows are ordered, in words. */
  order: string;
  /** The rows drawn. */
  rows: Row[];
  /** The rows past the limit, not drawn (Found's). */
  rest: Row[];
  more: number;
  /** Its rows before a search. */
  all: number;
}

/** Found draws this many repositories at most: "and N more: type to find them". */
export const FOUND_LIMIT = 500;

const byName = (a: Row, b: Row) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path);
const byPath = (a: Row, b: Row) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** A path from home as `~/…`, any other as it is. */
export function shownPath(path: string, home: string): string {
  if (path === home) return '~';
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

const group = (
  key: GroupKey,
  name: string,
  order: string,
  rows: Row[],
  limit = Infinity,
): Group => ({
  key,
  name,
  order,
  rows: rows.slice(0, limit),
  rest: rows.slice(limit),
  more: Math.max(0, rows.length - limit),
  all: rows.length,
});

/**
 * The list's groups (decision 909): Running by name, as the tabs; Pinned (not running) by name,
 * folders and gone pins too; Opened before (not running, not pinned) last seen first; Found in the
 * folder scanned, the rest, by path, so worktrees sit by their repository. A repository is in one.
 */
export function groupsOf({
  tabs,
  pins,
  known,
  scanned,
  home,
}: {
  tabs: readonly Tab[];
  pins: readonly Pin[];
  known: readonly Known[];
  scanned: string | null;
  home: string;
}): Group[] {
  const pinned = new Set(pins.map((pin) => pin.path));
  const knownOf = new Map(known.map((k) => [k.path, k]));
  const running = tabs
    .filter((tab): tab is Tab & { url: string } => tab.url !== null)
    .map((tab): Row => {
      const opened = knownOf.get(tab.root)?.opened;
      return {
        name: tab.name,
        path: tab.root,
        repository: true,
        ...(tab.branch !== null ? { branch: tab.branch } : tab.head ? { detached: tab.head } : {}),
        tab,
        ...(pinned.has(tab.root) ? { pinned: true as const } : {}),
        ...(opened ? { opened } : {}),
      };
    })
    .sort(byName);
  const shown = new Set(running.map((row) => row.path));
  const pinnedRows = pins
    .filter((pin) => !shown.has(pin.path))
    .map((pin): Row => {
      const opened = knownOf.get(pin.path)?.opened;
      return {
        name: pin.name,
        path: pin.path,
        repository: pin.repository,
        ...(pin.repository ? checkout(pin) : {}),
        pinned: true,
        ...(pin.missing ? { missing: true as const } : {}),
        ...(opened ? { opened } : {}),
      };
    })
    .sort(byName);
  for (const row of pinnedRows) shown.add(row.path);
  const rowOf = (k: Known): Row => ({
    name: k.name,
    path: k.path,
    repository: true,
    ...checkout(k),
    ...(k.opened ? { opened: k.opened } : {}),
    ...(k.found ? { found: true as const } : {}),
  });
  const opened = known
    .filter((k) => k.opened && !shown.has(k.path))
    .map(rowOf)
    .sort((a, b) => (b.opened ?? '').localeCompare(a.opened ?? ''));
  for (const row of opened) shown.add(row.path);
  const found = known
    .filter((k) => k.found && !shown.has(k.path))
    .map(rowOf)
    .sort(byPath);
  return [
    group('running', 'Running', 'by name, as the tabs', running),
    group('pinned', 'Pinned', 'by name', pinnedRows),
    group('opened', 'Opened before', 'last opened first', opened),
    group(
      'found',
      scanned ? `Found in ${shownPath(scanned, home)}` : 'Found',
      'by path',
      found,
      FOUND_LIMIT,
    ),
  ];
}

const checkout = (from: Pick<Folder, 'branch' | 'detached'>) =>
  from.branch !== undefined
    ? { branch: from.branch }
    : from.detached !== undefined
      ? { detached: from.detached }
      : {};

/** The words of a search: lower case, none empty. */
const wordsOf = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * The groups with the rows whose path from home holds every word typed (decision 910), case
 * aside: a row whose name holds them all first, then the group's own order. Groups left empty go.
 */
export function searched(groups: readonly Group[], query: string, home: string): Group[] {
  const words = wordsOf(query);
  if (words.length === 0) return groups.filter((g) => g.rows.length > 0);
  const holds = (text: string) => {
    const lower = text.toLowerCase();
    return words.every((word) => lower.includes(word));
  };
  return groups
    .map((g) => {
      const hits = [...g.rows, ...g.rest].filter((row) => holds(shownPath(row.path, home)));
      const named = hits.filter((row) => holds(row.name));
      const ranked = [...named, ...hits.filter((row) => !named.includes(row))];
      const limit = g.key === 'found' ? FOUND_LIMIT : Infinity;
      return { ...group(g.key, g.name, g.order, ranked, limit), all: g.all };
    })
    .filter((g) => g.rows.length > 0);
}

/** Where each word of `query` is in `text`, case aside: [start, end) pairs, overlaps joined. */
export function marks(text: string, query: string): [number, number][] {
  const lower = text.toLowerCase();
  const found: [number, number][] = [];
  for (const word of wordsOf(query)) {
    for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + 1)) {
      found.push([at, at + word.length]);
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  const joined: [number, number][] = [];
  for (const [start, end] of found) {
    const last = joined.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else joined.push([start, end]);
  }
  return joined;
}

/** A folder listed while a path is typed, as a row: a repository with what the nexus knows of it. */
export function entryRow(
  folder: Folder,
  { tabs, pins, known }: { tabs: readonly Tab[]; pins: readonly Pin[]; known: readonly Known[] },
): Row {
  const tab = tabs.find(
    (t): t is Tab & { url: string } => t.url !== null && t.root === folder.path,
  );
  const k = known.find((other) => other.path === folder.path);
  return {
    name: folder.name,
    path: folder.path,
    repository: folder.repository,
    ...checkout(folder),
    ...(tab ? { tab } : {}),
    ...(pins.some((pin) => pin.path === folder.path) ? { pinned: true as const } : {}),
    ...(k?.opened ? { opened: k.opened } : {}),
    ...(k?.found ? { found: true as const } : {}),
  };
}
