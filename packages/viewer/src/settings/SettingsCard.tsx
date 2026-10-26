import type { ReactNode } from 'react';
import { BackToList } from './BackToList.js';

/**
 * A page of Settings (V62, the person's mockup): one card, its head — the page's name and what goes
 * beside it, its actions at the right — over a hairline, its body scrolling under the head.
 */
export function SettingsCard({
  label,
  title,
  actions,
  className,
  onBack,
  children,
}: {
  /** The region's name. */
  label: string;
  /** The head's heading: the name, and a chip after it. */
  title: ReactNode;
  /** At the head's right: a prompt's Reset to default. */
  actions?: ReactNode;
  className?: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`settings-editor${className ? ` ${className}` : ''}`} aria-label={label}>
      <BackToList onBack={onBack} />
      <div className="settings-head">
        <h2>{title}</h2>
        {actions}
      </div>
      <div className="settings-page">{children}</div>
    </section>
  );
}
