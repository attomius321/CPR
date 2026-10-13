import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const RESOLVED = /\.(?:tsx?|jsx?|mjs|cjs)$/;

/**
 * Paths that name the same file on a case-insensitive file system (macOS, Windows). Module
 * extensions count as one name: `./x.js` resolves to `x.ts` or `x.tsx`, so `commits.ts` and
 * `Commits.tsx` collide.
 */
function caseCollisions(paths: readonly string[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const name = path.replace(RESOLVED, '');
    const key = name.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), name]);
  }
  return [...groups.values()].filter((names) => new Set(names).size > 1);
}

describe('repository files', () => {
  it('finds names that differ only by case', () => {
    expect(caseCollisions(['src/commits.ts', 'src/Commits.tsx', 'src/a.ts', 'src/a.tsx'])).toEqual([
      ['src/commits', 'src/Commits'],
    ]);
  });

  it('has no two names that differ only by case (CI runs on macOS)', () => {
    const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n');
    expect(caseCollisions(files)).toEqual([]);
  });
});
