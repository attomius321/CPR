import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { tip } from './tip.js';

/** The canvas keeps at least this width (unless `room` says otherwise); also its flex basis in
 * styles.css. */
const MIN_CANVAS = 240;
/** Arrow keys move the edge this far; with Shift, four times as far. */
const STEP = 16;

interface Range {
  width: number;
  min: number;
  max: number;
}

interface Props {
  /** What it resizes, for assistive technology: "Resize review sidebar". */
  label: string;
  /** Where the panel is: before the handle (left of it) or after it (right of it). */
  side: 'before' | 'after';
  /** The custom property on the parent that holds the panel's width. */
  variable: string;
  /** The new width once a drag or key press ends; null restores the default. */
  onResize: (width: number | null) => void;
  /** A drag starts or ends. */
  onDrag: (dragging: boolean) => void;
  /** The panel's narrowest; unset, its CSS `min-width`. */
  min?: number;
  /** The panel's widest, room allowing. */
  max?: number;
  /** What the rest keeps: the canvas's MIN_CANVAS unless set. */
  room?: number;
  /**
   * The panel and what gives up the room, when they are not the handle's siblings: the sidenav's
   * handle lies over it in the shell's grid.
   */
  find?: (handle: HTMLElement) => { panel: Element | null; rest: Element | null };
  /** Between two cards (V72): the gutter itself, `--page-gap` wide, where it straddles an edge. */
  gutter?: boolean;
}

/**
 * A handle on a panel's inner edge: drag it, or focus it and use the arrow keys (Home/End for
 * the narrowest and widest), to resize the panel; double-click restores its default width. What
 * is beside the panel gives up the room, down to `room` (the canvas's MIN_CANVAS).
 */
export function Resizer({
  label,
  side,
  variable,
  onResize,
  onDrag,
  min: narrowest,
  max: widest = Infinity,
  room: keep = MIN_CANVAS,
  find,
  gutter = false,
}: Props) {
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<(Range & { x: number; next: number; moved: boolean }) | null>(null);
  const [range, setRange] = useState<Range | null>(null);
  const [dragging, setDragging] = useState(false);
  // Moving the handle toward the canvas widens the panel.
  const sign = side === 'before' ? 1 : -1;

  /** The panel's width as drawn, and how far it can go. */
  const measure = (): Range | null => {
    const el = handle.current;
    if (!el) return null;
    const { panel, rest } = find
      ? find(el)
      : side === 'before'
        ? { panel: el.previousElementSibling, rest: el.nextElementSibling }
        : { panel: el.nextElementSibling, rest: el.previousElementSibling };
    if (!panel || !rest) return null;
    const width = Math.round(panel.getBoundingClientRect().width);
    const min = narrowest ?? Math.round(parseFloat(getComputedStyle(panel).minWidth) || 0);
    const room = Math.floor(rest.getBoundingClientRect().width) - keep;
    return { width, min, max: Math.max(min, Math.min(widest, width + room)) };
  };

  const clamp = (width: number, { min, max }: Range) =>
    Math.round(Math.min(max, Math.max(min, width)));

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const current = measure();
    if (!current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { ...current, x: event.clientX, next: current.width, moved: false };
  };

  // While dragging, the width goes straight to the page: nothing re-renders until the drop.
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    // A click is not a drag: only moving starts one.
    if (!current.moved) {
      current.moved = true;
      setDragging(true);
      onDrag(true);
    }
    current.next = clamp(current.width + sign * (event.clientX - current.x), current);
    handle.current?.parentElement?.style.setProperty(variable, `${current.next}px`);
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!current.moved) return;
    setDragging(false);
    onDrag(false);
    if (current.next !== current.width) {
      onResize(current.next);
      setRange({ ...current, width: current.next });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = measure();
    if (!current) return;
    const step = event.shiftKey ? STEP * 4 : STEP;
    let next: number;
    if (event.key === 'ArrowRight') next = current.width + sign * step;
    else if (event.key === 'ArrowLeft') next = current.width - sign * step;
    else if (event.key === 'Home') next = current.min;
    else if (event.key === 'End') next = current.max;
    else return;
    event.preventDefault();
    next = clamp(next, current);
    onResize(next);
    setRange({ ...current, width: next });
  };

  return (
    <div
      ref={handle}
      className={`resizer${gutter ? ' gutter' : ''}${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={range?.width}
      aria-valuemin={range?.min}
      aria-valuemax={range?.max}
      tabIndex={0}
      {...tip('Drag to resize\nDouble-click to restore', { side: 'right' })}
      onFocus={() => setRange(measure())}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        onResize(null);
        // Measured once the default width is drawn again.
        requestAnimationFrame(() => setRange(measure()));
      }}
    />
  );
}
