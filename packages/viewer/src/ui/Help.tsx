import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HelpIcon } from './icons.js';
import { placeTip } from './tips.js';

/** How long a hover rests on the button before its help shows, and how long it outlasts a leave. */
const HOVER_DELAY = 300;
const LEAVE_DELAY = 120;

/**
 * Help behind a "?" (V29b's page help; since V37 every help text): a hover or the focus shows it as
 * a tooltip, a click (or a tap) keeps it until a click elsewhere or Escape. The tip is drawn on the
 * page's body, placed from the button's box, so no scrolling panel clips it; it stays in the
 * document, hidden, as the button's description for screen readers.
 */
export function Help({
  label,
  id,
  children,
}: {
  label: string;
  /** The tip's id, for a page that names it; one of React's otherwise. */
  id?: string;
  children: ReactNode;
}) {
  const own = useId();
  const tipId = id ?? `help-${own.replace(/:/g, '')}`;
  const [shown, setShown] = useState<'hover' | 'focus' | 'pinned' | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const open = shown !== null;

  const later = (then: () => void, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(then, delay);
  };
  const enter = () => later(() => setShown((was) => was ?? 'hover'), HOVER_DELAY);
  const leave = () => later(() => setShown((was) => (was === 'hover' ? null : was)), LEAVE_DELAY);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Placed before it is painted, and again when the page scrolls or the window changes size.
  useLayoutEffect(() => {
    if (!open) {
      setAt(null);
      return;
    }
    const place = () => {
      const from = button.current?.getBoundingClientRect();
      const box = tip.current?.getBoundingClientRect();
      if (!from || !box) return;
      const view = { width: window.innerWidth, height: window.innerHeight };
      const { left, top } = placeTip(from, box, view);
      setAt({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (button.current?.contains(target) || tip.current?.contains(target)) return;
      setShown(null);
    };
    // Escape closes the help only: the page's own Escape (leave compare mode, leave the start
    // page) waits for the next.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      setShown(null);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="icon-button help-button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={tipId}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onFocus={() => setShown((was) => was ?? 'focus')}
        onBlur={() => setShown((was) => (was === 'focus' ? null : was))}
        // A click keeps it; a second click on a kept one closes it.
        onClick={() => setShown((was) => (was === 'pinned' ? null : 'pinned'))}
      >
        <HelpIcon />
      </button>
      {createPortal(
        <div
          ref={tip}
          id={tipId}
          role="tooltip"
          className={shown === 'pinned' ? 'help-tip pinned' : 'help-tip'}
          hidden={!open}
          style={at ? { left: at.left, top: at.top } : { visibility: 'hidden' }}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
