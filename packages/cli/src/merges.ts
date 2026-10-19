// CPR's merger (V26a, decisions 142–146, 149): an approved commit merged with `--no-ff` in a
// worktree of CPR's own, the project's check run on the merge, and the target branch moved by
// fast-forward. No agent and no tokens; one merge at a time per repository.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  commitSubject,
  defaultBranch,
  fastForwardBranch,
  isAncestor,
  listRefs,
  listWorktrees,
  mergeInWorktree,
  MergeStepRefused,
  pushCommit,
  resetMergeWorktree,
  upstreamOf,
  type GitRepo,
  type MergeCheckRun,
  type MergeEntry,
  type MergeList,
  type MergeRequest,
  type MergeTargets,
  type RefList,
  type Verdict,
} from '@cpr/core';
import { guessCheck, treeAt } from './check.js';
import { CONFIG_FILES } from './plugins.js';
import { readReview, reviewPath, reviewPlace } from './reviews.js';
import { readWorkspace, workspacePath, type WorkspaceFile } from './workspaces.js';

/** What `cpr/config.json` says of merges: `merge.checks` (one command or several), `merge.push`. */
export interface MergeConfig {
  checks?: string[];
  push: boolean;
}

/** The merge section of the config file in `root`; anything unknown is ignored. */
export function readMergeConfig(root: string): MergeConfig {
  const file = configFile(root);
  if (!file) return { push: false };
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch {
    return { push: false };
  }
  const merge = (value as { merge?: unknown } | null)?.merge;
  const v = (merge && typeof merge === 'object' ? merge : {}) as {
    checks?: unknown;
    push?: unknown;
  };
  const listed =
    typeof v.checks === 'string' ? [v.checks] : Array.isArray(v.checks) ? v.checks : [];
  const checks = listed.filter((c): c is string => typeof c === 'string' && c.trim() !== '');
  return { ...(checks.length > 0 ? { checks } : {}), push: v.push === true };
}

const configFile = (root: string) => CONFIG_FILES.find((name) => existsSync(join(root, name)));

/** A request the server answers with `status` and the message. */
export class MergeRefused extends Error {
  override name = 'MergeRefused';
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 409,
  ) {
    super(message);
  }
}

/** Runs one check command in `cwd` through the shell: its exit code and what it wrote. */
export type RunCheck = (
  command: string,
  cwd: string,
) => Promise<{ code: number | null; output: string }>;

/** A check may take long (this repository's check, build and e2e: about 2.5 min). */
const CHECK_TIMEOUT_MS = 60 * 60_000;

/** Lines of a check's output kept with its entry. */
const OUTPUT_LINES = 60;

/** The shell's run of a command, its output and errors together, as a terminal shows them. */
export const runShell: RunCheck = (command, cwd) =>
  new Promise((done) => {
    let output = '';
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const timer = setTimeout(() => child.kill(), CHECK_TIMEOUT_MS);
    const keep = (chunk: string) => {
      output += chunk;
      // Only the end is kept: a check can write megabytes.
      if (output.length > 1_000_000) output = output.slice(-200_000);
    };
    child.stdout.setEncoding('utf8').on('data', keep);
    child.stderr.setEncoding('utf8').on('data', keep);
    child.on('error', (error) => {
      clearTimeout(timer);
      done({ code: null, output: `${output}${error.message}\n` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, output });
    });
  });

const lastLines = (text: string) =>
  text.replace(/\n+$/, '').split('\n').slice(-OUTPUT_LINES).join('\n');

/** What the server and `cpr merge` need of the merger. */
export interface Merger {
  list(): Promise<MergeList>;
  /** Merge into ▾ for a branch: the branches, the one preselected, and why not, if not. */
  targets(branch: string): Promise<MergeTargets>;
  /** Queues the approved commit of `branch`; starts merging unless `start` is false. */
  enqueue(request: MergeRequest, options?: { start?: boolean }): Promise<MergeEntry>;
  /** Lands a `ready` merge. */
  land(id: string): Promise<MergeEntry>;
  /** Queues a failed or stopped merge again. */
  retry(id: string): Promise<MergeEntry>;
  /** Takes an entry out of the queue (not while it merges or checks). */
  remove(id: string): Promise<void>;
  /** Resolves once nothing in the queue can go further. */
  idle(): Promise<void>;
}

/** Merges of `repo`, queued in CPR's cache; reviews and workspaces read where CPR keeps them. */
export function merger(
  repo: GitRepo,
  cacheDir: string,
  {
    now = () => new Date(),
    runCheck = runShell,
    root = repo.root,
    onChange,
  }: {
    now?: () => Date;
    runCheck?: RunCheck;
    /** Where `cpr/config.json` is read. */
    root?: string;
    /** Each change of an entry, as it is written (`cpr merge` prints them). */
    onChange?: (entry: MergeEntry) => void;
  } = {},
): Merger {
  const stateDir = join(cacheDir, 'state', repo.id);
  const queueFile = join(stateDir, 'merges.json');
  const lockFile = join(stateDir, 'merges.lock');
  const worktree = join(cacheDir, 'worktrees', repo.id, 'merge');

  async function read(): Promise<MergeEntry[]> {
    try {
      const value = JSON.parse(await readFile(queueFile, 'utf8')) as { merges?: unknown };
      return Array.isArray(value.merges) ? (value.merges as MergeEntry[]) : [];
    } catch {
      return [];
    }
  }

  /** One change to the queue file at a time in this process. */
  let writing: Promise<unknown> = Promise.resolve();
  function change<T>(task: (merges: MergeEntry[]) => T | Promise<T>): Promise<T> {
    const next = writing.then(async () => {
      const merges = await read();
      const result = await task(merges);
      await mkdir(stateDir, { recursive: true });
      const temp = `${queueFile}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify({ merges }, null, 2)}\n`);
      await rename(temp, queueFile);
      return result;
    });
    writing = next.catch(() => undefined);
    return next;
  }

  /** Sets an entry's fields (`undefined` removes one); the entry as it now is. */
  function set(id: string, fields: Partial<MergeEntry>): Promise<MergeEntry> {
    return change((merges) => {
      const entry = merges.find((e) => e.id === id);
      if (!entry) throw new MergeRefused(`no merge ${id}`, 404);
      Object.assign(entry, fields, { updated: now().toISOString() });
      for (const key of Object.keys(fields) as (keyof MergeEntry)[]) {
        if (fields[key] === undefined) delete entry[key];
      }
      return { ...entry };
    }).then((entry) => {
      onChange?.(entry);
      return entry;
    });
  }

  /** The fields a merge leaves behind, cleared when it is merged again. */
  const fresh: Partial<MergeEntry> = {
    base: undefined,
    merge: undefined,
    conflicts: undefined,
    check: undefined,
    message: undefined,
  };

  /** A branch's tip: the local branch's, else a remote's (`origin` first); null when none. */
  function tipOf(refs: RefList, branch: string): { sha: string; local: boolean } | null {
    const local = refs.branches.find((b) => b.name === branch);
    if (local) return { sha: local.sha, local: true };
    const remote = refs.remotes
      .filter((r) => r.branch === branch)
      .sort((a, b) => Number(b.remote === 'origin') - Number(a.remote === 'origin'))[0];
    return remote ? { sha: remote.sha, local: false } : null;
  }

  /** Branches to merge into: local ones, and remote ones by name. */
  function branchesOf(refs: RefList): string[] {
    return [...new Set([...refs.branches.map((b) => b.name), ...refs.remotes.map((r) => r.branch)])]
      .filter((name) => name !== 'HEAD')
      .sort();
  }

  /** The branch's last verdict and its workspace's record, where CPR keeps them. */
  async function recordsOf(branch: string): Promise<{
    verdict?: Verdict;
    workspace: WorkspaceFile | null;
  }> {
    const where = await reviewPlace(repo, cacheDir);
    const review = await readReview(reviewPath(where.dir, branch, where.reviewer));
    const workspace = await readWorkspace(
      workspacePath(join(dirname(where.dir), 'workspaces'), branch),
    );
    const verdict = review?.verdicts.at(-1);
    return { ...(verdict ? { verdict } : {}), workspace };
  }

  async function targets(branch: string): Promise<MergeTargets & { tip?: string }> {
    const refs = await listRefs(repo);
    const branches = branchesOf(refs).filter((name) => name !== branch);
    const { verdict, workspace } = await recordsOf(branch);
    const preselected = [workspace?.from, verdict?.into, await defaultBranch(repo, refs)];
    const into = preselected.find((name) => name && branches.includes(name)) ?? null;
    const entry = (await read()).find((e) => e.branch === branch && e.state !== 'landed');
    const tip = refs.branches.find((b) => b.name === branch)?.sha;
    const approved = verdict?.event === 'approve' ? verdict.head : undefined;
    const blocked = !tip
      ? `no branch ${branch}`
      : !approved
        ? `${branch} is not approved: approve its review in CPR first`
        : tip !== approved
          ? `${branch} has commits after the approved commit ${approved.slice(0, 7)}: they were not reviewed`
          : undefined;
    return {
      branches,
      into,
      ...(approved ? { head: approved } : {}),
      ...(blocked ? { blocked } : {}),
      ...(entry ? { entry } : {}),
      ...(tip ? { tip } : {}),
    };
  }

  /**
   * The check of a merge: `merge.checks`, else the command guessed from `into`'s tip (V24b), a
   * package script after its package manager's install.
   */
  async function checkOf(base: string): Promise<Pick<MergeCheckRun, 'commands' | 'source'> | null> {
    const { checks } = readMergeConfig(root);
    if (checks) return { commands: checks, source: `${configFile(root)} (merge.checks)` };
    const guess = await guessCheck(await treeAt(repo, base));
    if (!guess) return null;
    // A package script needs the dependencies, which CPR's worktree does not have at first.
    if (guess.source.startsWith('package.json')) {
      const manager = guess.command.split(' ')[0] ?? 'npm';
      return {
        commands: [`${manager} install`, guess.command],
        source: `${guess.source}, after an install`,
      };
    }
    return { commands: [guess.command], source: guess.source };
  }

  /** Merges, checks and, when the check passed, lands one entry. */
  async function mergeOne(entry: MergeEntry): Promise<void> {
    const { id } = entry;
    const refs = await listRefs(repo);
    const tip = tipOf(refs, entry.into);
    if (!tip) {
      await set(id, { ...fresh, state: 'failed', message: `no branch ${entry.into}` });
      return;
    }
    await set(id, { ...fresh, state: 'merging', base: tip.sha });
    await resetMergeWorktree(repo, worktree, tip.sha);
    const outcome = await mergeInWorktree(worktree, entry.head, entry.title);
    if ('conflicts' in outcome) {
      await set(id, {
        state: 'needs-you',
        conflicts: outcome.conflicts,
        message: `${entry.head.slice(0, 7)} conflicts with ${entry.into}: merge ${entry.into} into ${entry.branch}, resolve it there, and review it again`,
      });
      return;
    }
    if ('error' in outcome) {
      await set(id, { state: 'failed', message: outcome.error });
      return;
    }
    if ('upToDate' in outcome) {
      await set(id, {
        state: 'landed',
        landed: now().toISOString(),
        message: `already in ${entry.into}`,
      });
      return;
    }
    const check = await checkOf(tip.sha);
    if (!check) {
      await set(id, {
        state: 'ready',
        merge: outcome.merged,
        message:
          'no check to run: set merge.checks in cpr/config.json, or Land once you have checked it',
      });
      return;
    }
    await set(id, { state: 'checking', merge: outcome.merged, check: { ...check } });
    const started = Date.now();
    let output = '';
    for (const command of check.commands) {
      const result = await runCheck(command, worktree);
      output += result.output;
      if (result.code !== 0) {
        await set(id, {
          state: 'failed',
          check: {
            ...check,
            ok: false,
            ms: Date.now() - started,
            failed: command,
            output: lastLines(output),
          },
        });
        return;
      }
    }
    const passed = await set(id, {
      state: 'ready',
      check: { ...check, ok: true, ms: Date.now() - started, output: lastLines(output) },
    });
    await landEntry(passed);
  }

  /** Moves `into` to the merge, or says why not; merged again when `into` moved meanwhile. */
  async function landEntry(entry: MergeEntry): Promise<MergeEntry> {
    const { id, into, merge, base } = entry;
    if (!merge || !base) throw new MergeRefused('nothing merged to land', 409);
    const refs = await listRefs(repo);
    const tip = tipOf(refs, into);
    if (!tip || tip.sha !== base || !(await isAncestor(repo, base, merge))) {
      return set(id, {
        ...fresh,
        state: 'queued',
        message: `${into} moved since the merge: merging again on its tip`,
      });
    }
    // Read before landing: the landing may bring another config file into `root`.
    const { push: pushing } = readMergeConfig(root);
    const holder = (await listWorktrees(repo)).find((w) => w.branch === into && !w.prunable);
    try {
      await fastForwardBranch(repo, {
        branch: into,
        to: merge,
        from: tip.local ? base : null,
        ...(holder ? { checkedOut: holder.path } : {}),
      });
    } catch (error) {
      if (error instanceof MergeStepRefused) {
        const where = holder ? ` in ${holder.path}` : '';
        return set(id, {
          state: 'ready',
          message: `${into} was not moved${where}: ${error.message}`,
        });
      }
      throw error;
    }
    const landed = await set(id, {
      state: 'landed',
      landed: now().toISOString(),
      message: undefined,
    });
    if (!pushing) return landed;
    return set(id, { pushed: await push(into, merge) });
  }

  /** Pushes the landed branch to its upstream, else to `origin`. */
  async function push(into: string, sha: string): Promise<NonNullable<MergeEntry['pushed']>> {
    const upstream = await upstreamOf(repo, into);
    const refs = await listRefs(repo);
    const remote =
      upstream?.remote ??
      (refs.remotes.some((r) => r.remote === 'origin') ? 'origin' : refs.remotes[0]?.remote);
    if (!remote) return { ok: false, remote: '', error: 'no remote to push to' };
    const result = await pushCommit(repo, { remote, sha, branch: upstream?.branch ?? into });
    return result.ok ? { ok: true, remote } : { ok: false, remote, error: result.error };
  }

  /** States that hold a branch: a later merge into it waits until they are done. */
  const holding = new Set<MergeEntry['state']>(['merging', 'checking', 'ready']);

  /** A pid lock: one CPR process merges in a repository; null when another holds it. */
  async function lock(): Promise<(() => Promise<void>) | null> {
    await mkdir(stateDir, { recursive: true });
    try {
      await writeFile(lockFile, `${process.pid}\n`, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await lockedElsewhere()) return null;
      await rm(lockFile, { force: true });
      return lock();
    }
    return () => rm(lockFile, { force: true });
  }

  /** Whether a live process other than this one holds the lock. */
  async function lockedElsewhere(): Promise<boolean> {
    const pid = Number((await readFile(lockFile, 'utf8').catch(() => '')).trim());
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  }

  async function drain(): Promise<void> {
    const release = await lock();
    if (!release) return;
    try {
      // A process that stopped mid-merge left its entry merging or checking: merged again.
      await change((merges) => {
        for (const e of merges)
          if (e.state === 'merging' || e.state === 'checking') e.state = 'queued';
      });
      for (;;) {
        const merges = await read();
        const next = merges.find(
          (e, i) =>
            e.state === 'queued' &&
            !merges.some((o, j) => j !== i && o.into === e.into && holding.has(o.state)),
        );
        if (!next) return;
        try {
          await mergeOne(next);
        } catch (error) {
          await set(next.id, {
            state: 'failed',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      await release();
    }
  }

  let running: Promise<void> | null = null;
  let again = false;
  /** Starts merging, or has the running drain look at the queue again. */
  function kick(): void {
    if (running) {
      again = true;
      return;
    }
    running = (async () => {
      do {
        again = false;
        await drain();
      } while (again);
    })()
      // What failed is in its entry; a lock or queue file that cannot be written waits for the next kick.
      .catch(() => undefined)
      .finally(() => (running = null));
  }

  async function entryOf(id: string): Promise<MergeEntry> {
    const entry = (await read()).find((e) => e.id === id);
    if (!entry) throw new MergeRefused(`no merge ${id}`, 404);
    return entry;
  }

  return {
    async list() {
      const merges = await read();
      // Queued by another process, or left by one that stopped: merged here.
      if (
        merges.some((e) => e.state === 'queued' || e.state === 'merging' || e.state === 'checking')
      )
        kick();
      const elsewhere = !running && existsSync(lockFile) && (await lockedElsewhere());
      return { merges, ...(elsewhere ? { elsewhere: true as const } : {}) };
    },

    async targets(branch) {
      const found: MergeTargets & { tip?: string } = await targets(branch);
      delete found.tip;
      return found;
    },

    async enqueue({ branch, into }, { start = true } = {}) {
      if (typeof branch !== 'string' || branch === '') throw new MergeRefused('which branch?', 400);
      if (into === branch) throw new MergeRefused(`cannot merge ${branch} into itself`, 400);
      const found = await targets(branch);
      if (found.blocked || !found.head)
        throw new MergeRefused(found.blocked ?? 'not approved', 409);
      if (!found.branches.includes(into)) throw new MergeRefused(`no branch ${into}`, 400);
      if (found.entry) throw new MergeRefused(`${branch} is already queued`, 409);
      const { workspace } = await recordsOf(branch);
      const title = workspace?.title ?? (await commitSubject(repo, found.head));
      const at = now().toISOString();
      const entry: MergeEntry = {
        id: randomUUID(),
        branch,
        head: found.head,
        into,
        title: `Merge ${branch}: ${title}`,
        state: 'queued',
        queued: at,
        updated: at,
      };
      await change((merges) => void merges.push(entry));
      if (start) kick();
      return entry;
    },

    async land(id) {
      const entry = await entryOf(id);
      if (entry.state !== 'ready')
        throw new MergeRefused(`${entry.branch} is not ready to land`, 409);
      const after = await landEntry(entry);
      kick();
      return after;
    },

    async retry(id) {
      const entry = await entryOf(id);
      if (!['failed', 'needs-you'].includes(entry.state)) {
        throw new MergeRefused(`${entry.branch} is ${entry.state}: nothing to retry`, 409);
      }
      const after = await set(id, { ...fresh, state: 'queued' });
      kick();
      return after;
    },

    async remove(id) {
      const entry = await entryOf(id);
      if (entry.state === 'merging' || entry.state === 'checking') {
        throw new MergeRefused(`${entry.branch} is ${entry.state}: wait for it`, 409);
      }
      await change((merges) => {
        merges.splice(
          merges.findIndex((e) => e.id === id),
          1,
        );
      });
      kick();
    },

    async idle() {
      await writing;
      while (running) await running;
    },
  };
}
