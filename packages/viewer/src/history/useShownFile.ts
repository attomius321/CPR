// The file shown in the rows' place on Git (V70): a commit's or an uncommitted one, its diff read,
// its lines staged from it (decision 642), j/k's order.
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { Commit, WorkingChanges } from '@symbiote/core';
import { fetchChangeFile, fetchCommitFile, openDiff, stageLines } from './git-api.js';
import type { Staging } from './GitDiff.js';
import { changesOrder, followShown, type ShownFile } from './details.js';
import { useCommitRead } from './CommitDetails.js';
import { useChangesRead } from './ChangesDetails.js';
import { WORKING } from './WorkingRow.js';

/** The file shown in the rows' place and what the pane, the layer and the keys read of it. */
export function useShownFile({
  cursor,
  details,
  working,
  pane,
  setChanges,
}: {
  cursor: number;
  /** The rows' commits read so far, by row. */
  details: RefObject<Map<number, Commit>>;
  working: WorkingChanges | null;
  /** The details pane: read for it while it is open. */
  pane: { open: boolean };
  setChanges: Dispatch<SetStateAction<WorkingChanges | null>>;
}) {
  // The file shown in the rows' place (V70): of a commit, by its SHA, or uncommitted (null); not
  // by its row, which a commit listed above it changes (decision 635). Closed when the cursor
  // goes to another commit.
  const [openFile, setOpenFile] = useState<(ShownFile & { sha: string | null }) | null>(null);
  const onWorking = cursor === WORKING;
  const commitSha = onWorking ? null : (details.current.get(cursor)?.sha ?? null);
  const cursorKey = onWorking ? 'working' : (commitSha ?? `row ${cursor}`);
  useEffect(() => {
    // A row not read yet: decided once it is (a file's history goes to a row and opens the file).
    if (!onWorking && commitSha === null) return;
    setOpenFile((open) => (open && open.sha === commitSha ? open : null));
    // Only the cursor's commit changing closes the file: `cursorKey` says it.
  }, [cursorKey]);
  const shownHere =
    openFile && (onWorking ? openFile.sha === null : openFile.sha === commitSha) ? openFile : null;
  // Read for the pane and the file shown; not while the pane is folded and nothing is shown.
  const commitRead = useCommitRead(pane.open || shownHere ? commitSha : null);
  const workingHere = onWorking ? working : null;
  const changesRead = useChangesRead(workingHere);
  const fileShown = useMemo(() => {
    if (!shownHere) return null;
    if (onWorking) {
      const side = shownHere.staged ? changesRead?.staged : changesRead?.unstaged;
      return side?.find((f) => f.path === shownHere.path) ?? null;
    }
    return commitRead?.files.find((f) => f.path === shownHere.path) ?? null;
  }, [shownHere, onWorking, changesRead, commitRead]);
  // j/k's order: the pane's.
  const fileOrder = useMemo<ShownFile[]>(
    () =>
      onWorking
        ? workingHere
          ? changesOrder(workingHere)
          : []
        : (commitRead?.files.map(({ path }) => ({ path })) ?? []),
    [onWorking, workingHere, commitRead],
  );
  // Staged or unstaged, the uncommitted file shown follows it to its other side.
  useEffect(() => {
    if (!openFile || openFile.sha !== null) return;
    const next = working ? followShown(working, openFile) : null;
    if (next !== openFile) setOpenFile(next && { ...next, sha: null });
  }, [working, openFile]);
  const shownPath = shownHere?.path ?? null;
  const shownStaged = shownHere?.staged === true;
  const loadShown = useCallback(() => {
    if (!shownPath) return Promise.resolve(null);
    if (onWorking) return fetchChangeFile(shownPath, shownStaged);
    return commitSha ? fetchCommitFile(commitSha, shownPath) : Promise.resolve(null);
    // `workingHere`: an uncommitted file's diff is read again after a stage.
  }, [shownPath, shownStaged, onWorking, commitSha, workingHere]);
  const openShown = useCallback(
    () =>
      !shownPath
        ? Promise.resolve()
        : openDiff(
            onWorking
              ? { path: shownPath, staged: shownStaged }
              : { path: shownPath, sha: commitSha ?? '' },
          ),
    [shownPath, shownStaged, onWorking, commitSha],
  );
  // An uncommitted modified file's lines, staged or unstaged from its diff (decision 642).
  const staging = useMemo<Staging | undefined>(() => {
    if (!onWorking || !shownPath || fileShown?.status !== 'modified' || fileShown.previousPath)
      return undefined;
    return {
      staged: shownStaged,
      onLines: async (lines, index) =>
        setChanges(await stageLines(shownPath, shownStaged, lines, index)),
    };
  }, [onWorking, shownPath, shownStaged, fileShown]);
  return {
    openFile,
    setOpenFile,
    onWorking,
    shownHere,
    commitRead,
    changesRead,
    fileShown,
    fileOrder,
    shownStaged,
    loadShown,
    openShown,
    staging,
  };
}
