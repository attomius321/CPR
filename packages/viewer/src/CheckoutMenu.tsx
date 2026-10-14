import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { WorkingState } from '@cpr/core';
import { changesNote, type CheckoutChoice } from './checkout.js';

/** A checkout target's name, drawn as the row's badges draw it (V14). */
function RefBadge({ target, className }: { target: CheckoutChoice['ref']; className?: string }) {
  return (
    <span
      className={`ref ref-${target.kind}${className ? ` ${className}` : ''}`}
      title={target.name}
    >
      {target.name}
    </span>
  );
}

/**
 * A row's menu (V11), at the pointer or under the row. It holds "Check out", whose submenu (V14)
 * lists the targets: it opens on hover, a click, → or Enter, beside the menu (on its left when
 * the window has no room). In it arrows move, Enter chooses and ← goes back; Escape or a click
 * elsewhere closes both. Disabled entries say why.
 */
export function CheckoutMenu({
  choices,
  at,
  submenu = false,
  onChoose,
  onClose,
}: {
  choices: readonly CheckoutChoice[];
  at: { x: number; y: number };
  /** Opens with the targets shown and the first one active (the `c` key). */
  submenu?: boolean;
  onChoose: (choice: CheckoutChoice) => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const targets = useRef<HTMLDivElement>(null);
  const enabled = choices.flatMap((c, i) => (c.disabled ? [] : [i]));
  const [active, setActive] = useState(enabled[0] ?? -1);
  // The submenu is shown; the keys and the highlight are in it (`inside`), else on "Check out".
  const [expanded, setExpanded] = useState(submenu);
  const [inside, setInside] = useState(submenu);
  const [place, setPlace] = useState(at);
  const [subPlace, setSubPlace] = useState<{ x: number; y: number } | null>(null);

  // Kept inside the window, and focused so the keys reach it.
  useLayoutEffect(() => {
    const box = menu.current;
    if (!box) return;
    const { width, height } = box.getBoundingClientRect();
    setPlace({
      x: Math.max(8, Math.min(at.x, window.innerWidth - width - 8)),
      y: at.y + height > window.innerHeight - 8 ? Math.max(8, at.y - height) : at.y,
    });
    box.focus();
  }, [at]);

  // Beside the menu, inside the window. Its top is the menu's: the same padding puts its first
  // entry level with "Check out". Measured at the window's left edge, where nothing narrows it.
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect();
    const sub = targets.current?.getBoundingClientRect();
    if (!expanded || !box || !sub) {
      setSubPlace(null);
      return;
    }
    const right = box.right - 2;
    const x = right + sub.width > window.innerWidth - 8 ? box.left - sub.width + 2 : right;
    const low = box.top + sub.height > window.innerHeight - 8;
    setSubPlace({
      x: Math.max(8, x),
      y: low ? Math.max(8, window.innerHeight - sub.height - 8) : box.top,
    });
  }, [expanded, place]);

  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [onClose]);

  const open = () => {
    setExpanded(true);
    setInside(true);
    setActive(enabled[0] ?? -1);
  };
  const move = (step: number) => {
    if (enabled.length === 0) return;
    const at = enabled.indexOf(active);
    setActive(enabled[(at + step + enabled.length) % enabled.length] ?? -1);
  };
  return (
    <div
      ref={menu}
      className="checkout-menu"
      role="menu"
      tabIndex={-1}
      style={{ left: place.x, top: place.y }}
      onKeyDown={(event) => {
        const key = event.key;
        if (key === 'Escape') onClose();
        else if (expanded && inside) {
          if (key === 'ArrowDown') move(1);
          else if (key === 'ArrowUp') move(-1);
          else if (key === 'ArrowLeft') {
            setExpanded(false);
            setInside(false);
          } else if (key === 'Enter' || key === ' ') {
            const choice = choices[active];
            if (choice && !choice.disabled) onChoose(choice);
          } else return;
        } else if (key === 'ArrowRight' || key === 'Enter' || key === ' ') open();
        else if (key !== 'ArrowDown' && key !== 'ArrowUp') return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div role="none" className="menu-host">
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={expanded}
          className={inside ? 'menu-item has-submenu' : 'menu-item has-submenu active'}
          onMouseEnter={() => {
            setExpanded(true);
            setInside(false);
          }}
          onClick={open}
        >
          Check out
        </button>
        {expanded && (
          <div
            ref={targets}
            className="checkout-menu submenu"
            role="menu"
            aria-label="Check out"
            style={
              subPlace
                ? { left: subPlace.x, top: subPlace.y }
                : { left: 0, top: 0, visibility: 'hidden' }
            }
          >
            {choices.map((choice, i) => (
              <button
                key={choice.label}
                type="button"
                role="menuitem"
                aria-label={choice.label}
                className={inside && i === active ? 'menu-item active' : 'menu-item'}
                disabled={!!choice.disabled}
                onMouseEnter={() => {
                  setInside(true);
                  if (!choice.disabled) setActive(i);
                }}
                onClick={() => onChoose(choice)}
              >
                <span className="menu-target">
                  <RefBadge target={choice.ref} /> <span className="menu-kind">{choice.note}</span>
                </span>
                {choice.disabled && <span className="menu-note">{choice.disabled}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** How the confirmation names a target's kind. */
const KINDS: Record<CheckoutChoice['ref']['kind'], string> = {
  branch: 'branch',
  remote: 'remote branch',
  tag: 'tag',
  commit: 'commit',
};

/**
 * Asks before a checkout: what it does, what happens to local changes (or why it cannot run),
 * and git's refusal if it came. Enter checks out, Escape cancels.
 */
export function CheckoutDialog({
  choice,
  state,
  running,
  error,
  onConfirm,
  onCancel,
}: {
  choice: CheckoutChoice;
  state: WorkingState;
  running: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const note = changesNote(state);
  const blocked = state.operation !== null;
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !running) onCancel();
          else if (event.key === 'Enter' && !blocked && !running) onConfirm();
          else return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <h2 id="checkout-title">
          Check out {KINDS[choice.ref.kind]} <RefBadge target={choice.ref} className="dialog-ref" />
          ?
        </h2>
        <p>{choice.what}</p>
        {note && <p className={blocked ? 'error' : 'dialog-note'}>{note}</p>}
        {error && <pre className="error">{error}</pre>}
        <div className="dialog-buttons">
          <button type="button" className="link" disabled={running} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="button"
            autoFocus
            disabled={blocked || running}
            onClick={onConfirm}
          >
            {running ? 'Checking out…' : 'Check out'}
          </button>
        </div>
      </div>
    </div>
  );
}
