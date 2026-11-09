// Which of Git's rows are in view (V10): the scrolled box measured as it scrolls and resizes, a row
// scrolled into view.
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { HistoryPage } from '@symbiote/core';
import { ROW_HEIGHT } from './GraphCell.js';

/** Rows drawn beyond the view, above and below. */
const OVERSCAN = 10;

/** The rows in view, `OVERSCAN` more each side, and how to bring a row into it. */
export function useRowsInView({
  first,
  rows,
}: {
  /** The listing's first rows: measured again once they are drawn. */
  first: HistoryPage | null;
  rows: number;
}) {
  const [view, setView] = useState({ top: 0, height: 0 });
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  // Which rows are in view: the list starts below the title, inside the scrolled box.
  const measure = useCallback(() => {
    const box = scroller.current;
    if (box)
      setView({ top: box.scrollTop - (list.current?.offsetTop ?? 0), height: box.clientHeight });
  }, []);
  useLayoutEffect(() => {
    measure();
    const box = scroller.current;
    if (!box) return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [measure, first]);
  const firstShown = Math.max(0, Math.floor(view.top / ROW_HEIGHT) - OVERSCAN);
  const lastShown = Math.min(rows - 1, Math.ceil((view.top + view.height) / ROW_HEIGHT) + OVERSCAN);

  /** Scrolls row `row` into view: to the middle when `center`, else just enough. */
  const reveal = useCallback((row: number, center = false) => {
    const box = scroller.current;
    if (!box) return;
    const top = (list.current?.offsetTop ?? 0) + row * ROW_HEIGHT;
    if (center) box.scrollTop = top - (box.clientHeight - ROW_HEIGHT) / 2;
    else if (top < box.scrollTop) box.scrollTop = top;
    else if (top + ROW_HEIGHT > box.scrollTop + box.clientHeight) {
      box.scrollTop = top + ROW_HEIGHT - box.clientHeight;
    }
  }, []);
  return { view, scroller, list, measure, firstShown, lastShown, reveal };
}
