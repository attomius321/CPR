import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { ChangedFile } from './git/changed-files.js';

const SKIPPED_DIRS = new Set(['node_modules', '.git']);

/**
 * Files that differ between two folders, like `git diff --name-status` between commits.
 * Renames are detected only for identical content. Used for fixtures and folder comparisons.
 */
export async function listChangedFilesInDirectories(
  baseRoot: string,
  headRoot: string,
): Promise<ChangedFile[]> {
  const [base, head] = await Promise.all([fileHashes(baseRoot), fileHashes(headRoot)]);
  const files: ChangedFile[] = [];
  const deleted = new Map<string, string>(); // content hash → path
  const added: [string, string][] = [];

  for (const [path, hash] of base) {
    const other = head.get(path);
    if (other === undefined) deleted.set(hash, path);
    else if (other !== hash) files.push({ status: 'modified', path });
  }
  for (const [path, hash] of head) {
    if (!base.has(path)) added.push([path, hash]);
  }
  for (const [path, hash] of added) {
    const previousPath = deleted.get(hash);
    if (previousPath !== undefined) {
      deleted.delete(hash);
      files.push({ status: 'renamed', path, previousPath, similarity: 100 });
    } else {
      files.push({ status: 'added', path });
    }
  }
  for (const path of deleted.values()) files.push({ status: 'deleted', path });
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function fileHashes(root: string): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const rel = relative(root, path).split(sep);
    if (rel.some((part) => SKIPPED_DIRS.has(part))) continue;
    const content = await readFile(path);
    hashes.set(rel.join('/'), createHash('sha256').update(content).digest('hex'));
  }
  return hashes;
}
