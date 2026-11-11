import { diffLines, diffWordsWithSpace } from 'diff';
import type { Finding, Graph, GraphEdge, GraphNode, Range } from '@symbiote/core';

export interface Neighbour {
  id: string;
  kind: GraphEdge['kind'];
  side: GraphEdge['side'];
  /** Only through an ancestor or interface type: a use when the object is of this class. */
  possible: boolean;
  node: GraphNode | undefined;
}

export interface SymbolDetail {
  node: GraphNode;
  /** Who references this symbol. */
  users: Neighbour[];
  /** What this symbol references. */
  callees: Neighbour[];
  /** Findings about this symbol. */
  findings: Finding[];
  /** Findings about other symbols that list this one (e.g. as an untouched caller). */
  mentions: Finding[];
}

export function symbolDetail(graph: Graph, id: string): SymbolDetail | undefined {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const node = nodes.get(id);
  if (!node) return undefined;
  const neighbour = (other: string, edge: GraphEdge): Neighbour => ({
    id: other,
    kind: edge.kind,
    side: edge.side,
    possible: edge.possible === true,
    node: nodes.get(other),
  });
  const order = (a: Neighbour, b: Neighbour) =>
    a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind);
  return {
    node,
    users: graph.edges
      .filter((e) => e.to === id && e.from !== id)
      .map((e) => neighbour(e.from, e))
      .sort(order),
    callees: graph.edges
      .filter((e) => e.from === id && e.to !== id)
      .map((e) => neighbour(e.to, e))
      .sort(order),
    findings: graph.findings.filter((f) => f.symbol === id),
    mentions: graph.findings.filter((f) => f.symbol !== id && f.related.includes(id)),
  };
}

/** A group of a symbol's neighbours in the detail (V90, decision 841): its title and its tone. */
export interface NeighbourGroup {
  title: string;
  /** `error`: still uses a removed symbol; `ok`: no longer does; none: as it is. */
  tone?: 'error' | 'ok';
  items: Neighbour[];
}

/**
 * A symbol's users and uses by side: those that still use a removed symbol (its
 * `removed-still-referenced` finding's), those that used it before the change only, those that do
 * now; what it uses now, and no longer.
 */
export function neighbourGroups({ users, callees, findings }: SymbolDetail): NeighbourGroup[] {
  const still = new Set(
    findings.filter((f) => f.rule === 'removed-still-referenced').flatMap((f) => f.related),
  );
  const groups: NeighbourGroup[] = [
    { title: 'Still used by', tone: 'error', items: users.filter((u) => still.has(u.id)) },
    {
      title: 'Used by',
      items: users.filter((u) => !still.has(u.id) && u.side !== 'base'),
    },
    {
      title: 'Used before by',
      tone: 'ok',
      items: users.filter((u) => !still.has(u.id) && u.side === 'base'),
    },
    { title: 'Uses', items: callees.filter((c) => c.side !== 'base') },
    { title: 'No longer uses', tone: 'ok', items: callees.filter((c) => c.side === 'base') },
  ];
  return groups.filter((group) => group.items.length > 0);
}

export interface Excerpt {
  /** 1-based number of the first line. */
  firstLine: number;
  text: string;
}

/** The whole lines a range covers, without their common indentation. */
export function excerpt(source: string, range: Range): Excerpt {
  const lines = source.split('\n').slice(range.start.line - 1, range.end.line);
  const indents = lines
    .filter((l) => l.trim() !== '')
    .map((l) => /^[\t ]*/.exec(l)?.[0].length ?? 0);
  const common = indents.length > 0 ? Math.min(...indents) : 0;
  return { firstLine: range.start.line, text: lines.map((l) => l.slice(common)).join('\n') };
}

export interface DiffRow {
  type: 'same' | 'add' | 'del';
  text: string;
  /** Line numbers in base / head. */
  base?: number;
  head?: number;
}

/** A unified line diff of a symbol's two versions; one side may be missing (added/removed). */
export function diffRows(base: Excerpt | undefined, head: Excerpt | undefined): DiffRow[] {
  const rows: DiffRow[] = [];
  let baseLine = base?.firstLine ?? 0;
  let headLine = head?.firstLine ?? 0;
  for (const part of diffLines(withNewline(base?.text), withNewline(head?.text))) {
    const lines = part.value.replace(/\n$/, '').split('\n');
    for (const text of lines) {
      if (part.added) rows.push({ type: 'add', text, head: headLine++ });
      else if (part.removed) rows.push({ type: 'del', text, base: baseLine++ });
      else rows.push({ type: 'same', text, base: baseLine++, head: headLine++ });
    }
  }
  return rows;
}

function withNewline(text: string | undefined): string {
  return text === undefined ? '' : `${text}\n`;
}

/** A tab's columns in the panel's code (`.code`'s `tab-size`). */
const TAB = 2;
/** The most a wrapped line hangs: past it, a deep line keeps room for its words. */
const HANG_MAX = 8;

/**
 * Where a wrapped line of the panel's code goes on (V103, decision 975): under its own code, at
 * its indent in columns, at most `HANG_MAX`; 0 for a line of spaces only.
 */
export function hangOf(text: string): number {
  const indent = /^[\t ]*/.exec(text)?.[0] ?? '';
  if (indent.length === text.length) return 0;
  const columns = [...indent].reduce((sum, c) => sum + (c === '\t' ? TAB : 1), 0);
  return Math.min(columns, HANG_MAX);
}

/** A run of a changed signature's words: kept, removed or added (V103, decision 976). */
export interface SignatureRun {
  type: 'same' | 'del' | 'add';
  text: string;
}

/** Past this share of the two signatures' characters changed, the panel shows both whole. */
const MOST_CHANGED = 0.5;

/** A letter or a digit: a word's, unlike spaces and punctuation. */
const WORD = /[\p{L}\p{N}]/u;

/**
 * A signature's two versions as one: the words kept, removed and added (a diff of words,
 * punctuation and spaces). The changes between two kept words are one removed run then one added
 * run, the spaces and punctuation between them in both; null when more than half differs.
 */
export function signatureDiff(before: string, after: string): SignatureRun[] | null {
  const parts = diffWordsWithSpace(before, after).map((part): SignatureRun => ({
    type: part.added ? 'add' : part.removed ? 'del' : 'same',
    text: part.value,
  }));
  const runs: SignatureRun[] = [];
  const push = (type: SignatureRun['type'], text: string) => {
    const last = runs.at(-1);
    if (!text) return;
    if (last?.type === type) last.text += text;
    else runs.push({ type, text });
  };
  let del = '';
  let add = '';
  const flush = () => {
    // Spaces and punctuation both runs start or end with are kept, not changed.
    const [head, tail] = del && add ? sharedEnds(del, add) : [0, 0];
    push('same', del.slice(0, head));
    push('del', del.slice(head, del.length - tail));
    push('add', add.slice(head, add.length - tail));
    push('same', del.slice(del.length - tail));
    del = add = '';
  };
  parts.forEach((part, i) => {
    if (part.type === 'del') del += part.text;
    else if (part.type === 'add') add += part.text;
    else if ((del || add) && parts[i + 1] && !WORD.test(part.text)) {
      // Only spaces or punctuation between two changes: part of both, not a word kept.
      del += part.text;
      add += part.text;
    } else {
      flush();
      push('same', part.text);
    }
  });
  flush();
  // The share is the diff's own: spaces and punctuation drawn in both runs count once.
  const changed = parts.reduce(
    (sum, part) => sum + (part.type === 'same' ? 0 : part.text.length),
    0,
  );
  return changed > MOST_CHANGED * (before.length + after.length) ? null : runs;
}

/** How many spaces and punctuation marks two texts share at their start and at their end. */
function sharedEnds(a: string, b: string): [number, number] {
  const same = (i: number, j: number) => a[i] === b[j] && !WORD.test(a[i] ?? '');
  let head = 0;
  while (head < Math.min(a.length, b.length) && same(head, head)) head++;
  let tail = 0;
  while (
    tail < Math.min(a.length, b.length) - head &&
    same(a.length - 1 - tail, b.length - 1 - tail)
  )
    tail++;
  return [head, tail];
}
