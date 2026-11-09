// Git's keys (V10–V14, V66, V70): j/k, x, c, d, f, /, Enter and Esc on the rows, or on a file shown
// in their place.
import { useLayoutEffect, type RefObject, type Dispatch, type SetStateAction } from 'react';
import type { WorkingChanges } from '@symbiote/core';
import { stepShown } from './details.js';
import { OPEN_FILE_ID } from './GitFile.js';
import type { Pair } from './commits.js';
import { keyIsTaken } from '../ui/keys.js';
import { WORKING } from './WorkingRow.js';
import type { useGitMenus } from './GitMenus.js';
import type { useShownFile } from './useShownFile.js';
import type { useCompare } from './useCompare.js';

type Menus = ReturnType<typeof useGitMenus>;
type Shown = ReturnType<typeof useShownFile>;
type Compare = ReturnType<typeof useCompare>;

/**
 * The page's keys on the window, attached as the rows are drawn (a layout effect, not after the
 * paint): a key pressed as soon as they show is not lost.
 */
export function useHistoryKeys({
  menu,
  confirm,
  refAction,
  branchMenu,
  stashMenu,
  question,
  fileShown,
  shownHere,
  setOpenFile,
  fileOrder,
  working,
  rows,
  cursor,
  setCursor,
  reveal,
  pane,
  findRef,
  onComparing,
  pickRow,
  list,
  openMenu,
  setPanelOpen,
  filterRef,
  panelOpen,
  comparing,
  stopComparing,
  current,
  starting,
  compare,
  openWorkspace,
}: {
  menu: Menus['menu'];
  confirm: Menus['confirm'];
  refAction: Menus['refAction'];
  branchMenu: Menus['branchMenu'];
  stashMenu: Menus['stashMenu'];
  question: Menus['question'];
  fileShown: Shown['fileShown'];
  shownHere: Shown['shownHere'];
  setOpenFile: Shown['setOpenFile'];
  fileOrder: Shown['fileOrder'];
  working: WorkingChanges | null;
  rows: number;
  cursor: number;
  setCursor: Dispatch<SetStateAction<number>>;
  reveal: (row: number, center?: boolean) => void;
  pane: { open: boolean; onOpen: (open: boolean) => void };
  findRef: RefObject<HTMLInputElement | null>;
  onComparing: (comparing: boolean) => void;
  pickRow: (row: number) => void;
  list: RefObject<HTMLOListElement | null>;
  openMenu: Menus['openMenu'];
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
  filterRef: RefObject<HTMLInputElement | null>;
  panelOpen: boolean;
  comparing: boolean;
  stopComparing: () => void;
  current: Compare['current'];
  starting: boolean;
  compare: (pair: Pair) => Promise<void>;
  /** Not called: in the dependencies as it was, so the listener is added again as before. */
  openWorkspace: (sha?: string) => unknown;
}) {
  // j/k move, x picks (turning compare mode on), Enter compares, Escape leaves compare mode.
  // Attached as the rows are drawn (a layout effect), not after the paint: a key pressed as soon
  // as they show is not lost.
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Typing (the search, the commit's message), and the menus and dialogs: their own keys.
      if (keyIsTaken(event) || menu || confirm || refAction || branchMenu || stashMenu || question)
        return;
      // A file shown in the rows' place (V70): j/k step the files, o opens its diff in VS Code,
      // Esc goes back to the rows; the rows' own keys wait under it.
      if (fileShown && shownHere) {
        if (event.key === 'j' || event.key === 'k') {
          const step = event.key === 'j' ? 1 : -1;
          setOpenFile({ ...stepShown(fileOrder, shownHere, step), sha: shownHere.sha });
          return;
        }
        if (event.key === 'o') {
          document.getElementById(OPEN_FILE_ID)?.click();
          return;
        }
        if (event.key === 'Escape') {
          setOpenFile(null);
          return;
        }
        if (['x', 'c', 'Enter'].includes(event.key)) return;
      }
      if (event.key === 'j' || event.key === 'k') {
        // Above the first commit, the uncommitted row when there is one (V66c).
        const top = working ? WORKING : 0;
        const next = Math.max(top, Math.min(rows - 1, cursor + (event.key === 'j' ? 1 : -1)));
        setCursor(next);
        reveal(next);
      } else if (event.key === 'd') pane.onOpen(!pane.open);
      else if (event.key === 'f') {
        event.preventDefault();
        findRef.current?.focus();
      } else if (event.key === 'x') {
        onComparing(true);
        pickRow(cursor);
      } else if (event.key === 'c') {
        const box = list.current?.querySelector('.commit.cursor')?.getBoundingClientRect();
        // `c` checks out: straight to the targets.
        if (box) openMenu(cursor, box.left + 48, box.bottom, 'checkout');
      } else if (event.key === '/') {
        // Finds a branch: the panel's filter (shown first under 900 px).
        event.preventDefault();
        setPanelOpen(true);
        requestAnimationFrame(() => filterRef.current?.focus());
      } else if (event.key === 'Escape' && panelOpen) setPanelOpen(false);
      else if (event.key === 'Escape' && comparing) stopComparing();
      else if (
        event.key === 'Enter' &&
        // A focused button takes Enter itself.
        !(event.target instanceof HTMLButtonElement) &&
        comparing &&
        current?.pair &&
        !starting
      ) {
        event.preventDefault();
        void compare(current.pair);
      } else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    fileShown,
    shownHere,
    fileOrder,
    rows,
    cursor,
    current,
    starting,
    compare,
    pickRow,
    reveal,
    menu,
    confirm,
    openWorkspace,
    openMenu,
    comparing,
    onComparing,
    stopComparing,
    panelOpen,
    refAction,
    branchMenu,
    stashMenu,
    question,
    working,
    pane,
  ]);
}
