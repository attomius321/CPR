import type { CodeFile, FileKind } from '@symbiote/monitor';

/** The kinds of file, in the chips' order, with their names (RM1, decision 323). */
export const KINDS: readonly { kind: FileKind; label: string }[] = [
  { kind: 'source', label: 'Source' },
  { kind: 'test', label: 'Tests' },
  { kind: 'docs', label: 'Docs' },
  { kind: 'data', label: 'Data' },
  { kind: 'other', label: 'Other' },
  { kind: 'aside', label: 'Set aside' },
];

/** A folder or a file, with the lines of the kinds turned on. */
export interface CodeNode {
  /** A file's name, a folder's, or a chain of single folders' (`src/main/java`); '' the root. */
  name: string;
  /** Repo-relative; a chain's deepest folder; '' the root. */
  path: string;
  /** Lines of code (not blank, not only a comment), a folder's added up. */
  lines: number;
  /** Files counted: 1 for a file. */
  files: number;
  /** A folder's, largest first (then by path). */
  children?: CodeNode[];
  /** A file's. */
  file?: CodeFile;
}

/** A node's share of the folder's lines, and whether the running share reaches half there. */
export interface ListRow {
  node: CodeNode;
  share: number;
  /** The first row at which the rows above and it hold half of the lines: a line after it. */
  half: boolean;
}

/** How a folder's code is spread over its files (decision 325). */
export interface Concentration {
  lines: number;
  files: number;
  /** The fewest files, largest first, that hold half of the lines. */
  half: number;
  /** The largest tenth of the files: how many, and their share. */
  tenth: number;
  tenthShare: number;
  /** The child holding the most, when there are two or more. */
  leader?: { name: string; share: number };
}

interface Draft {
  name: string;
  path: string;
  folders: Map<string, Draft>;
  files: CodeNode[];
}

/**
 * The folder tree of the files of the kinds turned on; a file without lines of code is left out
 * (it has no area). A chain of folders each holding only the next is one node (decision 324).
 */
export function codeTree(files: readonly CodeFile[], kinds: ReadonlySet<FileKind>): CodeNode {
  const root: Draft = { name: '', path: '', folders: new Map(), files: [] };
  for (const file of files) {
    if (!kinds.has(file.kind) || file.code === 0) continue;
    const parts = file.path.split('/');
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      let next = folder.folders.get(part);
      if (!next) {
        next = {
          name: part,
          path: folder.path ? `${folder.path}/${part}` : part,
          folders: new Map(),
          files: [],
        };
        folder.folders.set(part, next);
      }
      folder = next;
    }
    folder.files.push({ name: parts.at(-1)!, path: file.path, lines: file.code, files: 1, file });
  }
  return finish(root, true);
}

function finish(draft: Draft, isRoot = false): CodeNode {
  let folder = draft;
  let name = draft.name;
  // A chain: a folder whose only content is one folder takes that folder's place.
  while (!isRoot && folder.files.length === 0 && folder.folders.size === 1) {
    folder = [...folder.folders.values()][0]!;
    name = `${name}/${folder.name}`;
  }
  const children = [...[...folder.folders.values()].map((f) => finish(f)), ...folder.files].sort(
    largestFirst,
  );
  return {
    name,
    path: folder.path,
    lines: children.reduce((sum, c) => sum + c.lines, 0),
    files: children.reduce((sum, c) => sum + c.files, 0),
    children,
  };
}

const largestFirst = (a: CodeNode, b: CodeNode) =>
  b.lines - a.lines || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * The folder at `path`: the chain that holds it when it is inside one, else the nearest folder
 * above it (a file's folder, or the root for a path the tree no longer has).
 */
export function nodeAt(root: CodeNode, path: string): CodeNode {
  return crumbs(root, path).at(-1)!;
}

/** The folders from the root to the one at `path` (see `nodeAt`). */
export function crumbs(root: CodeNode, path: string): CodeNode[] {
  const trail = [root];
  let node = root;
  for (;;) {
    if (node.path === path) return trail;
    const next = node.children?.find(
      (child) =>
        child.children &&
        (path === child.path ||
          path.startsWith(`${child.path}/`) ||
          child.path.startsWith(`${path}/`)),
    );
    if (!next) return trail;
    trail.push(next);
    // A path inside a chain is the chain.
    if (next.path.startsWith(`${path}/`)) return trail;
    node = next;
  }
}

/** Every file under a node, largest first. */
function filesUnder(node: CodeNode, into: CodeNode[] = []): CodeNode[] {
  if (!node.children) into.push(node);
  else for (const child of node.children) filesUnder(child, into);
  return into;
}

function sortedFiles(node: CodeNode): CodeNode[] {
  return filesUnder(node).sort(largestFirst);
}

export function concentration(node: CodeNode): Concentration {
  const files = sortedFiles(node);
  let half = 0;
  for (let held = 0; half < files.length && held * 2 < node.lines; half++) {
    held += files[half]!.lines;
  }
  const tenth = Math.ceil(files.length / 10);
  const tenthLines = files.slice(0, tenth).reduce((sum, f) => sum + f.lines, 0);
  const children = node.children ?? [];
  const first = children[0];
  return {
    lines: node.lines,
    files: files.length,
    half,
    tenth,
    tenthShare: node.lines ? tenthLines / node.lines : 0,
    ...(children.length >= 2 && first
      ? { leader: { name: first.name, share: first.lines / node.lines } }
      : {}),
  };
}

const count = (value: number) => value.toLocaleString('en-US');
const percent = (share: number) => `${Math.round(share * 100)} %`;
const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

/**
 * A folder's concentration in words (decision 325): its lines and files, how few files hold
 * half, what the largest tenth holds, and the child holding the most. `unit` is "lines of code",
 * or "lines" when kinds other than source and tests are counted.
 */
export function headline(c: Concentration, unit: string): string[] {
  if (c.files === 0) return [];
  const singular = unit.replace(/^lines/, 'line');
  const words = [`${plural(c.lines, singular, unit)} in ${plural(c.files, 'file', 'files')}.`];
  if (c.files === 1) return words;
  words.push(`Half of it is in ${plural(c.half, 'file', 'files')} (${percent(c.half / c.files)});`);
  words.push(
    c.tenth === 1
      ? `the largest file holds ${percent(c.tenthShare)}.`
      : `the largest 10 % of files (${count(c.tenth)}) hold ${percent(c.tenthShare)}.`,
  );
  if (c.leader) words.push(`${c.leader.name} holds ${percent(c.leader.share)}.`);
  return words;
}

function rows(nodes: readonly CodeNode[], total: number): ListRow[] {
  let held = 0;
  let halved = false;
  return nodes.map((node) => {
    held += node.lines;
    const half = !halved && held * 2 >= total;
    halved ||= half;
    return { node, share: total ? node.lines / total : 0, half };
  });
}

/** The folder's children, largest first, with their share (the list's "In this folder"). */
export function childRows(node: CodeNode): ListRow[] {
  return rows(node.children ?? [], node.lines);
}

/** Every file under the folder, largest first, up to `limit` (the list's "Largest files"). */
export function largestFiles(node: CodeNode, limit = 50): ListRow[] {
  return rows(sortedFiles(node), node.lines).slice(0, limit);
}
