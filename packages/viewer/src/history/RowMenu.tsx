import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MenuChoice } from './checkout.js';
import { tip } from '../ui/tip.js';

/** A ref's name, drawn as the row's badges draw it (V14). */
export function RefBadge({ target, className }: { target: MenuChoice['ref']; className?: string }) {
  return (
    <span
      className={`ref ref-${target.kind}${className ? ` ${className}` : ''}`}
      {...tip(target.name)}
    >
      {target.name}
    </span>
  );
}

/**
 * An entry of a row's menu: with a submenu, "Check out ▸" (V14), "Review ▸" (V15); or an action,
 * "Start a workspace here" (V18).
 */
export type RowMenuItem = SubmenuItem | { label: string; onSelect: () => void };

interface SubmenuItem {
  label: string;
  choices: readonly MenuChoice[];
  /** `index`: of the choice in `choices`. */
  onChoose: (index: number) => void;
}

const hasSubmenu = (item: RowMenuItem | undefined): item is SubmenuItem =>
  item !== undefined && 'choices' in item;

const firstEnabled = (item: RowMenuItem | undefined) =>
  hasSubmenu(item) ? item.choices.findIndex((c) => !c.disabled) : -1;

/**
 * A row's menu (V11), at the pointer or under the row. Each entry opens a submenu (V14) on
 * hover, a click, → or Enter, beside the menu (on its left when the window has no room). Arrows
 * move, Enter chooses and ← goes back; Escape or a click elsewhere closes the menu. Disabled
 * entries say why.
 */
export function RowMenu({
  items,
  at,
  open: opened,
  onClose,
}: {
  items: readonly RowMenuItem[];
  at: { x: number; y: number };
  /** The entry whose submenu is shown at first, its first choice active (`c`, `r`). */
  open?: number;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const parents = useRef<(HTMLButtonElement | null)[]>([]);
  const targets = useRef<HTMLDivElement>(null);
  // The entry the keys act on, the one whose submenu is shown, and whether the keys and the
  // highlight are in that submenu.
  const [parent, setParent] = useState(opened ?? 0);
  const [open, setOpen] = useState<number | null>(opened ?? null);
  const [inside, setInside] = useState(opened !== undefined);
  const [active, setActive] = useState(firstEnabled(items[opened ?? 0]));
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

  // Beside the menu, its first choice level with its entry, inside the window. Measured at the
  // window's left edge, where nothing narrows it.
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect();
    const item = open === null ? undefined : parents.current[open]?.getBoundingClientRect();
    const sub = targets.current;
    const first = sub?.firstElementChild?.getBoundingClientRect();
    if (!box || !item || !sub) {
      setSubPlace(null);
      return;
    }
    const size = sub.getBoundingClientRect();
    const right = box.right - 2;
    const x = right + size.width > window.innerWidth - 8 ? box.left - size.width + 2 : right;
    const y = item.top - (first ? first.top - size.top : 0);
    setSubPlace({
      x: Math.max(8, x),
      y:
        y + size.height > window.innerHeight - 8
          ? Math.max(8, window.innerHeight - size.height - 8)
          : Math.max(8, y),
    });
  }, [open, place]);

  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [onClose]);

  const openItem = (index: number) => {
    const item = items[index];
    if (item && !hasSubmenu(item)) return item.onSelect();
    setParent(index);
    setOpen(index);
    setInside(true);
    setActive(firstEnabled(item));
  };
  const entry = open === null ? undefined : items[open];
  const shown = hasSubmenu(entry) ? entry : undefined;
  const move = (step: number) => {
    const enabled = (shown?.choices ?? []).flatMap((c, i) => (c.disabled ? [] : [i]));
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
        else if (shown && inside) {
          if (key === 'ArrowDown') move(1);
          else if (key === 'ArrowUp') move(-1);
          else if (key === 'ArrowLeft') {
            setOpen(null);
            setInside(false);
          } else if (key === 'Enter' || key === ' ') {
            const choice = shown.choices[active];
            if (choice && !choice.disabled) shown.onChoose(active);
          } else return;
        } else if (key === 'ArrowRight' || key === 'Enter' || key === ' ') openItem(parent);
        else if (key === 'ArrowDown' || key === 'ArrowUp') {
          setOpen(null);
          setParent((parent + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
        } else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {items.map((item, i) =>
        hasSubmenu(item) ? (
          <div key={item.label} role="none" className="menu-host">
            <button
              ref={(element) => {
                parents.current[i] = element;
              }}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open === i}
              className={
                !inside && parent === i ? 'menu-item has-submenu active' : 'menu-item has-submenu'
              }
              onMouseEnter={() => {
                setParent(i);
                setOpen(i);
                setInside(false);
              }}
              onClick={() => openItem(i)}
            >
              {item.label}
            </button>
            {open === i && (
              <div
                ref={targets}
                className="checkout-menu submenu"
                role="menu"
                aria-label={item.label}
                style={
                  subPlace
                    ? { left: subPlace.x, top: subPlace.y }
                    : { left: 0, top: 0, visibility: 'hidden' }
                }
              >
                {item.choices.map((choice, j) => (
                  <button
                    key={choice.label}
                    type="button"
                    role="menuitem"
                    aria-label={choice.label}
                    className={inside && j === active ? 'menu-item active' : 'menu-item'}
                    disabled={!!choice.disabled}
                    onMouseEnter={() => {
                      setInside(true);
                      if (!choice.disabled) setActive(j);
                    }}
                    onClick={() => item.onChoose(j)}
                  >
                    <span className="menu-target">
                      <RefBadge target={choice.ref} />{' '}
                      <span className="menu-kind">{choice.note}</span>
                    </span>
                    {choice.disabled && <span className="menu-note">{choice.disabled}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div key={item.label} role="none" className="menu-host">
            <button
              ref={(element) => {
                parents.current[i] = element;
              }}
              type="button"
              role="menuitem"
              className={!inside && parent === i ? 'menu-item active' : 'menu-item'}
              onMouseEnter={() => {
                setParent(i);
                setOpen(null);
                setInside(false);
              }}
              onClick={item.onSelect}
            >
              {item.label}
            </button>
          </div>
        ),
      )}
    </div>
  );
}
