import { Term } from './term';

/** Components every `.mdx` file can use without importing them. */
export function useMDXComponents(components: Record<string, unknown>) {
  return { ...components, Term };
}
