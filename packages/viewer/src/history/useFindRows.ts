// Git's search (V66f): the rows found once typing stops, the cursor on the first from it, Enter
// stepping through them.
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
import type { HistoryPage, HistoryScope } from '@symbiote/core';
import { findRows } from './git-api.js';
import { nextMatch } from './details.js';

/** How long the search waits for typing to stop. */
const FIND_MS = 250;

/** The search: the rows it found in this listing, a step to the next or the previous. */
export function useFindRows({
  find,
  first,
  scope,
  cursor,
  cursorAt,
  jump,
  relistRef,
  setError,
}: {
  /** The search's words. */
  find: { query: string };
  first: HistoryPage | null;
  scope: HistoryScope;
  cursor: number;
  /** The cursor as last drawn: a search started meanwhile goes from it. */
  cursorAt: RefObject<number>;
  jump: (row: number) => void;
  relistRef: RefObject<() => Promise<void>>;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  // The search (V66f): the rows found in this listing, the field.
  const [matches, setMatches] = useState<number[] | null>(null);
  const findRef = useRef<HTMLInputElement>(null);

  const query = find.query.trim();
  const version = first?.version;
  // The words last searched: listed anew in place, the same words find again without moving.
  const searched = useRef('');
  useEffect(() => {
    if (!query || !version) {
      setMatches(null);
      searched.current = '';
      return;
    }
    const fresh = query !== searched.current;
    if (fresh) setMatches(null);
    let live = true;
    const timer = setTimeout(() => {
      findRows(scope, version, query)
        .then((found) => {
          if (!live) return;
          if (found === null) return void relistRef.current();
          setMatches(found);
          searched.current = query;
          const row = fresh ? nextMatch(found, cursorAt.current - 1, true) : null;
          if (row !== null) jump(row);
        })
        .catch((e: unknown) => live && setError(`Could not find commits: ${(e as Error).message}`));
    }, FIND_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, version, scope, jump]);
  const matched = useMemo(() => new Set(matches ?? []), [matches]);
  const step = useCallback(
    (forward: boolean) => {
      const row = matches ? nextMatch(matches, cursor, forward) : null;
      if (row !== null) jump(row);
    },
    [matches, cursor, jump],
  );
  return { query, matches, matched, step, findRef };
}
