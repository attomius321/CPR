import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * Symbiote's former name. What it kept under that name moves, once, to Symbiote's places: the
 * repository's folder (`reviewPlace`) and the cache's state (`bin.ts`); `app install` replaces
 * the desktop entry; the app moves its settings itself (packages/desktop). The one place the CLI
 * names it.
 */
export const FORMER_NAME = 'cpr';

/**
 * Moves what `from` holds into `to`, entry by entry where `to` has nothing of that name;
 * folders in both are merged, and a file `to` has the same is dropped. `drop` (top-level names)
 * are removed instead, `keep` stay; `from` goes once it is empty. Errors leave things where they are: another reader may move them.
 */
export function moveInto(
  from: string,
  to: string,
  { drop = [], keep = [] }: { drop?: readonly string[]; keep?: readonly string[] } = {},
): void {
  let names: string[];
  try {
    if (!lstatSync(from).isDirectory()) return;
    names = readdirSync(from);
  } catch {
    return;
  }
  for (const name of names) {
    if (keep.includes(name)) continue;
    const source = join(from, name);
    const target = join(to, name);
    try {
      if (drop.includes(name)) rmSync(source, { recursive: true, force: true });
      else if (!existsSync(target)) {
        mkdirSync(to, { recursive: true });
        renameSync(source, target);
      } else if (lstatSync(source).isDirectory() && lstatSync(target).isDirectory()) {
        moveInto(source, target);
      } else if (readFileSync(source).equals(readFileSync(target))) {
        rmSync(source);
      }
    } catch {
      // Left in place.
    }
  }
  try {
    rmdirSync(from);
  } catch {
    // Not empty: what could not move stays.
  }
}

/**
 * Moves the former cache's state beside `cacheDir` into it, never its worktrees (git records
 * their paths: Symbiote makes its own). A cache named by `SYMBIOTE_CACHE_DIR` is left alone.
 */
export function moveFormerCache(
  cacheDir: string,
  env: Readonly<Record<string, string | undefined>>,
): void {
  if (env.SYMBIOTE_CACHE_DIR || basename(cacheDir) !== 'symbiote') return;
  moveInto(join(dirname(cacheDir), FORMER_NAME), cacheDir, { keep: ['worktrees'] });
}
