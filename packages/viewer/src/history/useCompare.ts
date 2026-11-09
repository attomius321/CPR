// Git's compare mode (V13, V10c): the picks, the comparison they make, its fork point read, and
// Compare starting the diff.
import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import type { Commit, HistoryShape } from '@symbiote/core';
import { startDiff } from './api.js';
import { BLOCK, comparison, pick, type Pair, type Picked } from './commits.js';

/** Compare mode's picks and the comparison they make; `compare` opens the diff of a pair. */
export function useCompare({
  parents,
  headRow,
  shape,
  loaded,
  details,
  loadBlock,
  onComparing,
}: {
  parents: number[][];
  headRow: number | null;
  shape: HistoryShape | null;
  /** Bumped as a block of details arrives: maybe the fork point's. */
  loaded: number;
  details: RefObject<Map<number, Commit>>;
  loadBlock: (block: number) => void;
  onComparing: (comparing: boolean) => void;
}) {
  const [picks, setPicks] = useState<Picked[]>([]);
  // Diverged picks compared the other way round (V10c); picking again resets it.
  const [swapped, setSwapped] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const compare = useCallback(async (pair: Pair) => {
    setStarting(true);
    setCompareError(null);
    try {
      window.location.assign(await startDiff(pair));
    } catch (e) {
      setCompareError(`Could not compare: ${(e as Error).message}`);
      setStarting(false);
    }
  }, []);

  const current = useMemo(
    () =>
      comparison(
        picks,
        {
          parents,
          head: headRow,
          trunk: shape?.defaultBranch?.rows ?? [],
          complete: shape !== null,
          shaAt: (row) => details.current.get(row)?.sha,
        },
        swapped,
      ),
    // `loaded`: a block of details came, maybe the fork point's.
    [picks, parents, headRow, shape, swapped, loaded],
  );
  // Diverged picks: the fork point's details, wherever it is in the history.
  const forkRow = current?.diverged?.forkRow;
  useEffect(() => {
    if (forkRow !== undefined && !details.current.has(forkRow))
      loadBlock(Math.floor(forkRow / BLOCK));
  }, [forkRow, loadBlock]);
  const pickRow = useCallback((row: number) => {
    const commit = details.current.get(row);
    if (!commit) return;
    const next: Picked = {
      sha: commit.sha,
      row,
      ...(commit.parents[0] ? { parent: commit.parents[0] } : {}),
    };
    setPicks((ps) =>
      pick(
        ps.map((p) => p.sha),
        next.sha,
      ).map((sha) => ps.find((p) => p.sha === sha) ?? next),
    );
    setSwapped(false);
  }, []);
  /** Leaves compare mode: the picks go with it. */
  const stopComparing = useCallback(() => {
    setPicks([]);
    setSwapped(false);
    setCompareError(null);
    onComparing(false);
  }, [onComparing]);

  return {
    picks,
    setPicks,
    swapped,
    setSwapped,
    starting,
    compareError,
    compare,
    current,
    forkRow,
    pickRow,
    stopComparing,
  };
}
