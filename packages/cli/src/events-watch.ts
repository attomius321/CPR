// Changes from outside (V94c, decision 904): files another process writes — an agent's hooks in
// `symbiote/threads/`, a review saved by another `symbiote view`, git's refs after a commit in a
// terminal. One plain `fs.watch` per folder, folders added as they appear: Node's recursive watch on
// Linux missed the third write by rename to one file (how git writes a ref and Symbiote a record)
// and never fired on a folder made after it started (the spike, Node 26). On a disk that gives no
// events (`/mnt/c` under WSL2) nothing fires: the hooks' ping and the safety read are what is left.
import { readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

/** Most folders one tree watches: past it, the rest is left to the safety read. */
const MOST_FOLDERS = 4_096;

export interface Watched {
  close(): void;
}

/**
 * Watches `folder` and the folders under it that `descend` takes (by their path in `folder`),
 * each with a plain watch; tells `onChange` the path of each file or folder that changed. A
 * folder made later is watched once its parent says so; `folder` itself, once made, from its
 * parent. Never throws: a folder it cannot watch is left to the safety read.
 */
export function watchTree(
  folder: string,
  onChange: (path: string) => void,
  descend: (rel: string) => boolean = () => true,
): Watched {
  const watchers = new Map<string, FSWatcher>();
  let top: FSWatcher | null = null;
  let closed = false;

  function drop(dir: string): void {
    watchers.get(dir)?.close();
    watchers.delete(dir);
    // Its folder went: wait for it to come back.
    if (dir === folder) awaitFolder();
  }

  function add(dir: string): void {
    if (closed || watchers.has(dir) || watchers.size >= MOST_FOLDERS) return;
    let watcher: FSWatcher;
    try {
      watcher = watch(dir, (_kind, name) => {
        const path = name ? join(dir, name.toString()) : dir;
        onChange(path);
        if (path === dir) return;
        let folderMade = false;
        try {
          folderMade = statSync(path).isDirectory();
        } catch {
          // Gone (a temporary file renamed): nothing to add.
        }
        if (folderMade && descend(relative(folder, path))) addTree(path);
      });
    } catch {
      return;
    }
    watcher.on('error', () => drop(dir));
    watchers.set(dir, watcher);
  }

  /** `dir` and, in it, every folder `descend` takes. */
  function addTree(dir: string): void {
    add(dir);
    let entries: { name: string; isDirectory(): boolean }[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && descend(relative(folder, path))) addTree(path);
    }
  }

  /** `folder` is not there (yet): its parent says when it is. */
  function awaitFolder(): void {
    if (closed || top) return;
    try {
      top = watch(dirname(folder), (_kind, name) => {
        if (name?.toString() !== basename(folder)) return;
        let made = false;
        try {
          made = statSync(folder).isDirectory();
        } catch {
          // Not yet.
        }
        if (!made) return;
        top?.close();
        top = null;
        addTree(folder);
        onChange(folder);
      });
      top.on('error', () => {
        top?.close();
        top = null;
      });
    } catch {
      // No parent either: the safety read.
    }
  }

  let exists = false;
  try {
    exists = statSync(folder).isDirectory();
  } catch {
    // Made later.
  }
  if (exists) addTree(folder);
  else awaitFolder();

  return {
    close() {
      closed = true;
      top?.close();
      top = null;
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}
