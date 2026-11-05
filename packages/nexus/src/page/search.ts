// The list's pure part (NX5, decisions 909, 910; NX6, 926): the rows from the running Symbiotes,
// the pins, the repositories the nexus knows and home's tree, in their groups and orders; the
// search over them, and where its words are in a row's words. The list's DOM is `list-view.ts`'s.
import type { Folder } from '../folders.js';
import type { Pin } from '../pins.js';
import type { Known } from '../repositories.js';
import type { Tab } from './tabs.js';
import type { ShownFolder } from './tree.js';

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
  /** The scan found it in home. */
  found?: true;
  /** A row of home's tree (decision 926): its depth, 0 for home's own folders. */
  depth?: number;
  /** A tree's folder opened, its folders shown under it. */
  open?: boolean;
  /** A tree's folder holding no folder; null while that is unknown. */
  leaf?: boolean | null;
}

export type GroupKey = 'running' | 'pinned' | 'opened' | 'home' | 'hits' | 'others';

export interface Group {
  key: GroupKey;
  name: string;
  /** How its rows are ordered, in words. */
  order: string;
  /** The rows drawn. */
  rows: Row[];
  /** The rows past the limit, not drawn (Home's, searched). */
  rest: Row[];
  more: number;
  /** Its rows before a search. */
  all: number;
}

/** Home, searched, draws this many folders at most: "and N more: type to find them". */
export const HOME_LIMIT = 500;

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
 * The list's groups (decisions 909, 926): Running by name, as the tabs; Pinned (not running) by
 * name, folders and gone pins too; Opened before (not running, not pinned) last seen first; then
 * Home, `tree`'s rows: as a tree, each folder in its place (a running one too); `flat` (searched),
 * by path, none shown above, 500 drawn. A repository is in one group above Home.
 */
export function groupsOf({
  tabs,
  pins,
  known,
  tree,
  flat = false,
}: {
  tabs: readonly Tab[];
  pins: readonly Pin[];
  known: readonly Known[];
  tree: readonly Row[];
  flat?: boolean;
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
  const opened = known
    .filter((k) => k.opened && !shown.has(k.path))
    .map((k): Row => ({
      name: k.name,
      path: k.path,
      repository: true,
      ...checkout(k),
      ...(k.opened ? { opened: k.opened } : {}),
      ...(k.found ? { found: true as const } : {}),
    }))
    .sort((a, b) => (b.opened ?? '').localeCompare(a.opened ?? ''));
  for (const row of opened) shown.add(row.path);
  const homeGroup = flat
    ? group(
        'home',
        'Home',
        'by path',
        tree.filter((row) => !shown.has(row.path)).sort(byPath),
        HOME_LIMIT,
      )
    : group('home', 'Home', 'its folders', [...tree]);
  return [
    group('running', 'Running', 'by name, as the tabs', running),
    group('pinned', 'Pinned', 'by name', pinnedRows),
    group('opened', 'Opened before', 'last opened first', opened),
    homeGroup,
  ];
}

/**
 * Home's folders as rows (decision 926): a repository (one the nexus knows, runs, pinned or a
 * listing marked) with its Symbiote, its pin and what is known of it; a tree's depth and state.
 */
export function homeRows(
  /** The tree's folders shown, or (a search, flat) only their paths. */
  folders: readonly (ShownFolder | { path: string })[],
  {
    tabs,
    pins,
    known,
    listed = new Map(),
  }: {
    tabs: readonly Tab[];
    pins: readonly Pin[];
    known: readonly Known[];
    /** Folders read by a listing (a folder the scan did not read, opened): their repositories. */
    listed?: ReadonlyMap<string, Folder>;
  },
): Row[] {
  const knownOf = new Map(known.map((k) => [k.path, k]));
  const pinOf = new Map(pins.map((pin) => [pin.path, pin]));
  const tabOf = new Map(
    tabs
      .filter((tab): tab is Tab & { url: string } => tab.url !== null)
      .map((tab) => [tab.root, tab]),
  );
  return folders.map((folder): Row => {
    const { path } = folder;
    const k = knownOf.get(path);
    const pin = pinOf.get(path);
    const tab = tabOf.get(path);
    const listing = listed.get(path);
    const repository = !!(tab || k || pin?.repository || listing?.repository);
    const from =
      tab !== undefined
        ? tab.branch !== null
          ? { branch: tab.branch }
          : tab.head
            ? { detached: tab.head }
            : {}
        : checkout(k ?? listing ?? pin ?? {});
    return {
      name: path.slice(path.lastIndexOf('/') + 1),
      path,
      repository,
      ...(repository ? from : {}),
      ...(tab ? { tab } : {}),
      ...(pin ? { pinned: true as const } : {}),
      ...(k?.opened ? { opened: k.opened } : {}),
      ...(k?.found ? { found: true as const } : {}),
      ...('depth' in folder
        ? {
            depth: folder.depth,
            open: folder.open,
            // A repository is the end of the way down (decision 554).
            leaf: repository ? true : folder.leaf,
          }
        : {}),
    };
  });
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
      const limit = g.key === 'home' ? HOME_LIMIT : Infinity;
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
