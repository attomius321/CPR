// The Graph page's first view (V109, decision 986): the riskiest finding's symbol, focused, the
// first time the page shows a graph; F between the whole change and it, the choice kept.
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { Finding, Graph } from '@symbiote/core';
import type { DiffView } from '../shell/pages.js';
import { readStored, writeStored } from '../ui/stored.js';
import {
  FIRST_VIEW_KEY,
  firstViewOf,
  riskiest,
  symbolOpened,
  viewAfterF,
  type FirstView,
} from './first-view.js';

/**
 * Opens the Graph page on the change's riskiest finding (or on the whole change, when that is the
 * person's choice), once per graph, and binds F. Returns the times F asked the canvas to frame
 * its view anew, as it frames the first layout (`Canvas`'s `framing`).
 */
export function useFirstView({
  graph,
  page,
  shown,
  selected,
  setSelected,
  setFocus,
}: {
  graph: Graph | undefined;
  page: DiffView;
  /** The Findings tab's list (`foldFindings`). */
  shown: readonly Finding[];
  selected: string | null;
  setSelected: Dispatch<SetStateAction<string | null>>;
  setFocus: Dispatch<SetStateAction<boolean>>;
}): number {
  const [view, setView] = useState<FirstView>(() => firstViewOf(readStored(FIRST_VIEW_KEY)));
  const risk = useMemo(() => (graph ? riskiest(shown, graph.nodes) : null), [graph, shown]);
  // Set while App renders, not in an effect: the first layout asked for is the focused one. An
  // effect would have the worker lay out the whole change first, and the canvas fit and draw it.
  const [opened, setOpened] = useState<Graph | undefined>(undefined);
  if (graph && page === 'graph' && opened !== graph) {
    setOpened(graph);
    const symbol = symbolOpened(view, risk, selected);
    if (symbol !== null) {
      setSelected(symbol);
      setFocus(true);
    }
  }

  const [framing, setFraming] = useState(0);
  useEffect(() => {
    if (risk === null || page !== 'graph') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'F' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLInputElement && !['checkbox', 'radio'].includes(target.type))
      )
        return;
      const next = viewAfterF(selected);
      setView(next);
      writeStored(FIRST_VIEW_KEY, next);
      setSelected(next === 'risk' ? risk : null);
      setFocus(next === 'risk');
      setFraming((n) => n + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [risk, page, selected, setSelected, setFocus]);
  return framing;
}
