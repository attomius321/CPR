import type { ReactNode } from 'react';

/**
 * A page's head (V72, decision 509): its icon, its title with what goes beside it (its "?", a
 * kind's chip), a muted line under it, its actions at the right. One box on every page
 * (`ui/page.css`): the titles stand at one x and the cards under them start at one y.
 */
export function PageHead({
  icon,
  title,
  beside,
  line,
  actions,
  className,
}: {
  /** 28 px, drawn in the accent; Symbiote's S on Start a workspace. */
  icon: ReactNode;
  title: ReactNode;
  /** On the title's line, after it. */
  beside?: ReactNode;
  /** Under the title, muted, cut to one line. */
  line?: ReactNode;
  /** At the head's right; under the title where the main area is too narrow for them. */
  actions?: ReactNode;
  /** The page's own class: its rules and its tests find the head by it. */
  className?: string;
}) {
  return (
    <header className={className ? `page-head ${className}` : 'page-head'}>
      <span className="page-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="page-title">
        <div className="page-name-line">
          <h1>{title}</h1>
          {beside}
        </div>
        {line !== undefined && <p className="page-line">{line}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
