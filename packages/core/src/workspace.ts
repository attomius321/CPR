import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Workspace globs of the repository at `root`: package.json `workspaces` (a list, or
 * `{ packages }`) and pnpm-workspace.yaml `packages`. A leading `!` excludes.
 */
export function workspacePatterns(root: string): string[] {
  const pkg = readJsonFile(join(root, 'package.json')) as { workspaces?: unknown } | undefined;
  const workspaces = pkg?.workspaces;
  const list = Array.isArray(workspaces)
    ? workspaces
    : (workspaces as { packages?: unknown } | undefined)?.packages;
  const patterns = Array.isArray(list)
    ? list.filter((p): p is string => typeof p === 'string')
    : [];

  const pnpm = join(root, 'pnpm-workspace.yaml');
  if (existsSync(pnpm)) {
    let inPackages = false;
    for (const line of readFileSync(pnpm, 'utf8').split('\n')) {
      if (/^\S/.test(line)) inPackages = /^packages\s*:/.test(line);
      const item = inPackages ? /^\s*-\s*['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/.exec(line) : null;
      if (item?.[1]) patterns.push(item[1]);
    }
  }
  return patterns.map((p) => p.replace(/^(!?)\.\//, '$1').replace(/\/$/, ''));
}

/**
 * Whether a repo-relative folder matches the workspace globs: `*` within one folder name, `**`
 * any number of folders, none included (`libs/**\/*` holds `libs/common`).
 */
export function workspaceMatcher(patterns: readonly string[]): (folder: string) => boolean {
  const include = patterns.filter((p) => !p.startsWith('!')).map(globRegExp);
  const exclude = patterns.filter((p) => p.startsWith('!')).map((p) => globRegExp(p.slice(1)));
  return (folder) => include.some((r) => r.test(folder)) && !exclude.some((r) => r.test(folder));
}

function globRegExp(glob: string): RegExp {
  const parts = glob.split('/');
  const source = parts
    .map((part, i) => {
      const last = i === parts.length - 1;
      if (part === '**') return last ? '.*' : '(?:[^/]+/)*';
      const name = part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
      return last ? name : `${name}/`;
    })
    .join('');
  return new RegExp(`^${source}$`);
}

/** A JSON file's value; undefined when it is missing or not JSON. */
export function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as unknown;
  } catch {
    return undefined;
  }
}
