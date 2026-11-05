// Home as a tree (NX6, decision 926): the folders the last scan of home read or found, each
// folder's folders in a file manager's order, and which of them are shown: home's first level,
// then under each folder the person opened. A folder the scan did not read (it stopped short) is
// read when opened (`GET /api/folders`). Pure: the DOM is `list-view.ts`'s.
import type { TreeAnswer } from '../repositories.js';

export interface Tree {
  /** The folder scanned: home. */
  folder: string;
  /** When the scan ended: the tree is read again when it changes. */
  at: string;
  /** Each folder's folders, by name; a folder read with none has none, one not read is absent. */
  children: ReadonlyMap<string, readonly string[]>;
  /** The folders found and not read: their folders are unknown until listed. */
  unread: ReadonlySet<string>;
  /** Every folder, by path. */
  all: readonly string[];
}

/** A folder shown in the tree. */
export interface ShownFolder {
  path: string;
  /** 0 for home's own folders. */
  depth: number;
  open: boolean;
  /** It holds no folder; null while that is unknown (not read yet). */
  leaf: boolean | null;
}

/** File managers' order, as `listFolder`'s: case aside, numbers by value (item9 before item10). */
const byName = new Intl.Collator('en', { numeric: true }).compare;

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';

/** The tree of `GET /api/tree`'s answer. */
export function treeOf(answer: TreeAnswer): Tree {
  const children = new Map<string, string[]>();
  for (const path of answer.tree) {
    const parent = parentOf(path);
    const list = children.get(parent);
    if (list) list.push(path);
    else children.set(parent, [path]);
  }
  for (const list of children.values()) list.sort((a, b) => byName(nameOf(a), nameOf(b)));
  return {
    folder: answer.folder,
    at: answer.at,
    children,
    unread: new Set(answer.unread),
    all: answer.tree,
  };
}

/**
 * The folders shown, depth first: home's own, then each opened folder's under it. `listed` is a
 * folder's folders as read when opened (one the scan did not read), undefined until it answers.
 */
export function shownFolders(
  tree: Tree,
  open: ReadonlySet<string>,
  listed: (path: string) => readonly string[] | undefined,
): ShownFolder[] {
  const read = new Set(tree.all);
  /** A folder's folders, or undefined while unknown. */
  const under = (path: string): readonly string[] | undefined => {
    const scanned = path === tree.folder || (read.has(path) && !tree.unread.has(path));
    if (scanned) return tree.children.get(path) ?? [];
    const answer = listed(path);
    return answer && [...answer].sort((a, b) => byName(nameOf(a), nameOf(b)));
  };
  const out: ShownFolder[] = [];
  const walk = (path: string, depth: number) => {
    for (const child of under(path) ?? []) {
      const known = under(child);
      const isOpen = open.has(child);
      out.push({
        path: child,
        depth,
        open: isOpen,
        leaf: known === undefined ? null : known.length === 0,
      });
      if (isOpen) walk(child, depth + 1);
    }
  };
  walk(tree.folder, 0);
  return out;
}
