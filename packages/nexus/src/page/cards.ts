// A repository as a card (NX3, decisions 553–555), on Folders and under Symbiotes' running ones:
// its icon, its name, what it has checked out, and what a click does. A repository is the end of
// the way down: the whole card opens its Symbiote, or shows the one running; it never goes in. On
// Folders its corner holds its pin (NX4, decision 620), beside the card: a button holds no button.
import type { Folder } from '../folders.js';
import { BRANCH, el, FOLDER_GIT, icon, pinButton } from './dom.js';
import { checkoutWords } from './folders-tab.js';

export interface RepositoryCard {
  folder: Folder;
  /** A Symbiote serves it: the card shows that one. */
  running: boolean;
  /** Its Symbiote is starting. */
  busy: boolean;
  /** Opens its Symbiote, or shows the one running. */
  act: () => void;
  /** Folders' pin in its corner: whether it is pinned, and the click that pins or unpins it. */
  pin?: { pinned: boolean; toggle: () => void };
}

export function repositoryCard({ folder, running, busy, act, pin }: RepositoryCard): HTMLElement {
  const checkout = checkoutWords(folder);
  const card = el(
    'button',
    {
      type: 'button',
      class: running ? 'nexus-repo running' : 'nexus-repo',
      'data-path': folder.path,
      'aria-label': running ? `Show ${folder.name}` : `Open Symbiote in ${folder.name}`,
      disabled: busy,
    },
    el('span', { class: 'nexus-repo-icon', 'aria-hidden': 'true' }, icon(FOLDER_GIT, true)),
    el('span', { class: 'nexus-repo-name' }, folder.name),
    el(
      'span',
      { class: 'nexus-repo-checkout' },
      ...(checkout === null ? [] : [icon(BRANCH, true), el('span', {}, checkout)]),
    ),
    el(
      'span',
      { class: 'nexus-repo-action' },
      running && el('span', { class: 'state-dot nexus-live', 'aria-hidden': 'true' }),
      busy ? 'Starting…' : running ? 'Running · Show' : 'Open Symbiote',
    ),
  );
  card.addEventListener('click', act);
  if (!pin) return card;
  return el(
    'div',
    { class: 'nexus-repo-box' },
    card,
    pinButton(
      'nexus-repo-pin',
      { name: folder.name, path: folder.path, pinned: pin.pinned },
      pin.toggle,
    ),
  );
}
