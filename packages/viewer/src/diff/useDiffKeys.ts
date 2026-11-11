// A diff's keys (V6, V60): j/k, r, R, f, p, c, o, /, Esc, g and Alt+←, on the Graph page and on Files.
import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import type { ReviewFile } from '@symbiote/core';
import type { DiffView } from '../shell/pages.js';
import { stepFile, type FileFocus } from './file-diff.js';
import { nextProject, stepChange, type FileChanges } from './review.js';
import type { SidebarTab } from './Sidebar.js';
import type { State } from './useDiffGraph.js';
import type { useReview } from './useReview.js';

type Review = ReturnType<typeof useReview>;

/**
 * Keyboard review: j/k walk the changes, r marks reviewed (R: the pick's whole file, V108), f focuses, p (P) shows the next
 * (previous) project only, c comments, o opens in VS Code, / searches, Esc closes, g switches
 * between the pages, following the pick (V104). On the Files page, j/k walk the files and c
 * comments on the first change.
 */
export function useDiffKeys({
  state,
  served,
  page,
  follow,
  files,
  setOpenFile,
  setFileFocus,
  forge,
  openFile,
  toggleViewed,
  setTab,
  walked,
  setSelected,
  selected,
  toggleReviewed,
  setFocus,
  setProject,
  changes,
  back,
}: {
  state: State;
  /** The pair's files are served: Files can be shown while it is analyzed. */
  served: boolean;
  page: DiffView;
  /** The other page, following the pick (V104, decision 977). */
  follow: (next: DiffView) => void;
  files: ReviewFile[];
  setOpenFile: Dispatch<SetStateAction<string | null>>;
  setFileFocus: Dispatch<SetStateAction<FileFocus | null>>;
  forge: Extract<State, { status: 'ready' }>['forge'] | null;
  openFile: string | null;
  toggleViewed: Review['toggleViewed'];
  setTab: Dispatch<SetStateAction<SidebarTab | null>>;
  /** What j/k walk: the list, without the projects folded in it. */
  walked: FileChanges[];
  setSelected: Dispatch<SetStateAction<string | null>>;
  selected: string | null;
  toggleReviewed: Review['toggleReviewed'];
  setFocus: Dispatch<SetStateAction<boolean>>;
  setProject: Dispatch<SetStateAction<string | null>>;
  changes: FileChanges[];
  /** Back in the detail panel (V107, decision 982), while it has a trail. */
  back: (() => void) | null;
}): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const typing =
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLInputElement && !['checkbox', 'radio'].includes(target.type));
      // Alt+← is the browser's Back but while the panel has a trail (V107).
      const altOnly = event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey;
      if (altOnly && event.key === 'ArrowLeft' && back && page === 'graph' && !typing) {
        event.preventDefault();
        back();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (typing) {
        // Esc leaves the field (keeping what was typed) instead of closing the panel.
        if (event.key === 'Escape') target.blur();
        return;
      }
      if (
        event.key === 'g' &&
        (state.status === 'ready' || (state.status === 'analyzing' && served))
      ) {
        follow(page === 'files' ? 'graph' : 'files');
      } else if (page === 'files') {
        if (event.key === 'j' || event.key === 'k') {
          setOpenFile((path) =>
            stepFile(files, path ?? files[0]?.path ?? null, event.key === 'j' ? 1 : -1),
          );
          setFileFocus(null);
        } else if (event.key === 'c') {
          event.preventDefault();
          const input = document.getElementById('comment-input');
          if (input) input.focus();
          else
            document
              .querySelector<HTMLElement>(
                '.file-code .row-add.pickable, .file-code .row-del.pickable',
              )
              ?.click();
        } else if (event.key === 'o') document.getElementById('open-in-editor')?.click();
        else if (event.key === 'v' && state.status === 'ready' && forge) {
          // The file shown, viewed or not (V90, decision 843).
          const shown = files.find((f) => f.path === openFile) ?? files[0];
          if (shown) toggleViewed(shown);
        }
      } else if (event.key === 'c' && document.getElementById('comment-input')) {
        event.preventDefault();
        document.getElementById('comment-input')?.focus();
      } else if (event.key === 'o') {
        document.getElementById('open-in-editor')?.click();
      } else if (event.key === '/') {
        event.preventDefault();
        flushSync(() => setTab('changes'));
        document.getElementById('change-search')?.focus();
      } else if (event.key === 'j') setSelected((id) => stepChange(walked, id, 1));
      else if (event.key === 'k') setSelected((id) => stepChange(walked, id, -1));
      else if (event.key === 'r' && selected) toggleReviewed(selected);
      // Its file's changed symbols at once (V108, decision 985).
      else if (event.key === 'R' && selected) toggleReviewed(selected, 'file');
      else if (event.key === 'f') setFocus((on) => !on);
      else if (event.key === 'p' || event.key === 'P') {
        setProject((folder) => nextProject(changes, folder, event.key === 'p' ? 1 : -1));
      } else if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    changes,
    walked,
    selected,
    toggleReviewed,
    toggleViewed,
    state.status,
    page,
    follow,
    files,
    served,
    forge,
    openFile,
    back,
  ]);
}
