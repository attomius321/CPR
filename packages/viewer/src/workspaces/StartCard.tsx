import type { ReactNode } from 'react';

/**
 * One of the start page's cards (V63; V93's proof 06-start): a card head with its title — and
 * its "?" and a control at its end, when it has them — then its body. `id` names the heading: a
 * card with an `id` is a group it names.
 */
export function StartCard({
  title,
  help,
  control,
  id,
  className,
  children,
}: {
  /** The heading's words, or the `<label>` of the head's control. */
  title: ReactNode;
  help?: ReactNode;
  control?: ReactNode;
  id?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section
      className={className ? `start-card ${className}` : 'start-card'}
      {...(id ? { role: 'group', 'aria-labelledby': id } : {})}
    >
      <div className="card-head">
        <h2 id={id}>{title}</h2>
        {help}
        {control && <div className="end start-card-control">{control}</div>}
      </div>
      {children && <div className="start-card-body">{children}</div>}
    </section>
  );
}
