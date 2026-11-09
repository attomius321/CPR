// Git's listing (V10, V66): its first rows at once, the shape of the whole history, the branches,
// the rows' details read block by block, and the lanes laid out.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type {
  Commit,
  HistoryPage,
  HistoryRefs,
  HistoryScope,
  HistoryShape,
  RepoStatus,
} from '@symbiote/core';
import { fetchBranches, fetchJson, fetchRows, fetchShape, StaleHistory } from './api.js';
import { BLOCK, parentRows } from './commits.js';
import { laneSpacing, layoutLanes } from './lanes.js';

/** One listing of `scope`: what is read of it and its lanes. */
export function useHistoryRows({
  scope,
  details,
  asked,
  readChanges,
  setError,
}: {
  scope: HistoryScope;
  /** The rows' commits read so far, by row, and the blocks asked for: the page's, kept here. */
  details: RefObject<Map<number, Commit>>;
  asked: RefObject<Set<number>>;
  readChanges: () => void;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  const [first, setFirst] = useState<HistoryPage | null>(null);
  const [shape, setShape] = useState<HistoryShape | null>(null);
  // The branches with their tips' rows (V10b).
  const [refs, setRefs] = useState<HistoryRefs | null>(null);
  const [stale, setStale] = useState(false);
  const [loaded, setLoaded] = useState(0);

  // Listing anew in place (decision 634), defined once the rows are: what a stale answer calls.
  const relistRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const failed = useCallback((e: unknown) => {
    if (e instanceof StaleHistory) void relistRef.current();
    else setError(`Could not list commits: ${(e as Error).message}`);
  }, []);

  // The first rows at once, then the shape of the whole history.
  useEffect(() => {
    let live = true;
    fetchRows(scope, 0, BLOCK)
      .then((page) => {
        if (!live) return;
        page.commits.forEach((c, i) => details.current.set(i, c));
        asked.current.add(0);
        setFirst(page);
        fetchBranches(scope, page.version)
          .then((r) => live && setRefs(r))
          .catch((e: unknown) => {
            if (e instanceof StaleHistory) setStale(true);
            else setError(`Could not list the branches: ${(e as Error).message}`);
          });
        return fetchShape(scope, page.version).then((s) => live && setShape(s));
      })
      .catch(failed);
    return () => {
      live = false;
    };
  }, [scope, failed]);

  // A checkout or a commit made elsewhere (a terminal, an editor) shows when the page is back.
  useEffect(() => {
    if (!first) return;
    const check = () => {
      if (document.visibilityState === 'hidden') return;
      fetchJson<RepoStatus>('api/status')
        .then((status) => (status.version !== first.version ? relistRef.current() : readChanges()))
        .catch(() => {});
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [first, readChanges]);

  const parents = useMemo(
    () => shape?.parents ?? (first ? parentRows(first.commits) : []),
    [shape, first],
  );
  const headRow = useMemo(() => {
    if (shape) return shape.head;
    const row = first?.commits.findIndex((c) => c.sha === first.head) ?? -1;
    return row < 0 ? null : row;
  }, [shape, first]);
  const lanes = useMemo(() => layoutLanes(parents, headRow), [parents, headRow]);
  const widest = useMemo(() => lanes.reduce((w, row) => Math.max(w, row.width), 1), [lanes]);
  const spacing = laneSpacing(widest);
  const graphWidth = Math.ceil(widest * spacing);
  const rows = lanes.length;

  /** Loads a block of rows' details, unless asked for already. */
  const loadBlock = useCallback(
    (block: number) => {
      if (!first || asked.current.has(block)) return;
      asked.current.add(block);
      // Into this listing's rows: listed anew in place meanwhile, they are another's.
      const into = details.current;
      const wanted = asked.current;
      fetchRows(scope, block * BLOCK, Math.min(rows, (block + 1) * BLOCK), first.version)
        .then((page) => {
          page.commits.forEach((c, i) => into.set(page.from + i, c));
          setLoaded((n) => n + 1);
        })
        .catch((e: unknown) => {
          wanted.delete(block);
          failed(e);
        });
    },
    [first, rows, scope, failed],
  );

  return {
    first,
    setFirst,
    shape,
    setShape,
    refs,
    setRefs,
    stale,
    setStale,
    loaded,
    setLoaded,
    relistRef,
    parents,
    headRow,
    lanes,
    spacing,
    graphWidth,
    rows,
    loadBlock,
  };
}
