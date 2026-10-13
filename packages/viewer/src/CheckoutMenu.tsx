import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { WorkingState } from '@cpr/core';
import { changesNote, type CheckoutChoice } from './checkout.js';

/**
 * A row's checkout menu (V11), at the pointer or under the row: arrows move, Enter chooses,
 * Escape or a click elsewhere closes. Disabled entries say why.
 */
export function CheckoutMenu({
  choices,
  at,
  onChoose,
  onClose,
}: {
  choices: readonly CheckoutChoice[];
  at: { x: number; y: number };
  onChoose: (choice: CheckoutChoice) => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const enabled = choices.flatMap((c, i) => (c.disabled ? [] : [i]));
  const [active, setActive] = useState(enabled[0] ?? -1);
  const [place, setPlace] = useState(at);

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

  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [onClose]);

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
        if (event.key === 'ArrowDown') move(1);
        else if (event.key === 'ArrowUp') move(-1);
        else if (event.key === 'Escape') onClose();
        else if (event.key === 'Enter') {
          const choice = choices[active];
          if (choice && !choice.disabled) onChoose(choice);
        } else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {choices.map((choice, i) => (
        <button
          key={choice.label}
          type="button"
          role="menuitem"
          className={i === active ? 'menu-item active' : 'menu-item'}
          disabled={!!choice.disabled}
          onMouseEnter={() => !choice.disabled && setActive(i)}
          onClick={() => onChoose(choice)}
        >
          {choice.label}
          {choice.disabled && <span className="menu-note">{choice.disabled}</span>}
        </button>
      ))}
    </div>
  );
}

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
        <h2 id="checkout-title">{choice.label}?</h2>
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
