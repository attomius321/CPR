import type { ReactNode } from 'react';

/**
 * A pane's head (V64): its icon in a raised square, its title, its actions at the right, and a line
 * under the title saying where it is.
 */
export function PaneHead({
  icon,
  title,
  actions,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="skills-pane-head">
      <span className="skills-tile" aria-hidden="true">
        {icon}
      </span>
      <div className="skills-pane-title">
        <h2>{title}</h2>
        <p className="skills-where">{children}</p>
      </div>
      {actions}
    </div>
  );
}
