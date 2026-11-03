import type { ReactNode } from 'react';

export function Loading({
  children,
}: {
  children: ReactNode;
  className?: string;
  inline?: boolean;
}) {
  return <p>{children}</p>;
}
