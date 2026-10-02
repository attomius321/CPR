import { compatibility } from './compat.js';
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
  /**
   * Changed symbols (by change ID) that code outside the repository can use, per side: removed
   * and modified symbols exported from a published package's entry.
   */
  publicApi?: { base: ReadonlySet<SymbolId>; head: ReadonlySet<SymbolId> };
}

/** Test code by its path: `*.test.ts`, `*.spec.ts`, `*.test-d.ts`, `__tests__/`, `test/`… */
export function isTestFile(path: string): boolean {
  return (
    /\.(test|spec)(-d)?\.[cm]?[jt]sx?$/.test(path) ||
    /(^|\/)(__tests__|__mocks__|tests?|e2e)\//.test(path)
  );
}

const fileOf = (id: SymbolId) => id.slice(0, id.indexOf('#'));

const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info'];

/** Runs every v1 rule and numbers the findings `f1…` in severity order. */
export function runDetectors(input: DetectorInput): Finding[] {
  const stillReferenced = removedStillReferenced(input);
  const findings = [
    ...stillReferenced,
    ...signatureChanged(input),
    ...orphanAdded(input),
    ...exportedApiChanged(input, new Set(stillReferenced.map((f) => f.symbol))),
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
          message: `${name(change.id)} was removed but is still used by ${plural(referencedBy.length, 'symbol')}: ${list(referencedBy)}`,
          data: { referencedBy, certainty, sites: hits.map((h) => h.site) },
        },
      ),
    );
  }
  return drafts;
}

/**
 * A changed signature, with its users split into those updated in this change and the rest,
 * and production code apart from tests. It is a warning only when the change may break users
 * (not `compatible`/`additive`) and some untouched production user lives in another file:
 * same-file users are already in front of the reviewer, and a stale test fails on its own.
 */
function signatureChanged({ changes, edges, files }: DetectorInput): Draft[] {
  const changed = new Set(
    changes.filter((c) => c.status === 'added' || c.status === 'modified').map((c) => c.id),
  );
  const changedFiles = new Set(files.map((f) => f.path));
  const isUpdated = (id: SymbolId) =>
    changed.has(id) || (id.endsWith('#(module)') && changedFiles.has(fileOf(id)));

  const drafts: Draft[] = [];
  for (const change of changes) {
    if (change.status !== 'modified' || !change.delta?.signature || !change.base || !change.head) {
      continue;
    }
    const all = [...users(edges, change.id, 'head')];
    if (all.length === 0) continue;
    const updated = all.filter(isUpdated).sort();
    const untouched = all.filter((id) => !isUpdated(id)).sort();
    const tests = all.filter((id) => isTestFile(fileOf(id)));
    const untouchedTests = untouched.filter((id) => isTestFile(fileOf(id)));
    const untouchedCode = untouched.filter((id) => !isTestFile(fileOf(id)));
    const file = change.head.file;
    const elsewhere = untouchedCode.filter((id) => fileOf(id) !== file);
    const compat =
      change.delta.moved && change.base.name !== change.head.name
        ? 'breaking'
        : compatibility(change.base, change.head);
    const risky = (compat === 'breaking' || compat === 'unknown') && elsewhere.length > 0;

    drafts.push(
      draft(
        'signature-changed',
        risky ? 'warning' : 'info',
        change.id,
        [...untouchedCode, ...untouchedTests, ...updated],
        {
          message: signatureMessage(name(change.id), compat, {
            code: all.length - tests.length,
            untouchedCode,
            tests: tests.length,
            untouchedTests: untouchedTests.length,
          }),
          data: {
            callers: all.length,
            updated: updated.length,
            untouched: untouched.length,
            untouchedElsewhere: elsewhere.length,
            tests: tests.length,
            untouchedTests: untouchedTests.length,
            compatibility: compat,
          },
        },
      ),
    );
  }
  return drafts;
}

interface UserCounts {
  /** Users outside tests, and those of them this change did not update. */
  code: number;
  untouchedCode: SymbolId[];
  tests: number;
  untouchedTests: number;
}

function signatureMessage(symbol: string, compat: string, counts: UserCounts): string {
  const { code, untouchedCode, tests, untouchedTests } = counts;
  const testNote =
    tests === 0
      ? ''
      : `${plural(tests, 'test user')}${untouchedTests > 0 ? `, ${untouchedTests} not updated` : ''}`;
  const withTests = testNote ? ` · ${testNote}` : '';
  if (compat === 'compatible' || compat === 'additive') {
    const codeNote = code > 0 ? `${plural(code, 'user')}, ${untouchedCode.length} untouched` : '';
    const total = [codeNote, testNote].filter(Boolean).join(' · ');
    return compat === 'compatible'
      ? `${symbol} changed its signature compatibly; existing users keep working (${total})`
      : `${symbol} gained required members; code that creates it must add them (${total})`;
  }
  if (code === 0) return `${symbol} changed its signature; only tests use it${withTests}`;
  if (untouchedCode.length === 0) {
    const all = code === 1 ? 'its only user was updated' : `all ${code} users were updated`;
    return `${symbol} changed its signature; ${all}${withTests}`;
  }
  return `${symbol} changed its signature; ${untouchedCode.length} of ${plural(code, 'user')} not updated: ${list(untouchedCode)}${withTests}`;
}

/**
 * A new symbol nothing references. Public API (exported from the package entry) and default
 * exports are only `info`; overrides and what a plugin says the framework uses are skipped;
 * members of an orphan class are not repeated.
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
    if (why === 'override' || why === 'framework') continue;

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

/**
 * A published package's API that changed in a way that can break code outside the repository:
 * a public symbol removed, no longer exported from the entry, or with a possibly breaking new
 * signature. In-repo users are the other rules' business; a removal that already breaks the
 * repo itself is reported there only.
 */
function exportedApiChanged(
  { changes, publicApi }: DetectorInput,
  alreadyBroken: ReadonlySet<SymbolId>,
): Draft[] {
  if (!publicApi) return [];
  const drafts: Draft[] = [];
  const add = (id: SymbolId, change: string, message: string, extra = {}) =>
    drafts.push(
      draft('exported-api-changed', 'warning', id, [], { message, data: { change, ...extra } }),
    );

  for (const change of changes) {
    const wasPublic = publicApi.base.has(change.id);
    if (change.status === 'removed') {
      if (wasPublic && !alreadyBroken.has(change.id)) {
        add(change.id, 'removed', `${name(change.id)} was removed from the package's public API`);
      }
      continue;
    }
    if (change.status !== 'modified' || !change.base || !change.head || !wasPublic) continue;
    if (!publicApi.head.has(change.id)) {
      add(
        change.id,
        'unexported',
        `${name(change.id)} is no longer exported from the package entry`,
      );
      continue;
    }
    if (!change.delta?.signature) continue;
    const compat =
      change.delta.moved && change.base.name !== change.head.name
        ? 'breaking'
        : compatibility(change.base, change.head);
    if (compat === 'breaking' || compat === 'unknown') {
      add(
        change.id,
        'signature',
        `${name(change.id)} is public API and its new signature may break code outside the repo`,
        { compatibility: compat },
      );
    }
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

/**
 * Short display name: `Class.method`, `src/app.ts (top level)` for module code, a template's
 * file (`foo.component.html`) or `FooComponent template` for an inline one.
 */
function name(id: SymbolId): string {
  const file = id.slice(0, id.indexOf('#'));
  const qualified = id.slice(id.indexOf('#') + 1);
  if (qualified === '(module)') return `${file} (top level)`;
  if (qualified === '(template)') return file.slice(file.lastIndexOf('/') + 1);
  if (qualified.endsWith('.(template)'))
    return `${qualified.slice(0, -'.(template)'.length)} template`;
  return qualified;
}

/** `a, b, c, d, e and 3 more`. */
function list(ids: SymbolId[], max = 5): string {
  const names = ids.slice(0, max).map(name).join(', ');
  return ids.length > max ? `${names} and ${ids.length - max} more` : names;
}

function depth(id: SymbolId): number {
  return id.slice(id.indexOf('#') + 1).split('.').length;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
