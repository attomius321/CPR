import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CprError } from '../errors.js';
import type { RevisionSource } from '../revision.js';
import { git } from './exec.js';
import type { GitRepo } from './repo.js';

/** Upper bound on concurrent runs per repo and role. */
const MAX_SLOTS = 8;

/** Cache root: `$CPR_CACHE_DIR`, else `$XDG_CACHE_HOME/cpr`, else the platform cache folder. */
export function defaultCacheDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (env.CPR_CACHE_DIR) return env.CPR_CACHE_DIR;
  if (env.XDG_CACHE_HOME) return join(env.XDG_CACHE_HOME, 'cpr');
  if (platform === 'darwin') return join(home, 'Library', 'Caches', 'cpr');
  return join(home, '.cache', 'cpr');
}

export interface CheckoutOptions {
  /** Slot name prefix, such as `base` or `head`. */
  role: string;
  /** Cache root. Default: {@link defaultCacheDir}. */
  cacheDir?: string;
}

/**
 * Checks out a commit into a reusable, detached worktree slot under
 * `<cacheDir>/worktrees/<repo id>/<role>-<n>` and locks the slot until disposed.
 * Reusing a slot only rewrites files that differ between the old and new commit.
 */
export async function checkoutRevision(
  repo: GitRepo,
  sha: string,
  { role, cacheDir = defaultCacheDir() }: CheckoutOptions,
): Promise<RevisionSource> {
  const dir = join(cacheDir, 'worktrees', repo.id);
  await mkdir(dir, { recursive: true });
  // Git reports real paths; compare against the same form.
  const realDir = await realpath(dir);

  for (let n = 0; n < MAX_SLOTS; n++) {
    const root = join(realDir, `${role}-${n}`);
    const release = await tryLock(`${root}.lock`);
    if (!release) continue;

    try {
      await moveSlot(repo, root, sha);
    } catch (error) {
      await release();
      throw error;
    }

    let released = false;
    return {
      root,
      sha,
      dispose: async () => {
        if (released) return;
        released = true;
        await release();
      },
    };
  }
  throw new CprError(`all ${MAX_SLOTS} '${role}' worktree slots in ${realDir} are in use`);
}

async function moveSlot(repo: GitRepo, root: string, sha: string): Promise<void> {
  if (await isWorktreeOf(repo, root)) {
    const head = (await git(root, ['rev-parse', 'HEAD'])).trim();
    if (head !== sha) await git(root, ['checkout', '--quiet', '--force', '--detach', sha]);
    return;
  }
  // Missing or broken slot: drop it and add it again. --force replaces a stale registration of
  // this path only; a global `git worktree prune` would also touch the user's own worktrees.
  await rm(root, { recursive: true, force: true });
  await git(repo.root, ['worktree', 'add', '--quiet', '--force', '--detach', root, sha]);
}

async function isWorktreeOf(repo: GitRepo, root: string): Promise<boolean> {
  try {
    await stat(root);
    const output = await git(root, [
      'rev-parse',
      '--path-format=absolute',
      '--show-toplevel',
      '--git-common-dir',
    ]);
    const [top, commonDir] = output.trimEnd().split('\n');
    return (
      top === root && commonDir !== undefined && (await realpath(commonDir)) === repo.commonDir
    );
  } catch {
    return false;
  }
}

/** Takes a pid lock file. Returns its release function, or undefined if another live process holds it. */
async function tryLock(file: string): Promise<(() => Promise<void>) | undefined> {
  try {
    await writeFile(file, `${process.pid}\n`, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (!(await isStale(file))) return undefined;
    // Left behind by a run that crashed. Two runs recovering the same lock at once is not handled.
    await rm(file, { force: true });
    return tryLock(file);
  }
  return () => rm(file, { force: true });
}

async function isStale(file: string): Promise<boolean> {
  let content: string;
  try {
    content = await readFile(file, 'utf8');
  } catch {
    return true; // released in the meantime
  }

  const pid = Number(content.trim());
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    // The owner may still be writing its pid; only an old, unreadable lock is stale.
    const { mtimeMs } = await stat(file).catch(() => ({ mtimeMs: 0 }));
    return Date.now() - mtimeMs > 60_000;
  }

  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}
