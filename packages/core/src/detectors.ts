import type { SymbolChange } from './diff.js';
import type { ChangedFile } from './git/changed-files.js';
import type { Dangling, Edge, Exposure, Finding, RuleId, Severity, SymbolId } from './model.js';

export interface DetectorInput {
  changes: readonly SymbolChange[];
  edges: readonly Edge[];
  files: readonly ChangedFile[];
  /** Head uses of removed names that no longer resolve. */
  dangling: readonly Dangling[];
  /** Why added symbols may be used without in-repo references. */
  exposure: ReadonlyMap<SymbolId, Exposure>;
}

const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info'];

/** Runs every v1 rule and numbers the findings `f1…` in severity order. */
export function runDetectors(input: DetectorInput): Finding[] {
  const findings = [
    ...removedStillReferenced(input),
    ...signatureChanged(input),
    ...orphanAdded(input),
  ].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      a.rule.localeCompare(b.rule) ||
      a.symbol.localeCompare(b.symbol),
  );
  return findings.map((finding, i) => ({ ...finding, id: `f${i + 1}` }));
}

type Draft = Omit<Finding, 'id'>;

/**
 * A removed symbol whose name still appears, unresolved, in head: in a symbol that used it
 * before the change, or imported from the file it was removed from.
 */
function removedStillReferenced({ changes, edges, dangling }: DetectorInput): Draft[] {
  const drafts: Draft[] = [];
  for (const change of changes) {
    if (change.status !== 'removed') continue;
    const before = users(edges, change.id, 'base');
    const hits = dangling.filter(
      (d) => d.target === change.id && (d.viaImport || before.has(d.from)),
    );
    if (hits.length === 0) continue;

    const referencedBy = unique(hits.map((h) => h.from));
    const certainty = hits.some((h) => h.certainty === 'resolved') ? 'resolved' : 'unknown';
    drafts.push(
      draft(
        'removed-still-referenced',
        certainty === 'resolved' ? 'error' : 'warning',
        change.id,
        referencedBy,
        {
          message: `${name(change.id)} was removed but is still used by ${plural(referencedBy.length, 'symbol')}: ${referencedBy.map(name).join(', ')}`,
          data: { referencedBy, certainty, sites: hits.map((h) => h.site) },
        },
      ),
    );
  }
  return drafts;
}

/** A changed signature, with its users split into those updated in this change and the rest. */
function signatureChanged({ changes, edges, files }: DetectorInput): Draft[] {
  const changed = new Set(
    changes.filter((c) => c.status === 'added' || c.status === 'modified').map((c) => c.id),
  );
  const changedFiles = new Set(files.map((f) => f.path));
  const isUpdated = (id: SymbolId) =>
    changed.has(id) || (id.endsWith('#(module)') && changedFiles.has(id.slice(0, id.indexOf('#'))));

  const drafts: Draft[] = [];
  for (const change of changes) {
    if (change.status !== 'modified' || !change.delta?.signature) continue;
    const all = [...users(edges, change.id, 'head')];
    if (all.length === 0) continue;
    const updated = all.filter(isUpdated).sort();
    const untouched = all.filter((id) => !isUpdated(id)).sort();
    drafts.push(
      draft(
        'signature-changed',
        untouched.length > 0 ? 'warning' : 'info',
        change.id,
        [...untouched, ...updated],
        {
          message:
            untouched.length > 0
              ? `${name(change.id)} changed its signature; ${untouched.length} of ${plural(all.length, 'user')} not updated: ${untouched.map(name).join(', ')}`
              : all.length === 1
                ? `${name(change.id)} changed its signature; its only user was updated`
                : `${name(change.id)} changed its signature; all ${all.length} users were updated`,
          data: { callers: all.length, updated: updated.length, untouched: untouched.length },
        },
      ),
    );
  }
  return drafts;
}

/**
 * A new symbol nothing references. Public API (exported from the package entry) and default
 * exports are only `info`; overrides are skipped; members of an orphan class are not repeated.
 */
function orphanAdded({ changes, edges, exposure }: DetectorInput): Draft[] {
  const added = changes
    .filter((c) => c.status === 'added' && c.head && c.head.kind !== 'constructor')
    .sort((a, b) => depth(a.id) - depth(b.id));
  const orphans = new Set<SymbolId>();
  const drafts: Draft[] = [];

  for (const change of added) {
    const container = change.head?.container;
    if (container && orphans.has(container)) continue;
    const used = [...users(edges, change.id, 'head')].some(
      (from) => !from.startsWith(`${change.id}.`),
    );
    if (used) continue;
    const why = exposure.get(change.id);
    if (why === 'override') continue;

    orphans.add(change.id);
    drafts.push(
      draft('orphan-added', why ? 'info' : 'warning', change.id, [], {
        message:
          why === 'entry-export'
            ? `${name(change.id)} is new public API; nothing in the repo uses it yet`
            : why === 'default-export'
              ? `${name(change.id)} is a new default export nothing imports (loaded by convention?)`
              : `${name(change.id)} is new and nothing references it`,
        data: { exportedFromEntry: why === 'entry-export', exposure: why ?? null },
      }),
    );
  }
  return drafts;
}

/** Symbols that reference `id` on a side (edges kept on both sides count for either). */
function users(edges: readonly Edge[], id: SymbolId, side: 'base' | 'head'): Set<SymbolId> {
  return new Set(
    edges
      .filter((e) => e.to === id && e.from !== id && (e.side === side || e.side === 'both'))
      .map((e) => e.from),
  );
}

function draft(
  rule: RuleId,
  severity: Severity,
  symbol: SymbolId,
  related: SymbolId[],
  { message, data }: { message: string; data: Record<string, unknown> },
): Draft {
  return { rule, severity, symbol, related, message, data };
}

function name(id: SymbolId): string {
  return id.slice(id.indexOf('#') + 1);
}

function depth(id: SymbolId): number {
  return name(id).split('.').length;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
