// The nexus page's state (NX1, NX5, NX6): the tabs and the one open, what the nexus knows, what is
// typed and picked, what starts or stopped. One object the page's parts share (decision 959).
import type { Folder } from '../folders.js';
import type { RepositoriesAnswer } from '../repositories.js';
import type { Child } from './dom.js';
import { folderFromHash } from './folders-tab.js';
import type { Pick } from './pick.js';
import type { Group, Row } from './search.js';
import { selectedFrom, type Tab } from './tabs.js';
import type { Tree } from './tree.js';

/** What the list shows now: its groups and rows, what Tab would add, why there are none. */
export interface View {
  groups: Group[];
  rows: Row[];
  ghost: string;
  hint: string;
  message: Child;
  welcome: boolean;
  /** The folder's entries while a path is typed (what Tab completes from). */
  entries: Folder[] | null;
  /** A repository the folder typed is in: the pick goes to it (decision 554). */
  preferred: string | null;
}

/** The page's state. */
export interface PageState {
  tabs: Tab[];
  /** The open tab: a Symbiote's folder, or null: Symbiotes, the list. */
  selected: string | null;
  /** The folder typed in the field (a path), kept in the address (`#folders:<path>`); null: none. */
  browsed: string | null;
  /** The folder the address named at load: put in the field once home is known. */
  asked: string | null;
  /** The folders whose tab was opened: their frames are kept, their tabs too once they stop. */
  opened: Set<string>;
  frames: Map<string, HTMLIFrameElement>;
  failure: string | null;
  readOnce: boolean;
  /** Why something asked on Symbiotes did not happen: a stop, a pin, a folder to scan, a copy. */
  problem: string | null;
  /** What the nexus knows besides the running Symbiotes (NX5): null until read. */
  known: RepositoriesAnswer | null;
  /** The field's text. */
  query: string;
  /**
   * The picked row (decision 913) and its place: kept by its path when the list is drawn again, and
   * by which of its path's rows it is (in the tree too, decision 926).
   */
  pick: Pick | null;
  /** Home's tree, from the last scan (decision 926); null until read. */
  tree: Tree | null;
  /** The tree's folders the person opened. */
  openFolders: Set<string>;
  /** The repositories whose Symbiote is starting, and why one did not. */
  starting: Set<string>;
  failures: Map<string, string>;
  /** The stopped tabs whose Symbiote is starting again, and why one did not. */
  restarting: Set<string>;
  restartFailure: { root: string; why: string } | null;
  /** The path just copied, for the copy button's check. */
  copied: string | null;
  /** What the list showed when last drawn. */
  lastView: View;
  /** The running Symbiotes' folders at the last read: a change reads what the nexus knows again. */
  runningKey: string;
  /** The read of what the nexus knows, while it runs. */
  readingKnown: Promise<void> | null;
}

/** The page's state at load: the open tab and the folder typed from the address. */
export function pageState(): PageState {
  const browsed = folderFromHash(window.location.hash);
  return {
    tabs: [],
    selected: selectedFrom(window.location.hash),
    browsed,
    asked: browsed,
    opened: new Set<string>(),
    frames: new Map<string, HTMLIFrameElement>(),
    failure: null,
    readOnce: false,
    problem: null,
    known: null,
    query: '',
    pick: null,
    tree: null,
    openFolders: new Set<string>(),
    starting: new Set<string>(),
    failures: new Map<string, string>(),
    restarting: new Set<string>(),
    restartFailure: null,
    copied: null,
    lastView: {
      groups: [],
      rows: [],
      ghost: '',
      hint: 'slash',
      message: null,
      welcome: false,
      entries: null,
      preferred: null,
    },
    runningKey: '',
    readingKnown: null,
  };
}
