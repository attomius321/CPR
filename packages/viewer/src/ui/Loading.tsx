// Something under way (fix/static-loadings): the turning loader arc and its words, never the words
// alone. A line of its own is a `p`; inline (a busy button, a list's empty place) a `span` in
// what holds it. Neither is a live region unless asked (`status`): a page has one status line,
// which its tests and screen readers find by its role.
import type { ReactNode } from 'react';
import { SpinIcon } from './icons.js';

/** A loading line, or with `inline` its words in a button or a sentence: the arc turns before them. */
export function Loading({
  children,
  className,
  inline = false,
  status = false,
}: {
  children: ReactNode;
  /** The place's own class (its margins, its tests). */
  className?: string;
  inline?: boolean;
  /** A live region: said to a screen reader as it comes. */
  status?: boolean;
}) {
  const classes = className ? `loading ${className}` : 'loading';
  const Tag = inline ? 'span' : 'p';
  return (
    <Tag className={classes} {...(status ? { role: 'status' } : {})}>
      <SpinIcon />
      {children}
    </Tag>
  );
}
