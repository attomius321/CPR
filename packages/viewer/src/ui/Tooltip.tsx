import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TipSide, TipTone } from './tip.js';
import { placeTooltip, type Box, type PlacedSide } from './tips.js';

/**
 * How long the pointer rests on an element before its tooltip shows (the style's, V38's), and for
 * how long after one goes the next shows without that wait: along a toolbar or the sidenav.
 */
const SHOW_DELAY = 400;
const WARM_FOR = 300;
/** How often a shown tooltip checks its element: still on the page, its text, its place. */
const CHECK_EVERY = 250;
/** The one tooltip's id: what its element is `aria-describedby` while it shows. */
const TOOLTIP_ID = 'tooltip';
/**
 * Past this, a tip goes by the pointer rather than by its element's middle: a resize handle as
 * high as the window, a row, a frame's band.
 */
const LONG = 240;

interface Point {
  x: number;
  y: number;
}

interface Shown {
  element: Element;
  text: string;
  keys: string | null;
  tone: TipTone | null;
  side: TipSide;
  /** A cut text's whole text: in the text's font, its letters over the cut ones. */
  cut: { font: string; inset: number } | null;
  code: boolean;
  /** Shown along a toolbar, without the wait: not faded in. */
  warm: boolean;
  /** Where the pointer was when it showed; none for the keyboard's focus. */
  point: Point | null;
}

/** The element whose tooltip a pointer or a focus on `target` asks for. */
const tipped = (target: EventTarget | null): Element | null =>
  target instanceof Element ? target.closest('[data-tip]') : null;

const words = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Whether an element cuts its text: it or a box inside it overflows (an ellipsis, a line clamp),
 * or it runs past a parent that hides its overflow.
 */
function cuts(element: Element): boolean {
  for (const box of [element, ...element.querySelectorAll('*')]) {
    if (box.clientWidth === 0) continue;
    if (box.scrollWidth > box.clientWidth + 1) return true;
    const clamp = getComputedStyle(box).webkitLineClamp;
    if (clamp && clamp !== 'none' && box.scrollHeight > box.clientHeight + 1) return true;
  }
  const parent = element.parentElement;
  if (!parent || getComputedStyle(parent).overflowX === 'visible') return false;
  return element.getBoundingClientRect().right > parent.getBoundingClientRect().right + 1;
}

/**
 * What an element's tooltip shows, or nothing: no text, or words the element shows whole (decision
 * 399; a heading's name beside its count, a name not cut). Its own text cut is shown from where it
 * starts, in its font. What the element hides (the folded sidenav's names) is not shown. A tip
 * with keys says more than the words beside them (Start, and Ctrl+Enter).
 */
function read(element: Element, warm: boolean, point: Point | null): Shown | null {
  const text = element.getAttribute('data-tip');
  if (!text) return null;
  const keys = element.getAttribute('data-tip-keys');
  const shows = words(element instanceof HTMLElement ? element.innerText : '');
  const said = words(text);
  if (!keys && said && shows.includes(said) && !cuts(element)) return null;
  const style = !keys && said && shows === said ? getComputedStyle(element) : null;
  return {
    element,
    text,
    keys,
    tone: element.getAttribute('data-tip-tone') as TipTone | null,
    side: (element.getAttribute('data-tip-side') as TipSide | null) ?? 'top',
    cut: style
      ? {
          font: style.fontFamily,
          inset: parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth),
        }
      : null,
    code: element.hasAttribute('data-tip-code'),
    warm,
    point,
  };
}

/** The part of a long element by the pointer, where its tip goes; the whole element otherwise. */
function byPointer(rect: Box, side: TipSide, point: Point | null): Box {
  const { left, top, width, height } = rect;
  if (point && side === 'right' && height > LONG)
    return { left, top: point.y - 8, width, height: 16 };
  if (point && side !== 'right' && width > LONG)
    return { left: point.x - 8, top, width: 16, height };
  return { left, top, width, height };
}

const same = (a: Shown, b: Shown) =>
  a.text === b.text && a.keys === b.keys && a.tone === b.tone && a.side === b.side;

/**
 * Every element's tooltip (V54, decision 397): one listener on the window for the page, not one
 * per element (the graph has thousands). An element names its tip with `tip()`'s `data-tip…`; the
 * tip shows when the pointer rests on it (`SHOW_DELAY`) or the keyboard's focus reaches it, goes
 * when they leave, on a pointer down, a wheel, Escape, a scroll that moves its element, and when its
 * element leaves the page. One element on the body, placed fixed, taking no pointer (V37: a tip
 * shown by a hover lets the pointer through).
 */
export function Tooltips() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [at, setAt] = useState<{ left: number; top: number; side: PlacedSide } | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const current = useRef<Shown | null>(null);

  const place = useCallback(() => {
    const now = current.current;
    const box = tip.current;
    if (!now || !box) return;
    const rect = now.element.getBoundingClientRect();
    const element = now.cut
      ? {
          left: rect.left + now.cut.inset - parseFloat(getComputedStyle(box).paddingLeft),
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }
      : byPointer(rect, now.side, now.point);
    const size = { width: box.offsetWidth, height: box.offsetHeight };
    const view = { width: window.innerWidth, height: window.innerHeight };
    const next = placeTooltip(element, size, view, now.side, now.cut ? 'start' : 'center');
    setAt((was) =>
      was && was.left === next.left && was.top === next.top && was.side === next.side ? was : next,
    );
  }, []);

  useEffect(() => {
    /** The element the pointer or the focus is on, shown or not, and the pointer's place. */
    let on: Element | null = null;
    let pointer: Point | null = null;
    let byFocus = false;
    let goneAt = -Infinity;
    let timer: number | undefined;
    let check: number | undefined;

    const set = (next: Shown | null) => {
      current.current = next;
      window.clearInterval(check);
      if (next) check = window.setInterval(recheck, CHECK_EVERY);
      setShown(next);
    };
    // Its element gone, its text changed, or moved (a card reordered by a poll).
    const recheck = () => {
      const now = current.current;
      if (!now) return;
      const again = now.element.isConnected ? read(now.element, true, now.point) : null;
      if (!again) set(null);
      else if (!same(again, now)) set(again);
      else place();
    };
    const show = (element: Element, warm: boolean) =>
      set(read(element, warm, byFocus ? null : pointer));
    const ask = (element: Element | null) => {
      if (element === on) return;
      on = element;
      window.clearTimeout(timer);
      const warm = current.current !== null || performance.now() - goneAt < WARM_FOR;
      if (current.current) {
        goneAt = performance.now();
        set(null);
      }
      if (!element) return;
      if (warm) show(element, true);
      else timer = window.setTimeout(() => show(element, false), SHOW_DELAY);
    };
    // Gone at once and not warm; the element under the pointer shows it again only once left.
    const dismiss = () => {
      window.clearTimeout(timer);
      goneAt = -Infinity;
      if (current.current) set(null);
    };

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      pointer = { x: event.clientX, y: event.clientY };
      byFocus = false;
      // A drag (a pan, a resize) asks for nothing.
      ask(event.buttons === 0 ? tipped(event.target) : null);
    };
    const onMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
    };
    const onOut = (event: PointerEvent) => {
      if (event.relatedTarget === null) ask(null);
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.matches(':focus-visible')) return;
      byFocus = true;
      ask(tipped(target));
    };
    const onBlur = (event: FocusEvent) => {
      const now = current.current;
      if (now && event.target instanceof Node && now.element.contains(event.target)) ask(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    // Only a scroll that moves the element: an agent's terminal printing scrolls all the time.
    const onScroll = (event: Event) => {
      const now = current.current;
      const target = event.target;
      if (now && (target === document || (target instanceof Node && target.contains(now.element))))
        dismiss();
    };
    const onLeave = () => {
      dismiss();
      on = null;
    };

    window.addEventListener('pointerover', onOver, true);
    window.addEventListener('pointermove', onMove, { capture: true, passive: true });
    window.addEventListener('pointerout', onOut, true);
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('wheel', dismiss, { capture: true, passive: true });
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('focusin', onFocus, true);
    window.addEventListener('focusout', onBlur, true);
    window.addEventListener('resize', onLeave);
    window.addEventListener('blur', onLeave);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(check);
      window.removeEventListener('pointerover', onOver, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerout', onOut, true);
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('wheel', dismiss, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('focusin', onFocus, true);
      window.removeEventListener('focusout', onBlur, true);
      window.removeEventListener('resize', onLeave);
      window.removeEventListener('blur', onLeave);
    };
  }, [place]);

  // Placed before it is painted; its element described by it while it shows.
  useLayoutEffect(() => {
    if (!shown) {
      setAt(null);
      return;
    }
    place();
    const element = shown.element;
    if (element.hasAttribute('aria-describedby')) return;
    element.setAttribute('aria-describedby', TOOLTIP_ID);
    return () => {
      if (element.getAttribute('aria-describedby') === TOOLTIP_ID)
        element.removeAttribute('aria-describedby');
    };
  }, [shown, place]);

  if (!shown) return null;
  const [head, ...lines] = shown.text.split('\n');
  const font = shown.cut ? { fontFamily: shown.cut.font } : {};
  return createPortal(
    <div
      ref={tip}
      id={TOOLTIP_ID}
      role="tooltip"
      className={`tooltip${shown.cut ? ' tooltip-cut' : ''}${shown.code ? ' tooltip-code' : ''}${shown.warm ? ' tooltip-warm' : ''}`}
      data-side={at?.side}
      style={at ? { left: at.left, top: at.top, ...font } : { visibility: 'hidden', ...font }}
    >
      <div className="tooltip-head">
        {shown.tone && <span className="tooltip-dot" data-tone={shown.tone} aria-hidden="true" />}
        <span className="tooltip-text">{head}</span>
        {shown.keys && (
          <span className="tooltip-keys">
            {shown.keys.split('+').map((key) => (
              <kbd key={key}>{key}</kbd>
            ))}
          </span>
        )}
      </div>
      {lines.map((line, i) => (
        <div key={i} className="tooltip-line">
          {line}
        </div>
      ))}
    </div>,
    document.body,
  );
}
