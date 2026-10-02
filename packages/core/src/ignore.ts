import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Paths that are code but not product decisions: examples, playgrounds, fixtures, generated
 * code. Changes in them are listed but not analyzed, and they are left out of the program
 * (faster loads). Extend or override (`!pattern`) with a `.cprignore` file.
 */
export const DEFAULT_IGNORES = [
  '**/examples/**',
  '**/playground/**',
  '**/fixtures/**',
  '**/__fixtures__/**',
  '**/__snapshots__/**',
  '**/generated/**',
  '**/*.generated.*',
];

export type IgnoreMatcher = (path: string) => boolean;

/**
 * Builds a matcher from gitignore-style patterns, last match wins: `*` stays within a folder,
 * `**` crosses folders, `!pattern` re-includes. As in git, a pattern matches a path or any
 * folder above it (ignoring a folder ignores what is inside), a trailing `/` matches folders
 * only, and a `/` at the start or in the middle anchors a pattern at the root; otherwise it
 * matches at any depth (`interfaces/` ignores every `interfaces` folder). Folders are passed
 * with a trailing `/`.
 */
export function ignoreMatcher(patterns: readonly string[]): IgnoreMatcher {
  const rules = patterns
    .map((p) => p.trim())
    .filter((p) => p !== '' && !p.startsWith('#'))
    .map((p) => {
      const negate = p.startsWith('!');
      const glob = negate ? p.slice(1) : p;
      const folders = glob.endsWith('/');
      return { negate, folders, regex: globRegExp(folders ? glob.slice(0, -1) : glob) };
    });
  return (path) => {
    const isFolder = path.endsWith('/');
    const parts = (isFolder ? path.slice(0, -1) : path).split('/');
    let ignored = false;
    for (const rule of rules) {
      // The path itself, then each folder above it.
      for (let i = parts.length; i >= 1; i--) {
        const folder = i < parts.length || isFolder;
        if (rule.folders && !folder) continue;
        const prefix = parts.slice(0, i).join('/');
        if (rule.regex.test(prefix) || (folder && rule.regex.test(`${prefix}/`))) {
          ignored = !rule.negate;
          break;
        }
      }
    }
    return ignored;
  };
}

/** Default ignores plus the lines of `<root>/.cprignore`, if present. */
export function loadIgnores(root: string): IgnoreMatcher {
  let custom: string[] = [];
  try {
    custom = readFileSync(join(root, '.cprignore'), 'utf8').split('\n');
  } catch {
    // no .cprignore
  }
  return ignoreMatcher([...DEFAULT_IGNORES, ...custom]);
}

function globRegExp(pattern: string): RegExp {
  // A `/` at the start or in the middle anchors the pattern at the root.
  let glob = pattern.replace(/^\//, '');
  if (!pattern.includes('/')) glob = `**/${glob}`;

  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob.charAt(i);
    if (char === '*' && glob[i + 1] === '*') {
      // `**/` matches zero or more folders; a trailing `**` matches everything below.
      if (glob[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}
