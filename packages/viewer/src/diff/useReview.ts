import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Graph, ReviewFile } from '@symbiote/core';
import {
  newDraft,
  newLineDraft,
  refreshDrafts,
  withEarlyEdits,
  type Anchor,
  type ReviewDraft,
  type ReviewEvent,
} from './comments.js';
import { readChangeFiles } from './change-files.js';
import {
  derivedMarks,
  toggleFileMark,
  toggleFileSymbols,
  toggleFileViewed,
  toggleMark,
  type Marks,
} from './review.js';
import { asMarks, asReviewDraft, type Store } from './store.js';

/**
 * A diff's review as the person makes it: the symbols marked reviewed, the files viewed and the
 * draft comments and summary, read from `store` for each graph and saved there as they change; the
 * verdict picked, kept for both pages (`g` between them) and never saved: a verdict is given to the
 * head shown.
 *
 * `marks` are what both pages read (V108, decision 983): the person's own, kept in the store as
 * before (an older review's load as they are), derived both ways against the change's files and
 * their blobs, which the server that keeps them gives (`./api/files`).
 */
export function useReview(graph: Graph | undefined, store: Store | undefined) {
  const [own, setOwn] = useState<Marks>({});
  const [files, setFiles] = useState<readonly ReviewFile[]>([]);
  const [draft, setDraft] = useState<ReviewDraft>({ drafts: [], body: '' });
  const [verdict, setVerdict] = useState<ReviewEvent>('comment');
  useEffect(() => {
    // The same empty list when there is none: a new one would draw the page again for nothing.
    setFiles((current) => (current.length === 0 ? current : []));
    if (!graph || !store?.server) return;
    let live = true;
    void readChangeFiles(graph).then((read) => {
      if (live && read) setFiles(read);
    });
    return () => {
      live = false;
    };
  }, [graph, store]);
  // Until the server's files arrive, and without a server, the graph's own: no blobs, so a file
  // reads viewed through its symbols only.
  const known = useMemo(() => (files.length > 0 || !graph ? files : graph.files), [files, graph]);
  const marks = useMemo(() => (graph ? derivedMarks(graph, known, own) : own), [graph, known, own]);
  useEffect(() => {
    if (!graph || !store) return;
    let live = true;
    setOwn({});
    setDraft({ drafts: [], body: '' });
    setVerdict('comment');
    void Promise.all([store.load('review'), store.load('drafts')]).then(([marks, drafts]) => {
      if (!live) return;
      setOwn(asMarks(marks));
      // Under `symbiote pr`, drafts may come from an earlier push of the change.
      const saved = asReviewDraft(drafts);
      const loaded = { ...saved, drafts: refreshDrafts(graph, saved.drafts) };
      setDraft((current) => {
        const next = withEarlyEdits(loaded, current);
        // Typed before it arrived: saved again with both (the person's save had only theirs).
        if (next !== loaded) store.save('drafts', next);
        return next;
      });
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

  /**
   * A symbol (or a stylesheet, V105) reviewed or not; with `whole`, every changed symbol of its
   * file (`R`, V108, decision 985).
   */
  const toggleReviewed = useCallback(
    (id: string, whole?: 'file') => {
      if (!graph) return;
      setOwn((current) => {
        const next =
          whole === 'file'
            ? toggleFileSymbols(graph, known, current, id)
            : toggleMark(graph, current, id, known);
        if (next !== current) store?.save('review', next);
        return next;
      });
    },
    [graph, store, known],
  );

  /** A file viewed on the Files page, or not (V90): a mark by its blob; its symbols' too (V108). */
  const toggleViewed = useCallback(
    (file: { path: string; previousPath?: string; blob?: string }) => {
      setOwn((current) => {
        const next = graph
          ? toggleFileViewed(graph, known, current, file)
          : toggleFileMark(current, file);
        if (next !== current) store?.save('review', next);
        return next;
      });
    },
    [graph, store, known],
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
  /** A draft's text written again (V90): Edit on a comment under its line. */
  const editDraft = useCallback(
    (id: string, body: string) =>
      updateDraft((d) => ({
        ...d,
        drafts: d.drafts.map((x) => (x.id === id ? { ...x, body } : x)),
      })),
    [updateDraft],
  );
  const removeDraft = useCallback(
    (id: string) => updateDraft((d) => ({ ...d, drafts: d.drafts.filter((x) => x.id !== id) })),
    [updateDraft],
  );
  return {
    marks,
    draft,
    updateDraft,
    verdict,
    setVerdict,
    toggleReviewed,
    toggleViewed,
    addDraft,
    addLineDraft,
    editDraft,
    removeDraft,
  };
}
