import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..', '..');

/** Every .ts and .tsx file under `dir`. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** `file:name` for each identifier in `file` whose name has "feature" in it, any case. */
function featureIdentifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && /feature/i.test(node.text)) {
      found.push(`${relative(root, file).split('\\').join('/')}:${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('one word for a workspace (V25)', () => {
  it('names a workspace "workspace" in code; "feature" is left only for the kind of work', () => {
    const found = ['core', 'cli', 'viewer']
      .flatMap((name) => sources(join(root, 'packages', name, 'src')))
      .flatMap(featureIdentifiers)
      .sort();
    expect(found).toEqual(
      [
        // `symbiote/config.json`'s section by its name before V25, still read.
        'packages/cli/src/workspaces.ts:features',
        'packages/cli/src/workspaces.ts:features',
        // The kind of work: its prefix, its brief's parts; its line in the dialog.
        'packages/cli/src/workspaces.ts:feature',
        'packages/cli/src/workspace-brief.ts:feature',
        'packages/viewer/src/workspaces/brief.ts:feature',
      ].sort(),
    );
  });
});
