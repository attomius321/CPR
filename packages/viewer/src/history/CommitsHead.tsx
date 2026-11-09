// The head of Git's rows card (V10, V13, V66): the branches' toggle, the scopes, HEAD, the keys and
// compare mode.
import type { HistoryPage, HistoryScope } from '@symbiote/core';
import { shortSha } from './commits.js';
import { Help } from '../ui/Help.js';
import { tip } from '../ui/tip.js';
import { useShownFile } from './useShownFile.js';
import type { Dispatch, SetStateAction } from 'react';

/** The rows card's head: inert while a file is shown in the rows' place (V70). */
export function CommitsHead({
  fileShown,
  panelOpen,
  setPanelOpen,
  scope,
  onScope,
  first,
  headRow,
  jump,
  comparing,
  stopComparing,
  onComparing,
}: {
  fileShown: ReturnType<typeof useShownFile>['fileShown'];
  panelOpen: boolean;
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
  scope: HistoryScope;
  onScope: (scope: HistoryScope) => void;
  first: HistoryPage;
  headRow: number | null;
  jump: (row: number) => void;
  comparing: boolean;
  stopComparing: () => void;
  onComparing: (comparing: boolean) => void;
}) {
  return (
    <div className="card-head commits-title" inert={!!fileShown}>
      <button
        type="button"
        className="branches-toggle"
        aria-expanded={panelOpen}
        {...tip('Branches', { keys: '/' })}
        onClick={() => setPanelOpen((o) => !o)}
      >
        Branches
      </button>
      <span className="scopes" role="group" aria-label="Branches">
        <button
          type="button"
          className={scope === 'all' ? 'scope active' : 'scope'}
          aria-pressed={scope === 'all'}
          onClick={() => onScope('all')}
        >
          All branches
        </button>
        <button
          type="button"
          className={scope === 'current' ? 'scope active' : 'scope'}
          aria-pressed={scope === 'current'}
          onClick={() => onScope('current')}
        >
          This branch{first.branch ? ` (${first.branch})` : ''}
        </button>
      </span>
      {first.head && headRow !== null && (
        <button
          type="button"
          className="head-chip"
          {...tip('Go to HEAD')}
          onClick={() => jump(headRow)}
        >
          HEAD → {first.branch ?? `${shortSha(first.head)} (detached)`}
        </button>
      )}
      <span className="commits-tail">
        <span className="commits-actions">
          {/* The keys behind the "?" (V29b), and what compare mode asks (V37: beside the
            toggle it wrapped the head onto two lines). */}
          <Help label="Git's keys">
            <span className="commits-help">
              {comparing
                ? 'Pick two to compare them, or one against its parent · x picks, Enter compares, Esc leaves'
                : 'j/k move · c checks out · x picks to compare · / finds a branch · f finds a commit · d shows or folds the details · a branch: double-click checks it out, right-click for more · a file shown: j/k its files, o its diff in VS Code, Esc back'}
            </span>
          </Help>
          <button
            type="button"
            className="compare-mode"
            aria-pressed={comparing}
            {...tip(comparing ? 'Leave compare mode' : 'Pick commits to compare', {
              keys: comparing ? 'Esc' : 'x',
            })}
            onClick={() => (comparing ? stopComparing() : onComparing(true))}
          >
            Compare mode
            <kbd aria-hidden="true">{comparing ? 'Esc' : 'x'}</kbd>
          </button>
        </span>
      </span>
    </div>
  );
}
