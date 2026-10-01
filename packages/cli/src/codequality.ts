import { createHash } from 'node:crypto';
import type { ChangedLines, Finding, Graph, Site } from '@cpr/core';
import { findingAnchor } from './post-findings.js';

/** One issue of a GitLab Code Quality report (the Code Climate format). */
export interface CodeQualityIssue {
  description: string;
  check_name: string;
  /** Stable across runs, so GitLab can tell new issues from known ones. */
  fingerprint: string;
  severity: 'info' | 'minor' | 'major' | 'critical' | 'blocker';
  location: { path: string; lines: { begin: number } };
}

const SEVERITY = { error: 'critical', warning: 'major', info: 'info' } as const;

/**
 * Findings as a GitLab Code Quality report (`artifacts:reports:codequality`): the merge request
 * shows them without any token. Each points at a line of the head version: where a removed
 * symbol is still used, else the first changed line of the symbol, else its first line.
 */
export function codeQualityReport(graph: Graph, lines: ChangedLines): CodeQualityIssue[] {
  return graph.findings.map((finding) => ({
    description: finding.message,
    check_name: finding.rule,
    fingerprint: createHash('sha256')
      .update(`${finding.rule}:${finding.symbol}`)
      .digest('hex')
      .slice(0, 32),
    severity: SEVERITY[finding.severity],
    location: location(graph, lines, finding),
  }));
}

function location(
  graph: Graph,
  lines: ChangedLines,
  finding: Finding,
): CodeQualityIssue['location'] {
  const site = (finding.data.sites as Site[] | undefined)?.[0];
  if (site) return { path: site.file, lines: { begin: site.line } };
  const anchor = findingAnchor(graph, lines, finding);
  if (anchor?.side === 'head') return { path: anchor.path, lines: { begin: anchor.line } };
  // Removed code has no head line: point at its file as it is now.
  if (anchor) return { path: anchor.otherPath, lines: { begin: 1 } };
  const node = graph.nodes.find((n) => n.id === finding.symbol);
  const decl = node?.head ?? node?.base;
  return {
    path: decl?.file ?? finding.symbol.slice(0, finding.symbol.indexOf('#')),
    lines: { begin: decl?.range.start.line ?? 1 },
  };
}
