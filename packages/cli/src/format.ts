import type { Analysis, ChangedFile, FileChangeStatus, SymbolChange } from '@cpr/core';

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
export function formatAnalysis({ revisions, files, changes }: Analysis): string {
  const { base, head } = revisions;
  const side = (ref: string, sha: string | null) => (sha ? `${ref} (${short(sha)})` : ref);
  const mergeBase = base.mergeBase ? `, merge-base ${short(base.mergeBase)}` : '';
  const changed = changes.filter((c) => c.status !== 'unchanged');
  const count = (status: SymbolChange['status']) =>
    changed.filter((c) => c.status === status).length;

  const lines = [`${side(base.ref, base.sha)} → ${side(head.ref, head.sha)}${mergeBase}`];
  if (files.length === 0) return `${lines[0]}\nno files changed\n`;

  const parts = [
    ['added', count('added')],
    ['removed', count('removed')],
    ['modified', count('modified')],
  ].filter(([, n]) => n !== 0);
  lines.push(
    `${plural(files.length, 'file')} changed · ${plural(changed.length, 'symbol')} changed` +
      (parts.length ? `: ${parts.map(([word, n]) => `${n} ${word}`).join(', ')}` : ''),
    '',
  );

  const byFile = groupByFile(files, changed);
  for (const file of files) {
    const from = file.previousPath === undefined ? '' : `${file.previousPath} → `;
    lines.push(`${LETTER[file.status]}  ${from}${file.path}`);
    for (const change of byFile.get(file.path) ?? []) lines.push(`     ${formatChange(change)}`);
  }
  return `${lines.join('\n')}\n`;
}

function formatChange(change: SymbolChange): string {
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
  return `${marker} ${symbol.kind.padEnd(11)} ${name}${details.length ? `  (${details.join(', ')})` : ''}`;
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
