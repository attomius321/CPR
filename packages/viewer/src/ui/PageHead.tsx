import type { ReactNode } from 'react';

/**
 * A page's head (V72, decision 509): its icon, its title with what goes beside it (its "?", a
 * kind's chip), a muted line under it, its actions at the right. One box on every page
 * (`ui/page.css`): the titles stand at one x and the cards under them start at one y.
 */
export function PageHead({
  icon,
  title,
  titleId,
  beside,
  line,
  actions,
  end,
  className,
}: {
  /** 28 px, drawn in the accent; Symbiote's S on Start a workspace. */
  icon: ReactNode;
  title: ReactNode;
  /** The title's id, for the region it names. */
  titleId?: string;
  /** On the title's line, after it. */
  beside?: ReactNode;
  /** Under the title, muted, cut to one line. */
  line?: ReactNode;
  /** At the head's right; under the title where the main area is too narrow for them. */
  actions?: ReactNode;
  /**
   * After the actions, at the right of the title's line at every width (V76c): what must stay
   * put while the actions before it change, page to page.
   */
  end?: ReactNode;
  /** The page's own class: its rules and its tests find the head by it. */
  className?: string;
}) {
  const parts = (
    <>
      <span className="page-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="page-title">
        <div className="page-name-line">
          <h1 id={titleId}>{title}</h1>
          {beside}
        </div>
        {line !== undefined && <div className="page-line">{line}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </>
  );
  const classes = ['page-head', end !== undefined && 'page-head-end', className].filter(Boolean);
  return (
    <header className={classes.join(' ')}>
      {end === undefined ? (
        parts
      ) : (
        <>
          <div className="page-head-main">{parts}</div>
          <div className="page-end">{end}</div>
        </>
      )}
    </header>
  );
}
