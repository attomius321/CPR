// Git's details pane (V66b): the commit at the cursor, or the uncommitted changes (V66c).
import type { WorkingChanges, Commit } from '@symbiote/core';
import type { Pair } from './commits.js';
import { CommitDetails } from './CommitDetails.js';
import { ChangesDetails } from './ChangesDetails.js';
import { shortSha } from './commits.js';
import type { Notice } from '../shell/shell-context.js';
import { WORKING } from './WorkingRow.js';
import { useGitMenus } from './GitMenus.js';
import { useShownFile } from './useShownFile.js';
import type { RefObject, Dispatch, SetStateAction } from 'react';

/** The pane's body: the uncommitted changes, the cursor's commit once read, or a hint. */
export function GitDetailsPane({
  cursor,
  details,
  working,
  changesRead,
  shownHere,
  setOpenFile,
  setChanges,
  onRelist,
  setQuestion,
  answered,
  commitRead,
  parents,
  starting,
  jump,
  compare,
}: {
  cursor: number;
  details: RefObject<Map<number, Commit>>;
  working: WorkingChanges | null;
  changesRead: ReturnType<typeof useShownFile>['changesRead'];
  shownHere: ReturnType<typeof useShownFile>['shownHere'];
  setOpenFile: ReturnType<typeof useShownFile>['setOpenFile'];
  setChanges: Dispatch<SetStateAction<WorkingChanges | null>>;
  onRelist: (notice: Notice | null, branch?: string) => void;
  setQuestion: ReturnType<typeof useGitMenus>['setQuestion'];
  answered: ReturnType<typeof useGitMenus>['answered'];
  commitRead: ReturnType<typeof useShownFile>['commitRead'];
  parents: number[][];
  starting: boolean;
  jump: (row: number) => void;
  compare: (pair: Pair) => Promise<void>;
}) {
  const selected = cursor === WORKING ? undefined : details.current.get(cursor);
  return (
    <aside
      className="git-details"
      aria-label={cursor === WORKING ? 'Uncommitted changes' : 'Commit details'}
    >
      {cursor === WORKING && working && changesRead ? (
        <ChangesDetails
          changes={working}
          read={changesRead}
          open={shownHere}
          onOpen={(file) => setOpenFile(file && { ...file, sha: null })}
          onChanges={setChanges}
          onCommitted={(sha, amend) =>
            onRelist({ text: `${amend ? 'Amended' : 'Committed'} ${shortSha(sha)}` })
          }
          onAsk={setQuestion}
          onDone={answered}
        />
      ) : selected && commitRead ? (
        <CommitDetails
          key={selected.sha}
          read={commitRead}
          commit={selected}
          parentRows={parents[cursor] ?? []}
          starting={starting}
          open={shownHere?.path ?? null}
          onOpen={(path) => setOpenFile(path ? { sha: selected.sha, path } : null)}
          onJump={jump}
          onReview={(parent) => void compare({ base: parent, head: selected.sha })}
        />
      ) : (
        <p className="hint git-details-hint">Select a commit to see its details.</p>
      )}
    </aside>
  );
}
