import { describe, expect, it } from 'vitest';
import { kindOf, type FileFacts } from '../src/kinds.js';

const NONE: FileFacts = { binary: false, generated: false, vendored: false, ignored: false };
const kind = (path: string, facts: Partial<FileFacts> = {}) => kindOf(path, { ...NONE, ...facts });

describe('kindOf', () => {
  it('sets aside what is not text, not written here, or left out, with the reason', () => {
    expect(kind('src/logo.ts', { binary: true })).toEqual({ kind: 'aside', aside: 'binary' });
    expect(kind('pnpm-lock.yaml')).toEqual({ kind: 'aside', aside: 'lockfile' });
    expect(kind('crates/x/Cargo.lock')).toEqual({ kind: 'aside', aside: 'lockfile' });
    expect(kind('api/client.ts', { generated: true })).toEqual({
      kind: 'aside',
      aside: 'generated',
    });
    expect(kind('lib/parser.js', { vendored: true })).toEqual({ kind: 'aside', aside: 'vendored' });
    expect(kind('test/fixtures/a/base/x.ts', { ignored: true })).toEqual({
      kind: 'aside',
      aside: 'ignored',
    });
    expect(kind('public/app.min.js')).toEqual({ kind: 'aside', aside: 'minified' });
  });

  it('knows tests by name and by folder, in several languages', () => {
    for (const path of [
      'src/a.test.ts',
      'src/b.spec.tsx',
      'packages/cli/test/helpers.ts',
      'e2e/page.ts',
      'src/__tests__/x.js',
      'apps/web/spec/x.ts',
      'pkg/server_test.go',
      'tests/test_api.py',
      'test/data.json',
    ]) {
      expect(kind(path), path).toEqual({ kind: 'test' });
    }
    expect(kind('src/latest/x.ts')).toEqual({ kind: 'source' });
    expect(kind('src/contest.ts')).toEqual({ kind: 'source' });
  });

  it('sorts the rest by language: source, docs, data, other', () => {
    expect(kind('src/a.ts')).toEqual({ kind: 'source' });
    expect(kind('src/styles.css')).toEqual({ kind: 'source' });
    expect(kind('docs/a.md')).toEqual({ kind: 'docs' });
    expect(kind('tsconfig.json')).toEqual({ kind: 'data' });
    expect(kind('LICENSE')).toEqual({ kind: 'other' });
    expect(kind('.gitignore')).toEqual({ kind: 'other' });
  });

  it('takes the first reason that matches', () => {
    // Set aside before tests: a test's fixture left out by `.symbioteignore` is not test code.
    expect(kind('test/fixtures/x.ts', { ignored: true })).toEqual({
      kind: 'aside',
      aside: 'ignored',
    });
    // A lockfile before its data language.
    expect(kind('package-lock.json')).toEqual({ kind: 'aside', aside: 'lockfile' });
  });
});
