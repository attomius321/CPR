import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Graph } from '@cpr/core';
import type { StateName, StateStore } from './server.js';

/**
 * Where the viewer's review state (reviewed marks, draft comments) lives on disk: per repo, and
 * per change request — or per pair of revisions outside `cpr pr` — so it survives restarts, a
 * different port (browser storage is per origin) and new pushes to the change.
 */
export function stateDir(cacheDir: string, repoId: string, graph: Graph): string {
  const { base, head } = graph.revisions;
  const key = graph.changeRequest?.url ?? `${base.sha ?? base.ref}..${head.sha ?? head.ref}`;
  return join(
    cacheDir,
    'state',
    repoId,
    createHash('sha256').update(key).digest('hex').slice(0, 16),
  );
}

/** JSON files in a folder, written atomically (temp file + rename). */
export function fileStateStore(dir: string): StateStore {
  const file = (name: StateName) => join(dir, `${name}.json`);
  return {
    async read(name) {
      try {
        return JSON.parse(await readFile(file(name), 'utf8')) as unknown;
      } catch {
        return null;
      }
    },
    async write(name, value) {
      await mkdir(dir, { recursive: true });
      const temp = `${file(name)}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(value));
      await rename(temp, file(name));
    },
  };
}
