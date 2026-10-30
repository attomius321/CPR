// This PC's folders (NX2b, decisions 539, 540): the repositories marked, and Open Symbiote on each.
// Since NX3 (decisions 553–555) the places are a card at its left, a folder's repositories cards
// (`cards.ts`) and its other folders rows in columns; a repository is the end of the way down: its
// card opens its Symbiote, never its folders. Since NX4 (decisions 617–620) the person pins a folder
// from its head and a repository from its card. Since fix/nexus-pinned-symbiotes (decisions
// 626–628) it is drawn under Symbiotes' cards, its field in their page's head; the pinned folders
// are under the places, the pinned repositories among the Symbiotes (`main.ts`). Drawn in the
// viewer's classes (a card and its head, its field); `nexus.css` lays out the rest.
import type { Folder, FoldersAnswer, Place } from '../folders.js';
import type { Pin, PinAnswer } from '../pins.js';
import { repositoryCard } from './cards.js';
import { ARROW_UP, CHEVRON_RIGHT, DRIVE, el, FOLDER, HOUSE, icon, pinButton } from './dom.js';
import {
  countsText,
  crumbsOf,
  moreText,
  nextOnGrid,
  pinnable,
  pinnedPlaces,
  pinNames,
  placesShown,
  typedFolder,
} from './folders-tab.js';

export interface FoldersView {
  element: HTMLElement;
  /** Go to folder: its field, in Symbiotes' page head. */
  go: HTMLElement;
  /** Shows a folder (null: where the folders open), unless it is the one shown. */
  open(path: string | null): void;
  /** Draws again, the running Symbiotes' roots marked (each read of the page's). */
  draw(running: ReadonlySet<string>): void;
  /** The folder shown; null before the first listing. */
  readonly path: string | null;
  /** The pins, in the order pinned, as the last listing or pin answered; null before either. */
  readonly pinned: readonly Pin[] | null;
  /** Pins or unpins a folder (decision 618): null once done, else why not. */
  setPin(folder: { name: string; path: string }, pinned: boolean): Promise<string | null>;
}

export interface FoldersDeps {
  /** Opens a Symbiote in `folder`: null once its tab is open, else why not. */
  start(folder: string): Promise<string | null>;
  /** Opens the tab of the Symbiote serving `root`. */
  show(root: string): void;
  /**
   * The folder shown changed: the address keeps it; null when it is where the folders open, no
   * folder asked for.
   */
  moved(path: string | null): void;
  /** The pins changed: Symbiotes' cards are drawn again. */
  pinsChanged(): void;
}

const PLACE_ICONS: Record<Place['kind'], string> = {
  home: HOUSE,
  symbiotes: FOLDER,
  top: DRIVE,
  drive: DRIVE,
};

const lastName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? '/';

/** What `GET /api/folders` answers: a listing, the places and the pins (NX4). */
type Listed = FoldersAnswer & { pinned: Pin[] };

/** What the arrows move between, in reading order: the repositories' cards, then the folders. */
const ITEMS = '.nexus-repo, .nexus-folder-open';

export function foldersView(deps: FoldersDeps): FoldersView {
  let answer: Listed | null = null;
  /** The pins: the last listing's, or the last pin's answer. */
  let pinnedNow: Pin[] | null = null;
  let running: ReadonlySet<string> = new Set();
  /** What went wrong last: a folder not listed, or a Symbiote not started. */
  let error: string | null = null;
  /** The folders whose Symbiote is starting. */
  const starting = new Set<string>();
  /** Each listing asked for; an answer to an older one is dropped. */
  let asked = 0;
  let drawn = '';

  const places = el('div', { class: 'nexus-places', role: 'group', 'aria-label': 'Places' });
  const pins = el('section', { class: 'nexus-pins', 'aria-label': 'Pinned' });
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
    { class: 'nexus-folders', 'aria-label': 'Folders' },
    el(
      'nav',
      { class: 'nexus-card nexus-places-card', 'aria-label': 'Places' },
      el('div', { class: 'card-head' }, el('h2', { class: 'nexus-card-title' }, 'Places')),
      places,
      pins,
    ),
    el('div', { class: 'nexus-card nexus-folders-card' }, cardHead, body),
  );

  // The cards and rows by the keys: the arrows by their place on the page, Backspace up a folder
  // (Enter acts, as a button's); the field keeps its own keys.
  element.addEventListener('keydown', (event) => {
    if (event.target === field) return;
    if (event.key === 'Backspace' && answer?.parent) {
      event.preventDefault();
      void list(answer.parent, { focus: true });
      return;
    }
    const items = [...body.querySelectorAll<HTMLElement>(ITEMS)];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const to = nextOnGrid(
      items.map((item) => item.getBoundingClientRect()),
      at,
      event.key,
    );
    const next = to === null ? undefined : items[to];
    if (!next) return;
    event.preventDefault();
    next.focus();
  });

  /** Lists `path` (null: where the tab opens); a folder not listed keeps the one shown. */
  async function list(path: string | null, { focus = false } = {}): Promise<void> {
    const mine = ++asked;
    let next: Listed | { error: string };
    try {
      const query = path === null ? '' : `?path=${encodeURIComponent(path)}`;
      const res = await fetch(`/api/folders${query}`, { cache: 'no-store' });
      next = res.headers.get('content-type')?.includes('json')
        ? ((await res.json()) as Listed | { error: string })
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
    takePins(next.pinned);
    deps.moved(path === null ? null : next.path);
    draw(running);
    // A repository asked for (decision 554): its card, in the folder holding it. Else the first
    // card or row, or Up in a folder without any: the keys stay in the tab.
    const picked =
      next.picked === null
        ? null
        : body.querySelector<HTMLElement>(`.nexus-repo[data-path="${CSS.escape(next.picked)}"]`);
    if (picked) picked.focus();
    else if (focus) {
      (
        body.querySelector<HTMLElement>(ITEMS) ??
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
      el('span', {}, place.name),
    );
    button.addEventListener('click', () => void list(place.path, { focus: true }));
    return button;
  }

  /**
   * A pinned folder's row (decisions 617, 628): a place's, "not found" once its folder is gone; its
   * unpin at its end. Its click lists it (619).
   */
  function pinRow(pin: Pin, name: string, current: string | null): HTMLElement {
    const here = pin.path === current;
    const open = el(
      'button',
      {
        type: 'button',
        class: 'nexus-place',
        'aria-current': here ? 'true' : false,
        'data-path': pin.path,
      },
      icon(FOLDER, true),
      el('span', {}, name),
      pin.missing && el('span', { class: 'nexus-pin-gone' }, 'not found'),
    );
    open.addEventListener('click', () => void list(pin.path, { focus: true }));
    return el(
      'div',
      { class: 'nexus-pin' },
      open,
      pinButton(
        'nexus-unpin',
        { name, path: pin.path, pinned: true },
        () => void pinHere(pin, false),
      ),
    );
  }

  const pinnedPaths = () => new Set((pinnedNow ?? []).map((pin) => pin.path));

  /** The pins as the server answered them, Symbiotes' cards told when they changed. */
  function takePins(next: Pin[]): void {
    const changed = JSON.stringify(next) !== JSON.stringify(pinnedNow);
    pinnedNow = next;
    if (answer) answer = { ...answer, pinned: next };
    if (changed) deps.pinsChanged();
  }

  /** Pins or unpins a folder (decision 618): the pins the server answers are kept. */
  async function setPin(
    folder: { name: string; path: string },
    pinned: boolean,
  ): Promise<string | null> {
    let next: PinAnswer;
    try {
      const res = await fetch('/api/pinned', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
        body: JSON.stringify({ path: folder.path, pinned }),
      });
      next = res.headers.get('content-type')?.includes('json')
        ? ((await res.json()) as PinAnswer)
        : { status: 400, error: `${res.status}: ${await res.text()}` };
    } catch (failure) {
      next = { status: 400, error: (failure as Error).message };
    }
    if ('error' in next)
      return `${folder.name} was not ${pinned ? 'pinned' : 'unpinned'}: ${next.error}`;
    takePins(next.pinned);
    draw(running);
    return null;
  }

  /**
   * A pin or an unpin from the folders: what went wrong is said in the folder's card. An unpin from
   * its own row puts the focus on the next pin's row, or on the places.
   */
  async function pinHere(folder: { name: string; path: string }, pinned: boolean): Promise<void> {
    const fromRow = (document.activeElement as HTMLElement | null)?.classList.contains(
      'nexus-unpin',
    );
    const at = pinnedPlaces(pinnedNow ?? []).findIndex((pin) => pin.path === folder.path);
    const why = await setPin(folder, pinned);
    error = why;
    draw(running);
    if (fromRow && !pinned && why === null) {
      const rows = [...pins.querySelectorAll<HTMLElement>('.nexus-place')];
      (
        rows[Math.min(at, rows.length - 1)] ?? places.querySelector<HTMLElement>('.nexus-place')
      )?.focus();
    }
  }

  /** A folder that is no repository: a row, its way in. */
  function folderRow(folder: Folder): HTMLElement {
    const open = el(
      'button',
      { type: 'button', class: 'nexus-folder-open', 'data-path': folder.path },
      icon(FOLDER, true),
      el('span', { class: 'nexus-folder-name' }, folder.name),
      el('span', { class: 'nexus-folder-in', 'aria-hidden': 'true' }, icon(CHEVRON_RIGHT, true)),
    );
    open.addEventListener('click', () => void list(folder.path, { focus: true }));
    return open;
  }

  /** A repository: a card, the end of the way down. */
  function repository(folder: Folder): HTMLElement {
    const live = running.has(folder.path);
    const pinned = pinnedPaths().has(folder.path);
    const card = repositoryCard({
      folder,
      running: live,
      busy: starting.has(folder.path),
      act: () => (live ? deps.show(folder.path) : void start(folder.path)),
      pin: { pinned, toggle: () => void pinHere(folder, !pinned) },
    });
    if (folder.path === answer?.picked) card.querySelector('.nexus-repo')?.classList.add('picked');
    return card;
  }

  /** A group's head, when a folder has both kinds: its name and its count. */
  const groupHead = (name: string, count: number) =>
    el(
      'h3',
      { class: 'nexus-group-head' },
      name,
      el('span', { class: 'count' }, count.toLocaleString('en')),
    );

  function draw(next: ReadonlySet<string>): void {
    running = next;
    const marks = answer
      ? answer.folders.map((folder) => folder.path).filter((path) => running.has(path))
      : [];
    const key = JSON.stringify([answer, pinnedNow, marks, error, [...starting]]);
    if (key === drawn) return;
    drawn = key;
    // Focus stays on what had it (a place, a card or a row), drawn again.
    const active = document.activeElement as HTMLElement | null;
    const focused = active?.dataset.path;
    const focusedKind = active?.classList[0];

    const current = answer?.path ?? null;
    // The pinned folders under the places (decision 628); a hint while nothing is pinned, nothing
    // while only repositories are: they are among the Symbiotes.
    const pinned = pinnedPlaces(pinnedNow ?? []);
    places.replaceChildren(
      ...(answer ? placesShown(answer.places, pinned) : []).map((p) => placeButton(p, current)),
    );
    const names = pinNames(pinned);
    pins.hidden = pinned.length === 0 && (pinnedNow ?? []).length > 0;
    pins.replaceChildren(
      el(
        'h3',
        { class: 'nexus-group-head' },
        'Pinned',
        pinned.length > 0 && el('span', { class: 'count' }, pinned.length.toLocaleString('en')),
      ),
      pinned.length > 0
        ? el(
            'div',
            { class: 'nexus-places', role: 'group', 'aria-label': 'Pinned' },
            ...pinned.map((pin, at) => pinRow(pin, names[at] ?? pin.name, current)),
          )
        : el(
            'p',
            { class: 'nexus-pins-none' },
            'Pin a folder from its head, a repository from its card.',
          ),
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
    const { parent } = answer;
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
    const counts = countsText(answer.folders);
    const listed = { name: lastName(answer.path), path: answer.path };
    const headPinned = pinnedPaths().has(answer.path);
    cardHead.replaceChildren(
      ...[
        up,
        trail,
        counts ? el('span', { class: 'nexus-folders-counts' }, counts) : null,
        // Home, the top and the drives are always places: no pin (decision 620).
        pinnable(answer)
          ? pinButton('nexus-head-pin', { ...listed, pinned: headPinned }, () => {
              void pinHere(listed, !headPinned);
            })
          : null,
      ].filter((part) => part !== null),
    );
    const repositories = answer.folders.filter((folder) => folder.repository);
    const others = answer.folders.filter((folder) => !folder.repository);
    const both = repositories.length > 0 && others.length > 0;
    body.replaceChildren(
      ...[
        error ? el('p', { class: 'nexus-folders-error error', role: 'alert' }, error) : null,
        repositories.length > 0
          ? el(
              'section',
              { class: 'nexus-group', 'aria-label': 'Repositories' },
              both && groupHead('Repositories', repositories.length),
              el('div', { class: 'nexus-repos' }, ...repositories.map(repository)),
            )
          : null,
        others.length > 0
          ? el(
              'section',
              { class: 'nexus-group', 'aria-label': 'Folders' },
              both && groupHead('Folders', others.length),
              el('div', { class: 'nexus-folder-rows' }, ...others.map(folderRow)),
            )
          : null,
        answer.folders.length === 0
          ? el('p', { class: 'nexus-folders-none' }, 'No folders here')
          : null,
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
    go,
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
    get pinned() {
      return pinnedNow;
    },
    setPin,
  };
}
