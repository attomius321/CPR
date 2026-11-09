// Git's branches panel (V10b): over the rows under 900 px, its filter, and a branch gone to from it.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryRefs, HistoryScope, HistoryShape } from '@symbiote/core';

/** The panel's state and a branch's tip gone to: flashed, or listed with every branch first. */
export function useBranchesPanel({
  shape,
  refs,
  jump,
  scope,
  onGoElsewhere,
  goTo,
  onArrived,
}: {
  shape: HistoryShape | null;
  refs: HistoryRefs | null;
  jump: (row: number) => void;
  scope: HistoryScope;
  /** A branch this scope does not list: list every branch, then go to it. */
  onGoElsewhere: (name: string) => void;
  /** A branch whose tip to go to once listed. */
  goTo: string | null;
  onArrived: () => void;
}) {
  // The panel over the rows under 900 px.
  const [panelOpen, setPanelOpen] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  // A row gone to from the panel flashes.
  const [flash, setFlash] = useState<number | null>(null);

  // The panel's branches once the whole history is laid out: a tip anywhere can be reached.
  const branches = shape ? refs : null;
  /** A branch from the panel: its tip's row, flashed; else every branch, then there. */
  const goToBranch = useCallback(
    ({ name, row }: { name: string; row: number | null }) => {
      setPanelOpen(false);
      if (row !== null) {
        jump(row);
        setFlash(row);
      } else if (scope === 'current') onGoElsewhere(name);
    },
    [jump, scope, onGoElsewhere],
  );
  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(timer);
  }, [flash]);
  // Listed anew for a branch "This branch" did not hold: go there once it is.
  useEffect(() => {
    if (!goTo || !branches) return;
    onArrived();
    const tip = [...branches.branches, ...branches.remotes].find((b) => b.name === goTo);
    if (tip && tip.row !== null) goToBranch(tip);
  }, [goTo, branches, onArrived, goToBranch]);

  return { panelOpen, setPanelOpen, filterRef, flash, setFlash, branches, goToBranch };
}
