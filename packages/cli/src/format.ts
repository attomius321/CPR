import type {
  Analysis,
  ChangedFile,
  Edge,
  FileChangeStatus,
  Finding,
  Graph,
  Severity,
  SymbolChange,
} from '@cpr/core';

const LETTER: Record<FileChangeStatus, string> = {
  added: 'A',
  deleted: 'D',
  modified: 'M',
  renamed: 'R',
  copied: 'C',
  'type-changed': 'T',
};

const short = (sha: string | null) => (sha ? sha.slice(0, 7) : '');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Human summary: revisions, then each changed file with its changed symbols. */
export function formatAnalysis(
  { revisions, files, changes, edges, findings, ignored, since }: Analysis,
  changeRequest?: Graph['changeRequest'],
): string {
  const { base, head } = revisions;
  const side = (ref: string, sha: string | null) => (sha ? `${ref} (${short(sha)})` : ref);
  const mergeBase = base.mergeBase ? `, merge-base ${short(base.mergeBase)}` : '';
  const changed = changes.filter((c) => c.status !== 'unchanged');
  const count = (status: SymbolChange['status']) =>
    changed.filter((c) => c.status === status).length;

  const lines = [`${side(base.ref, base.sha)} → ${side(head.ref, head.sha)}${mergeBase}`];
  if (changeRequest) {
    const sign = changeRequest.forge === 'gitlab' ? '!' : '#';
    lines.unshift(`${sign}${changeRequest.number} ${changeRequest.title}  ${changeRequest.url}`);
  }
  if (files.length === 0) return `${lines.join('\n')}\nno files changed\n`;

  const parts = [
    ['added', count('added')],
    ['removed', count('removed')],
    ['modified', count('modified')],
  ].filter(([, n]) => n !== 0);
  lines.push(
    `${plural(files.length, 'file')} changed · ${plural(changed.length, 'symbol')} changed` +
      (parts.length ? `: ${parts.map(([word, n]) => `${n} ${word}`).join(', ')}` : ''),
  );
  if (since) {
    const statuses = Object.values(since.symbols);
    const tally = (['new', 'updated', 'same'] as const)
      .map((status) => [status, statuses.filter((s) => s === status).length] as const)
      .filter(([, n]) => n > 0)
      .map(([status, n]) => `${n} ${status}`);
    const dropped = since.dropped.length
      ? ` · ${since.dropped.length} no longer changed: ${since.dropped.join(', ')}`
      : '';
    lines.push(
      `since ${side(since.ref, since.sha)}: ${tally.join(', ') || 'nothing changed'}${dropped}`,
    );
  }
  lines.push('');

  if (findings.length > 0) lines.push(...formatFindings(findings), '');

  const byFile = groupByFile(files, changed);
  for (const file of files) {
    const from = file.previousPath === undefined ? '' : `${file.previousPath} → `;
    const skipped = ignored.includes(file.path) ? '  (ignored)' : '';
    lines.push(`${LETTER[file.status]}  ${from}${file.path}${skipped}`);
    for (const change of byFile.get(file.path) ?? []) {
      const status = since?.symbols[change.id];
      lines.push(
        `     ${formatChange(change, users(change, edges))}${status ? `  [${status}]` : ''}`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

const ICON: Record<Severity, string> = { error: '✖', warning: '⚠', info: 'ℹ' };

function formatFindings(findings: Finding[]): string[] {
  const width = Math.max(...findings.map((f) => f.rule.length));
  return [
    'Findings',
    ...findings.flatMap((f) => [
      `  ${ICON[f.severity]} ${f.rule.padEnd(width)}  ${f.symbol}`,
      `      ${f.message}`,
    ]),
  ];
}

/** Distinct symbols that reference a change: in head, or in base for removed symbols. */
function users(change: SymbolChange, edges: Edge[]): number {
  const side = change.status === 'removed' ? 'base' : 'head';
  const from = edges
    .filter((e) => e.to === change.id && (e.side === side || e.side === 'both'))
    .map((e) => e.from);
  return new Set(from).size;
}

function formatChange(change: SymbolChange, usedBy: number): string {
  const symbol = (change.head ?? change.base)!;
  const name = symbol.id.slice(symbol.id.indexOf('#') + 1);
  const { delta } = change;
  const marker =
    change.status === 'added' ? '+' : change.status === 'removed' ? '-' : delta?.moved ? '→' : '~';
  const details = [
    delta?.signature ? 'signature' : '',
    delta?.body ? 'body' : '',
    change.previousId ? `moved from ${change.previousId}` : '',
  ].filter(Boolean);
  const use = usedBy > 0 ? `  · used by ${usedBy}` : '';
  return `${marker} ${symbol.kind.padEnd(11)} ${name}${details.length ? `  (${details.join(', ')})` : ''}${use}`;
}

/** Changes per head file path; removed symbols of renamed files go under the new path. */
function groupByFile(files: ChangedFile[], changes: SymbolChange[]): Map<string, SymbolChange[]> {
  const renamed = new Map(
    files.flatMap((f) =>
      f.status === 'renamed' && f.previousPath ? [[f.previousPath, f.path]] : [],
    ),
  );
  const groups = new Map<string, SymbolChange[]>();
  for (const change of changes) {
    const file = change.head?.file ?? renamed.get(change.base!.file) ?? change.base!.file;
    const group = groups.get(file);
    if (group) group.push(change);
    else groups.set(file, [change]);
  }
  return groups;
}
