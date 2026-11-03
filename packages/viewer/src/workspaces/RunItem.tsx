// A step on a timeline (V92, the kits' `run.css` `.item`): its dot, its name and words, what it
// ran beneath. Hive's Run tab and a merge's Steps (V93) draw theirs with it.
import type { ReactNode } from 'react';

export type ItemState = 'ok' | 'run' | 'fail' | 'warning' | 'todo';

/** A step of a timeline: its mark, its name and words, what it ran beneath. */
export function Item({
  name,
  state,
  icon,
  words,
  end,
  last = false,
  children,
}: {
  name: string;
  state: ItemState;
  icon: ReactNode;
  words?: ReactNode;
  end?: ReactNode;
  last?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className={`run-item is-${state}${last ? ' last' : ''}`} aria-label={name}>
      <span className="run-dot" aria-hidden="true">
        {icon}
      </span>
      <div className="run-top">
        <b>{name}</b>
        {words && <span className="run-said">{words}</span>}
        {end && <span className="run-end">{end}</span>}
      </div>
      {children && <div className="run-content">{children}</div>}
    </li>
  );
}

/** A command that passed: a check, 14 px. */
export const ChecksMark = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);
