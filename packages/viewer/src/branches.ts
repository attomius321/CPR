import type { HistoryRefs } from '@symbiote/core';

/** One line of the branches panel (V10b), in the order drawn. */
export type PanelEntry =
  | { kind: 'section'; key: string; label: string; count: number }
  /** A remote, or a folder of branch names (`fix/`); `count`: its branches (or matches). */
  | { kind: 'folder'; key: string; label: string; count: number; depth: number; open: boolean }
  | {
      kind: 'branch';
      key: string;
      /** What is shown: the name's last part under a folder, else the name. */
      label: string;
      /** The ref's name, as badges show it (`wip`, `origin/fix/one`). */
      name: string;
      depth: number;
      /** Its tip's row; null when the listing does not hold it. */
      row: number | null;
      current: boolean;
      upstream?: string;
      ahead?: number;
      behind?: number;
      gone?: boolean;
    };

export interface TreeOptions {
  /** The branch checked out: listed first. */
  current: string | null;
  /** Keeps branches whose name holds it, any case; folders with matches open. */
  filter: string;
  /** Folders flipped from how they start: remotes open, folders closed. */
  toggled: ReadonlySet<string>;
  /** Local branches listed before the current one, in this order (V23: `featuresFirst`). */
  first?: readonly string[];
}

interface Folder {
  folders: Map<string, Folder>;
  branches: { label: string; name: string; row: number | null }[];
  count: number;
}

const byName = (a: string, b: string) => a.localeCompare(b, 'en');

/**
 * The panel's lines: Local (`first` in its order, then the current branch, then by name) and
 * Remotes, per remote, in folders by `/` (folders first, by name). Folders start closed and
 * remotes open, unless `toggled`; with a filter, only matching branches stay and their folders
 * open.
 */
export function branchTree(refs: HistoryRefs, options: TreeOptions): PanelEntry[] {
  const needle = options.filter.trim().toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(needle);
  const entries: PanelEntry[] = [];

  const rank = new Map(options.first?.map((name, i) => [name, i] as const));
  const local = refs.branches
    .filter((b) => matches(b.name))
    .sort((a, b) => {
      const ra = rank.get(a.name);
      const rb = rank.get(b.name);
      if (ra !== undefined || rb !== undefined) return (ra ?? Infinity) - (rb ?? Infinity);
      return a.name === options.current
        ? -1
        : b.name === options.current
          ? 1
          : byName(a.name, b.name);
    });
  if (local.length > 0) {
    entries.push({ kind: 'section', key: 'local', label: 'Local', count: local.length });
    for (const b of local) {
      entries.push({
        kind: 'branch',
        key: `local:${b.name}`,
        label: b.name,
        name: b.name,
        depth: 0,
        row: b.row,
        current: b.name === options.current,
        ...(b.upstream ? { upstream: b.upstream } : {}),
        ...(b.ahead === undefined ? {} : { ahead: b.ahead }),
        ...(b.behind === undefined ? {} : { behind: b.behind }),
        ...(b.gone ? { gone: true } : {}),
      });
    }
  }

  const root: Folder = { folders: new Map(), branches: [], count: 0 };
  for (const r of refs.remotes) {
    if (!matches(r.name)) continue;
    const parts = [r.remote, ...r.branch.split('/')];
    const label = parts.pop() ?? r.name;
    let folder = root;
    folder.count++;
    for (const part of parts) {
      let next = folder.folders.get(part);
      if (!next) {
        next = { folders: new Map(), branches: [], count: 0 };
        folder.folders.set(part, next);
      }
      folder = next;
      folder.count++;
    }
    folder.branches.push({ label, name: r.name, row: r.row });
  }
  if (root.count === 0) return entries;
  entries.push({ kind: 'section', key: 'remotes', label: 'Remotes', count: root.count });
  const walk = (folder: Folder, path: string, depth: number) => {
    for (const [name, inner] of [...folder.folders].sort(([a], [b]) => byName(a, b))) {
      const key = `remote:${path}${name}`;
      // A remote starts open, a folder closed.
      const open = needle !== '' || (depth === 0) !== options.toggled.has(key);
      entries.push({ kind: 'folder', key, label: name, count: inner.count, depth, open });
      if (open) walk(inner, `${path}${name}/`, depth + 1);
    }
    for (const b of [...folder.branches].sort((x, y) => byName(x.label, y.label))) {
      entries.push({
        kind: 'branch',
        key: `remote:${b.name}`,
        label: b.label,
        name: b.name,
        depth,
        row: b.row,
        current: false,
      });
    }
  };
  walk(root, '', 0);
  return entries;
}
