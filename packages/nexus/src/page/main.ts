// Symbiote nexus's page (NX1b): a row of tabs, Symbiotes, then one per running Symbiote, and the
// open one in a frame under it (decisions 521–523, 539). A frame opened once stays loaded, hidden
// while another tab is shown. Drawn in the viewer's own stylesheet and its classes; the nexus's own
// layout is `page/nexus.css`. Since NX3 the row has two groups, a line between (decision 551), and
// Symbiotes shows cards (552). Since fix/nexus-pinned-symbiotes Symbiotes is the nexus's one page:
// the pinned repositories among its cards, this PC's folders under them (decisions 626–628).
import type { Running } from '../registry.js';
import type { Symbiote } from '../symbiotes.js';
import {
  BRANCH,
  CLOSE,
  el,
  GRID,
  icon,
  MAXIMIZE,
  MINIMIZE,
  pinButton,
  RESTORE,
  STOP,
  STOPPED,
  type Child,
} from './dom.js';
import { checkoutWords, folderFromHash, foldersHash } from './folders-tab.js';
import { foldersView } from './folders-view.js';
import {
  changesText,
  checkoutText,
  closeTab,
  hashOf,
  nextTabs,
  selectedFrom,
  sinceText,
  symbiotesShown,
  titleOf,
  type SymbioteCard,
  type Tab,
} from './tabs.js';

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

const desktop = window.symbioteApp;

let tabs: Tab[] = [];
/** The open tab: a Symbiote's folder, or null: Symbiotes, the list. */
let selected = selectedFrom(window.location.hash);
/** The folder the person went to under Symbiotes, kept in its address; null: none asked for. */
let browsed = folderFromHash(window.location.hash);
/** The folders whose tab was opened: their frames are kept, their tabs too once they stop. */
const opened = new Set<string>();
const frames = new Map<string, HTMLIFrameElement>();
let failure: string | null = null;
let readOnce = false;
/** Why a Symbiote did not stop, or a pinned one did not open or pin, on the list. */
let actionFailure: string | null = null;
/** The pinned repositories whose Symbiote is starting. */
const startingPinned = new Set<string>();
/** The stopped tabs whose Symbiote is starting again, and why one did not. */
const restarting = new Set<string>();
let restartFailure: { root: string; why: string } | null = null;

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

const strip = el('div', {
  class: 'workspace-views nexus-tabs',
  role: 'tablist',
  'aria-label': 'Running Symbiotes',
});
const folders = foldersView({
  start: startSymbiote,
  show: (root) => select(root, { focusFrame: true }),
  moved: (path) => {
    browsed = path;
    if (selected === null) select(null);
  },
  pinsChanged: () => render(),
});
// Symbiotes: its head (the S, the count, Go to folder), what went wrong, the cards, and this PC's
// folders under them (decision 626). Only the line and the cards are drawn again.
const homeLine = el('div', { class: 'page-line' });
const homeProblem = el('p', { class: 'nexus-failure error', role: 'alert', hidden: true });
const homeCards = el('div', { class: 'nexus-home-cards' });
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
    el('div', { class: 'page-actions' }, folders.go),
  ),
  homeProblem,
  homeCards,
  folders.element,
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
const drawn = { strip: '', home: '', stopped: '' };

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
    tabs.length > 0 && el('span', { class: 'views-divider nexus-divider', 'aria-hidden': 'true' }),
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
      class: picked ? 'selected' : '',
      'aria-selected': picked ? 'true' : 'false',
      tabindex: picked ? '0' : '-1',
      'data-tab': root ?? '',
    },
    ...children,
  );
  button.addEventListener('click', () => select(root, { focusFrame: true }));
  return button;
}

function drawHome(): void {
  const pins = folders.pinned;
  const cards = symbiotesShown(tabs, pins ?? []);
  const count = tabs.filter((tab) => tab.url !== null).length;
  const now = new Date();
  const key = JSON.stringify([
    readOnce,
    failure,
    actionFailure,
    cards,
    pins === null,
    [...startingPinned],
    now.toDateString(),
    now.getHours(),
    now.getMinutes(),
  ]);
  if (key === drawn.home) return;
  drawn.home = key;
  homeLine.textContent = !readOnce
    ? 'Looking for running Symbiotes…'
    : `${count === 0 ? 'None' : count} running on this machine`;
  const problem = failure ?? actionFailure;
  homeProblem.textContent = problem ?? '';
  homeProblem.hidden = problem === null;
  // Focus stays on what had it (a card, its pin or Stop), drawn again; on the next card when the
  // card it was on left (unpinned).
  const active = document.activeElement as HTMLElement | null;
  const inCards = active !== null && homeCards.contains(active);
  const focused = inCards ? active.dataset.path : undefined;
  const focusedKind = inCards ? active.classList[0] : undefined;
  const focusedAt = inCards
    ? [...homeCards.querySelectorAll('.nexus-symbiote')].findIndex((card) => card.contains(active))
    : -1;
  const empty = el(
    'div',
    { class: 'nexus-card' },
    el(
      'div',
      { class: 'nexus-empty' },
      icon(STOPPED),
      el('p', { class: 'nexus-empty-title' }, 'No Symbiote is running'),
      el(
        'p',
        { class: 'nexus-empty-text' },
        'Open one on a repository below, or start one with ',
        el('code', {}, 'symbiote view'),
        ' in a repository: it shows here within 2 seconds.',
      ),
    ),
  );
  homeCards.replaceChildren(
    ...(readOnce
      ? [
          cards.length > 0
            ? el(
                'div',
                { class: 'nexus-symbiotes' },
                ...cards.map((card) => symbioteCard(card, pins !== null, now)),
              )
            : empty,
        ]
      : []),
  );
  if (!inCards) return;
  const again =
    focused !== undefined && focusedKind
      ? homeCards.querySelector<HTMLElement>(`.${focusedKind}[data-path="${CSS.escape(focused)}"]`)
      : null;
  const opens = [...homeCards.querySelectorAll<HTMLElement>('.nexus-symbiote-open')];
  (
    again ??
    opens[Math.min(focusedAt, opens.length - 1)] ??
    folders.go.querySelector('input')
  )?.focus();
}

/**
 * A card on Symbiotes (decisions 552, 627): a running Symbiote's opens its tab, Stop beside it; a
 * pinned repository's with none running opens its Symbiote, the person's start (619). Each has its
 * pin in its corner once the pins are read; a button cannot hold a button, so they stand beside.
 */
function symbioteCard(card: SymbioteCard, pinsRead: boolean, now: Date): HTMLElement {
  const runs = card.kind === 'running';
  const name = runs ? card.tab.name : card.pin.name;
  const root = runs ? card.tab.root : card.pin.path;
  const pinned = !runs || card.pinned;
  const busy = !runs && startingPinned.has(root);
  let meta: Child[];
  if (runs) {
    meta = [
      el('span', { class: 'nexus-symbiote-checkout' }, icon(BRANCH, true), checkoutText(card.tab)),
      el('span', {}, changesText(card.tab.changed)),
      el('span', {}, sinceText(card.tab.started, now)),
    ];
  } else {
    const checkout = checkoutWords(card.pin);
    meta = [
      checkout !== null &&
        el('span', { class: 'nexus-symbiote-checkout' }, icon(BRANCH, true), checkout),
      el('span', { class: 'nexus-symbiote-action' }, busy ? 'Starting…' : 'Open Symbiote'),
    ];
  }
  const open = el(
    'button',
    {
      type: 'button',
      class: 'nexus-symbiote-open',
      'data-path': root,
      ...(runs ? {} : { 'aria-label': `Open Symbiote in ${name}` }),
      disabled: busy,
    },
    el(
      'span',
      { class: 'nexus-symbiote-name' },
      el('span', {
        class: runs ? 'state-dot nexus-live' : 'state-dot tone-idle',
        'aria-hidden': 'true',
      }),
      el('span', {}, name),
    ),
    el('span', { class: 'nexus-symbiote-folder' }, root),
    el('span', { class: 'nexus-symbiote-meta' }, ...meta),
  );
  if (runs) open.addEventListener('click', () => select(root, { focusFrame: true }));
  else open.addEventListener('click', () => void openPinned(root, name));
  const actions = el(
    'span',
    { class: 'nexus-symbiote-actions' },
    pinsRead &&
      pinButton('nexus-symbiote-pin', { name, path: root, pinned }, () => {
        void togglePin({ name, path: root }, !pinned);
      }),
  );
  if (runs) {
    const tab = card.tab;
    const stop = el(
      'button',
      {
        type: 'button',
        class: 'nexus-symbiote-stop icon-button',
        'aria-label': `Stop ${name}`,
        'data-path': root,
      },
      icon(STOP, true),
    );
    stop.addEventListener('click', () => void stopSymbiote(tab, stop));
    actions.append(stop);
  }
  return el(
    'div',
    { class: runs ? 'nexus-symbiote' : 'nexus-symbiote idle', 'data-path': root },
    open,
    actions,
  );
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
    busy ? 'Starting…' : 'Start again',
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

/** Shows the open tab: its frame (made once, kept), the list, Folders, or a stopped one's panel. */
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
      frame.src = its.url;
    }
  }
  if (tab?.url) {
    opened.add(tab.root);
    if (!frames.has(tab.root)) {
      const frame = el('iframe', {
        class: 'nexus-frame',
        src: tab.url,
        title: tab.name,
        'data-url': tab.url,
        // Copy SHA, an image pasted into a terminal: the clipboard, as in a tab of its own.
        allow: 'clipboard-read; clipboard-write',
      });
      frames.set(tab.root, frame);
      framesBox.append(frame);
    }
  }
  for (const [root, frame] of frames) frame.hidden = root !== selected;
  home.hidden = tab !== undefined;
  // Listed at once, whichever tab is open: the pins come with a listing.
  folders.open(folders.path ?? browsed);
  folders.draw(new Set(tabs.filter((t) => t.url !== null).map((t) => t.root)));
  stopped.hidden = !(tab && tab.url === null);
  if (tab && tab.url === null) drawStopped(tab);
  else if (drawn.stopped !== '') {
    drawn.stopped = '';
    stopped.replaceChildren();
  }
  document.title = titleOf(tab);
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

/**
 * Starts `symbiote view` in `folder` (decision 541), or finds the one serving it, and opens its
 * tab: null once it is open, else why not.
 */
async function startSymbiote(folder: string): Promise<string | null> {
  let answer: { symbiote: Running } | { error: string };
  try {
    const res = await post('/api/symbiotes', { folder });
    answer = res.headers.get('content-type')?.includes('json')
      ? ((await res.json()) as typeof answer)
      : { error: `${res.status}: ${await res.text()}` };
  } catch (error) {
    answer = { error: (error as Error).message };
  }
  if ('error' in answer) return answer.error;
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
  if (why !== null) restartFailure = { root, why };
  render();
}

/** Stops a Symbiote, after a question (decision 542): its tab, if opened, is then stopped. */
async function stopSymbiote(tab: Tab, from: HTMLElement): Promise<void> {
  const stop = await confirmStop(tab.name);
  from.focus();
  if (!stop) return;
  actionFailure = null;
  try {
    const res = await post('/api/symbiotes/stop', { root: tab.root });
    if (!res.ok && res.status !== 404)
      actionFailure = `${tab.name} did not stop: ${await res.text()}`;
  } catch (error) {
    actionFailure = `${tab.name} did not stop: ${(error as Error).message}`;
  }
  await refresh();
}

/** Opens a Symbiote in a pinned repository, by the person's click on its card (decision 627). */
async function openPinned(folder: string, name: string): Promise<void> {
  startingPinned.add(folder);
  actionFailure = null;
  render();
  const why = await startSymbiote(folder);
  startingPinned.delete(folder);
  if (why !== null) actionFailure = `${name} did not open: ${why}`;
  render();
}

/** Pins or unpins a Symbiote from its card (decision 627): the cards are drawn again. */
async function togglePin(folder: { name: string; path: string }, pinned: boolean): Promise<void> {
  const why = await folders.setPin(folder, pinned);
  actionFailure = why;
  render();
}

/**
 * The question before a Symbiote stops, in the viewer's dialog (its `ConfirmDialog`): staying is
 * the default, Escape stays.
 */
function confirmStop(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const keep = el('button', { type: 'button', class: 'button' }, 'Keep it running');
    const stop = el('button', { type: 'button', class: 'button ghost' }, 'Stop');
    const box = el(
      'div',
      {
        class: 'dialog',
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-labelledby': 'nexus-stop-question',
        'aria-describedby': 'nexus-stop-detail',
      },
      el('h2', { id: 'nexus-stop-question' }, `Stop ${name}?`),
      el(
        'p',
        { id: 'nexus-stop-detail' },
        'Its symbiote view ends, with its terminals and any agent working in them. Open it again from Symbiotes.',
      ),
      el('div', { class: 'dialog-buttons' }, stop, keep),
    );
    const backdrop = el('div', { class: 'dialog-backdrop' }, box);
    const answer = (value: boolean) => {
      backdrop.remove();
      resolve(value);
    };
    keep.addEventListener('click', () => answer(false));
    stop.addEventListener('click', () => answer(true));
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
  if (next === null && path !== null) {
    browsed = path;
    if (path !== folders.path) folders.open(path);
  }
  select(next);
});

// ---- reading ------------------------------------------------------------------------------------

/** Reads the running Symbiotes once and draws what changed. */
async function refresh(): Promise<void> {
  try {
    const res = await fetch('/api/symbiotes', { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const { symbiotes } = (await res.json()) as { symbiotes: Symbiote[] };
    tabs = nextTabs(tabs, symbiotes, opened);
    failure = null;
    const first = !readOnce;
    readOnce = true;
    // A tab asked for by the address that is not there (any more): the list.
    const gone = selected !== null && !tabs.some((t) => t.root === selected);
    if (gone) select(null);
    else render();
    if (first && selected !== null) frames.get(selected)?.focus();
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
void read();
