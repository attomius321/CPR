import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Root } from 'postcss';
import type { LanguageAdapter } from '../../adapter.js';
import { extractStylesheet } from './extract.js';
import { isStylesheet, stylesheetLanguage } from './files.js';
import { parseStylesheet } from './parse.js';

/** A loaded revision of the repository's stylesheets, parsed as they are needed. */
export interface CssRevision {
  /** Absolute revision root. */
  root: string;
  /** Parsed stylesheets by repo-relative path; null: missing or unreadable. */
  parsed: Map<string, Root | null>;
  warnings: string[];
}

/** A stylesheet of the revision, parsed once; undefined when it is missing or unreadable. */
export function stylesheet(revision: CssRevision, path: string): Root | undefined {
  let root = revision.parsed.get(path);
  if (root === undefined) {
    let text: string | undefined;
    try {
      text = readFileSync(join(revision.root, path), 'utf8');
    } catch {
      text = undefined;
    }
    root = text === undefined ? null : (parseStylesheet(path, text, revision.warnings) ?? null);
    revision.parsed.set(path, root);
  }
  return root ?? undefined;
}

/** The stylesheet adapter: CSS and SCSS rules, custom properties, keyframes and SCSS members. */
export const stylesheetAdapter: LanguageAdapter<CssRevision> = {
  id: 'css',
  matches: isStylesheet,
  load: (source) => Promise.resolve({ root: source.root, parsed: new Map(), warnings: [] }),
  extract: (revision, files) =>
    files.flatMap((file) => {
      const root = stylesheet(revision, file);
      return root ? extractStylesheet(file, root) : [];
    }),
  incoming: () => [],
  outgoing: () => [],
  dangling: () => [],
  // Markup, scripts and libraries use rules, custom properties, variables and keyframes in
  // ways Symbiote does not fully see; only `@extend` uses a placeholder, `@include` a mixin.
  exposure: (_revision, symbol) =>
    symbol.kind === 'mixin' ||
    symbol.kind === 'function' ||
    (symbol.kind === 'rule' && symbol.name.startsWith('%'))
      ? undefined
      : 'framework',
  publicApi: () => false,
  languageOf: (path) => (isStylesheet(path) ? stylesheetLanguage(path) : undefined),
  warnings: (revision) => revision.warnings,
};
