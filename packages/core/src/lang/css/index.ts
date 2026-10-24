import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LanguageAdapter, Peers } from '../../adapter.js';
import { loadIgnores, type IgnoreMatcher } from '../../ignore.js';
import { extractStylesheet, type StylesheetFacts } from './extract.js';
import { isStylesheet, stylesheetLanguage } from './files.js';
import { danglingMarkup, incomingMarkup, mentionedCss, setByScript } from './markup.js';
import { parseStylesheet } from './parse.js';
import { danglingCss, incomingCss, outgoingCss } from './references.js';
import { buildIndex, listStylesheets, type StylesheetIndex } from './scope.js';

/**
 * A loaded revision of the repository's stylesheets. Nothing is read when it loads: a
 * stylesheet when it is extracted, all of them the first time a reference is asked for.
 */
export interface CssRevision {
  /** Absolute revision root. */
  root: string;
  ignore: IgnoreMatcher;
  /** Files that must be read even when not listed (the changed ones). */
  files: readonly string[];
  /** What each stylesheet holds, by repo-relative path; null: missing or unreadable. */
  facts: Map<string, StylesheetFacts | null>;
  index?: StylesheetIndex;
  /** The other languages' mentions of stylesheets' names (markup's classes), and scopes. */
  peers?: Peers;
  warnings: string[];
}

/** What a stylesheet of the revision holds, read once; undefined when missing or unreadable. */
function factsOf(revision: CssRevision, path: string): StylesheetFacts | undefined {
  let facts = revision.facts.get(path);
  if (facts === undefined) {
    let text: string | undefined;
    try {
      text = readFileSync(join(revision.root, path), 'utf8');
    } catch {
      text = undefined;
    }
    const root = text === undefined ? undefined : parseStylesheet(path, text, revision.warnings);
    facts = root ? extractStylesheet(path, root) : null;
    revision.facts.set(path, facts);
  }
  return facts ?? undefined;
}

/** Every stylesheet of the revision, indexed once. */
function indexOf(revision: CssRevision): StylesheetIndex {
  if (!revision.index) {
    const files = new Map<string, StylesheetFacts>();
    for (const path of new Set([
      ...listStylesheets(revision.root, revision.ignore),
      ...revision.files,
    ])) {
      const facts = factsOf(revision, path);
      if (facts) files.set(path, facts);
    }
    revision.index = buildIndex(files);
  }
  return revision.index;
}

/** The stylesheet adapter: CSS and SCSS rules, custom properties, keyframes and SCSS members. */
export const stylesheetAdapter: LanguageAdapter<CssRevision> = {
  id: 'css',
  matches: isStylesheet,
  load: (source, options = {}) =>
    Promise.resolve({
      root: source.root,
      ignore: options.ignore ?? loadIgnores(source.root),
      files: options.files ?? [],
      facts: new Map(),
      ...(options.peers ? { peers: options.peers } : {}),
      warnings: [],
    }),
  extract: (revision, files) => files.flatMap((file) => factsOf(revision, file)?.symbols ?? []),
  incoming: (revision, symbol) => [
    ...incomingCss(indexOf(revision), symbol),
    ...incomingMarkup(indexOf(revision), revision.peers, symbol),
  ],
  outgoing: (revision, symbol) => outgoingCss(indexOf(revision), symbol),
  dangling: (revision, removed, base) => {
    const head = { index: indexOf(revision), peers: revision.peers };
    // A custom property a script sets is defined, even with no stylesheet defining it.
    const inStylesheets = danglingCss(head.index, removed).filter((d) => {
      const name = removed.find((s) => s.id === d.target)?.name ?? '';
      return !(name.startsWith('--') && setByScript(revision.peers, name));
    });
    const inMarkup = danglingMarkup(head, { index: indexOf(base), peers: base.peers }, removed);
    return [...inStylesheets, ...inMarkup];
  },
  mentioned: (revision, mentions) => mentionedCss(indexOf(revision), revision.peers, mentions),
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
