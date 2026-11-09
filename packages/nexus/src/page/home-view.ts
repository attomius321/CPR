// What the nexus page's list shows (NX5, NX6; decisions 908–916, 926): the groups and rows for
// the field's text or a path typed, and why a folder cannot be made a repository.
import type { Folder } from '../folders.js';
import { completed, completion, typedPath } from './complete.js';
import { loading } from './dom.js';
import {
  entryRow,
  groupsOf,
  homeRows,
  searched,
  shownPath,
  type Group,
  type Row,
} from './search.js';
import { shownFolders } from './tree.js';
import type { View, PageState } from './state.js';
import type { Listings } from './listings.js';

const groupOf = (key: Group['key'], name: string, order: string, rows: Row[]): Group => ({
  key,
  name,
  order,
  rows,
  rest: [],
  more: 0,
  all: rows.length,
});

/** A folder's name with its `/`, as the list heads it: `~/projects/`, `/`. */
export const folderName = (path: string, homePath: string) =>
  path === '/' ? '/' : `${shownPath(path, homePath)}/`;

/** What the list shows now, from the state and the folders' listings read. */
export function view(state: PageState, reads: Listings): View {
  const { listingOf, folderListing, listedFolders } = reads;
  const none: View = {
    ...state.lastView,
    groups: [],
    rows: [],
    ghost: '',
    hint: 'slash',
    message: null,
  };
  if (!state.known) {
    return {
      ...none,
      welcome: false,
      message: loading('Reading the repositories the nexus knows…'),
    };
  }
  const homePath = state.known.home;
  const parts = { tabs: state.tabs, pins: state.known.pins, known: state.known.repositories };
  const typed = typedPath(state.query, homePath);
  if (typed) {
    const base = { ...none, hint: 'tab', welcome: false };
    const read = listingOf(typed.folder);
    if (!read)
      return { ...base, message: loading(`Reading ${folderName(typed.folder, homePath)}…`) };
    if ('error' in read) return { ...base, message: read.error };
    // A folder in a repository: the folder holding it, the repository picked (decision 554).
    const inside = read.path !== typed.folder;
    const prefix = inside ? '' : typed.prefix;
    const where = folderName(read.path, homePath);
    const { hits, others } = completion(read.folders, prefix);
    const rowsOf = (entries: Folder[]) => entries.map((entry) => entryRow(entry, parts));
    const groups: Group[] = [];
    if (hits.length > 0) {
      groups.push(
        groupOf('hits', where, prefix ? `starting with “${prefix}”` : 'by name', rowsOf(hits)),
      );
    }
    if (prefix && others.length > 0)
      groups.push(groupOf('others', `Also in ${where}`, 'by name', rowsOf(others)));
    const next = inside ? state.query : completed(state.query, read.folders);
    return {
      ...base,
      groups,
      rows: groups.flatMap((g) => g.rows),
      ghost: next.startsWith(state.query) ? next.slice(state.query.length) : '',
      message:
        read.folders.length === 0
          ? `${where} holds no folder`
          : hits.length === 0
            ? `Nothing in ${where} starts with “${prefix}”`
            : null,
      entries: read.folders,
      preferred: read.picked,
    };
  }
  const words = state.query.trim();
  const listed = listedFolders();
  // Home (decision 926): as a tree, or every folder of the scan, flat, to search.
  const homeRowsShown = !state.tree
    ? []
    : words
      ? homeRows(
          state.tree.all.map((path) => ({ path })),
          { ...parts, listed },
        )
      : homeRows(
          shownFolders(state.tree, state.openFolders, (path) => {
            const answer = folderListing(path);
            return answer?.map((folder) => folder.path);
          }),
          { ...parts, listed },
        );
  const all = groupsOf({ ...parts, tree: homeRowsShown, flat: words !== '' });
  const groups = searched(all, words, homePath);
  const rows = groups.flatMap((g) => g.rows);
  const total = all.slice(0, 3).reduce((n, g) => n + g.all, 0) + (state.tree?.all.length ?? 0);
  const firstRun =
    state.readOnce &&
    words === '' &&
    !state.tabs.some((t) => t.url !== null) &&
    state.known.pins.length === 0 &&
    !state.known.repositories.some((k) => k.opened);
  return {
    ...none,
    welcome: firstRun,
    entries: null,
    preferred: null,
    groups,
    rows,
    hint: words ? `${rows.length} of ${total.toLocaleString('en')}` : 'slash',
    message:
      rows.length > 0
        ? null
        : words
          ? `Nothing in home or the lists above has “${words}” in its path`
          : state.known.scan === null
            ? loading('Looking in ~…')
            : 'Home holds no folder to show: run symbiote view in a repository, or type a path.',
  };
}

/**
 * Why a folder cannot be made a repository, as the page can tell (the server checks every guard,
 * decision 928): home, the top, a Windows drive.
 */
export function refusedFor(state: { known: PageState['known'] }, path: string): string | null {
  if (!state.known) return null;
  if (path === '/') return 'The top folder (/) cannot be made a repository.';
  if (path === state.known.home)
    return 'Your home folder cannot be made a repository: pick a folder in it.';
  if (state.known.drives.includes(path)) {
    return `The drive ${path} cannot be made a repository: pick a folder on it.`;
  }
  return null;
}
