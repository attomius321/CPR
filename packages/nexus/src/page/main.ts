// Symbiote nexus's page (NX1b): a row of tabs, Symbiotes, then one per running Symbiote, and the
// open one in a frame under it (decisions 521–523, 539). A frame opened once stays loaded, hidden
// while another tab is shown. Drawn in the viewer's own stylesheet and its classes; the nexus's own
// layout is `page/nexus.css`. Since NX3 the row has two groups, a line between (decision 551).
// Since NX5 Symbiotes is a list of every repository the nexus knows, one field to find one by any
// part of its path or to type a path, and the picked one's card beside it (decisions 908–916).
// Since NX6 home is a tree in the list (decision 926), and selecting a folder that is no
// repository asks, then makes it one with `git init` (decisions 927, 928).
import { detailView } from './detail-view.js';
import { el } from './dom.js';
import { folderFromHash, foldersHash } from './folders-tab.js';
import { listView } from './list-view.js';
import { browserReach, reached } from './reach.js';
import { closeTab, hashOf, selectedFrom, titleOf } from './tabs.js';
import { pageState } from './state.js';
import { windowButtons, paintTitleBar } from './window-buttons.js';
import { listingReads } from './listings.js';
import { folderName } from './home-view.js';
import { stripView } from './strip-view.js';
import { stoppedView } from './stopped-view.js';
import { homePage } from './home.js';
import { frameAddress, nexusActions } from './actions.js';
import { fieldKeys } from './field.js';
import { nexusReads } from './reads.js';

const state = pageState();

// The page's parts, each over the state; their callbacks reach the parts made after them when
// called, never while the page is made.
const listings = listingReads(state, render);
const list = listView({
  input: (value) => setQuery(value, { fromField: true }),
  key: (event) => onKey(event),
  pick: (at) => {
    const row = state.lastView.rows[at];
    if (row) state.pick = pickOf(at);
    render();
  },
  act: (at) => {
    const row = state.lastView.rows[at];
    if (row) act(row);
  },
  toggle: (at) => {
    const row = state.lastView.rows[at];
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
const { pickOf, toggleFolder, goIn, setQuery, typeInField, onKey } = fieldKeys(state, {
  list,
  render,
  select,
  act: (row) => act(row),
});
const { startAgain, stopSymbiote, openSymbiote, act, setPin, rescan, copyPath } = nexusActions(
  state,
  {
    render,
    select,
    setQuery,
    refresh: () => refresh(),
    readKnown: () => readKnown(),
  },
);
const { readKnown, refresh, read } = nexusReads(state, { render, select, setQuery, list });
const strip = stripView(state, { select, closeStopped });
const stopped = stoppedView(state, { startAgain, closeStopped });
const home = homePage(state, { list, card, reads: listings, pickOf, typeInField });
const framesBox = el('div', { class: 'nexus-frames' });
// No S of the row's own: the list's head and each viewer's sidenav show it right under the row.
const bar = el('header', { class: 'nexus-bar' }, strip.element, windowButtons());

document
  .getElementById('root')
  ?.append(
    el(
      'div',
      { class: 'nexus' },
      bar,
      el('main', { class: 'nexus-main' }, home.element, stopped.element, framesBox),
    ),
  );

/** Shows the open tab: its frame (made once, kept), Symbiotes, or a stopped one's panel. */
function show(): void {
  const tab = state.tabs.find((t) => t.root === state.selected);
  // Frames of Symbiotes that stopped, or whose tab closed, are unloaded; a restarted one's moves.
  for (const [root, frame] of state.frames) {
    const its = state.tabs.find((t) => t.root === root);
    if (!its?.url || !state.opened.has(root)) {
      frame.remove();
      state.frames.delete(root);
    } else if (frame.dataset.url !== its.url) {
      frame.dataset.url = its.url;
      void address(frame, its.url);
    }
  }
  if (tab?.url) {
    state.opened.add(tab.root);
    if (!state.frames.has(tab.root)) {
      const frame = el('iframe', {
        class: 'nexus-frame',
        title: tab.name,
        'data-url': tab.url,
        // Copy SHA, an image pasted into a terminal: the clipboard, as in a tab of its own.
        allow: 'clipboard-read; clipboard-write',
      });
      state.frames.set(tab.root, frame);
      framesBox.append(frame);
      void address(frame, tab.url);
    }
  }
  for (const [root, frame] of state.frames) frame.hidden = root !== state.selected;
  home.element.hidden = tab !== undefined;
  stopped.element.hidden = !(tab && tab.url === null);
  if (tab && tab.url === null) stopped.draw(tab);
  else stopped.clear();
  document.title = titleOf(tab);
}

/**
 * Gives a frame its Symbiote's address once this browser reaches it (decision 625): a browser on
 * Windows reaches a new port of WSL's late, and a frame refused once stays refused. A frame
 * unloaded or moved meanwhile is left as it is.
 */
async function address(frame: HTMLIFrameElement, url: string): Promise<void> {
  await reached(url, browserReach);
  if (!frame.isConnected || frame.dataset.url !== url) return;
  // With its open token (SC1): the framed page trades it for its page key, and writes.
  const opened = await frameAddress(url);
  if (frame.isConnected && frame.dataset.url === url) frame.src = opened;
}

function render(): void {
  strip.draw();
  home.draw();
  show();
}

// ---- what the person does ----------------------------------------------------------------------

function select(root: string | null, { focusFrame = false } = {}): void {
  state.selected = root;
  // The open tab in the address, with no entry of the nexus's own in the history (decision 521);
  // Symbiotes' with the folder the person went to, if any.
  const hash =
    root === null ? (state.browsed === null ? '' : foldersHash(state.browsed)) : hashOf(root);
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}${hash}`,
  );
  render();
  if (focusFrame && root !== null) state.frames.get(root)?.focus();
}

function closeStopped(root: string): void {
  state.opened.delete(root);
  state.tabs = closeTab(state.tabs, root);
  if (state.selected === root) select(null);
  else render();
}

window.addEventListener('hashchange', () => {
  const next = selectedFrom(window.location.hash);
  const path = folderFromHash(window.location.hash);
  if (next === null && path !== null && path !== state.browsed && state.known) {
    setQuery(folderName(path, state.known.home));
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
    if (state.selected !== null) select(null);
    list.field.focus();
    list.field.select();
  } else if (
    event.key === '/' &&
    !typing &&
    state.selected === null &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
    event.preventDefault();
    list.field.focus();
  }
});

paintTitleBar();

window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', paintTitleBar);

render();

void readKnown();

void read();
