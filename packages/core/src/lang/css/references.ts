import type { Dangling, EdgeRef, SymbolDecl } from '../../model.js';
import { memberKey, reaches, resolveUse, type StylesheetIndex } from './scope.js';
import { USE_EDGE, type StyleUse } from './uses.js';

/** Who uses a stylesheet symbol: every use in the revision that resolves to it. */
export function incomingCss(index: StylesheetIndex, symbol: SymbolDecl): EdgeRef[] {
  const key = memberKey(symbol);
  if (!key) return [];
  const refs: EdgeRef[] = [];
  for (const use of index.uses.get(key) ?? []) {
    if (use.from === symbol.id) continue;
    const resolution = resolveUse(index, use);
    if (!('targets' in resolution) || !resolution.targets.some((t) => t.id === symbol.id)) {
      continue;
    }
    refs.push(edge(use, symbol.id, resolution.ambiguous));
  }
  return refs;
}

/** What a stylesheet symbol uses: its tokens, keyframes, variables, mixins, functions. */
export function outgoingCss(index: StylesheetIndex, symbol: SymbolDecl): EdgeRef[] {
  const refs: EdgeRef[] = [];
  for (const use of index.files.get(symbol.file)?.uses ?? []) {
    if (use.from !== symbol.id) continue;
    const resolution = resolveUse(index, use);
    if ('targets' in resolution) {
      for (const target of resolution.targets) {
        if (target.id !== symbol.id) refs.push(edge(use, target.id, resolution.ambiguous));
      }
    } else if ('external' in resolution) {
      refs.push({ ...edge(use, resolution.external, false), target: 'external' });
    } else if ('unknown' in resolution) {
      refs.push({ ...edge(use, resolution.unknown, true), target: 'unknown' });
    }
  }
  return refs;
}

/**
 * Uses in head of removed stylesheet symbols that nothing defines any more. A SCSS member's is
 * an error Sass would report (`resolved`); a custom property's or keyframes' only falls back
 * in the browser, and a script may still set the property (`unknown`).
 */
export function danglingCss(index: StylesheetIndex, removed: readonly SymbolDecl[]): Dangling[] {
  const found: Dangling[] = [];
  for (const symbol of removed) {
    const key = memberKey(symbol);
    if (!key) continue;
    const cascade = key.startsWith('property:') || key.startsWith('keyframes:');
    for (const use of index.uses.get(key) ?? []) {
      const resolution = resolveUse(index, use);
      if (('targets' in resolution && resolution.targets.length > 0) || 'external' in resolution) {
        continue;
      }
      found.push({
        target: symbol.id,
        from: use.from,
        site: use.site,
        certainty: cascade ? 'unknown' : 'resolved',
        viaImport: !cascade && reaches(index, use.site.file, symbol.file),
      });
    }
  }
  return found;
}

function edge(use: StyleUse, to: string, ambiguous: boolean): EdgeRef {
  return {
    from: use.from,
    to,
    kind: USE_EDGE[use.kind],
    resolution: ambiguous ? 'unknown' : 'resolved',
    site: use.site,
  };
}
