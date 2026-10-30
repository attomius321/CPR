// The branches hidden from Git's graph (decision 645): kept per repository in its `symbiote/`
// beside the reviews (`git.json`), as Hive's switch is (decision 621): every window of its
// `symbiote view` shares them, and its `.gitignore` keeps them out of commits. Not browser storage:
// each `symbiote view` is a port, so an origin, of its own (decision 17).
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { GitRepo } from '@symbiote/core';
import { writeFileWhole } from './file-write.js';
import { prepareSymbioteFolder, reviewPlace, type ReviewPlace } from './reviews.js';

/** The branches hidden, by full ref (`refs/heads/x`, `refs/remotes/origin/x`), sorted. */
export interface HiddenBranches {
  list(): Promise<string[]>;
  /** Hides `ref` or shows it again; the list after. */
  set(ref: string, hidden: boolean): Promise<string[]>;
}

const BRANCH = /^refs\/(heads|remotes)\/./;

/** The record in `file` (`{ "hidden": [...] }`); a missing, broken or foreign file hides none. */
export function hiddenBranches(file: string): HiddenBranches {
  const list = async () => {
    try {
      const value = JSON.parse(await readFile(file, 'utf8')) as { hidden?: unknown } | null;
      const hidden = value?.hidden;
      if (!Array.isArray(hidden)) return [];
      return hidden.filter((ref): ref is string => typeof ref === 'string' && BRANCH.test(ref));
    } catch {
      return [];
    }
  };
  return {
    list,
    async set(ref, hidden) {
      const next = new Set(await list());
      if (hidden) next.add(ref);
      else next.delete(ref);
      const sorted = [...next].sort();
      await writeFileWhole(file, `${JSON.stringify({ hidden: sorted }, null, 2)}\n`);
      return sorted;
    },
  };
}

/**
 * The hidden branches of `repo`: `git.json` in its `symbiote/` beside the reviews, the main
 * checkout's, so its worktrees share them; in Symbiote's cache where the reviews are kept there
 * (`reviewPlace`, read once). Written after `symbiote/.gitignore`.
 */
export function repositoryHiddenBranches(repo: GitRepo, cacheDir: string): HiddenBranches {
  let place: Promise<ReviewPlace> | null = null;
  const where = async () => {
    place ??= reviewPlace(repo, cacheDir);
    const at = await place;
    return { at, record: hiddenBranches(join(dirname(at.dir), 'git.json')) };
  };
  return {
    list: async () => (await where()).record.list(),
    async set(ref, hidden) {
      const { at, record } = await where();
      await prepareSymbioteFolder(at, { agents: false });
      return record.set(ref, hidden);
    },
  };
}
