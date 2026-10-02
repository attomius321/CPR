import { lstat, readdir, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_DEPTH = 4;
const SKIPPED = new Set(['.git', 'dist', 'build', 'coverage']);

/**
 * Links every `node_modules` folder of `origin` (the user's checkout) into the same place in
 * `target` (a worktree slot), so the slot sees installed dependency types. Existing entries
 * are left alone. Returns how many links were created.
 */
export async function linkNodeModules(origin: string, target: string): Promise<number> {
  let linked = 0;
  for (const dir of await dependencyFolders(origin)) {
    const parent = join(target, dir);
    const link = join(parent, 'node_modules');
    if (!(await isDirectory(parent)) || (await exists(link))) continue;
    await symlink(join(origin, dir, 'node_modules'), link, 'dir');
    linked += 1;
  }
  return linked;
}

/** Repo-relative folders ('' for the root) that contain a `node_modules` folder. */
async function dependencyFolders(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (rel: string, depth: number) => {
    let entries;
    try {
      entries = await readdir(join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules') {
        // A folder, or a link to one (an install shared between checkouts).
        const path = join(root, rel, entry.name);
        if (entry.isDirectory() || (entry.isSymbolicLink() && (await isFolder(path)))) {
          found.push(rel);
        }
      } else if (
        entry.isDirectory() &&
        depth < MAX_DEPTH &&
        !SKIPPED.has(entry.name) &&
        !entry.name.startsWith('.')
      ) {
        await walk(rel ? `${rel}/${entry.name}` : entry.name, depth + 1);
      }
    }
  };
  await walk('', 0);
  return found;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Whether a path is a folder, following links. */
async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
