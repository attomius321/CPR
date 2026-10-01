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
  ])('%s → %s', (path, expected) => {
    expect(ignored(path)).toBe(expected);
  });
});
