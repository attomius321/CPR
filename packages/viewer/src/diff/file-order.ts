// The Files page's order (V102, decision 973): a review opens on its riskiest file. Pure.
import type { Graph, ReviewFile, Severity } from '@symbiote/core';
import { settled } from '../graph/flow.js';

/** What a file is by its path: code, a test (or a test's fixture), or anything else. */
export type FileKind = 'code' | 'tests' | 'other';

/** Code Symbiote reads, its stylesheets and templates: the spike's pattern (G7), and its kin. */
const CODE = /\.(?:[cm]?[jt]sx?|css|scss|less|html)$/i;
/** A test file, or anything in a tests' folder. */
const TESTS = /(?:^|\/)(?:test|tests|__tests__|e2e)\/|\.(?:test|spec)\.[^/]*$/;

/** A file's kind by its path: tests before code, so a test's `.ts` is a test. */
export function fileKind(path: string): FileKind {
  if (TESTS.test(path)) return 'tests';
  return CODE.test(path) ? 'code' : 'other';
}

/**
 * Each changed file's findings by severity, the ones the Findings tab lists (V100: a settled
 * signature change is not one), keyed by the file's path; a file with none has no entry. A
 * finding is in its symbol's file: the head's, or the base's for a removed symbol, which a renamed
 * file's row holds under its new path.
 */
export function fileFindings(
  files: readonly ReviewFile[],
  graph: Graph,
): Map<string, Record<Severity, number>> {
  const counts = new Map<string, Record<Severity, number>>();
  if (graph.findings.length === 0) return counts;
  // A path or a renamed file's old one, to the row's path; a row's own path wins.
  const rows = new Map<string, string>();
  for (const file of files) if (file.previousPath) rows.set(file.previousPath, file.path);
  for (const file of files) rows.set(file.path, file.path);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const finding of graph.findings) {
    if (settled(finding)) continue;
    const node = nodes.get(finding.symbol);
    const path =
      (node?.head ?? node?.base)?.file ?? finding.symbol.slice(0, finding.symbol.indexOf('#'));
    const row = rows.get(path);
    if (row === undefined) continue;
    const count = counts.get(row) ?? { error: 0, warning: 0, info: 0 };
    count[finding.severity] += 1;
    counts.set(row, count);
  }
  return counts;
}

const GROUPS: Record<FileKind | 'findings', number> = { findings: 0, code: 1, tests: 2, other: 3 };
const NONE: Record<Severity, number> = { error: 0, warning: 0, info: 0 };

/**
 * The change's files in order of risk (decision 973): files with listed findings, worst severity
 * first, then the most of each severity in turn; then other code, tests, and every other file
 * (docs, configuration, images). Inside a group the files keep the order they came in: git's.
 */
export function riskOrder<File extends ReviewFile>(files: readonly File[], graph: Graph): File[] {
  const findings = fileFindings(files, graph);
  const ranked = files.map((file) => {
    const count = findings.get(file.path);
    return { file, count: count ?? NONE, group: GROUPS[count ? 'findings' : fileKind(file.path)] };
  });
  // Array sort is stable: ties keep git's order.
  return ranked
    .sort(
      (a, b) =>
        a.group - b.group ||
        b.count.error - a.count.error ||
        b.count.warning - a.count.warning ||
        b.count.info - a.count.info,
    )
    .map(({ file }) => file);
}
