// Hive's runner (HV2, decisions 646, 653–656): in `symbiote view`'s process, it drives every
// workspace started while Hive is on. It reads what the workspace's card reads — the writer's
// session and the thread its hooks record — and acts on a turn's end: the project's check on the
// branch's tip, its failures sent back with `reply`; once the check passes, the running review of
// that commit (HV3, decisions 674–679), the tests it proved defects with sent back; up to 3 rounds;
// then landing is asked of the person. Hive off stops Hive's writers, checks and reviews and keeps
// each step; Hive on, or a new runner after a killed one, looks at what the sessions show and goes
// on from there. One runner drives a repository, by a pid lock beside the records.
// fix/hive-runner-flaws: a commit is checked and reviewed once (decision 716); a branch in the
// merge queue or merged is left to its landing (717); a message is sent once its prompt is
// recorded (718), and a turn Hive cannot see stops it, with why (719). HV4: Hive lands what it
// checked and reviewed itself — its approval, the merge queue, a failed landing sent back to the
// writer — and pushes the workspace's branch after each turn (decisions 767–770). HV8: where the
// repository lands by request, a pull or merge request in place of the queue, watched until the
// person merges or closes it on the forge (decisions 788–792). HV5: every agent Hive starts — the
// writer's first start, each message, a restart, each running review — goes through one gate
// (`paced`), which holds it while Claude's usage is at or over the threshold, or unknown, and stops
// a workspace that reached its budget (decisions 796–801).
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { GitRepo } from '@symbiote/core';
import { hiveLockPath, readHive, readHives } from './hive-record.js';
import { findConfinement } from './hive-review.js';
import { findClaude } from './claude-code.js';
import { mergeQueue } from './merge-queue.js';
import { runGroup } from './programs.js';
import { reviewPlace, type ReviewPlace } from './reviews.js';
import { symbioteFolder } from './workspace-record.js';
import type { Running, Reviewing, HiveRunnerOptions, HiveContext } from './hive-context.js';
import { hiveRound, slug } from './hive-round.js';
import { hiveWriting } from './hive-writing.js';
import { hiveChecking } from './hive-checking.js';
import { hiveReviewing } from './hive-reviewing.js';
import { hiveLand } from './hive-landing.js';
import { hiveForge } from './hive-forge.js';
import { hiveOff } from './hive-off.js';

/** Hive's runner of a repository. */
export interface HiveRunner {
  /** Ticks every `interval` while Hive is on, every `offInterval` while it is off. */
  start(): void;
  /** Hive was turned on or off in this process (`POST /api/hive`): a tick at once. */
  switched(on: boolean): void;
  /** One look at every Hive workspace; a check it starts runs on after it resolves. */
  tick(): Promise<void>;
  /** Resolves once no tick, check or message is in flight. */
  idle(): Promise<void>;
  /** Stops: its checks killed (their steps kept, to run again), its lock released. */
  close(): Promise<void>;
  /** Stops as a killed process would (tests): nothing killed or written, the lock left behind. */
  abandon(): void;
}

/** How long a message Claude Code took may go without its prompt in the thread (decision 719). */
const UNSEEN_MS = 60_000;

/** How long an entry the person's checkout refused waits before Hive lands it again (770). */
const LAND_RETRY_MS = 60_000;

/**
 * How often an open request is read (decision 791): one call a minute a request, 1.2 % of GitHub's
 * 5,000 an hour with a token; GitLab.com allows 2,000 a minute.
 */
const REQUEST_POLL_MS = 60_000;

/** The runner of `repo`'s Hive: its records beside the workspace records. */
export function hiveRunner(
  repo: GitRepo,
  cacheDir: string,
  {
    hive,
    workspaces,
    now = () => new Date(),
    root = repo.root,
    interval = 2_000,
    offInterval = 10_000,
    pid = process.pid,
    run = runGroup,
    reviewer = {
      claude: () => findClaude(process.env),
      confine: () => findConfinement(process.env),
    },
    merges = () => mergeQueue(join(cacheDir, 'state', repo.id)).read(),
    unseenMs = UNSEEN_MS,
    lander,
    landRetryMs = LAND_RETRY_MS,
    requestPollMs = REQUEST_POLL_MS,
    pacing,
    log,
  }: HiveRunnerOptions,
): HiveRunner {
  let holding = false;
  /** Hive as this runner last saw it; null: not looked yet (a new holder looks at every record). */
  let lastOn: boolean | null = null;
  let ticking: Promise<void> | null = null;
  let again = false;
  let timer: NodeJS.Timeout | undefined;
  /** Each workspace's message or check in flight, by branch. */
  const actions = new Map<string, Promise<void>>();
  const checks = new Map<string, Running>();
  const reviews = new Map<string, Reviewing>();
  /** Where a branch's review copies are, each review in a folder of its own (decision 675). */
  const copiesOf = (branch: string) =>
    join(cacheDir, 'worktrees', repo.id, 'hive-review', slug(branch));
  /** Writers Hive off must stop: tried again at each tick until stopped or gone. */
  const toStop = new Set<string>();
  /**
   * While Hive is off here: its switch's file and when it was last written. Until that changes,
   * a look reads nothing else (no git): Hive off costs a `stat`.
   */
  let offProbe: { file: string; at: number } | null = null;
  const ctx: HiveContext = {
    repo,
    cacheDir,
    hive,
    workspaces,
    now,
    root,
    run,
    reviewer,
    merges,
    unseenMs,
    lander,
    landRetryMs,
    requestPollMs,
    pacing,
    log,
    closed: false,
    actions,
    checks,
    reviews,
    toStop,
    copiesOf,
  };
  // Its steps, each over what it reads. A round leaves a branch to the forge's one gate
  // (`leaveTo`), which is made after it from the round's moves: bound when called.
  const round = hiveRound(ctx, { watchRequest: (...args) => forge.watchRequest(...args) });
  const reviewSteps = hiveReviewing(ctx, round);
  const checkSteps = hiveChecking(ctx, { ...round, ...reviewSteps });
  const { writing } = hiveWriting(ctx, { ...round, ...checkSteps });
  const forge = hiveForge(ctx, round);
  const { landing, waiting } = hiveLand(ctx, { ...round, ...checkSteps, ...forge });
  const { turnOff, stopWriters, reconcile } = hiveOff(ctx, round);
  const { checking, watchCheck } = checkSteps;
  const { reviewing, watchReview } = reviewSteps;
  const { watchRequest } = forge;

  const writtenAt = (file: string) =>
    stat(file).then(
      (s) => s.mtimeMs,
      () => 0,
    );

  /** A pid lock (decision 656): this runner's, or another live process's. */
  async function lock(where: ReviewPlace): Promise<boolean> {
    const file = hiveLockPath(where);
    await mkdir(dirname(file), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await writeFile(file, `${pid}\n`, { flag: 'wx' });
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const held = Number((await readFile(file, 'utf8').catch(() => '')).trim());
      if (held === pid) return true;
      if (aliveProcess(held)) return false;
      await rm(file, { force: true });
    }
    return false;
  }

  async function unlock(where: ReviewPlace): Promise<void> {
    const file = hiveLockPath(where);
    const held = Number((await readFile(file, 'utf8').catch(() => '')).trim());
    if (held === pid) await rm(file, { force: true });
  }

  /** One look at every record. */
  async function once(): Promise<void> {
    if (ctx.closed) return;
    if (!holding && offProbe && (await writtenAt(offProbe.file)) === offProbe.at) return;
    const on = await hive.on().catch(() => false);
    if (!holding) {
      // Hive off and never on here: nothing is read or written (Hive off is `main`).
      if (!on) {
        const file = join(symbioteFolder(await reviewPlace(repo, cacheDir)), 'hive.json');
        offProbe = { file, at: await writtenAt(file) };
        lastOn = false;
        return;
      }
      offProbe = null;
      const where = await reviewPlace(repo, cacheDir);
      holding = await lock(where);
      if (!holding) return;
      lastOn = null;
    }
    const where = await reviewPlace(repo, cacheDir);
    // Landed and answered are ends (HV4): nothing more to drive.
    const records = (await readHives(where)).filter(
      (r) => r.step !== 'landed' && r.step !== 'answered',
    );
    if (!on) {
      if (lastOn !== false) await turnOff(where, records);
      else if (toStop.size > 0) await stopWriters(where);
      lastOn = false;
      return;
    }
    if (lastOn !== true) {
      // HV5: the pauses recorded hold until their windows reset, whatever this process read.
      pacing?.prime(records.flatMap((r) => (r.paused ? [r.paused] : [])));
      await reconcile(where, records);
    }
    lastOn = true;
    for (const listed of records) {
      if (ctx.closed) return;
      let record = (await readHive(where, listed.branch)) ?? listed;
      // HV8: a request Hive waits on is read whatever the step, through the one gate (when due);
      // at landing, by the landing step.
      if (record.request && record.step !== 'landing' && !actions.has(record.branch)) {
        try {
          await watchRequest(where, record);
        } catch (error) {
          log?.warn({ branch: record.branch, error: (error as Error).message }, 'hive step failed');
        }
        record = (await readHive(where, listed.branch)) ?? record;
        if (record.step === 'landed') continue;
      }
      if (checks.has(record.branch)) {
        await watchCheck(where, record);
        continue;
      }
      if (reviews.has(record.branch)) {
        await watchReview(where, record);
        continue;
      }
      if (actions.has(record.branch)) continue;
      try {
        if (record.step === 'writing') await writing(where, record);
        else if (record.step === 'checking') await checking(where, record);
        else if (record.step === 'reviewing') await reviewing(where, record);
        else if (record.step === 'landing') await landing(where, record);
        else if (record.step === 'stuck') await waiting(where, record);
      } catch (error) {
        log?.warn({ branch: record.branch, error: (error as Error).message }, 'hive step failed');
      }
    }
  }

  function tick(): Promise<void> {
    if (ticking) {
      again = true;
      return ticking;
    }
    const current = (async () => {
      do {
        again = false;
        await once();
      } while (again && !ctx.closed);
    })()
      .catch((error: unknown) => {
        log?.warn({ error: (error as Error).message }, 'hive tick failed');
      })
      .finally(() => {
        ticking = null;
      });
    ticking = current;
    return current;
  }

  function schedule(): void {
    clearTimeout(timer);
    if (ctx.closed || interval <= 0) return;
    timer = setTimeout(
      () => {
        void tick().then(schedule);
      },
      lastOn === true ? interval : offInterval,
    );
    timer.unref();
  }

  return {
    start() {
      void tick().then(schedule);
    },
    switched() {
      offProbe = null;
      void tick().then(schedule);
    },
    tick,
    async idle() {
      while (ticking || actions.size > 0) {
        await ticking;
        await Promise.all(actions.values());
      }
    },
    async close() {
      if (ctx.closed) return;
      for (const running of checks.values()) {
        running.stopped = 'close';
        running.run.kill();
      }
      for (const running of reviews.values()) {
        running.stopped = 'close';
        running.run.stop();
      }
      ctx.closed = true;
      clearTimeout(timer);
      await ticking;
      await Promise.all(actions.values());
      if (holding) await unlock(await reviewPlace(repo, cacheDir)).catch(() => undefined);
    },
    abandon() {
      ctx.closed = true;
      clearTimeout(timer);
    },
  };
}

/** Whether a live process other than ours has `pid`. */
function aliveProcess(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
