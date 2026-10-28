// The Folders tab (NX2b, decisions 539, 540): this PC's folders, the repositories marked, and Open
// Symbiote on each. Drawn in the viewer's classes (the page head, a card and its head, buttons,
// chips, its field); `nexus.css` lays out the places, the crumbs and the rows.
import type { Folder, FoldersAnswer, Place } from '../folders.js';
import { ARROW_UP, DRIVE, el, FOLDER, FOLDER_GIT, HOUSE, icon } from './dom.js';
import { actionOf, crumbsOf, moreText, typedFolder } from './folders-tab.js';

export interface FoldersView {
  element: HTMLElement;
  /** Shows a folder (null: where the tab opens), unless it is the one shown. */
  open(path: string | null): void;
  /** Draws again, the running Symbiotes' roots marked (each read of the page's). */
  draw(running: ReadonlySet<string>): void;
  /** The folder shown; null before the first listing. */
  readonly path: string | null;
}

export interface FoldersDeps {
  /** Opens a Symbiote in `folder`: null once its tab is open, else why not. */
  start(folder: string): Promise<string | null>;
  /** Opens the tab of the Symbiote serving `root`. */
  show(root: string): void;
  /** The folder shown changed: the address keeps it. */
  moved(path: string): void;
}

const PLACE_ICONS: Record<Place['kind'], string> = {
  home: HOUSE,
  symbiotes: FOLDER,
  top: DRIVE,
  drive: DRIVE,
};

const lastName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? '/';

export function foldersView(deps: FoldersDeps): FoldersView {
  let answer: FoldersAnswer | null = null;
  let running: ReadonlySet<string> = new Set();
  /** What went wrong last: a folder not listed, or a Symbiote not started. */
  let error: string | null = null;
  /** The folders whose Symbiote is starting. */
  const starting = new Set<string>();
  /** Each listing asked for; an answer to an older one is dropped. */
  let asked = 0;
  let drawn = '';

  const places = el('div', { class: 'nexus-places', role: 'group', 'aria-label': 'Places' });
  const field = el('input', {
    class: 'search-input',
    type: 'text',
    placeholder: 'Go to folder: /path or ~/path',
    'aria-label': 'Go to folder',
    spellcheck: 'false',
    autocomplete: 'off',
  });
  const go = el('form', { class: 'nexus-go' }, field);
  go.addEventListener('submit', (event) => {
    event.preventDefault();
    const home = answer?.places.find((place) => place.kind === 'home')?.path ?? '';
    const path = typedFolder(field.value, home);
    if (path === null) {
      error = 'Type a full path: /… or ~/…';
      draw(running);
      return;
    }
    void list(path, { focus: true });
  });

  const cardHead = el('div', { class: 'card-head nexus-folders-head' });
  const body = el('div', { class: 'nexus-folders-body' });
  const element = el(
    'section',
    { class: 'nexus-folders', role: 'tabpanel', 'aria-label': 'Folders', hidden: true },
    el(
      'header',
      { class: 'page-head' },
      el('span', { class: 'page-icon', 'aria-hidden': 'true' }, icon(FOLDER, true)),
      el(
        'div',
        { class: 'page-title' },
        el('div', { class: 'page-name-line' }, el('h1', {}, 'Folders')),
        el('div', { class: 'page-line' }, 'Open a Symbiote in any repository on this PC'),
      ),
    ),
    el('div', { class: 'nexus-folders-bar' }, places, go),
    el('div', { class: 'nexus-card nexus-folders-card' }, cardHead, body),
  );

  // The rows by the keys: ↑ and ↓ between them, Backspace up a folder (Enter opens, as a button);
  // the field keeps its own keys.
  element.addEventListener('keydown', (event) => {
    if (event.target === field) return;
    const rows = [...body.querySelectorAll<HTMLButtonElement>('.nexus-folder-open')];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Backspace' && answer?.parent) {
      event.preventDefault();
      void list(answer.parent, { focus: true });
      return;
    }
    const to = event.key === 'ArrowDown' ? at + 1 : event.key === 'ArrowUp' ? at - 1 : -2;
    const next = rows[to];
    if (at < 0 || !next) return;
    event.preventDefault();
    next.focus();
  });

  /** Lists `path` (null: where the tab opens); a folder not listed keeps the one shown. */
  async function list(path: string | null, { focus = false } = {}): Promise<void> {
    const mine = ++asked;
    let next: FoldersAnswer | { error: string };
    try {
      const query = path === null ? '' : `?path=${encodeURIComponent(path)}`;
      const res = await fetch(`/api/folders${query}`, { cache: 'no-store' });
      next = res.headers.get('content-type')?.includes('json')
        ? ((await res.json()) as FoldersAnswer | { error: string })
        : { error: `${res.status}: ${await res.text()}` };
    } catch (failure) {
      next = { error: `The folders could not be read: ${(failure as Error).message}` };
    }
    if (mine !== asked) return;
    if ('error' in next) {
      error = next.error;
      // The address's folder is gone: where the tab opens, the error kept.
      if (answer === null && path !== null) {
        const kept = error;
        await list(null);
        error = kept;
      }
      draw(running);
      return;
    }
    answer = next;
    error = null;
    field.value = '';
    deps.moved(next.path);
    draw(running);
    // The first row, or Up in a folder without any: the keys stay in the tab.
    if (focus) {
      (
        body.querySelector<HTMLElement>('.nexus-folder-open') ??
        cardHead.querySelector<HTMLElement>('.icon-button')
      )?.focus();
    }
  }

  async function start(folder: string): Promise<void> {
    starting.add(folder);
    error = null;
    draw(running);
    const why = await deps.start(folder);
    starting.delete(folder);
    if (why !== null) error = `${lastName(folder)} did not open: ${why}`;
    draw(running);
  }

  function action(
    folder: string,
    kind: 'open' | 'show' | null,
    primary = false,
  ): HTMLElement | null {
    if (kind === null) return null;
    if (kind === 'show') {
      const show = el('button', { type: 'button', class: 'button secondary' }, 'Show');
      show.addEventListener('click', () => deps.show(folder));
      return show;
    }
    const busy = starting.has(folder);
    const open = el(
      'button',
      {
        type: 'button',
        class: primary ? 'button' : 'button secondary',
        disabled: busy,
        'aria-label': `Open Symbiote in ${lastName(folder)}`,
      },
      busy ? 'Starting…' : 'Open Symbiote',
    );
    open.addEventListener('click', () => void start(folder));
    return open;
  }

  function placeButton(place: Place, current: string | null): HTMLButtonElement {
    const here = place.path === current;
    const button = el(
      'button',
      {
        type: 'button',
        class: 'nexus-place',
        'aria-current': here ? 'true' : false,
        'data-path': place.path,
      },
      icon(PLACE_ICONS[place.kind], true),
      place.name,
    );
    button.addEventListener('click', () => void list(place.path, { focus: true }));
    return button;
  }

  function row(folder: Folder): HTMLElement {
    const kind = actionOf(folder, running);
    const open = el(
      'button',
      { type: 'button', class: 'nexus-folder-open', 'data-path': folder.path },
      icon(folder.repository ? FOLDER_GIT : FOLDER, true),
      el('span', { class: 'nexus-folder-name' }, folder.name),
      folder.repository && el('span', { class: 'chip' }, 'repository'),
      kind === 'show' && el('span', { class: 'chip' }, 'running'),
    );
    open.addEventListener('click', () => void list(folder.path, { focus: true }));
    return el(
      'div',
      { class: 'nexus-folder', 'data-path': folder.path },
      open,
      action(folder.path, kind),
    );
  }

  function draw(next: ReadonlySet<string>): void {
    running = next;
    const marks = answer
      ? [answer.repository, ...answer.folders.map((folder) => folder.path)].filter(
          (path): path is string => path !== null && running.has(path),
        )
      : [];
    const key = JSON.stringify([answer, marks, error, [...starting]]);
    if (key === drawn) return;
    drawn = key;
    // Focus stays on what had it (a place or a row), drawn again.
    const active = document.activeElement as HTMLElement | null;
    const focused = active?.dataset.path;
    const focusedKind = active?.classList[0];

    places.replaceChildren(
      ...(answer?.places ?? []).map((p) => placeButton(p, answer?.path ?? null)),
    );
    if (!answer) {
      cardHead.replaceChildren();
      body.replaceChildren(
        error
          ? el('p', { class: 'nexus-folders-error error', role: 'alert' }, error)
          : el('p', { class: 'nexus-folders-none' }, 'Reading the folders…'),
      );
      return;
    }
    const { parent, repository } = answer;
    const up = el(
      'button',
      { type: 'button', class: 'icon-button', 'aria-label': 'Up a folder', disabled: !parent },
      icon(ARROW_UP, true),
    );
    up.addEventListener('click', () => {
      if (parent) void list(parent, { focus: true });
    });
    const crumbs = crumbsOf(answer.path, answer.places);
    const trail = el('nav', { class: 'nexus-crumbs', 'aria-label': 'Folder' });
    crumbs.forEach((crumb, at) => {
      if (at > 0)
        trail.append(el('span', { class: 'nexus-crumb-sep', 'aria-hidden': 'true' }, '/'));
      if (at === crumbs.length - 1) {
        trail.append(el('span', { 'aria-current': 'page' }, crumb.name));
        return;
      }
      const link = el('button', { type: 'button', class: 'link' }, crumb.name);
      link.addEventListener('click', () => void list(crumb.path, { focus: true }));
      trail.append(link);
    });
    const inside =
      repository !== null && repository !== answer.path
        ? el('span', { class: 'nexus-folders-in' }, `In ${lastName(repository)}`)
        : null;
    cardHead.replaceChildren(
      up,
      trail,
      ...(repository === null
        ? []
        : [
            el(
              'div',
              { class: 'nexus-folders-actions' },
              inside,
              action(repository, running.has(repository) ? 'show' : 'open', true),
            ),
          ]),
    );
    body.replaceChildren(
      ...[
        error ? el('p', { class: 'nexus-folders-error error', role: 'alert' }, error) : null,
        answer.folders.length > 0
          ? el('div', { class: 'nexus-rows nexus-folder-rows' }, ...answer.folders.map(row))
          : el('p', { class: 'nexus-folders-none' }, 'No folders here'),
        answer.more > 0 ? el('p', { class: 'nexus-folders-none' }, moreText(answer.more)) : null,
      ].filter((part) => part !== null),
    );
    if (focused !== undefined && focusedKind) {
      element
        .querySelector<HTMLElement>(`.${focusedKind}[data-path="${CSS.escape(focused)}"]`)
        ?.focus();
    }
  }

  return {
    element,
    open(path) {
      if (answer !== null && (path === null || path === answer.path)) return;
      // The first listing is on its way: each read of the page's would ask again.
      if (answer === null && asked > 0) return;
      void list(path);
    },
    draw,
    get path() {
      return answer?.path ?? null;
    },
  };
}
