// The list's DOM (NX5, decisions 908–910, 913): its field at its head, the groups and their rows,
// where the repositories come from at its foot. The field is a combobox: the focus stays in it
// while ↑↓ move the pick. What is shown is `main.ts`'s to compute (`search.ts`, `complete.ts`);
// this draws it, again only when it changed, and leaves the field as the person types it.
import type { ScanSummary } from '../repositories.js';
import {
  BRANCH,
  CIRCLE_X,
  el,
  FOLDER,
  FOLDER_OPEN,
  FOLDER_SEARCH,
  icon,
  key,
  loading,
  PIN,
  REFRESH,
  SEARCH,
  SPIN,
  TERMINAL,
  type Child,
} from './dom.js';
import { marks, shownPath, type Group, type Row } from './search.js';
import { checkoutText, timeText } from './tabs.js';

/** What the list draws. */
export interface ListState {
  groups: readonly Group[];
  /** The picked row's path. */
  pick: string | null;
  /** The words searched, for the marks ('' while a path is typed). */
  words: string;
  home: string;
  /** What Tab would add, drawn after the typed text. */
  ghost: string;
  /** At the field's end: 'slash' (the key that finds), 'tab' (the key that completes), or a count. */
  hint: string;
  /** Instead of rows, why there are none. */
  message: Child;
  /** A first run: no Symbiote, no pin, nothing known, no folder chosen. */
  welcome: boolean;
  scanned: string | null;
  scan: ScanSummary | null;
  now: Date;
  starting: ReadonlySet<string>;
}

export interface ListHandlers {
  input: (value: string) => void;
  key: (event: KeyboardEvent) => void;
  pick: (path: string) => void;
  act: (path: string) => void;
  /** Change… or Choose…: where the repositories are looked for. */
  change: () => void;
  rescan: () => void;
}

export interface ListView {
  element: HTMLElement;
  field: HTMLInputElement;
  draw(state: ListState): void;
  /** Scrolls the picked row into the list's sight. */
  reveal(): void;
}

const PLACEHOLDER = 'Find by name or path; ~/ for a path';

/** A text with the words' places marked. */
function marked(text: string, words: string): Child[] {
  const out: Child[] = [];
  let at = 0;
  for (const [start, end] of marks(text, words)) {
    if (start > at) out.push(text.slice(at, start));
    out.push(el('mark', {}, text.slice(start, end)));
    at = end;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** A row's lead: its Symbiote's state, a folder, a pin gone, or the arc of one starting. */
export function rowLead(row: Row, starting: boolean): Element {
  if (starting) {
    const arc = icon(SPIN, true);
    arc.classList.add('spin', 'nexus-row-starting');
    return arc;
  }
  if (row.missing) return icon(CIRCLE_X, true);
  if (!row.repository) return icon(FOLDER, true);
  return el('span', {
    class: row.tab ? 'state-dot nexus-live' : 'state-dot tone-idle',
    'aria-hidden': 'true',
  });
}

/** When, in a row's words: since it runs, or when it was opened last. */
function whenOf(row: Row, now: Date): string {
  if (row.tab) return `since ${timeText(row.tab.started, now)}`;
  return row.opened ? `opened ${timeText(row.opened, now)}` : '';
}

/**
 * A row's contents: its lead, its name (a pin's mark beside a running one), its path, what it has
 * checked out and when; files changed at the end of a running one. The card's rows are the same.
 */
export function rowParts(
  row: Row,
  {
    words = '',
    home,
    now,
    starting = false,
  }: { words?: string; home: string; now: Date; starting?: boolean },
): Child[] {
  const meta: Child[] = [
    el('span', { class: 'nexus-row-path' }, ...marked(shownPath(row.path, home), words)),
  ];
  const sep = () => el('span', { class: 'nexus-row-sep', 'aria-hidden': 'true' }, '·');
  if (row.repository) {
    const checkout =
      row.branch !== undefined
        ? row.branch
        : row.detached !== undefined
          ? checkoutText({ branch: null, head: row.detached })
          : null;
    if (checkout !== null) {
      meta.push(
        sep(),
        el('span', { class: 'nexus-row-branch' }, icon(BRANCH, true), el('code', {}, checkout)),
      );
    }
    const when = whenOf(row, now);
    if (when) meta.push(sep(), el('span', {}, when));
  } else {
    meta.push(
      sep(),
      el('span', {}, row.missing ? 'folder gone' : row.pinned ? 'pinned folder' : 'folder'),
    );
  }
  const changed = row.tab?.changed;
  return [
    el('span', { class: 'nexus-row-lead' }, rowLead(row, starting)),
    el(
      'span',
      { class: 'nexus-row-main' },
      el(
        'span',
        { class: 'nexus-row-line' },
        el(
          'span',
          { class: 'nexus-row-name' },
          ...marked(row.name, words),
          row.repository || row.missing ? null : '/',
        ),
        row.pinned &&
          row.repository &&
          el('span', { class: 'nexus-row-pin', title: 'Pinned' }, icon(PIN, true)),
      ),
      el('span', { class: 'nexus-row-meta' }, ...meta),
    ),
    el(
      'span',
      { class: 'nexus-row-side' },
      changed === undefined
        ? null
        : changed === 0
          ? 'no changes'
          : el('span', {}, el('b', {}, String(changed)), ' changed'),
    ),
  ];
}

export function listView(handlers: ListHandlers): ListView {
  const field = el('input', {
    class: 'search-input nexus-field',
    type: 'text',
    role: 'combobox',
    'aria-label': 'Find a repository by name or path',
    'aria-controls': 'nexus-rows',
    'aria-expanded': 'true',
    'aria-autocomplete': 'list',
    placeholder: PLACEHOLDER,
    autocomplete: 'off',
    spellcheck: 'false',
  });
  // What Tab would add, drawn after the text typed: a copy of the text, unseen, then the rest.
  const ghostTyped = el('span', { class: 'nexus-ghost-typed' });
  const ghostRest = el('span', { class: 'nexus-ghost-rest' });
  const ghost = el('span', { class: 'nexus-ghost', 'aria-hidden': 'true' }, ghostTyped, ghostRest);
  const hint = el('span', { class: 'nexus-field-hint' });
  const rows = el('div', {
    class: 'nexus-rows',
    id: 'nexus-rows',
    role: 'listbox',
    'aria-label': 'Repositories',
  });
  const foot = el('footer', { class: 'nexus-foot' });
  const element = el(
    'section',
    { class: 'nexus-card nexus-list', 'aria-label': 'Repositories the nexus knows' },
    el(
      'div',
      { class: 'nexus-find' },
      el(
        'label',
        { class: 'nexus-field-box' },
        icon(SEARCH, true),
        el('span', { class: 'nexus-field-text' }, field, ghost),
        hint,
      ),
    ),
    rows,
    foot,
  );

  field.addEventListener('input', () => handlers.input(field.value));
  field.addEventListener('keydown', (event) => handlers.key(event));
  field.addEventListener(
    'scroll',
    () => (ghost.style.transform = `translateX(${-field.scrollLeft}px)`),
  );
  // A click picks and keeps the focus in the field; a double click acts.
  rows.addEventListener('mousedown', (event) => event.preventDefault());
  rows.addEventListener('click', (event) => {
    const row = (event.target as Element).closest<HTMLElement>('[role="option"]');
    if (row?.dataset.path) handlers.pick(row.dataset.path);
  });
  rows.addEventListener('dblclick', (event) => {
    const row = (event.target as Element).closest<HTMLElement>('[role="option"]');
    if (row?.dataset.path) handlers.act(row.dataset.path);
  });

  let drawn = '';
  let drawnFoot = '';

  function drawRows(state: ListState): void {
    const key = JSON.stringify([
      state.groups.map((g) => [g.key, g.name, g.order, g.more, g.rows]),
      state.pick,
      state.words,
      state.welcome,
      typeof state.message === 'string' ? state.message : state.message ? 'node' : null,
      [...state.starting],
      state.now.toDateString(),
      state.now.getHours(),
      state.now.getMinutes(),
    ]);
    if (key === drawn) return;
    drawn = key;
    const children: Child[] = [];
    if (state.welcome) {
      children.push(
        el(
          'div',
          { class: 'nexus-welcome' },
          el('span', { class: 'nexus-welcome-icon', 'aria-hidden': 'true' }, icon(TERMINAL, true)),
          el(
            'div',
            {},
            el('h3', {}, 'No Symbiote runs yet'),
            el(
              'p',
              {},
              'Choose the folder your repositories are in: pick it below, then Look for repositories here. Or run ',
              el('code', {}, 'symbiote view'),
              ' in a repository: it shows here within 2 seconds.',
            ),
          ),
        ),
      );
    }
    let index = 0;
    state.groups.forEach((g, n) => {
      const head = `nexus-group-${n}`;
      children.push(
        el(
          'div',
          { class: 'nexus-group', role: 'group', 'aria-labelledby': head },
          el(
            'div',
            { class: 'nexus-group-head', id: head },
            g.key === 'hits' || (g.key === 'others' && n === 0) ? icon(FOLDER_OPEN, true) : null,
            el('span', { class: 'nexus-group-name' }, g.name),
            el('span', { class: 'count' }, String(g.rows.length)),
            el('span', { class: 'nexus-group-order' }, g.order),
          ),
          ...g.rows.map((row) => {
            const id = `nexus-row-${index++}`;
            const picked = row.path === state.pick;
            return el(
              'div',
              {
                class: picked ? 'nexus-row picked' : 'nexus-row',
                role: 'option',
                id,
                'aria-selected': picked ? 'true' : 'false',
                'data-path': row.path,
              },
              ...rowParts(row, {
                words: state.words,
                home: state.home,
                now: state.now,
                starting: state.starting.has(row.path),
              }),
            );
          }),
          g.more > 0 &&
            el(
              'p',
              { class: 'nexus-more' },
              `and ${g.more.toLocaleString('en')} more: type to find them`,
            ),
        ),
      );
    });
    if (state.message) children.push(el('p', { class: 'nexus-message' }, state.message));
    rows.replaceChildren(...children.filter((child): child is Node | string => !!child));
    const pickedRow = rows.querySelector<HTMLElement>('[aria-selected="true"]');
    if (pickedRow) field.setAttribute('aria-activedescendant', pickedRow.id);
    else field.removeAttribute('aria-activedescendant');
  }

  function drawFoot(state: ListState): void {
    const key = JSON.stringify([state.scanned, state.scan, state.home]);
    if (key === drawnFoot) return;
    drawnFoot = key;
    const button = (words: string, onClick: () => void) => {
      const b = el('button', { type: 'button', class: 'link nexus-foot-change' }, words);
      b.addEventListener('click', onClick);
      return b;
    };
    if (state.scanned === null) {
      foot.replaceChildren(
        el(
          'span',
          { class: 'nexus-foot-what' },
          icon(FOLDER_SEARCH, true),
          'No folder chosen to look for repositories in',
        ),
        button('Choose…', handlers.change),
      );
      return;
    }
    const where = shownPath(state.scanned, state.home);
    if (state.scan === null) {
      foot.replaceChildren(
        el('span', { class: 'nexus-foot-what' }, loading(`Looking in ${where}…`)),
        button('Change…', handlers.change),
      );
      return;
    }
    const { repositories, folders, ms, at, short } = state.scan;
    const again = el(
      'button',
      {
        type: 'button',
        class: 'icon-button nexus-foot-again',
        'aria-label': `Scan ${where} again`,
      },
      icon(REFRESH, true),
    );
    again.addEventListener('click', handlers.rescan);
    foot.replaceChildren(
      el(
        'span',
        { class: 'nexus-foot-what' },
        icon(FOLDER_SEARCH, true),
        el(
          'span',
          {},
          'Looking in ',
          el('b', {}, where),
          `: ${repositories} ${repositories === 1 ? 'repository' : 'repositories'} in ${folders.toLocaleString('en')} folders, ${ms} ms, at ${timeText(at, state.now)}`,
          short ? ', stopped there: a limit was reached' : '',
        ),
      ),
      button('Change…', handlers.change),
      again,
    );
  }

  function drawField(state: ListState): void {
    if (state.ghost && field.value.length > 0) {
      ghostTyped.textContent = field.value;
      ghostRest.textContent = state.ghost;
    } else {
      ghostTyped.textContent = '';
      ghostRest.textContent = '';
    }
    const hintKey = state.hint;
    if (hint.dataset.hint === hintKey) return;
    hint.dataset.hint = hintKey;
    if (hintKey === 'slash') hint.replaceChildren(key('/'));
    else if (hintKey === 'tab') hint.replaceChildren(key('Tab'), ' completes');
    else hint.replaceChildren(hintKey);
  }

  return {
    element,
    field,
    draw(state) {
      drawField(state);
      drawRows(state);
      drawFoot(state);
    },
    reveal() {
      rows.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    },
  };
}
