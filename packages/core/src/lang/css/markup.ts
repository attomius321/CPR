import type { Peers } from '../../adapter.js';
import type { Dangling, EdgeRef, Mention, SymbolDecl, SymbolId } from '../../model.js';
import { selectorClasses, selectorParts } from './classes.js';
import type { StylesheetIndex } from './scope.js';

/**
 * Which markup a stylesheet's rules can style: every component's (global), one CSS module's
 * importers through `styles.x`, or some components' own (Angular's `styleUrls`, Qwik's
 * `useStylesScoped$`). A partial reaches what the stylesheets including it reach.
 */
export type Reach = { global: true } | { module: string } | { owners: ReadonlySet<SymbolId> };

const CSS_MODULE = /\.module\.s?css$/;

/** Reaches of a revision's stylesheets and the scopes they come from, once per index. */
const reaches = new WeakMap<
  StylesheetIndex,
  { reach: Map<string, Reach>; scoped: Map<string, Set<SymbolId>> }
>();

export function reachOf(index: StylesheetIndex, peers: Peers | undefined, file: string): Reach {
  let cached = reaches.get(index);
  if (!cached) {
    const scoped = new Map<string, Set<SymbolId>>();
    for (const { stylesheet, owners } of peers?.styleScopes() ?? []) {
      const set = scoped.get(stylesheet) ?? new Set();
      for (const owner of owners) set.add(owner);
      scoped.set(stylesheet, set);
    }
    cached = { reach: new Map(), scoped };
    reaches.set(index, cached);
  }
  const { reach: cache, scoped } = cached;
  const resolve = (path: string, seen: Set<string>): Reach => {
    const known = cache.get(path);
    if (known) return known;
    if (CSS_MODULE.test(path)) return { module: path };
    const own = scoped.get(path);
    if (own) return { owners: own };
    const includers = (index.includedBy.get(path) ?? []).filter((f) => !seen.has(f));
    if (includers.length === 0) return { global: true };
    const owners = new Set<SymbolId>();
    for (const includer of includers) {
      const reach = resolve(includer, new Set([...seen, path]));
      if ('global' in reach) return reach;
      if ('module' in reach) return reach;
      for (const owner of reach.owners) owners.add(owner);
    }
    return { owners };
  };
  const reach = resolve(file, new Set([file]));
  cache.set(file, reach);
  return reach;
}

/** Whether a mention can name what a stylesheet with this reach defines. */
function within(mention: Mention, reach: Reach): boolean {
  if (mention.module !== undefined) return 'module' in reach && reach.module === mention.module;
  if ('global' in reach) return true;
  if ('module' in reach) return false;
  for (const owner of reach.owners) {
    if (mention.from === owner || mention.from.startsWith(`${owner}.`)) return true;
  }
  return false;
}

/** The classes some mentions render, by file and by symbol (CSS modules' apart). */
class Rendered {
  private readonly files = new Map<string, Set<string>>();
  private readonly symbols = new Map<string, Set<string>>();

  add(mentions: readonly Mention[]): this {
    for (const m of mentions) {
      if (m.kind !== 'class') continue;
      const file = this.files.get(key(m.site.file, m)) ?? new Set();
      this.files.set(key(m.site.file, m), file.add(m.name));
      const symbol = this.symbols.get(key(m.from, m)) ?? new Set();
      this.symbols.set(key(m.from, m), symbol.add(m.name));
    }
    return this;
  }

  inFile(m: Mention): ReadonlySet<string> {
    return this.files.get(key(m.site.file, m)) ?? new Set();
  }

  bySymbol(m: Mention): ReadonlySet<string> {
    return this.symbols.get(key(m.from, m)) ?? new Set();
  }
}

const key = (place: string, m: Mention) => `${place}\0${m.module ?? ''}`;

/**
 * How a class mention reaches a rule naming it: only when the mention's file renders every class
 * one of the rule's selectors needs (`.merge-row-actions .button` is no use of every button);
 * certainly when the mentioning symbol renders them all itself, else possibly.
 */
function reachRule(rule: SymbolDecl, mention: Mention, rendered: Rendered): EdgeRef | undefined {
  let possible = false;
  for (const part of selectorParts(rule.name)) {
    if (!part.classes.includes(mention.name)) continue;
    const file = rendered.inFile(mention);
    if (!part.classes.every((c) => file.has(c))) continue;
    const own = rendered.bySymbol(mention);
    if (part.classes.every((c) => own.has(c))) return edge(mention, rule.id, true);
    possible = true;
  }
  return possible ? edge(mention, rule.id, false) : undefined;
}

/** Edges from mentions in markup and scripts to the rules and custom properties they reach. */
export function mentionedCss(
  index: StylesheetIndex,
  peers: Peers | undefined,
  mentions: readonly Mention[],
): EdgeRef[] {
  const refs: EdgeRef[] = [];
  // What each file renders besides these mentions: a rule's other classes may be its siblings'.
  const rendered = new Rendered();
  for (const file of new Set(mentions.map((m) => m.site.file))) {
    rendered.add(
      peers?.mentions({ file, kind: 'class' }) ?? mentions.filter((m) => m.site.file === file),
    );
  }
  for (const mention of mentions) {
    if (mention.kind === 'class') {
      for (const { rule } of index.classes.get(mention.name) ?? []) {
        if (!within(mention, reachOf(index, peers, rule.file))) continue;
        const ref = reachRule(rule, mention, rendered);
        if (ref) refs.push(ref);
      }
    } else if (!mention.sets) {
      for (const definition of index.byKey.get(`property:${mention.name}`) ?? []) {
        refs.push(edge(mention, definition.id, true));
      }
    }
  }
  return refs;
}

/** Who in markup and scripts uses a rule's classes or reads a custom property. */
export function incomingMarkup(
  index: StylesheetIndex,
  peers: Peers | undefined,
  symbol: SymbolDecl,
): EdgeRef[] {
  if (!peers) return [];
  if (symbol.kind === 'rule' && !/^[%@]/.test(symbol.name)) {
    const names = new Set(selectorClasses(symbol.name).map((c) => c.name));
    if (names.size === 0) return [];
    const reach = reachOf(index, peers, symbol.file);
    const mentions = peers.mentions({ names, kind: 'class' }).filter((m) => within(m, reach));
    const rendered = new Rendered().add(mentions);
    return mentions.flatMap((m) => reachRule(symbol, m, rendered) ?? []);
  }
  if (symbol.kind === 'variable' && symbol.name.startsWith('--')) {
    return peers
      .mentions({ names: new Set([symbol.name]), kind: 'property' })
      .filter((m) => !m.sets)
      .map((m) => edge(m, symbol.id, true));
  }
  return [];
}

/**
 * What removals leave in markup: a class that the removed rules styled, still rendered where
 * they reached and styled by no rule there now; a custom property no stylesheet defines any
 * more, still read by a script. Both only change the page's look: `unknown`.
 */
export function danglingMarkup(
  head: { index: StylesheetIndex; peers: Peers | undefined },
  base: { index: StylesheetIndex; peers: Peers | undefined },
  removed: readonly SymbolDecl[],
): Dangling[] {
  if (!head.peers) return [];
  const found: Dangling[] = [];
  for (const symbol of removed) {
    if (symbol.kind === 'rule' && !/^[%@]/.test(symbol.name)) {
      const before = reachOf(base.index, base.peers, symbol.file);
      const names = new Set(selectorClasses(symbol.name).map((c) => c.name));
      if (names.size === 0) continue;
      for (const mention of head.peers.mentions({ names, kind: 'class' })) {
        if (!within(mention, before)) continue;
        const styled = (head.index.classes.get(mention.name) ?? []).some(({ rule }) =>
          within(mention, reachOf(head.index, head.peers, rule.file)),
        );
        if (!styled) found.push(dangling(symbol, mention));
      }
    } else if (symbol.kind === 'variable' && symbol.name.startsWith('--')) {
      if ((head.index.byKey.get(`property:${symbol.name}`) ?? []).length > 0) continue;
      const mentions = head.peers.mentions({ names: new Set([symbol.name]), kind: 'property' });
      if (mentions.some((m) => m.sets)) continue;
      for (const mention of mentions) found.push(dangling(symbol, mention));
    }
  }
  return found;
}

/** Whether a script sets a custom property (then a stylesheet need not define it). */
export function setByScript(peers: Peers | undefined, name: string): boolean {
  return (peers?.mentions({ names: new Set([name]), kind: 'property' }) ?? []).some((m) => m.sets);
}

function edge(mention: Mention, to: SymbolId, subject: boolean): EdgeRef {
  return {
    from: mention.from,
    to,
    kind: 'reference',
    resolution: 'resolved',
    ...(subject ? {} : { possible: true }),
    site: mention.site,
  };
}

function dangling(symbol: SymbolDecl, mention: Mention): Dangling {
  return {
    target: symbol.id,
    from: mention.from,
    site: mention.site,
    certainty: 'unknown',
    viaImport: false,
  };
}
