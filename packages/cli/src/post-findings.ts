import type { ChangedLines, Finding, Graph, Severity } from '@cpr/core';
import type { Review, ReviewComment } from '@cpr/forge';

const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info'];
const ICONS: Record<Severity, string> = { error: '✖', warning: '⚠', info: 'ℹ' };

type Anchor = Omit<ReviewComment, 'body'>;

export interface FindingsPlan {
  /** New findings with a changed line of their symbol to comment on. */
  inline: { finding: Finding; anchor: Anchor }[];
  /** New findings without one: they go into the review's summary. */
  summary: Finding[];
  /** Findings at the level that an earlier run already posted. */
  skipped: Finding[];
}

/**
 * Identifies a finding across runs: rule and symbol, so a finding whose wording changes (one
 * more caller) is not posted again. Hidden when the forge renders Markdown.
 */
export function findingMarker(finding: Finding): string {
  const key = encodeURIComponent(`${finding.rule}:${finding.symbol}`).replace(/-/g, '%2D');
  return `<!-- cpr:finding ${key} -->`;
}

/** Markers found in existing comments. */
export function postedMarkers(bodies: readonly string[]): Set<string> {
  const markers = new Set<string>();
  for (const body of bodies) {
    for (const match of body.matchAll(/<!-- cpr:finding \S+ -->/g)) markers.add(match[0]);
  }
  return markers;
}

/** Which findings at or above `level` are new, and where each one goes. */
export function planFindings(
  graph: Graph,
  lines: ChangedLines,
  level: Severity,
  posted: ReadonlySet<string>,
): FindingsPlan {
  const plan: FindingsPlan = { inline: [], summary: [], skipped: [] };
  const threshold = SEVERITIES.indexOf(level);
  for (const finding of graph.findings) {
    if (SEVERITIES.indexOf(finding.severity) > threshold) continue;
    if (posted.has(findingMarker(finding))) {
      plan.skipped.push(finding);
      continue;
    }
    const anchor = findingAnchor(graph, lines, finding);
    if (anchor) plan.inline.push({ finding, anchor });
    else plan.summary.push(finding);
  }
  return plan;
}

/**
 * The first changed line inside the finding's symbol: an added line of its head version, else a
 * removed line of its base version (removed symbols). Forges take inline comments only on lines
 * of their diff, which changed lines always are.
 */
export function findingAnchor(graph: Graph, lines: ChangedLines, finding: Finding): Anchor | null {
  const node = graph.nodes.find((n) => n.id === finding.symbol);
  if (!node) return null;
  for (const side of ['head', 'base'] as const) {
    const decl = node[side];
    if (!decl) continue;
    const { start, end } = decl.range;
    const line = lines[side].get(decl.file)?.find((l) => l >= start.line && l <= end.line);
    if (line !== undefined) {
      return { side, path: decl.file, otherPath: otherPath(graph, side, decl.file), line };
    }
  }
  return null;
}

function otherPath(graph: Graph, side: 'base' | 'head', path: string): string {
  for (const file of graph.files) {
    const before = file.previousPath ?? file.path;
    if (side === 'head' && file.path === path) return before;
    if (side === 'base' && before === path) return file.path;
  }
  return path;
}

/** The review to post: a summary, plus inline comments unless `inline` is false. */
export function findingsReview(plan: FindingsPlan, { inline = true } = {}): Review {
  const anchored = inline ? plan.inline : [];
  const listed = inline ? plan.summary : [...plan.inline.map((i) => i.finding), ...plan.summary];
  const all = [...plan.inline.map((i) => i.finding), ...plan.summary];
  const counts = SEVERITIES.map((s) => [s, all.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}${n === 1 ? '' : 's'}`);
  const header = `**CPR** · ${all.length} new finding${all.length === 1 ? '' : 's'} (${counts.join(', ')})`;
  const items = listed.map(
    (f) => `- ${ICONS[f.severity]} **${f.rule}** \`${f.symbol}\`: ${f.message} ${findingMarker(f)}`,
  );
  return {
    event: 'comment',
    body: [header, items.join('\n')].filter(Boolean).join('\n\n'),
    comments: anchored.map(({ finding, anchor }) => ({
      ...anchor,
      body: `**${ICONS[finding.severity]} ${finding.severity} · ${finding.rule}**\n\n${finding.message}\n\n${findingMarker(finding)}`,
    })),
  };
}
