import { useEffect, useRef, useState } from 'react';
import { MoreIcon } from './icons.js';
import { tip } from './tip.js';

/** An entry of the "⋯" menu. */
export interface MenuAction {
  label: string;
  title?: string;
  disabled?: boolean;
  onSelect: () => void;
}

/** "⋯": a page's less frequent actions, in a menu under the button (a workspace's, a merge's). */
export function MoreActions({ actions }: { actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  if (actions.length === 0) return null;
  return (
    <div className="more-actions" ref={box}>
      <button
        type="button"
        className="icon-button"
        aria-label="More actions"
        {...tip('More actions')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreIcon />
      </button>
      {open && (
        <div className="more-menu" role="menu" aria-label="More actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              {...tip(action.title, { side: 'right' })}
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
