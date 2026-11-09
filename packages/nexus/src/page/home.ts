// The nexus page's Symbiotes (NX5): its head (the S, the line, Browse…), what went wrong, the list
// and the picked row's card.
import { typedPath } from './complete.js';
import { detailView } from './detail-view.js';
import { el, FOLDER, icon, loading } from './dom.js';
import { listView } from './list-view.js';
import { cardKind, keptPick, type Pick } from './pick.js';
import { entryRow } from './search.js';
import type { PageState } from './state.js';
import { refusedFor, view } from './home-view.js';
import type { Listings } from './listings.js';

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

/** Symbiotes' page over the state: `draw` draws its line, the list and the card again. */
export function homePage(
  state: PageState,
  {
    list,
    card,
    reads,
    pickOf,
    typeInField,
  }: {
    list: ReturnType<typeof listView>;
    card: ReturnType<typeof detailView>;
    reads: Listings;
    pickOf: (at: number) => Pick | null;
    typeInField: (text: string) => void;
  },
) {
  const { readOpened, checkoutsOf, entriesOf } = reads;
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

  function drawHome(): void {
    const running = state.tabs.filter((tab) => tab.url !== null).length;
    const now = new Date();
    homeLine.replaceChildren(
      !state.readOnce || !state.known
        ? loading('Looking for running Symbiotes…')
        : [
            `${running === 0 ? 'None' : running} running`,
            ...(state.known.pins.length > 0 ? [`${state.known.pins.length} pinned`] : []),
            state.known.scan === null
              ? 'looking in ~'
              : `${state.known.scan.repositories} ${state.known.scan.repositories === 1 ? 'repository' : 'repositories'} in home`,
          ].join(' · '),
    );
    const shownProblem = state.failure ?? state.problem;
    homeProblem.textContent = shownProblem ?? '';
    homeProblem.hidden = shownProblem === null;

    readOpened();
    const v = view(state, reads);
    state.lastView = v;
    // The pick (decision 913): kept by its path and place; at first the repository a typed folder
    // is in, else the first row.
    const preferred = v.preferred ? v.rows.findIndex((row) => row.path === v.preferred) : -1;
    const next =
      state.pick !== null
        ? keptPick(v.rows, state.pick)
        : preferred >= 0
          ? pickOf(preferred)
          : keptPick(v.rows, null);
    // No pick before both reads: the running Symbiotes would not be first.
    state.pick = next === null || !state.readOnce || !state.known ? null : next;
    const row = state.pick === null ? null : (v.rows[state.pick.at] ?? null);
    const homePath = state.known?.home ?? '';
    list.draw({
      groups: v.groups,
      pick: state.pick?.at ?? null,
      words: typedPath(state.query, homePath) ? '' : state.query.trim(),
      home: homePath,
      ghost: v.ghost,
      hint: v.hint,
      message: v.message,
      welcome: v.welcome,
      scan: state.known?.scan ?? null,
      now,
      starting: state.starting,
    });
    const kind = cardKind(row, {
      starting: row !== null && state.starting.has(row.path),
      failed: row === null ? null : (state.failures.get(row.path) ?? null),
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
      failed: row === null ? null : (state.failures.get(row.path) ?? null),
      starting: row !== null && state.starting.has(row.path),
      refused: row === null || row.repository ? null : refusedFor(state, row.path),
      copied: row !== null && state.copied === row.path,
      rowOf: (folder) =>
        entryRow(folder, {
          tabs: state.tabs,
          pins: state.known?.pins ?? [],
          known: state.known?.repositories ?? [],
        }),
    });
  }

  return { element: home, draw: drawHome };
}
