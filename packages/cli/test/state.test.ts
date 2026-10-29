import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { fileStateStore } from '../src/state.js';

describe('fileStateStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Two tabs on one diff, or a page's last save as it closes, write at once: each write lands
  // whole (fix/security-and-bugs: one temporary file for both made 500s and a broken file).
  it('takes writes at once, each whole, and leaves no temporary file', async () => {
    const store = fileStateStore(join(dir, 'state'));
    const values = Array.from({ length: 20 }, (_, i) => ({
      reviewed: Array.from({ length: 2000 + i * 300 }, (_, k) => `a.ts#symbol${k}-${i}`),
    }));
    const results = await Promise.allSettled(values.map((value) => store.write('review', value)));
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(values).toContainEqual(await store.read('review'));
    expect(readdirSync(join(dir, 'state'))).toEqual(['review.json']);
  });
});
