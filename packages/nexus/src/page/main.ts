// Symbiote nexus's page (NX1b): a row of tabs, Symbiotes then one per running Symbiote, and the
// open one in a frame under it (decisions 521–523). A frame opened once stays loaded, hidden while
// another tab is shown. Drawn in the viewer's own stylesheet and its classes; the nexus's own
// layout is `page/nexus.css`.
import type { Symbiote } from '../symbiotes.js';
import {
  changesText,
  checkoutText,
  closeTab,
  hashOf,
  nextTabs,
  selectedFrom,
  sinceText,
  titleOf,
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
/** The open tab's folder; null: Symbiotes, the list. */
let selected = selectedFrom(window.location.hash);
/** The folders whose tab was opened: their frames are kept, their tabs too once they stop. */
const opened = new Set<string>();
const frames = new Map<string, HTMLIFrameElement>();
let failure: string | null = null;
let readOnce = false;

// ---- drawing ----------------------------------------------------------------------------------

type Child = Node | string | null | undefined | false;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false) continue;
    node.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

/** An icon as the viewer draws it (`ui/icons.tsx`): its paths on its grid. */
function icon(paths: string, lucide = false): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', lucide ? 'icon lucide' : 'icon');
  svg.setAttribute('viewBox', lucide ? '0 0 24 24' : '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = paths;
  return svg;
}

// The viewer's own (`ui/icons.tsx`): lucide's git-branch, circle-pause, and the window's buttons.
const BRANCH =
  '<path d="M6 3v12" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />';
const STOPPED = '<circle cx="8" cy="8" r="6" /><path d="M6.67 10V6M9.33 10V6" />';
const MINIMIZE = '<path d="M4 8h8" />';
const MAXIMIZE = '<rect x="4" y="4" width="8" height="8" rx="1.5" />';
const RESTORE =
  '<rect x="3.5" y="5.5" width="7" height="7" rx="1.5" /><path d="M6 5.5V5A1.5 1.5 0 0 1 7.5 3.5H11A1.5 1.5 0 0 1 12.5 5v3.5A1.5 1.5 0 0 1 11 10h-.5" />';
const CLOSE = '<path d="M4 4l8 8M12 4l-8 8" />';

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
const home = el('section', {
  class: 'nexus-home',
  id: 'nexus-home',
  role: 'tabpanel',
  'aria-label': 'Symbiotes',
});
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
    el('span', {}, 'Symbiotes'),
    el('span', { class: 'count' }, String(running)),
  );
  const children: HTMLElement[] = [list];
  for (const tab of tabs) {
    const button = tabButton(
      tab.root,
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
  const running = tabs.filter((tab): tab is Tab & { url: string } => tab.url !== null);
  const now = new Date();
  const key = JSON.stringify([
    readOnce,
    failure,
    running,
    now.toDateString(),
    now.getHours(),
    now.getMinutes(),
  ]);
  if (key === drawn.home) return;
  drawn.home = key;
  const count = running.length;
  const line = !readOnce
    ? 'Looking for running Symbiotes…'
    : `${count === 0 ? 'None' : count} running on this machine`;
  const head = el(
    'header',
    { class: 'page-head' },
    el('span', { class: 'page-icon', 'aria-hidden': 'true' }, mark()),
    el(
      'div',
      { class: 'page-title' },
      el('div', { class: 'page-name-line' }, el('h1', {}, 'Symbiotes')),
      el('div', { class: 'page-line' }, line),
    ),
  );
  const rows = running.map((tab) => {
    const row = el(
      'button',
      { type: 'button', class: 'nexus-row', 'data-root': tab.root },
      el(
        'span',
        { class: 'nexus-row-main' },
        el('span', { class: 'nexus-row-name' }, tab.name),
        el('span', { class: 'nexus-row-folder' }, tab.root),
      ),
      el('span', { class: 'nexus-row-checkout' }, icon(BRANCH, true), checkoutText(tab)),
      el('span', { class: 'nexus-row-changes' }, changesText(tab.changed)),
      el('span', { class: 'nexus-row-since' }, sinceText(tab.started, now)),
    );
    row.addEventListener('click', () => select(tab.root, { focusFrame: true }));
    return row;
  });
  const empty = el(
    'div',
    { class: 'nexus-empty' },
    icon(STOPPED),
    el('p', { class: 'nexus-empty-title' }, 'No Symbiote is running'),
    el(
      'p',
      { class: 'nexus-empty-text' },
      'Start one with ',
      el('code', {}, 'symbiote view'),
      ' in a repository: it shows here within 2 seconds.',
    ),
  );
  home.replaceChildren(
    ...[
      head,
      failure ? el('p', { class: 'nexus-failure error', role: 'alert' }, failure) : null,
      readOnce
        ? el(
            'div',
            { class: 'nexus-card' },
            count > 0 ? el('div', { class: 'nexus-rows' }, ...rows) : empty,
          )
        : null,
    ].filter((part) => part !== null),
  );
}

function drawStopped(tab: Tab): void {
  const key = JSON.stringify([tab.root, tab.name]);
  if (key === drawn.stopped) return;
  drawn.stopped = key;
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
        ' ended: run it again in its folder, and this tab takes it back.',
      ),
      el('p', { class: 'nexus-empty-text' }, el('code', {}, tab.root)),
      close,
    ),
  );
}

/** Shows the open tab: its frame (made once, kept), the list, or a stopped one's panel. */
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
  // The open tab in the address, with no entry of the nexus's own in the history (decision 521).
  const url = `${window.location.pathname}${window.location.search}${hashOf(root)}`;
  window.history.replaceState(null, '', url);
  render();
  if (focusFrame && root !== null) frames.get(root)?.focus();
}

function closeStopped(root: string): void {
  opened.delete(root);
  tabs = closeTab(tabs, root);
  if (selected === root) select(null);
  else render();
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

window.addEventListener('hashchange', () => select(selectedFrom(window.location.hash)));

// ---- reading ------------------------------------------------------------------------------------

async function read(): Promise<void> {
  try {
    const res = await fetch('/api/symbiotes', { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const { symbiotes } = (await res.json()) as { symbiotes: Symbiote[] };
    tabs = nextTabs(tabs, symbiotes, opened);
    failure = null;
    const first = !readOnce;
    readOnce = true;
    // A tab asked for by the address that is not there (any more): the list.
    if (selected !== null && !tabs.some((tab) => tab.root === selected)) select(null);
    else render();
    if (first && selected !== null) frames.get(selected)?.focus();
  } catch (error) {
    failure = `The running Symbiotes could not be read: ${(error as Error).message}`;
    render();
  }
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
