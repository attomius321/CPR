// Git's listing anew in place (decision 634): what moved unasked is read while the page stays, then
// swapped in at once, the cursor and the rows on screen where they were.
import {
  useCallback,
  useLayoutEffect,
  useRef,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { Commit, HistoryPage, HistoryRefs, HistoryScope, HistoryShape } from '@symbiote/core';
import { fetchBranches, fetchRows, fetchRowsOf, fetchShape, StaleHistory } from './api.js';
import { rowAfterListing } from './details.js';
import { BLOCK, type Picked } from './commits.js';
import { ROW_HEIGHT } from './GraphCell.js';
import { WORKING } from './WorkingRow.js';
import type { useShownFile } from './useShownFile.js';

/** Sets `relistRef` to listing this scope anew in place; `latest` is what the listing last drew. */
export function useRelist({
  scope,
  readChanges,
  first,
  headRow,
  picks,
  openFile,
  cursorAt,
  scroller,
  list,
  details,
  asked,
  setFirst,
  setShape,
  setRefs,
  setCursor,
  setPicks,
  setFlash,
  setLoaded,
  setStale,
  setError,
  relistRef,
  reveal,
  measure,
}: {
  scope: HistoryScope;
  readChanges: () => void;
  first: HistoryPage | null;
  headRow: number | null;
  picks: Picked[];
  openFile: ReturnType<typeof useShownFile>['openFile'];
  cursorAt: RefObject<number>;
  scroller: RefObject<HTMLDivElement | null>;
  list: RefObject<HTMLOListElement | null>;
  details: RefObject<Map<number, Commit>>;
  asked: RefObject<Set<number>>;
  setFirst: Dispatch<SetStateAction<HistoryPage | null>>;
  setShape: Dispatch<SetStateAction<HistoryShape | null>>;
  setRefs: Dispatch<SetStateAction<HistoryRefs | null>>;
  setCursor: Dispatch<SetStateAction<number>>;
  setPicks: Dispatch<SetStateAction<Picked[]>>;
  setFlash: Dispatch<SetStateAction<number | null>>;
  setLoaded: Dispatch<SetStateAction<number>>;
  setStale: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  /** Set here to this listing's relisting: what a stale answer calls. */
  relistRef: RefObject<() => Promise<void>>;
  reveal: (row: number, center?: boolean) => void;
  measure: () => void;
}) {
  // Listing anew in place (decision 634): what moved unasked (a branch elsewhere, an agent's
  // commit, a fetch) is read while the page stays, then swapped in at once. The cursor stays on its
  // commit (on HEAD from HEAD with no file shown), the rows where they were on screen, the file
  // shown and the pane as they were. One at a time; asked meanwhile, once more after.
  const latest = useRef({ first, headRow, picks, shown: openFile !== null });
  latest.current = { first, headRow, picks, shown: openFile !== null };
  const relisting = useRef<Promise<void> | null>(null);
  const relistAgain = useRef(false);
  const scrollTo = useRef<{ row: number; offset: number } | { reveal: number } | null>(null);
  const relistHere = useCallback((): Promise<void> => {
    if (relisting.current) {
      relistAgain.current = true;
      return relisting.current;
    }
    const run = async (tries: number): Promise<void> => {
      const { first: before, headRow: oldHead, picks: picked, shown } = latest.current;
      if (!before) return;
      readChanges();
      const page = await fetchRows(scope, 0, BLOCK);
      if (page.version === before.version) return;
      const cursor = cursorAt.current;
      const box = scroller.current;
      const top = list.current?.offsetTop ?? 0;
      const at = (row: number) => top + row * ROW_HEIGHT - (box?.scrollTop ?? 0);
      // The row kept in its place on screen: the cursor's when in view, else the first in view.
      const inView = (row: number) =>
        box !== null && row >= 0 && at(row) > -ROW_HEIGHT && at(row) < box.clientHeight;
      const anchor = inView(cursor)
        ? cursor
        : Math.max(0, Math.floor(((box?.scrollTop ?? 0) - top) / ROW_HEIGHT));
      const shaOf = (row: number) => details.current.get(row)?.sha;
      const kept = cursor === WORKING ? undefined : shaOf(cursor);
      const anchored = shaOf(anchor);
      const shas = [
        ...new Set([kept, anchored, ...picked.map((p) => p.sha)].filter((s) => s !== undefined)),
      ];
      try {
        const [nextShape, nextRefs, found] = await Promise.all([
          fetchShape(scope, page.version),
          fetchBranches(scope, page.version),
          shas.length > 0 ? fetchRowsOf(scope, page.version, shas) : Promise.resolve([]),
        ]);
        const rowOf = new Map(shas.map((sha, i) => [sha, found[i] ?? null]));
        const keptRow = kept === undefined ? null : (rowOf.get(kept) ?? null);
        const next = rowAfterListing({
          cursor,
          wasHead: cursor === oldHead,
          shown,
          kept: keptRow,
          head: nextShape.head,
        });
        // The first rows' details, and the cursor's when further down: its pane and file stay.
        const fresh = new Map<number, Commit>();
        page.commits.forEach((c, i) => fresh.set(i, c));
        const blocks = new Set([0]);
        if (next >= 0 && !fresh.has(next) && next < nextShape.rows) {
          const block = Math.floor(next / BLOCK);
          const more = await fetchRows(
            scope,
            block * BLOCK,
            Math.min(nextShape.rows, (block + 1) * BLOCK),
            page.version,
          );
          more.commits.forEach((c, i) => fresh.set(more.from + i, c));
          blocks.add(block);
        }
        const anchorRow = anchored === undefined ? null : (rowOf.get(anchored) ?? null);
        scrollTo.current =
          next >= 0 && next !== keptRow
            ? { reveal: next }
            : anchorRow !== null
              ? { row: anchorRow, offset: at(anchor) }
              : null;
        details.current = fresh;
        asked.current = blocks;
        setFirst(page);
        setShape(nextShape);
        setRefs(nextRefs);
        setCursor(next);
        setPicks((ps) =>
          ps.flatMap((p) => {
            const row = rowOf.get(p.sha);
            return row === null || row === undefined ? [] : [{ ...p, row }];
          }),
        );
        setFlash(null);
        setLoaded((n) => n + 1);
      } catch (e) {
        // Moved again while read: read the newer listing.
        if (e instanceof StaleHistory && tries > 0) return run(tries - 1);
        throw e;
      }
    };
    const done = run(2)
      .catch((e: unknown) => {
        if (e instanceof StaleHistory) setStale(true);
        else setError(`Could not list commits: ${(e as Error).message}`);
      })
      .finally(() => {
        relisting.current = null;
        if (relistAgain.current) {
          relistAgain.current = false;
          void relistRef.current();
        }
      });
    relisting.current = done;
    return done;
  }, [scope, readChanges]);
  relistRef.current = relistHere;

  // Listed in place: the rows where they were on screen, or the cursor revealed when it moved.
  useLayoutEffect(() => {
    const to = scrollTo.current;
    const box = scroller.current;
    if (!to || !box) return;
    scrollTo.current = null;
    if ('reveal' in to) reveal(to.reveal);
    else box.scrollTop = (list.current?.offsetTop ?? 0) + to.row * ROW_HEIGHT - to.offset;
    measure();
  }, [first, reveal, measure]);

  return { latest };
}
