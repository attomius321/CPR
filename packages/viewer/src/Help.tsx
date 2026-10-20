import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A page's help behind a "?" in its toolbar (V29b): what the page does and its keys, shown on a
 * click until a click elsewhere or Escape. Its text stays in the page, for screen readers too.
 */
export function Help({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    // Escape closes the help only: the page's own Escape (leave compare mode) waits for the next.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <span className="help" ref={box}>
      <button
        type="button"
        className="icon-button help-button"
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((shown) => !shown)}
      >
        ?
      </button>
      <span className="help-pop" role="note" hidden={!open}>
        {children}
      </span>
    </span>
  );
}
