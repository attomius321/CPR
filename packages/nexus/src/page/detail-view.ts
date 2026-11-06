// The picked repository's card (NX5, decisions 908, 913, 914, 916): its head (its state, its name,
// its status, what can be done with it), then why it did not open or what it waits for, its path
// as crumbs, its facts, its checkouts, the folder it is in; a folder's card its own folders and
// (NX6, decision 929) Open Symbiote, which asks, then `git init`s it. What it shows is `main.ts`'s
// to read; this draws it, again only when it changed.
import type { Folder } from '../folders.js';
import type { Found } from '../scan.js';
import {
  ARROW_UP_RIGHT,
  CHECK,
  CIRCLE_CHECK,
  CIRCLE_DOT,
  CIRCLE_X,
  COPY,
  el,
  FOLDER,
  FOLDER_OPEN,
  HOUSE,
  icon,
  loading,
  pinButton,
  SEARCH,
  SPIN,
  STOP,
  TERMINAL,
  type Child,
} from './dom.js';
import { rowLead, rowParts } from './list-view.js';
import type { CardKind } from './pick.js';
import { shownPath, type Row } from './search.js';
import { changesText, checkoutText, sinceText, timeText } from './tabs.js';

export interface CardState {
  kind: CardKind;
  row: Row | null;
  home: string;
  now: Date;
  /** The repository's checkouts; undefined while they are read. */
  checkouts: Found[] | null | undefined;
  /** The folder's own entries (a folder's card) or the folder it is in (a repository's). */
  listing: Folder[] | null | undefined;
  /** Why it did not open. */
  failed: string | null;
  /** A folder's Symbiote starting (after `git init`). */
  starting: boolean;
  /** Why the folder cannot be made a repository (home, the top, a drive); null when it can. */
  refused: string | null;
  /** The path just copied. */
  copied: boolean;
  /** Rows of the card's lists as the list would draw them (their Symbiote, their pin). */
  rowOf: (folder: Folder) => Row;
}

export interface CardHandlers {
  show: (row: Row) => void;
  open: (row: Row) => void;
  stop: (row: Row, from: HTMLElement) => void;
  pin: (row: Row, pinned: boolean) => void;
  copy: (row: Row) => void;
  /** Types a path into the list's field: a crumb, a folder or repository in the card. */
  type: (text: string) => void;
  /** Shows a folder's folders: in home's tree, else typed into the field. */
  goIn: (row: Row) => void;
}

const status = (tone: string | null, paths: string, words: string, spin = false) => {
  const mark = icon(paths, true);
  if (spin) mark.classList.add('spin');
  return el('span', { class: 'status-label', ...(tone ? { 'data-tone': tone } : {}) }, mark, words);
};

export function detailView(handlers: CardHandlers): {
  element: HTMLElement;
  draw(state: CardState): void;
} {
  const element = el('section', { class: 'nexus-card nexus-detail', 'aria-label': 'The pick' });
  let drawn = '';

  const button = (
    words: Child[],
    onClick: (from: HTMLElement) => void,
    {
      kind = '',
      label,
      disabled = false,
    }: { kind?: string; label?: string; disabled?: boolean } = {},
  ) => {
    const b = el(
      'button',
      {
        type: 'button',
        class: kind ? `button ${kind}` : 'button',
        ...(label ? { 'aria-label': label } : {}),
        disabled,
      },
      ...words,
    );
    b.addEventListener('click', () => onClick(b));
    return b;
  };

  /** A path as crumbs from home (or the top): each a button that lists it, the last the one shown. */
  function crumbs(path: string, home: string, folder: boolean): HTMLElement {
    const inHome = path === home || path.startsWith(`${home}/`);
    const start = inHome ? home : '/';
    const parts = path.slice(start.length).split('/').filter(Boolean);
    const items: Child[] = [];
    const crumb = (at: string, label: Child, name: string, last: boolean) => {
      if (last) {
        return el(
          'span',
          { class: 'nexus-crumb', 'aria-current': 'page' },
          label,
          folder ? '/' : '',
        );
      }
      const b = el('button', { type: 'button', class: 'nexus-crumb', 'aria-label': name }, label);
      b.addEventListener('click', () =>
        handlers.type(`${shownPath(at, home)}/`.replace(/^\/\/$/, '/')),
      );
      return b;
    };
    items.push(
      crumb(
        start,
        inHome ? icon(HOUSE, true) : '/',
        inHome ? 'Home' : 'The top',
        parts.length === 0,
      ),
    );
    let at = start === '/' ? '' : start;
    parts.forEach((name, n) => {
      at = `${at}/${name}`;
      items.push(el('span', { class: 'nexus-crumb-sep', 'aria-hidden': 'true' }, '/'));
      items.push(crumb(at, name, name, n === parts.length - 1));
    });
    return el('nav', { class: 'nexus-crumbs', 'aria-label': 'Its path' }, ...items);
  }

  /** A list inside the card: rows that type their path into the field. */
  function subCard(
    name: Child | Child[],
    label: string,
    end: string,
    rows: Row[],
    state: CardState,
    current?: string,
  ) {
    return el(
      'div',
      { class: 'nexus-sub', role: 'group', 'aria-label': label },
      el(
        'div',
        { class: 'nexus-sub-head' },
        el('span', { class: 'nexus-sub-name' }, ...(Array.isArray(name) ? name : [name])),
        el('span', { class: 'count' }, String(rows.length)),
        el('span', { class: 'nexus-sub-end' }, end),
      ),
      el(
        'div',
        { class: 'nexus-sub-rows' },
        ...rows.map((row) => {
          const b = el(
            'button',
            {
              type: 'button',
              class: row.path === current ? 'nexus-row picked' : 'nexus-row',
              'data-path': row.path,
            },
            ...rowParts(row, { home: state.home, now: state.now }),
          );
          b.addEventListener('click', () =>
            handlers.type(
              row.repository
                ? shownPath(row.path, state.home)
                : `${shownPath(row.path, state.home)}/`,
            ),
          );
          return b;
        }),
      ),
    );
  }

  function facts(pairs: [string, Child][]): HTMLElement {
    return el(
      'dl',
      { class: 'nexus-facts' },
      ...pairs.flatMap(([name, value]) => [el('dt', {}, name), el('dd', {}, value)]),
    );
  }

  const notice = (paths: string, words: Child[], tone = '') =>
    el(
      'div',
      {
        class: tone ? `nexus-notice ${tone}` : 'nexus-notice',
        ...(tone === 'error' ? { role: 'alert' } : {}),
      },
      icon(paths, true),
      el('span', {}, ...words),
    );

  function copyButton(row: Row, copied: boolean) {
    const b = el(
      'button',
      {
        type: 'button',
        class: 'icon-button nexus-copy',
        'aria-label': copied ? 'Copied' : `Copy ${row.name}'s path`,
      },
      icon(copied ? CHECK : COPY, true),
    );
    b.addEventListener('click', () => handlers.copy(row));
    return b;
  }

  function repositoryCard(row: Row, state: CardState): Child[] {
    const { kind, now, home } = state;
    const lead = kind === 'starting' ? rowLead(row, true) : rowLead(row, false);
    const label =
      kind === 'running'
        ? status('ok', CIRCLE_CHECK, 'Running')
        : kind === 'starting'
          ? status('run', SPIN, 'Starting', true)
          : kind === 'failed'
            ? status('error', CIRCLE_X, 'Did not open')
            : status(null, CIRCLE_DOT, 'Not running');
    const actions: Child[] = [
      copyButton(row, state.copied),
      pinButton('nexus-detail-pin', { name: row.name, path: row.path, pinned: !!row.pinned }, () =>
        handlers.pin(row, !row.pinned),
      ),
    ];
    if (kind === 'running') {
      actions.push(
        button([icon(STOP, true), 'Stop'], (from) => handlers.stop(row, from), {
          kind: 'danger',
          label: `Stop ${row.name}`,
        }),
        button(['Show', icon(ARROW_UP_RIGHT, true)], () => handlers.show(row), {
          label: `Show ${row.name}`,
        }),
      );
    } else if (kind === 'starting') {
      actions.push(button([loading('Starting…')], () => undefined, { disabled: true }));
    } else {
      actions.push(
        button([kind === 'failed' ? 'Try again' : 'Open Symbiote'], () => handlers.open(row)),
      );
    }
    const body: Child[] = [];
    if (kind === 'starting') {
      body.push(
        notice(
          SPIN,
          [
            el('code', {}, 'symbiote view'),
            ` is starting in ${shownPath(row.path, home)}. Its tab opens once it serves.`,
          ],
          'run',
        ),
      );
    }
    if (kind === 'failed' && state.failed) {
      body.push(notice(CIRCLE_X, [`${row.name} did not open: ${state.failed}`], 'error'));
    }
    body.push(crumbs(row.path, home, false));
    const checkout =
      row.branch !== undefined
        ? row.branch
        : row.detached !== undefined
          ? checkoutText({ branch: null, head: row.detached })
          : 'no commits';
    const tab = row.tab;
    body.push(
      facts(
        tab
          ? [
              ['Branch', el('code', {}, checkoutText(tab))],
              ['Changes', changesText(tab.changed)],
              ['Running', sinceText(tab.started, now)],
              ['Serves at', el('code', {}, tab.url.replace(/^http:\/\/|\/$/g, ''))],
            ]
          : [
              ['Branch', el('code', {}, checkout)],
              ['Opened before', row.opened ? timeText(row.opened, now) : 'Not with this nexus'],
              ...(row.pinned
                ? [['Pinned', 'Kept in Symbiote’s settings'] as [string, Child]]
                : row.found
                  ? [['Found', 'In home, by the scan'] as [string, Child]]
                  : []),
            ],
      ),
    );
    const checkouts = state.checkouts ?? [];
    if (checkouts.length > 1) {
      body.push(
        subCard(
          'Checkouts of this repository',
          'Checkouts of this repository',
          'the folder and its worktrees',
          checkouts.map((found) => state.rowOf({ ...found, repository: true })),
          state,
          row.path,
        ),
      );
    }
    const parent = row.path.slice(0, row.path.lastIndexOf('/')) || '/';
    const skip = new Set([row.path, ...checkouts.map((c) => c.path)]);
    if (state.listing) {
      body.push(
        subCard(
          [icon(FOLDER_OPEN, true), `${shownPath(parent, home)}/`],
          'The folder it is in',
          'the folder it is in',
          state.listing.filter((entry) => !skip.has(entry.path)).map(state.rowOf),
          state,
        ),
      );
    }
    return [
      head(lead, row.name, label, actions),
      el('div', { class: 'nexus-detail-body' }, ...body),
    ];
  }

  function folderCard(row: Row, state: CardState): Child[] {
    const where = shownPath(row.path, state.home);
    const label = state.starting
      ? status('run', SPIN, 'Starting', true)
      : state.failed
        ? status('error', CIRCLE_X, 'Did not open')
        : status(null, FOLDER, row.pinned ? 'Pinned folder' : 'Folder');
    const go = button(['Go in'], () => handlers.goIn(row), {
      kind: 'secondary',
      label: `Go into ${row.name}`,
    });
    const actions: Child[] = [
      copyButton(row, state.copied),
      pinButton('nexus-detail-pin', { name: row.name, path: row.path, pinned: !!row.pinned }, () =>
        handlers.pin(row, !row.pinned),
      ),
      go,
    ];
    if (state.starting) {
      actions.push(button([loading('Starting…')], () => undefined, { disabled: true }));
    } else if (state.refused === null) {
      actions.push(
        button([state.failed ? 'Try again' : 'Open Symbiote'], () => handlers.open(row), {
          label: `Open Symbiote in ${row.name}`,
        }),
      );
    }
    const body: Child[] = [];
    if (state.failed) {
      body.push(notice(CIRCLE_X, [`${row.name} did not open: ${state.failed}`], 'error'));
    } else if (state.refused !== null) {
      body.push(notice(FOLDER, [state.refused]));
    } else if (state.starting) {
      body.push(
        notice(
          SPIN,
          [
            el('code', {}, 'symbiote view'),
            ` is starting in ${where}. Its tab opens once it serves.`,
          ],
          'run',
        ),
      );
    } else {
      body.push(
        notice(TERMINAL, [
          'No git repository here. Open Symbiote asks first, then runs ',
          el('code', {}, 'git init'),
          ` in ${where}: a .git folder is added, nothing else, and no commit is made.`,
        ]),
      );
    }
    body.push(crumbs(row.path, state.home, true));
    if (state.listing === undefined)
      body.push(el('p', { class: 'nexus-card-note' }, loading(`Reading ${where}…`)));
    else if (state.listing === null)
      body.push(el('p', { class: 'nexus-card-note' }, `${where} could not be read.`));
    else {
      body.push(
        subCard(
          [icon(FOLDER_OPEN, true), `${where}/`],
          `In ${where}`,
          'its folders, read as it is picked',
          state.listing.map(state.rowOf),
          state,
        ),
      );
    }
    return [
      head(rowLead(row, state.starting), `${row.name}/`, label, actions),
      el('div', { class: 'nexus-detail-body' }, ...body),
    ];
  }

  function goneCard(row: Row, state: CardState): Child[] {
    const unpin = button(['Unpin'], () => handlers.pin(row, false), {
      kind: 'secondary',
      label: `Unpin ${row.name}`,
    });
    return [
      head(rowLead(row, false), row.name, status('error', CIRCLE_X, 'Folder gone'), [
        copyButton(row, state.copied),
        unpin,
      ]),
      el(
        'div',
        { class: 'nexus-detail-body' },
        notice(FOLDER, [
          `${shownPath(row.path, state.home)} is no longer there: moved, renamed or deleted. It stays pinned until you unpin it, in case it comes back.`,
        ]),
      ),
    ];
  }

  function noneCard(): Child[] {
    return [
      el(
        'div',
        { class: 'nexus-detail-none' },
        el('h2', {}, 'Nothing picked'),
        el('p', {}, 'Pick a repository in the list to see it here.'),
        el(
          'div',
          { class: 'nexus-tips' },
          el('p', {}, icon(SEARCH, true), 'Type any part of a name or path'),
          el(
            'p',
            {},
            icon(FOLDER, true),
            'Start with ',
            el('code', {}, '~/'),
            ' or ',
            el('code', {}, '/'),
            ' to type a path, Tab completing it',
          ),
          el(
            'p',
            {},
            icon(TERMINAL, true),
            'Or run ',
            el('code', {}, 'symbiote view'),
            ' in a repository',
          ),
        ),
      ),
    ];
  }

  function head(lead: Element, name: string, label: Element, actions: Child[]): HTMLElement {
    return el(
      'header',
      { class: 'nexus-detail-head' },
      el('span', { class: 'nexus-detail-lead' }, lead),
      el('h2', {}, name),
      label,
      el('div', { class: 'nexus-detail-actions' }, ...actions),
    );
  }

  return {
    element,
    draw(state) {
      const key = JSON.stringify([
        state.kind,
        state.row,
        state.checkouts,
        state.listing,
        state.failed,
        state.starting,
        state.refused,
        state.copied,
        state.now.toDateString(),
        state.now.getHours(),
        state.now.getMinutes(),
      ]);
      if (key === drawn) return;
      drawn = key;
      // The focus stays on what had it in the card: a button of the same name, or the pin's
      // (its name turns from Pin to Unpin).
      const active = document.activeElement as HTMLElement | null;
      const inCard = active !== null && element.contains(active);
      const focused = inCard ? (active.getAttribute('aria-label') ?? active.textContent) : null;
      const pinFocused = inCard && active.classList.contains('nexus-detail-pin');
      const row = state.row;
      element.setAttribute('aria-label', row ? row.name : 'Nothing picked');
      const parts: Child[] =
        row === null || state.kind === 'none'
          ? noneCard()
          : state.kind === 'gone'
            ? goneCard(row, state)
            : state.kind === 'folder'
              ? folderCard(row, state)
              : repositoryCard(row, state);
      element.replaceChildren(...parts.filter((part): part is Node | string => !!part));
      if (focused) {
        (
          [...element.querySelectorAll<HTMLElement>('button')].find(
            (b) => (b.getAttribute('aria-label') ?? b.textContent) === focused,
          ) ?? (pinFocused ? element.querySelector<HTMLElement>('.nexus-detail-pin') : null)
        )?.focus();
      }
    },
  };
}
