import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { directorySource, typescriptAdapter, type SymbolDecl } from '../../src/index.js';
import { tempDir } from './git-repo.js';

/** Writes files to a temp folder, extracts them, and returns the symbols by ID. */
export async function extractSources(
  files: Record<string, string>,
): Promise<Map<string, SymbolDecl>> {
  const root = tempDir();
  try {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    const revision = await typescriptAdapter.load(directorySource(root));
    const symbols = typescriptAdapter.extract(revision, Object.keys(files));
    return new Map(symbols.map((s) => [s.id, s]));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Extracts the same file in two versions and returns one symbol from each. */
export async function pair(id: string, base: string, head: string, file = 'src/a.ts') {
  const [b, h] = await Promise.all([
    extractSources({ [file]: base }),
    extractSources({ [file]: head }),
  ]);
  const before = b.get(`${file}#${id}`);
  const after = h.get(`${file}#${id}`);
  if (!before || !after)
    throw new Error(`symbol ${id} missing: ${[...b.keys(), ...h.keys()].join(', ')}`);
  return {
    signatureChanged: before.hashes.signature !== after.hashes.signature,
    bodyChanged: before.hashes.body !== after.hashes.body,
    before,
    after,
  };
}
