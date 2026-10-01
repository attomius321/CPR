import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Paths that are code but not product decisions. Changes in them are listed, but their
 * symbols are not analyzed. Extend or override (`!pattern`) with a `.cprignore` file.
 */
export const DEFAULT_IGNORES = [
  '**/fixtures/**',
  '**/__fixtures__/**',
  '**/__snapshots__/**',
  '**/generated/**',
  '**/*.generated.*',
];

export type IgnoreMatcher = (path: string) => boolean;

/**
 * Builds a matcher from gitignore-style patterns, last match wins: `*` stays within a folder,
 * `**` crosses folders, a pattern without `/` matches a name at any depth, `dir/` matches
 * everything below `dir`, and `!pattern` re-includes.
 */
export function ignoreMatcher(patterns: readonly string[]): IgnoreMatcher {
  const rules = patterns
    .map((p) => p.trim())
    .filter((p) => p !== '' && !p.startsWith('#'))
    .map((p) => {
      const negate = p.startsWith('!');
      return { negate, regex: globRegExp(negate ? p.slice(1) : p) };
    });
  return (path) => {
    let ignored = false;
    for (const { negate, regex } of rules) if (regex.test(path)) ignored = !negate;
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
  let glob = pattern.replace(/^\//, '');
  if (glob.endsWith('/')) glob += '**';
  if (!glob.includes('/')) glob = `**/${glob}`;

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
