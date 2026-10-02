import { describe, expect, it } from 'vitest';
import { DEFAULT_IGNORES, ignoreMatcher } from '../src/index.js';

describe('ignoreMatcher', () => {
  const ignored = ignoreMatcher([
    ...DEFAULT_IGNORES,
    'scripts/',
    '*.config.ts',
    '!keep/fixtures/**',
  ]);

  it.each([
    ['packages/core/test/fixtures/a/src/x.ts', true],
    ['test/__fixtures__/x.ts', true],
    ['src/api.generated.ts', true],
    ['src/generated/client.ts', true],
    ['scripts/release.ts', true],
    ['vite.config.ts', true],
    ['packages/web/vite.config.ts', true],
    ['keep/fixtures/x.ts', false],
    ['src/fixture.ts', false],
    ['src/user.ts', false],
    ['playground/vue/main.ts', true],
    ['packages/a/examples/', true],
  ])('%s → %s', (path, expected) => {
    expect(ignored(path)).toBe(expected);
  });
});

describe('ignoreMatcher, gitignore semantics', () => {
  const ignored = ignoreMatcher([
    'interfaces/',
    '/tools/',
    'src/legacy/',
    'secrets',
    '!apps/web/interfaces/keep.ts',
  ]);

  it.each([
    // A trailing `/` alone does not anchor: every `interfaces` folder, at any depth.
    ['apps/admin/src/interfaces/user.ts', true],
    ['interfaces/user.ts', true],
    ['apps/admin/interfaces/', true],
    ['apps/web/interfaces/keep.ts', false],
    // A folder pattern does not match a file of that name.
    ['src/interfaces.ts', false],
    // A leading or middle `/` anchors at the root.
    ['tools/build.ts', true],
    ['apps/tools/build.ts', false],
    ['src/legacy/old.ts', true],
    ['apps/src/legacy/old.ts', false],
    // A name matches files and folders at any depth, and what is inside them.
    ['config/secrets', true],
    ['config/secrets/key.ts', true],
  ])('%s → %s', (path, expected) => {
    expect(ignored(path)).toBe(expected);
  });
});
