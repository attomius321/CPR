// Symbiote nexus's page (NX1b): a row of tabs, Symbiotes, then one per running Symbiote, and the
// open one in a frame under it (decisions 521–523, 539). A frame opened once stays loaded, hidden
// while another tab is shown. Drawn in the viewer's own stylesheet and its classes; the nexus's own
// layout is `page/nexus.css`. Since NX3 the row has two groups, a line between (decision 551).
// Since NX5 Symbiotes is a list of every repository the nexus knows, one field to find one by any
// part of its path or to type a path, and the picked one's card beside it (decisions 908–916).
// Since NX6 home is a tree in the list (decision 926), and selecting a folder that is no
// repository asks, then makes it one with `git init` (decisions 927, 928).
import type { Folder, FoldersAnswer } from '../folders.js';
import type { Pin } from '../pins.js';
import type { Running } from '../registry.js';
import type { RepositoriesAnswer, TreeAnswer } from '../repositories.js';
import type { Found } from '../scan.js';
import type { Symbiote } from '../symbiotes.js';
import { completed, completion, into, typedPath, up } from './complete.js';
import { detailView } from './detail-view.js';
import {
  CLOSE,
  el,
  FOLDER,
  GRID,
  icon,
  loading,
  MAXIMIZE,
  MINIMIZE,
  RESTORE,
  STOPPED,
  type Child,
} from './dom.js';
import { folderFromHash, foldersHash } from './folders-tab.js';
import { listView } from './list-view.js';
import { cardKind, keptPick, movedPick, type Pick } from './pick.js';
import { browserReach, reached } from './reach.js';
import {
  entryRow,
  groupsOf,
  homeRows,
  searched,
  shownPath,
  type Group,
  type Row,
} from './search.js';
import {
  checkoutText,
  closeTab,
  hashOf,
  nextTabs,
  selectedFrom,
  titleOf,
  type Tab,
} from './tabs.js';
import { shownFolders, treeOf, type Tree } from './tree.js';

/** What Symbiote's window gives a page served over http (the desktop app's preload, N1). */
interface DesktopApp {
  platform: string;
  titleBar?: (colors: { color: string; symbol: string }) => void;
  frame?: 'own' | 'system';
  window?: (action: 'minimize' | 'maximize' | 'restore' | 'close') => void;
  onWindowState?: (listener: (state: { maximized: boolean }) => void) => () => void;
}

declare global {
  interface Window {
    symbioteApp?: DesktopApp;
  }
}

/** How often the running Symbiotes are read again. */
const READ_EVERY = 2000;
/** How long a folder's listing or a repository's checkouts are taken as they were read. */
const FRESH_FOR = 10_000;

const desktop = window.symbioteApp;

let tabs: Tab[] = [];
/** The open tab: a Symbiote's folder, or null: Symbiotes, the list. */
let selected = selectedFrom(window.location.hash);
/** The folder typed in the field (a path), kept in the address (`#folders:<path>`); null: none. */
let browsed = folderFromHash(window.location.hash);
/** The folder the address named at load: put in the field once home is known. */
let asked = browsed;
/** The folders whose tab was opened: their frames are kept, their tabs too once they stop. */
const opened = new Set<string>();
const frames = new Map<string, HTMLIFrameElement>();
let failure: string | null = null;
let readOnce = false;
/** Why something asked on Symbiotes did not happen: a stop, a pin, a folder to scan, a copy. */
let problem: string | null = null;
/** What the nexus knows besides the running Symbiotes (NX5): null until read. */
let known: RepositoriesAnswer | null = null;
/** The field's text. */
let query = '';
/**
 * The picked row (decision 913) and its place: kept by its path when the list is drawn again, and
 * by which of its path's rows it is (in the tree too, decision 926).
 */
let pick: Pick | null = null;
/** Home's tree, from the last scan (decision 926); null until read. */
let tree: Tree | null = null;
/** The tree's folders the person opened. */
const openFolders = new Set<string>();
/** Folders' listings and repositories' checkouts read, with when. */
const listings = new Map<string, { answer: FoldersAnswer | { error: string }; at: number }>();
const checkoutsRead = new Map<string, { checkouts: Found[] | null; at: number }>();
const reading = new Set<string>();
/** The repositories whose Symbiote is starting, and why one did not. */
const starting = new Set<string>();
const failures = new Map<string, string>();
/** The stopped tabs whose Symbiote is starting again, and why one did not. */
const restarting = new Set<string>();
let restartFailure: { root: string; why: string } | null = null;
/** The path just copied, for the copy button's check. */
let copied: string | null = null;

// ---- drawing ----------------------------------------------------------------------------------

/** Symbiote's S, as the viewer's `SymbioteMark`: the list's head has it, as Start's does. */
const mark = () =>
  el('img', {
    class: 'symbiote-mark',
    src: '/mark.png',
    alt: '',
    width: '32',
    height: '32',
    draggable: 'false',
  });

// The row's tabs are the viewer's session tabs (V89's `.workspace-tabs`, `.stab`): its line tabs'
// look lives on those classes only (fix/fix-nexus-top-left).
const strip = el('div', {
  class: 'workspace-tabs nexus-tabs',
  role: 'tablist',
  'aria-label': 'Running Symbiotes',
});
const list = listView({
  input: (value) => setQuery(value, { fromField: true }),
  key: onKey,
  pick: (at) => {
    const row = lastView.rows[at];
    if (row) pick = pickOf(at);
    render();
  },
  act: (at) => {
    const row = lastView.rows[at];
    if (row) act(row);
  },
  toggle: (at) => {
    const row = lastView.rows[at];
    if (row) toggleFolder(row);
  },
  rescan: () => void rescan(),
});
const card = detailView({
  show: (row) => act(row),
  open: (row) => void openSymbiote(row),
  stop: (row, from) => {
    if (row.tab) void stopSymbiote(row.tab, from);
  },
  pin: (row, pinned) => void setPin(row, pinned),
  copy: (row) => copyPath(row),
  type: (text) => typeInField(text),
  goIn: (row) => goIn(row),
});
const browse = el(
  'button',
  { type: 'button', class: 'button secondary' },
  icon(FOLDER, true),
  'Browse…',
);
browse.addEventListener('click', () => typeInField('~/'));
// Symbiotes: its head (the S, the line, Browse…), what went wrong, the list and the card.
const homeLine = el('div', { class: 'page-line' });
const homeProblem = el('p', { class: 'nexus-failure error', role: 'alert', hidden: true });
const home = el(
  'section',
  { class: 'nexus-home', id: 'nexus-home', role: 'tabpanel', 'aria-label': 'Symbiotes' },
  el(
    'header',
    { class: 'page-head' },
    el('span', { class: 'page-icon', 'aria-hidden': 'true' }, mark()),
    el(
      'div',
      { class: 'page-title' },
      el('div', { class: 'page-name-line' }, el('h1', {}, 'Symbiotes')),
      homeLine,
    ),
    el('div', { class: 'page-actions' }, browse),
  ),
  homeProblem,
  el('div', { class: 'nexus-split' }, list.element, card.element),
);
const stopped = el('section', { class: 'nexus-stopped', role: 'tabpanel', hidden: true });
const framesBox = el('div', { class: 'nexus-frames' });
// No S of the row's own: the list's head and each viewer's sidenav show it right under the row.
const bar = el('header', { class: 'nexus-bar' }, strip, windowButtons());

document
  .getElementById('root')
  ?.append(
    el(
      'div',
      { class: 'nexus' },
      bar,
      el('main', { class: 'nexus-main' }, home, stopped, framesBox),
    ),
  );

/** The window's buttons where Symbiote draws its frame (N1d, Linux): elsewhere the system's. */
function windowButtons(): HTMLElement | null {
  const ask = desktop?.window;
  if (desktop?.frame !== 'own' || !ask) return null;
  const maximized = () => document.documentElement.dataset.window === 'maximized';
  const button = (label: string, paths: string, onClick: () => void, className = 'icon-button') => {
    const b = el('button', { type: 'button', class: className, 'aria-label': label }, icon(paths));
    b.addEventListener('click', onClick);
    return b;
  };
  const size = button('Maximize', MAXIMIZE, () => ask(maximized() ? 'restore' : 'maximize'));
  const drawSize = () => {
    size.setAttribute('aria-label', maximized() ? 'Restore' : 'Maximize');
    size.replaceChildren(icon(maximized() ? RESTORE : MAXIMIZE));
  };
  drawSize();
  desktop.onWindowState?.(drawSize);
  return el(
    'div',
    { class: 'window-buttons' },
    button('Minimize', MINIMIZE, () => ask('minimize')),
    size,
    button('Close', CLOSE, () => ask('close'), 'icon-button window-close'),
  );
}

/** What each part last drew: a part is drawn again only when what it shows changed. */
const drawn = { strip: '', stopped: '' };

function drawStrip(): void {
  const key = JSON.stringify([
    selected,
    tabs.length,
    tabs.map((t) => [t.root, t.name, t.url, t.branch, t.head]),
  ]);
  if (key === drawn.strip) return;
  drawn.strip = key;
  const focused = (document.activeElement as HTMLElement | null)?.dataset.tab;
  const running = tabs.filter((tab) => tab.url !== null).length;
  const list = tabButton(
    null,
    icon(GRID, true),
    el('span', {}, 'Symbiotes'),
    el('span', { class: 'count' }, String(running)),
  );
  // The nexus's own page, with its icon, stays at the left; a line, then the Symbiotes, each with
  // its state's dot (decision 551). Folders is under Symbiotes since decision 626.
  const own = el(
    'div',
    { class: 'nexus-own' },
    list,
    tabs.length > 0 && el('span', { class: 'views-divider', 'aria-hidden': 'true' }),
  );
  const children: HTMLElement[] = [own];
  for (const tab of tabs) {
    const button = tabButton(
      tab.root,
      el('span', {
        class: tab.url === null ? 'state-dot tone-idle' : 'state-dot nexus-live',
        'aria-hidden': 'true',
      }),
      el('span', { class: 'nexus-tab-name' }, tab.name),
      el('span', { class: 'nexus-tab-where' }, tab.url === null ? 'stopped' : checkoutText(tab)),
    );
    if (tab.url !== null) {
      children.push(button);
      continue;
    }
    // A stopped tab closes, as a workspace's shell does (its × inside the tab).
    button.classList.add('nexus-tab-stopped');
    const close = el(
      'button',
      { type: 'button', class: 'icon-button shell-close', 'aria-label': `Close ${tab.name}` },
      icon(CLOSE),
    );
    close.addEventListener('click', () => closeStopped(tab.root));
    children.push(el('div', { class: 'shell-tab' }, button, close));
  }
  strip.replaceChildren(...children);
  // A Symbiote's tab focused by the keys scrolls clear of the own pages over the strip's start.
  strip.style.scrollPaddingInlineStart = `${own.offsetWidth}px`;
  if (focused !== undefined)
    strip.querySelector<HTMLElement>(`[data-tab="${CSS.escape(focused)}"]`)?.focus();
}

function tabButton(root: string | null, ...children: Child[]): HTMLButtonElement {
  const picked = root === selected;
  const button = el(
    'button',
    {
      type: 'button',
      role: 'tab',
      class: picked ? 'stab selected' : 'stab',
      'aria-selected': picked ? 'true' : 'false',
      tabindex: picked ? '0' : '-1',
      'data-tab': root ?? '',
    },
    ...children,
  );
  button.addEventListener('click', () => select(root, { focusFrame: true }));
  return button;
}

/** What the list shows now: its groups and rows, what Tab would add, why there are none. */
interface View {
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

let lastView: View = {
  groups: [],
  rows: [],
  ghost: '',
  hint: 'slash',
  message: null,
  welcome: false,
  entries: null,
  preferred: null,
};

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
const folderName = (path: string, homePath: string) =>
  path === '/' ? '/' : `${shownPath(path, homePath)}/`;

function view(): View {
  const none: View = { ...lastView, groups: [], rows: [], ghost: '', hint: 'slash', message: null };
  if (!known) {
    return {
      ...none,
      welcome: false,
      message: loading('Reading the repositories the nexus knows…'),
    };
  }
  const homePath = known.home;
  const parts = { tabs, pins: known.pins, known: known.repositories };
  const typed = typedPath(query, homePath);
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
    const next = inside ? query : completed(query, read.folders);
    return {
      ...base,
      groups,
      rows: groups.flatMap((g) => g.rows),
      ghost: next.startsWith(query) ? next.slice(query.length) : '',
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
  const words = query.trim();
  const listed = listedFolders();
  // Home (decision 926): as a tree, or every folder of the scan, flat, to search.
  const homeRowsShown = !tree
    ? []
    : words
      ? homeRows(
          tree.all.map((path) => ({ path })),
          { ...parts, listed },
        )
      : homeRows(
          shownFolders(tree, openFolders, (path) => {
            const answer = folderListing(path);
            return answer?.map((folder) => folder.path);
          }),
          { ...parts, listed },
        );
  const all = groupsOf({ ...parts, tree: homeRowsShown, flat: words !== '' });
  const groups = searched(all, words, homePath);
  const rows = groups.flatMap((g) => g.rows);
  const total = all.slice(0, 3).reduce((n, g) => n + g.all, 0) + (tree?.all.length ?? 0);
  const firstRun =
    readOnce &&
    words === '' &&
    !tabs.some((t) => t.url !== null) &&
    known.pins.length === 0 &&
    !known.repositories.some((k) => k.opened);
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
          : known.scan === null
            ? loading('Looking in ~…')
            : 'Home holds no folder to show: run symbiote view in a repository, or type a path.',
  };
}

/**
 * A folder's folders as its listing read them (a folder of the tree the scan did not read, opened):
 * undefined until read. Never asks: `readOpened` does, for the opened ones.
 */
function folderListing(path: string): Folder[] | undefined {
  const read = listings.get(path)?.answer;
  return read && !('error' in read) && read.path === path ? read.folders : undefined;
}

/** The folders listings read, by path: whether each is a repository, for the tree's rows. */
function listedFolders(): Map<string, Folder> {
  const out = new Map<string, Folder>();
  for (const path of openFolders) {
    for (const folder of folderListing(path) ?? []) out.set(folder.path, folder);
  }
  return out;
}

/** The tree's opened folders the scan did not read: listed now (a folder, never deeper, 916). */
function readOpened(): void {
  if (!tree) return;
  const read = new Set(tree.all);
  for (const path of openFolders) {
    if (!read.has(path) || tree.unread.has(path)) listingOf(path);
  }
}

/** A folder's listing as read (and read again once old); null while it is read. */
function listingOf(folder: string): FoldersAnswer | { error: string } | null {
  const read = listings.get(folder);
  if (!read || Date.now() - read.at > FRESH_FOR) void readListing(folder);
  return read?.answer ?? null;
}

async function readListing(folder: string): Promise<void> {
  const key = `list ${folder}`;
  if (reading.has(key)) return;
  reading.add(key);
  try {
    const res = await fetch(`/api/folders?path=${encodeURIComponent(folder)}`, {
      cache: 'no-store',
    });
    const answer = (await res.json()) as (FoldersAnswer & { pinned?: Pin[] }) | { error: string };
    listings.set(folder, { answer, at: Date.now() });
  } catch (error) {
    listings.set(folder, { answer: { error: (error as Error).message }, at: Date.now() });
  } finally {
    reading.delete(key);
  }
  render();
}

/** A repository's checkouts as read (and read again once old); undefined while they are read. */
function checkoutsOf(path: string): Found[] | null | undefined {
  const read = checkoutsRead.get(path);
  if (!read || Date.now() - read.at > FRESH_FOR) void readCheckouts(path);
  return read?.checkouts;
}

async function readCheckouts(path: string): Promise<void> {
  const key = `checkouts ${path}`;
  if (reading.has(key)) return;
  reading.add(key);
  try {
    const res = await fetch(`/api/checkouts?path=${encodeURIComponent(path)}`, {
      cache: 'no-store',
    });
    const checkouts = res.ok ? ((await res.json()) as { checkouts: Found[] }).checkouts : null;
    checkoutsRead.set(path, { checkouts, at: Date.now() });
  } catch {
    checkoutsRead.set(path, { checkouts: null, at: Date.now() });
  } finally {
    reading.delete(key);
  }
  render();
}

/** The entries of a folder as the card lists them; undefined while read, null when unreadable. */
function entriesOf(folder: string): Folder[] | null | undefined {
  const read = listingOf(folder);
  if (!read) return undefined;
  if ('error' in read || read.path !== folder) return null;
  return read.folders;
}

function drawHome(): void {
  const running = tabs.filter((tab) => tab.url !== null).length;
  const now = new Date();
  homeLine.replaceChildren(
    !readOnce || !known
      ? loading('Looking for running Symbiotes…')
      : [
          `${running === 0 ? 'None' : running} running`,
          ...(known.pins.length > 0 ? [`${known.pins.length} pinned`] : []),
          known.scan === null
            ? 'looking in ~'
            : `${known.scan.repositories} ${known.scan.repositories === 1 ? 'repository' : 'repositories'} in home`,
        ].join(' · '),
  );
  const shownProblem = failure ?? problem;
  homeProblem.textContent = shownProblem ?? '';
  homeProblem.hidden = shownProblem === null;

  readOpened();
  const v = view();
  lastView = v;
  // The pick (decision 913): kept by its path and place; at first the repository a typed folder
  // is in, else the first row.
  const preferred = v.preferred ? v.rows.findIndex((row) => row.path === v.preferred) : -1;
  const next =
    pick !== null
      ? keptPick(v.rows, pick)
      : preferred >= 0
        ? pickOf(preferred)
        : keptPick(v.rows, null);
  // No pick before both reads: the running Symbiotes would not be first.
  pick = next === null || !readOnce || !known ? null : next;
  const row = pick === null ? null : (v.rows[pick.at] ?? null);
  const homePath = known?.home ?? '';
  list.draw({
    groups: v.groups,
    pick: pick?.at ?? null,
    words: typedPath(query, homePath) ? '' : query.trim(),
    home: homePath,
    ghost: v.ghost,
    hint: v.hint,
    message: v.message,
    welcome: v.welcome,
    scan: known?.scan ?? null,
    now,
    starting,
  });
  const kind = cardKind(row, {
    starting: row !== null && starting.has(row.path),
    failed: row === null ? null : (failures.get(row.path) ?? null),
  });
  const repository = row !== null && row.repository;
  const parent = row ? row.path.slice(0, row.path.lastIndexOf('/')) || '/' : '';
  card.draw({
    kind,
    row,
    home: homePath,
    now,
    checkouts: repository && row ? checkoutsOf(row.path) : null,
    listing: row === null || row.missing ? null : entriesOf(repository ? parent : row.path),
    failed: row === null ? null : (failures.get(row.path) ?? null),
    starting: row !== null && starting.has(row.path),
    refused: row === null || row.repository ? null : refusedFor(row.path),
    copied: row !== null && copied === row.path,
    rowOf: (folder) =>
      entryRow(folder, { tabs, pins: known?.pins ?? [], known: known?.repositories ?? [] }),
  });
}

function drawStopped(tab: Tab): void {
  const busy = restarting.has(tab.root);
  const why = restartFailure?.root === tab.root ? restartFailure.why : null;
  const key = JSON.stringify([tab.root, tab.name, busy, why]);
  if (key === drawn.stopped) return;
  drawn.stopped = key;
  const again = el(
    'button',
    { type: 'button', class: 'button', disabled: busy },
    busy ? loading('Starting…') : 'Start again',
  );
  again.addEventListener('click', () => void startAgain(tab.root));
  const close = el('button', { type: 'button', class: 'button secondary' }, 'Close tab');
  close.addEventListener('click', () => closeStopped(tab.root));
  stopped.replaceChildren(
    el(
      'div',
      { class: 'nexus-empty' },
      icon(STOPPED),
      el('p', { class: 'nexus-empty-title' }, `${tab.name} stopped`),
      el(
        'p',
        { class: 'nexus-empty-text' },
        'Its ',
        el('code', {}, 'symbiote view'),
        ' ended: start it again here, or run it again in its folder, and this tab takes it back.',
      ),
      el('p', { class: 'nexus-empty-text' }, el('code', {}, tab.root)),
      why ? el('p', { class: 'nexus-empty-text error', role: 'alert' }, why) : null,
      el('div', { class: 'nexus-empty-actions' }, again, close),
    ),
  );
}

/** Shows the open tab: its frame (made once, kept), Symbiotes, or a stopped one's panel. */
function show(): void {
  const tab = tabs.find((t) => t.root === selected);
  // Frames of Symbiotes that stopped, or whose tab closed, are unloaded; a restarted one's moves.
  for (const [root, frame] of frames) {
    const its = tabs.find((t) => t.root === root);
    if (!its?.url || !opened.has(root)) {
      frame.remove();
      frames.delete(root);
    } else if (frame.dataset.url !== its.url) {
      frame.dataset.url = its.url;
      void address(frame, its.url);
    }
  }
  if (tab?.url) {
    opened.add(tab.root);
    if (!frames.has(tab.root)) {
      const frame = el('iframe', {
        class: 'nexus-frame',
        title: tab.name,
        'data-url': tab.url,
        // Copy SHA, an image pasted into a terminal: the clipboard, as in a tab of its own.
        allow: 'clipboard-read; clipboard-write',
      });
      frames.set(tab.root, frame);
      framesBox.append(frame);
      void address(frame, tab.url);
    }
  }
  for (const [root, frame] of frames) frame.hidden = root !== selected;
  home.hidden = tab !== undefined;
  stopped.hidden = !(tab && tab.url === null);
  if (tab && tab.url === null) drawStopped(tab);
  else if (drawn.stopped !== '') {
    drawn.stopped = '';
    stopped.replaceChildren();
  }
  document.title = titleOf(tab);
}

/**
 * Gives a frame its Symbiote's address once this browser reaches it (decision 625): a browser on
 * Windows reaches a new port of WSL's late, and a frame refused once stays refused. A frame
 * unloaded or moved meanwhile is left as it is.
 */
async function address(frame: HTMLIFrameElement, url: string): Promise<void> {
  await reached(url, browserReach);
  if (frame.isConnected && frame.dataset.url === url) frame.src = url;
}

function render(): void {
  drawStrip();
  drawHome();
  show();
}

// ---- what the person does ----------------------------------------------------------------------

function select(root: string | null, { focusFrame = false } = {}): void {
  selected = root;
  // The open tab in the address, with no entry of the nexus's own in the history (decision 521);
  // Symbiotes' with the folder the person went to, if any.
  const hash = root === null ? (browsed === null ? '' : foldersHash(browsed)) : hashOf(root);
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}${hash}`,
  );
  render();
  if (focusFrame && root !== null) frames.get(root)?.focus();
}

function closeStopped(root: string): void {
  opened.delete(root);
  tabs = closeTab(tabs, root);
  if (selected === root) select(null);
  else render();
}

/** A write to the nexus's server, as the viewer's are sent (decision 543). */
function post(path: string, value: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
    body: JSON.stringify(value),
  });
}

/** A start's answer for a folder that is no repository: `git init` may make it one (decision 927). */
const INIT = Symbol('init');

/**
 * Starts `symbiote view` in `folder` (decision 541), or finds the one serving it, and opens its
 * tab: null once it is open, `INIT` for a folder that may be made a repository, else why not.
 * `init`: the person said yes to `git init` in it (decision 928).
 */
async function startSymbiote(folder: string, init = false): Promise<string | typeof INIT | null> {
  let answer: { symbiote: Running } | { error: string; init?: true };
  try {
    const res = await post('/api/symbiotes', init ? { folder, init } : { folder });
    answer = res.headers.get('content-type')?.includes('json')
      ? ((await res.json()) as typeof answer)
      : { error: `${res.status}: ${await res.text()}` };
  } catch (error) {
    answer = { error: (error as Error).message };
  }
  if ('error' in answer) return answer.init ? INIT : answer.error;
  await refresh();
  select(answer.symbiote.root, { focusFrame: true });
  return null;
}

async function startAgain(root: string): Promise<void> {
  restarting.add(root);
  restartFailure = null;
  render();
  const why = await startSymbiote(root);
  restarting.delete(root);
  if (why === INIT) restartFailure = { root, why: `${root} is no git repository now` };
  else if (why !== null) restartFailure = { root, why };
  render();
}

/** Stops a Symbiote, after a question (decision 542): its tab, if opened, is then stopped. */
async function stopSymbiote(tab: Tab, from: HTMLElement): Promise<void> {
  const stop = await confirmStop(tab.name);
  // Back to what asked; the card may have been drawn again meanwhile: its button of that name.
  const label = from.getAttribute('aria-label');
  const again = from.isConnected
    ? from
    : label === null
      ? null
      : document.querySelector<HTMLElement>(`button[aria-label="${CSS.escape(label)}"]`);
  again?.focus();
  if (!stop) return;
  problem = null;
  try {
    const res = await post('/api/symbiotes/stop', { root: tab.root });
    if (!res.ok && res.status !== 404) problem = `${tab.name} did not stop: ${await res.text()}`;
  } catch (error) {
    problem = `${tab.name} did not stop: ${(error as Error).message}`;
  }
  await refresh();
}

/**
 * Opens a repository's or a folder's Symbiote, the person's start (decisions 619, 927): its tab
 * once it serves. A folder that is no repository is asked about first, then made one (928).
 */
async function openSymbiote(row: Row): Promise<void> {
  starting.add(row.path);
  failures.delete(row.path);
  render();
  let why = await startSymbiote(row.path);
  if (why === INIT) {
    starting.delete(row.path);
    render();
    const from = document.activeElement as HTMLElement | null;
    const yes = await confirmInit(row);
    from?.focus();
    if (!yes) return;
    starting.add(row.path);
    render();
    why = await startSymbiote(row.path, true);
  }
  starting.delete(row.path);
  if (why === INIT) why = `${row.name} is no git repository`;
  if (why !== null) failures.set(row.path, why);
  // Its tab is open: back on Symbiotes the whole list shows again.
  if (why === null) setQuery('');
  else render();
}

/** What Enter, a double click or the card's main button does with a row (decisions 913, 927). */
function act(row: Row): void {
  if (row.tab) {
    const root = row.tab.root;
    select(root, { focusFrame: true });
    setQuery('');
  } else if (row.missing || starting.has(row.path)) {
    return;
  } else if (!row.repository && refusedFor(row.path) !== null) {
    failures.set(row.path, refusedFor(row.path) ?? '');
    render();
  } else void openSymbiote(row);
}

/**
 * Why a folder cannot be made a repository, as the page can tell (the server checks every guard,
 * decision 928): home, the top, a Windows drive.
 */
function refusedFor(path: string): string | null {
  if (!known) return null;
  if (path === '/') return 'The top folder (/) cannot be made a repository.';
  if (path === known.home)
    return 'Your home folder cannot be made a repository: pick a folder in it.';
  if (known.drives.includes(path)) {
    return `The drive ${path} cannot be made a repository: pick a folder on it.`;
  }
  return null;
}

/** A picked place in the list. */
function pickOf(at: number): Pick | null {
  const row = lastView.rows[at];
  if (!row) return null;
  const nth = lastView.rows.slice(0, at).filter((other) => other.path === row.path).length;
  return { path: row.path, at, ...(nth > 0 ? { nth } : {}) };
}

/** Opens or closes a folder of home's tree (decision 926). */
function toggleFolder(row: Row): void {
  if (row.depth === undefined || row.leaf === true) return;
  if (openFolders.has(row.path)) openFolders.delete(row.path);
  else openFolders.add(row.path);
  render();
}

/**
 * Go in, on a folder's card: its folders shown in home's tree (the tree opened down to it, the
 * field cleared), or typed as a path when the tree does not hold it.
 */
function goIn(row: Row): void {
  if (!known) return;
  const homePath = known.home;
  const inTree =
    tree !== null && row.path.startsWith(`${homePath}/`) && tree.all.includes(row.path);
  if (!inTree) {
    typeInField(folderName(row.path, homePath));
    return;
  }
  for (let at = row.path; at.startsWith(`${homePath}/`); at = at.slice(0, at.lastIndexOf('/'))) {
    openFolders.add(at);
  }
  query = '';
  list.field.value = '';
  browsed = null;
  if (selected !== null) select(null);
  pick = { path: row.path, at: 0 };
  render();
  // The same row, now in the tree: its last place (the tree is below the groups).
  const places = lastView.rows.flatMap((r, n) => (r.path === row.path ? [n] : []));
  const last = places.at(-1);
  if (last !== undefined) pick = pickOf(last);
  render();
  list.reveal();
  list.field.focus();
}

/** The answer of a write: its JSON, or why it was refused. */
async function answerOf<T>(res: Response): Promise<T | { error: string }> {
  if (res.headers.get('content-type')?.includes('json')) return (await res.json()) as T;
  return { error: `${res.status}: ${await res.text()}` };
}

/** Pins or unpins a row (NX4, decision 620): kept in Symbiote's settings folder. */
async function setPin(row: Row, pinned: boolean): Promise<void> {
  problem = null;
  try {
    const answer = await answerOf<{ pinned: Pin[] }>(
      await post('/api/pinned', { path: row.path, pinned }),
    );
    if ('error' in answer)
      problem = `${row.name} was not ${pinned ? 'pinned' : 'unpinned'}: ${answer.error}`;
    else if (known) known = { ...known, pins: answer.pinned };
  } catch (error) {
    problem = `${row.name} was not ${pinned ? 'pinned' : 'unpinned'}: ${(error as Error).message}`;
  }
  render();
}

/** Scans home again: the foot's button, the one way but the start (decision 925). */
async function rescan(): Promise<void> {
  problem = null;
  try {
    await post('/api/scan', {});
  } catch (error) {
    problem = `Home was not scanned: ${(error as Error).message}`;
  }
  await readKnown();
}

/** Copies a row's path: the button says so for a moment. */
function copyPath(row: Row): void {
  navigator.clipboard.writeText(row.path).then(
    () => {
      copied = row.path;
      render();
      setTimeout(() => {
        if (copied === row.path) copied = null;
        render();
      }, 1500);
    },
    (error: unknown) => {
      problem = `The path was not copied: ${(error as Error).message}`;
      render();
    },
  );
}

/**
 * The field's text: a search, or a path (decision 910). The pick starts again from the top; the
 * address names a folder typed, so a reload keeps it.
 */
function setQuery(value: string, { fromField = false }: { fromField?: boolean } = {}): void {
  query = value;
  if (!fromField && list.field.value !== value) list.field.value = value;
  pick = null;
  const typed = known ? typedPath(value, known.home) : null;
  browsed = typed ? typed.folder : null;
  if (selected === null) select(null);
  else render();
}

/** Puts `text` in the field, the caret at its end, the focus in it. */
function typeInField(text: string): void {
  if (selected !== null) select(null);
  setQuery(text);
  list.field.focus();
  list.field.setSelectionRange(text.length, text.length);
}

/** The field's keys: the pick, Enter, Esc, and a path's Tab, → and Backspace (decision 910). */
function onKey(event: KeyboardEvent): void {
  const field = list.field;
  const row = pick === null ? null : (lastView.rows[pick.at] ?? null);
  const atEnd =
    field.selectionStart === field.value.length && field.selectionEnd === field.value.length;
  const typed = known ? typedPath(query, known.home) : null;
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp':
    case 'PageDown':
    case 'PageUp': {
      event.preventDefault();
      pick = movedPick(lastView.rows, pick, event.key);
      render();
      list.reveal();
      return;
    }
    case 'Enter':
      event.preventDefault();
      if (row) act(row);
      return;
    case 'Escape':
      if (query === '') return;
      event.preventDefault();
      setQuery('');
      return;
    case 'Tab': {
      if (event.shiftKey || !typed || !lastView.entries) return;
      const next = completed(query, lastView.entries);
      if (next === query) return;
      event.preventDefault();
      setQuery(next);
      return;
    }
    case 'ArrowRight':
      // Home's tree, the field empty (decision 926): → opens the picked folder, then goes in.
      if (query === '' && row?.depth !== undefined && row.leaf !== true) {
        event.preventDefault();
        if (!row.open) toggleFolder(row);
        else {
          const nextRow = lastView.rows[(pick?.at ?? 0) + 1];
          if (nextRow?.depth !== undefined && nextRow.depth > row.depth) {
            pick = pickOf((pick?.at ?? 0) + 1);
            render();
            list.reveal();
          }
        }
        return;
      }
      if (!typed || !atEnd || !row || row.repository || row.missing) return;
      event.preventDefault();
      setQuery(into(query, row));
      return;
    case 'ArrowLeft': {
      // ← closes the picked folder, or goes to the folder holding it.
      if (query !== '' || row?.depth === undefined) return;
      event.preventDefault();
      if (row.open) {
        toggleFolder(row);
        return;
      }
      const at = pick?.at ?? 0;
      for (let n = at - 1; n >= 0; n--) {
        const above = lastView.rows[n];
        if (above?.depth === undefined) break;
        if (above.depth < row.depth) {
          pick = pickOf(n);
          render();
          list.reveal();
          break;
        }
      }
      return;
    }
    case 'Backspace': {
      if (!typed || !atEnd) return;
      const above = up(query);
      if (above === null) return;
      event.preventDefault();
      setQuery(above);
      return;
    }
  }
}

/**
 * The question before a Symbiote stops, in the viewer's dialog (its `ConfirmDialog`): staying is
 * the default, Escape stays.
 */
function confirmStop(name: string): Promise<boolean> {
  return ask({
    question: `Stop ${name}?`,
    detail: [
      'Its symbiote view ends, with its terminals and any agent working in them. Open it again from Symbiotes.',
    ],
    stay: 'Keep it running',
    go: 'Stop',
  });
}

/**
 * The question before `git init` (decision 928), as Stop's: Cancel is the default, Escape
 * cancels.
 */
function confirmInit(row: Row): Promise<boolean> {
  const where = known ? shownPath(row.path, known.home) : row.path;
  return ask({
    question: `Make ${row.name} a git repository?`,
    detail: [
      'Symbiote runs ',
      el('code', {}, 'git init'),
      ` in ${where}: a .git folder is added, nothing else. No commit is made: commit from its Git page to start workspaces. Then its Symbiote opens.`,
    ],
    stay: 'Cancel',
    go: 'Make it a repository',
  });
}

/** A question in the viewer's dialog: `stay` focused, the default; Escape stays. */
function ask({
  question,
  detail,
  stay,
  go,
}: {
  question: string;
  detail: Child[];
  stay: string;
  go: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const keep = el('button', { type: 'button', class: 'button' }, stay);
    const yes = el('button', { type: 'button', class: 'button ghost' }, go);
    const box = el(
      'div',
      {
        class: 'dialog',
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-labelledby': 'nexus-ask-question',
        'aria-describedby': 'nexus-ask-detail',
      },
      el('h2', { id: 'nexus-ask-question' }, question),
      el('p', { id: 'nexus-ask-detail' }, ...detail),
      el('div', { class: 'dialog-buttons' }, yes, keep),
    );
    const backdrop = el('div', { class: 'dialog-backdrop' }, box);
    const answer = (value: boolean) => {
      backdrop.remove();
      resolve(value);
    };
    keep.addEventListener('click', () => answer(false));
    yes.addEventListener('click', () => answer(true));
    box.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      answer(false);
    });
    document.body.append(backdrop);
    keep.focus();
  });
}

// The tabs by the keys, as a tab list has them: the arrows, Home and End.
strip.addEventListener('keydown', (event) => {
  const buttons = [...strip.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  const to =
    event.key === 'ArrowRight'
      ? (at + 1) % buttons.length
      : event.key === 'ArrowLeft'
        ? (at - 1 + buttons.length) % buttons.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : -1;
  const next = buttons[to];
  if (!next) return;
  event.preventDefault();
  const root = next.dataset.tab;
  select(root ? root : null);
  strip.querySelector<HTMLElement>(`[data-tab="${CSS.escape(root ?? '')}"]`)?.focus();
});

window.addEventListener('hashchange', () => {
  const next = selectedFrom(window.location.hash);
  const path = folderFromHash(window.location.hash);
  if (next === null && path !== null && path !== browsed && known) {
    setQuery(folderName(path, known.home));
  }
  select(next);
});

// `/` on Symbiotes and Ctrl K anywhere on the nexus's page put the focus in the field (decision
// 910). Keys typed in a Symbiote's frame go to its viewer: the frame is another origin.
document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  const typing = !!target?.closest('input, textarea, select, [contenteditable]');
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (selected !== null) select(null);
    list.field.focus();
    list.field.select();
  } else if (
    event.key === '/' &&
    !typing &&
    selected === null &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
    event.preventDefault();
    list.field.focus();
  }
});

// ---- reading ------------------------------------------------------------------------------------

/** The running Symbiotes' folders at the last read: a change reads what the nexus knows again. */
let runningKey = '';

/** Reads what the nexus knows besides the running Symbiotes (NX5): pins, history, the scan. */
let readingKnown: Promise<void> | null = null;
function readKnown(): Promise<void> {
  readingKnown ??= (async () => {
    try {
      const res = await fetch('/api/repositories', { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      known = (await res.json()) as RepositoriesAnswer;
      if (known.scan && known.scan.at !== tree?.at) await readTree();
      if (asked !== null) {
        setQuery(folderName(asked, known.home));
        asked = null;
      }
    } catch (error) {
      problem = `What the nexus knows could not be read: ${(error as Error).message}`;
    }
    render();
  })().finally(() => {
    readingKnown = null;
    // Home's first scan runs: asked again until it answers.
    if (known && !known.scan) setTimeout(() => void readKnown(), 500);
  });
  return readingKnown;
}

/** Reads home's tree (decision 926): once per scan, when its time changes. */
async function readTree(): Promise<void> {
  try {
    const res = await fetch('/api/tree', { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const answer = (await res.json()) as { tree: TreeAnswer | null };
    tree = answer.tree ? treeOf(answer.tree) : null;
  } catch (error) {
    problem = `Home's folders could not be read: ${(error as Error).message}`;
  }
}

/** Reads the running Symbiotes once and draws what changed. */
async function refresh(): Promise<void> {
  try {
    const res = await fetch('/api/symbiotes', { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const { symbiotes } = (await res.json()) as { symbiotes: Symbiote[] };
    tabs = nextTabs(tabs, symbiotes, opened);
    const key = symbiotes
      .map((s) => s.root)
      .sort()
      .join('\n');
    if (key !== runningKey) {
      runningKey = key;
      void readKnown();
    }
    failure = null;
    const first = !readOnce;
    readOnce = true;
    // A tab asked for by the address that is not there (any more): the list.
    const gone = selected !== null && !tabs.some((t) => t.root === selected);
    if (gone) select(null);
    else render();
    if (first && selected !== null) frames.get(selected)?.focus();
    else if (first) list.field.focus();
  } catch (error) {
    failure = `The running Symbiotes could not be read: ${(error as Error).message}`;
    render();
  }
}

async function read(): Promise<void> {
  await refresh();
  setTimeout(() => void read(), READ_EVERY);
}

/** Gives the system's window buttons the bar's colours (Windows' overlay), as the viewer does. */
function paintTitleBar(): void {
  if (!desktop?.titleBar || desktop.frame === 'own') return;
  const style = getComputedStyle(document.documentElement);
  desktop.titleBar({
    color: style.getPropertyValue('--side').trim(),
    symbol: style.getPropertyValue('--text').trim(),
  });
}

paintTitleBar();
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', paintTitleBar);
render();
void readKnown();
void read();
