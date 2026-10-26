import type { ReactNode } from 'react';

/**
 * One of the start page's run cards (V63, the person's mockup): an icon in the accent, a heading
 * and its "?", and at the head's end a control when the card is one choice (Model's select, Plan
 * first's switch); the rest of the card under them. `id` names the heading: a card with an `id`
 * is a group it names (Documents).
 */
export function StartCard({
  icon,
  title,
  help,
  control,
  id,
  className,
  children,
}: {
  icon: ReactNode;
  /** The heading's words, or the `<label>` of the head's control. */
  title: ReactNode;
  help?: ReactNode;
  control?: ReactNode;
  id?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={className ? `start-card ${className}` : 'start-card'}
      {...(id ? { role: 'group', 'aria-labelledby': id } : {})}
    >
      <div className="start-card-head">
        <span className="start-card-icon" aria-hidden="true">
          {icon}
        </span>
        <h2 id={id}>{title}</h2>
        {help}
        {control && <div className="start-card-control">{control}</div>}
      </div>
      {children}
    </div>
  );
}
