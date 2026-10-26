import { useCallback, useEffect, useState } from 'react';
import type { Graph } from '@symbiote/core';
import {
  newDraft,
  newLineDraft,
  refreshDrafts,
  type Anchor,
  type ReviewDraft,
} from './comments.js';
import { toggleMark, type Marks } from './review.js';
import { asMarks, asReviewDraft, type Store } from './store.js';

/**
 * A diff's review as the person makes it: the symbols marked reviewed and the draft comments and
 * summary, read from `store` for each graph and saved there as they change.
 */
export function useReview(graph: Graph | undefined, store: Store | undefined) {
  const [marks, setMarks] = useState<Marks>({});
  const [draft, setDraft] = useState<ReviewDraft>({ drafts: [], body: '' });
  useEffect(() => {
    if (!graph || !store) return;
    let live = true;
    setMarks({});
    setDraft({ drafts: [], body: '' });
    void Promise.all([store.load('review'), store.load('drafts')]).then(([marks, drafts]) => {
      if (!live) return;
      setMarks(asMarks(marks));
      // Under `symbiote pr`, drafts may come from an earlier push of the change.
      const saved = asReviewDraft(drafts);
      setDraft({ ...saved, drafts: refreshDrafts(graph, saved.drafts) });
    });
    return () => {
      live = false;
    };
  }, [graph, store]);

  /** `delay`: typing a summary saves once it pauses. */
  const updateDraft = useCallback(
    (change: (current: ReviewDraft) => ReviewDraft, delay = 0) => {
      setDraft((current) => {
        const next = change(current);
        store?.save('drafts', next, delay);
        return next;
      });
    },
    [store],
  );

  const toggleReviewed = useCallback(
    (id: string) => {
      if (!graph) return;
      setMarks((current) => {
        const next = toggleMark(graph, current, id);
        store?.save('review', next);
        return next;
      });
    },
    [graph, store],
  );

  const addDraft = useCallback(
    (symbol: string, anchor: Anchor | null, body: string) => {
      const node = graph?.nodes.find((n) => n.id === symbol);
      if (node) updateDraft((d) => ({ ...d, drafts: [...d.drafts, newDraft(node, anchor, body)] }));
    },
    [graph, updateDraft],
  );
  /** A comment on a line of a file (V60): about the symbol holding it, if one does. */
  const addLineDraft = useCallback(
    (anchor: Anchor, body: string) => {
      if (graph) {
        updateDraft((d) => ({ ...d, drafts: [...d.drafts, newLineDraft(graph, anchor, body)] }));
      }
    },
    [graph, updateDraft],
  );
  const removeDraft = useCallback(
    (id: string) => updateDraft((d) => ({ ...d, drafts: d.drafts.filter((x) => x.id !== id) })),
    [updateDraft],
  );
  return { marks, draft, updateDraft, toggleReviewed, addDraft, addLineDraft, removeDraft };
}
