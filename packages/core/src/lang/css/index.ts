import type { LanguageAdapter } from '../../adapter.js';
import { isStylesheet, stylesheetLanguage } from './files.js';

/** A loaded revision of the repository's stylesheets. */
export interface CssRevision {
  /** Absolute revision root. */
  root: string;
  warnings: string[];
}

/** The stylesheet adapter: CSS and SCSS rules, custom properties, keyframes and SCSS members. */
export const stylesheetAdapter: LanguageAdapter<CssRevision> = {
  id: 'css',
  matches: isStylesheet,
  load: (source) => Promise.resolve({ root: source.root, warnings: [] }),
  extract: () => [],
  incoming: () => [],
  outgoing: () => [],
  dangling: () => [],
  exposure: () => undefined,
  publicApi: () => false,
  languageOf: (path) => (isStylesheet(path) ? stylesheetLanguage(path) : undefined),
  warnings: (revision) => revision.warnings,
};
