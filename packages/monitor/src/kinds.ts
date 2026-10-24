import { isTestFile } from '@symbiote/core';
import { languageOf } from './languages.js';
import type { AsideReason, FileKind } from './types.js';

/** What the scan knows of a file besides its path. */
export interface FileFacts {
  /** A NUL byte in its first 8,000 bytes, as git decides. */
  binary: boolean;
  /** `linguist-generated` in `.gitattributes`. */
  generated: boolean;
  /** `linguist-vendored` in `.gitattributes`. */
  vendored: boolean;
  /** Left out by `.symbioteignore` or its defaults (fixtures, examples, playgrounds…). */
  ignored: boolean;
}

/** Package managers' lockfiles: written by a tool, not by the repository's people. */
const LOCKFILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'Podfile.lock',
  'composer.lock',
  'poetry.lock',
  'Pipfile.lock',
  'uv.lock',
  'go.sum',
  'flake.lock',
  'pubspec.lock',
  'mix.lock',
  'packages.lock.json',
]);

/** Tests by name or folder, beyond `isTestFile`'s JavaScript and TypeScript names. */
const TEST_PATH = /(^|\/)spec\/|_test\.go$|(^|\/)test_[^/]*\.py$|_test\.py$/;

/**
 * A file's kind (RM1, decision 323), the first that matches: set aside (with the reason), test,
 * then its language's kind (source, docs, data), else other. Only rules a person can read and
 * change (`.gitattributes`, `.symbioteignore`, the file's name): nothing is guessed from content
 * but binary text.
 */
export function kindOf(path: string, facts: FileFacts): { kind: FileKind; aside?: AsideReason } {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const aside = (reason: AsideReason) => ({ kind: 'aside' as const, aside: reason });
  if (facts.binary) return aside('binary');
  if (LOCKFILES.has(name)) return aside('lockfile');
  if (facts.generated) return aside('generated');
  if (facts.vendored) return aside('vendored');
  if (facts.ignored) return aside('ignored');
  if (/\.min\.[a-z]+$/i.test(name)) return aside('minified');
  if (isTestFile(path) || TEST_PATH.test(path)) return { kind: 'test' };
  return { kind: languageOf(path)?.kind ?? 'other' };
}
