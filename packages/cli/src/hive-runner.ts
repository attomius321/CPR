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
// person merges or closes it on the forge (decisions 788–792).
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  git,
  mergeBase,
  pushBranch,
  worktreeStatus,
  type AgentStateName,
  type GitRepo,
  type HiveCheck,
  type HiveCheckStep,
  type HiveLanding,
  type HiveRequest,
  type HiveReview,
  type MergeEntry,
  type MergeState,
  type ThreadEntry,
  type WorkspaceSummary,
} from '@symbiote/core';
import type { Forge } from '@symbiote/forge';
import type { Logger } from '@symbiote/log';
import type { HiveRecord } from './hive.js';
import {
  HIVE_DECIDES,
  HIVE_MERGES,
  hiveEvent,
  hiveLockPath,
  hiveTestsDir,
  readHive,
  readHives,
  writeHive,
  type HiveFile,
  type HiveMessage,
  type HiveMessageKey,
} from './hive-record.js';
import {
  findConfinement,
  findingsText,
  installCommands,
  readReviewerConfig,
  REVIEWER_EFFORT,
  REVIEWER_MODEL,
  reviewPrompt,
  startReview,
  type Confine,
  type ReviewOutcome,
  type ReviewRun,
} from './hive-review.js';
import { findClaude } from './claude-code.js';
import {
  bringUp,
  conflictFiles,
  FORGE_WORDS,
  requestBody,
  type HiveRequests,
} from './hive-request.js';
import { hiveLogId, hiveLogPath, hiveLogs } from './hive-live.js';
import { mergeQueue } from './merge-queue.js';
import { projectCheck, type Merger } from './merges.js';
import { killGroup, runGroup, type GroupRun, type RunGroup, type SpawnGroup } from './programs.js';
import { fillPrompt, readPrompts } from './prompts.js';
import { MAX_BRIEF } from './workspace-brief.js';
import { reviewPlace, type BranchReviews, type ReviewPlace } from './reviews.js';
import { readThreadEnd } from './thread.js';
import { symbioteFolder } from './workspace-record.js';
import type { Workspaces } from './workspaces.js';

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

/** What the runner asks of the workspaces (`workspaces.ts`). */
export type HiveWorkspaces = Pick<Workspaces, 'summaryOf' | 'reply' | 'stopAgent' | 'startAgent'>;

/** Lines of a check's output kept and sent, and their characters at most (a message's limit is 20,000). */
const OUTPUT_LINES = 60;
const OUTPUT_CHARS = 6_000;

const lastLines = (text: string) =>
  text.replace(/\n+$/, '').split('\n').slice(-OUTPUT_LINES).join('\n').slice(-OUTPUT_CHARS);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** How a branch is being landed (decision 717): merged, or in the merge queue. */
type Landing = 'merged' | 'queued';

/** The merge queue's states while it has a branch: every one but its ends. */
const QUEUED: ReadonlySet<MergeState> = new Set<MergeState>([
  'queued',
  'merging',
  'resolving',
  'checking',
  'needs-you',
  'ready',
]);

/** How long a message Claude Code took may go without its prompt in the thread (decision 719). */
const UNSEEN_MS = 60_000;

/** The agent's states with a session at work or done with a turn: whose turns Hive must see. */
const SESSION_STATES: ReadonlySet<AgentStateName> = new Set<AgentStateName>([
  'working',
  'needs-you',
  'plan-ready',
  'ready',
  'done',
]);

/** The same commands, in the same order: a check's result holds only for the commands it ran. */
const sameCommands = (ran: string[] | undefined, now: string[]) =>
  ran !== undefined && ran.length === now.length && ran.every((c, i) => c === now[i]);

/** Whether `thread` has `message` as a prompt: its session took it with its hooks. */
const arrived = (thread: ThreadEntry[], message: HiveMessage) =>
  thread.some((e) => e.kind === 'prompt' && e.at >= message.at && e.text === message.text);

/** Why a check or a review was stopped before its end; a landing (decision 717) says which. */
type Stop = 'off' | 'took-over' | 'close' | Landing;

/** A check this runner runs, and why it was stopped, if it was. */
interface Running {
  run: GroupRun;
  stopped?: Stop;
}

/** A review this runner runs (HV3), and why it was stopped, if it was. */
interface Reviewing {
  run: ReviewRun;
  stopped?: Stop;
}

/** The running reviewer's surroundings (HV3): Claude Code, how a rerun is confined, the limits. */
export interface HiveReviewer {
  /** Claude Code's program; null when there is none. */
  claude: () => Promise<string | null>;
  /** How a rerun is confined (bubblewrap); null where it cannot be: then nothing is reviewed. */
  confine: () => Promise<Confine | null>;
  run?: RunGroup;
  spawn?: SpawnGroup;
  reviewerMs?: number;
  rerunMs?: number;
}

/**
 * What Hive lands with (HV4, decision 767): the branch's review, where its approval is recorded,
 * and the merge queue it queues the approved commit in.
 */
export interface HiveLander {
  reviews: Pick<BranchReviews, 'resolve' | 'finish'>;
  merges: Pick<Merger, 'targets' | 'enqueue' | 'land' | 'remove'>;
  /** Landing by a pull or merge request, where the repository says so (HV8, decision 788). */
  requests?: HiveRequests;
}

/** How long an entry the person's checkout refused waits before Hive lands it again (770). */
const LAND_RETRY_MS = 60_000;

/**
 * How often an open request is read (decision 791): one call a minute a request, 1.2 % of GitHub's
 * 5,000 an hour with a token; GitLab.com allows 2,000 a minute.
 */
const REQUEST_POLL_MS = 60_000;

/** Times Hive posts its graph review on a commit before it gives up on it (790). */
const REVIEW_TRIES = 3;

/** The merge queue's states while a merge runs or waits its turn. */
const MERGING: ReadonlySet<MergeState> = new Set<MergeState>([
  'queued',
  'merging',
  'resolving',
  'checking',
]);

const short = (sha: string) => sha.slice(0, 7);

/** A branch as one folder's name in Symbiote's cache. */
const slug = (branch: string) => branch.replace(/[^\w.-]+/g, '-');

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
    log,
  }: {
    hive: HiveRecord;
    workspaces: HiveWorkspaces;
    now?: () => Date;
    /** Where `symbiote/config.json` is read: the check and the prompts. */
    root?: string;
    /** How often it looks while Hive is on, and while it is off (0: only when asked, tests). */
    interval?: number;
    offInterval?: number;
    /** Its process, as the lock names it. */
    pid?: number;
    /** How a check's command runs. */
    run?: RunGroup;
    /** The running reviewer's surroundings (HV3). */
    reviewer?: HiveReviewer;
    /**
     * The merge queue's entries (decision 717): a branch it has is being landed. Its file in
     * Symbiote's cache, read only (the merger's `list` would start a merge it finds queued).
     */
    merges?: () => Promise<MergeEntry[]>;
    /** How long a message taken may go without its prompt before Hive stops (decision 719). */
    unseenMs?: number;
    /**
     * What Hive lands with (HV4): with it, Hive approves and queues what it checked and reviewed,
     * and pushes the workspace's branch; without it (tests of the loop), landing waits as in HV3.
     */
    lander?: HiveLander;
    /** How long an entry the person's checkout refused waits before Hive lands it again. */
    landRetryMs?: number;
    /** How often an open pull or merge request is read (HV8). */
    requestPollMs?: number;
    log?: Pick<Logger, 'info' | 'warn'>;
  },
): HiveRunner {
  let closed = false;
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
  /** Messages that failed once: their failure is an event once. */
  const failed = new Set<string>();
  /**
   * While Hive is off here: its switch's file and when it was last written. Until that changes,
   * a look reads nothing else (no git): Hive off costs a `stat`.
   */
  let offProbe: { file: string; at: number } | null = null;
  const writtenAt = (file: string) =>
    stat(file).then(
      (s) => s.mtimeMs,
      () => 0,
    );

  const stamp = () => now().toISOString();

  /** Writes a record, unless this runner stopped: a killed process writes nothing. */
  async function save(where: ReviewPlace, record: HiveFile): Promise<void> {
    if (closed) return;
    await writeHive(where, record);
  }

  async function event(
    where: ReviewPlace,
    branch: string,
    kind: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    if (closed) return;
    await hiveEvent(where, branch, stamp(), kind, data);
    log?.info({ branch, hive: kind, ...data }, `hive ${kind}`);
  }

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

  /**
   * What the writer's turn shows: its summary, the thread's last prompt, and whether the turn
   * ended after `since` (its prompt that new: before Hive's message arrives, the last report is
   * the turn before's). Null when the workspace is gone or cleaned up.
   */
  async function turnOf(where: ReviewPlace, branch: string, since: string) {
    const summary = await workspaces.summaryOf(branch);
    if (!summary) return null;
    const thread = await readThreadEnd(symbioteFolder(where), branch);
    const prompt = thread.findLast((e) => e.kind === 'prompt');
    const finished = summary.agent.state === 'ready' || summary.agent.state === 'done';
    const ended = finished && prompt !== undefined && prompt.at >= since;
    return { summary, thread, prompt, ended };
  }

  /** Hive's message to the writer, written in the record before it is sent (decision 653). */
  async function queue(
    where: ReviewPlace,
    record: HiveFile,
    key: HiveMessageKey,
    values: Record<string, string>,
    { stop = false }: { stop?: boolean } = {},
  ): Promise<HiveFile> {
    const at = stamp();
    const text = fillPrompt(readPrompts(root).text[key], values).trim();
    const next: HiveFile = {
      ...record,
      step: 'writing',
      since: at,
      message: { key, text, at, ...(stop ? { stop: true as const } : {}) },
    };
    delete next.interrupted;
    await save(where, next);
    await event(where, record.branch, 'message', { key, round: next.round });
    return next;
  }

  /**
   * Sends the record's message unless its session has it already; kept for a retry when refused.
   * Sent once its prompt is in the thread (decision 718); taken when Claude Code took it and no
   * prompt came yet — at once a turn Hive cannot see when it went into a copy (decision 719).
   * Nothing goes to a branch being landed (decision 717).
   */
  async function deliver(where: ReviewPlace, record: HiveFile): Promise<void> {
    const message = record.message;
    if (!message || message.sent || message.taken || closed) return;
    const landing = await landingOf(record.branch);
    if (landing) return leaveTo(where, record, landing);
    const symbiote = symbioteFolder(where);
    let copy: string | undefined;
    if (!arrived(await readThreadEnd(symbiote, record.branch), message)) {
      try {
        // Noted as Hive's (AR2, decision 741): the record says who sent it.
        ({ copy } = await workspaces.reply({
          branch: record.branch,
          text: message.text,
          by: 'hive',
          key: message.key,
          ...(message.stop ? { stop: true } : {}),
        }));
      } catch (error) {
        if (!failed.has(record.branch)) {
          failed.add(record.branch);
          await event(where, record.branch, 'send-failed', { error: (error as Error).message });
        }
        return;
      }
    }
    failed.delete(record.branch);
    const fresh = (await readHive(where, record.branch)) ?? record;
    if (fresh.message?.at !== message.at) return;
    if (arrived(await readThreadEnd(symbiote, record.branch), message)) {
      await seen(where, fresh, message);
      return;
    }
    const taken: HiveFile = {
      ...fresh,
      message: { ...message, taken: stamp(), ...(copy ? { copy } : {}) },
    };
    await save(where, taken);
    await event(where, record.branch, 'taken', { key: message.key, ...(copy ? { copy } : {}) });
    if (copy) await unseen(where, taken);
  }

  /** The message's prompt is in the thread: sent (decision 718). */
  async function seen(where: ReviewPlace, record: HiveFile, message: HiveMessage) {
    const next: HiveFile = { ...record, message: { ...message, sent: true } };
    await save(where, next);
    await event(where, record.branch, 'sent', { key: message.key });
    return next;
  }

  /**
   * A turn Hive cannot see (decision 719): no prompt recorded after its message (or since the turn
   * began), so no turn of it can be read as ended. Stopped for the person, with why; the writer is
   * left as it is.
   */
  async function unseen(where: ReviewPlace, record: HiveFile): Promise<void> {
    const message = record.message;
    const at = `${(message ? (message.taken ?? message.at) : record.since).slice(11, 16)} UTC`;
    const copy = message?.copy
      ? ` (Claude Code took it into a copy of its session, ${message.copy}, whose hooks record nothing)`
      : '';
    const note = `the writer's turn cannot be seen: no prompt recorded ${message ? `after Hive's message at ${at}` : `since its turn began at ${at}`}${copy}`;
    const stuck: HiveFile = { ...record, step: 'stuck', since: stamp(), note };
    delete stuck.message;
    await save(where, stuck);
    await event(where, record.branch, 'stuck', { note, unseen: true });
  }

  /** Whether a branch is being landed (decision 717): merged, or in the merge queue. */
  async function landingOf(
    branch: string,
    known?: WorkspaceSummary | null,
  ): Promise<Landing | null> {
    const summary = known === undefined ? await workspaces.summaryOf(branch) : known;
    if (summary?.merged) return 'merged';
    const queue = await merges().catch(() => []);
    return queue.some((m) => m.branch === branch && QUEUED.has(m.state)) ? 'queued' : null;
  }

  /**
   * A branch being landed is left to its landing (decision 717): `landed` once merged, `landing`
   * while the merge queue has it; a message not sent yet is dropped.
   */
  async function leaveTo(
    where: ReviewPlace,
    record: HiveFile,
    landing: Landing,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    const step = landing === 'merged' ? 'landed' : 'landing';
    await moveTo(
      where,
      record,
      { step, message: undefined, check: undefined, review: undefined, interrupted: undefined },
      step,
      landing === 'queued' ? { queued: true, ...data } : data,
    );
  }

  /** The next round with `key`'s message, or the person once the rounds are spent. */
  async function nextRound(
    where: ReviewPlace,
    record: HiveFile,
    key: 'hive.check' | 'hive.review' | 'hive.commit',
    values: Record<string, string>,
    why: (rounds: number) => string,
  ): Promise<void> {
    if (record.round >= record.rounds) {
      const note = why(record.rounds);
      const stuck: HiveFile = { ...record, step: 'stuck', since: stamp(), note };
      delete stuck.message;
      await save(where, stuck);
      await event(where, record.branch, 'stuck', { note });
      return;
    }
    const next = await queue(where, { ...record, round: record.round + 1 }, key, values);
    await deliver(where, next);
  }

  /** A step's change, written, with its event. */
  async function moveTo(
    where: ReviewPlace,
    record: HiveFile,
    change: Partial<HiveFile>,
    kind: string | null,
    data: Record<string, unknown> = {},
  ): Promise<HiveFile> {
    const next: HiveFile = { ...record, ...change, since: change.since ?? stamp() };
    for (const key of Object.keys(change) as (keyof HiveFile)[]) {
      if (change[key] === undefined) delete (next as Partial<HiveFile>)[key];
    }
    await save(where, next);
    if (kind) await event(where, record.branch, kind, data);
    return next;
  }

  /**
   * Hive answers in place of the person (773): a plan gets its OK, a question or a permission "no
   * one answers", the writer's turn stopped to say it; after 3, Hive stops, with why.
   */
  async function answer(
    where: ReviewPlace,
    record: HiveFile,
    key: 'hive.plan' | 'hive.decide',
  ): Promise<void> {
    const decided = (record.decided ?? 0) + 1;
    if (decided > HIVE_DECIDES) {
      const note = `the writer asked for the person ${decided} times: no one answers in Hive mode`;
      const stuck: HiveFile = { ...record, step: 'stuck', since: stamp(), note };
      delete stuck.message;
      await save(where, stuck);
      await event(where, record.branch, 'stuck', { note });
      return;
    }
    const next = await queue(
      where,
      { ...record, decided },
      key,
      {},
      { stop: key === 'hive.decide' },
    );
    await deliver(where, next);
  }

  /** A writer that failed or never started is started again, once (773); then Hive stops. */
  async function restart(
    where: ReviewPlace,
    record: HiveFile,
    summary: WorkspaceSummary,
  ): Promise<void> {
    const why = summary.agent.error?.split('\n')[0];
    if ((record.restarted ?? 0) >= 1) {
      const note = `its agent failed twice${why ? `: ${why}` : ''}`;
      const stuck: HiveFile = { ...record, step: 'stuck', since: stamp(), note };
      delete stuck.message;
      await save(where, stuck);
      await event(where, record.branch, 'stuck', { note });
      return;
    }
    const next: HiveFile = { ...record, restarted: (record.restarted ?? 0) + 1, since: stamp() };
    delete next.message;
    await save(where, next);
    await event(where, record.branch, 'restarted', { ...(why ? { why } : {}) });
    try {
      await workspaces.startAgent(record.branch);
    } catch (error) {
      const note = `its agent could not be started again: ${(error as Error).message}`;
      await moveTo(where, next, { step: 'stuck', note }, 'stuck', { note });
    }
  }

  /** The writer's turn (decision 653). */
  async function writing(where: ReviewPlace, given: HiveFile): Promise<void> {
    let record = given;
    const message = record.message;
    if (message && !message.sent && !message.taken) return deliver(where, record);
    const turn = await turnOf(where, record.branch, record.since);
    if (!turn) return;
    const { summary } = turn;
    const landing = await landingOf(record.branch, summary);
    if (landing) return leaveTo(where, record, landing);
    // No gate waits for the person in Hive mode (HV4, decision 773).
    const state = summary.agent.state;
    if (state === 'failed' || state === 'not-started') return restart(where, record, summary);
    if (message?.taken && !message.sent && arrived(turn.thread, message)) {
      record = await seen(where, record, message);
    }
    if (!turn.prompt || turn.prompt.at < record.since) {
      // No prompt since the step began: no turn of it can end where Hive sees it (decision 719),
      // while a session works or has finished. An agent that never started, failed or was stopped
      // says so on its card. An older runner's `sent` (before 718) proved nothing: its time counts.
      const from = message ? (message.taken ?? message.at) : record.since;
      const live = SESSION_STATES.has(summary.agent.state);
      if (live && (message?.copy || now().getTime() - Date.parse(from) >= unseenMs)) {
        return unseen(where, record);
      }
      return;
    }
    if (state === 'plan-ready') return answer(where, record, 'hive.plan');
    if (state === 'needs-you') return answer(where, record, 'hive.decide');
    if (!turn.ended) return;
    await event(where, record.branch, 'turn-ended', { round: record.round });
    const changed = summary.worktree.changed ?? 0;
    if (changed > 0) {
      const files = await worktreeStatus(summary.worktree.path).catch(() => []);
      const names = files.slice(0, 10).map((f) => f.path);
      const what = `${plural(changed, 'file')} not committed: ${names.join(', ')}${changed > names.length ? ', …' : ''}`;
      return nextRound(
        where,
        record,
        'hive.commit',
        { what, branch: record.branch },
        (rounds) => `${plural(rounds, 'turn')} left work not committed`,
      );
    }
    if (summary.ahead === 0) {
      // A spike's answer is its report: nothing to check (the start prompt says so).
      if (summary.kind === 'spike') {
        return void (await moveTo(where, record, { step: 'answered' }, 'answered', { commits: 0 }));
      }
      return nextRound(
        where,
        record,
        'hive.commit',
        { what: `no commit on ${record.branch}`, branch: record.branch },
        (rounds) => `${plural(rounds, 'turn')} ended with no commit`,
      );
    }
    const next = await moveTo(where, record, { step: 'checking' }, null);
    return checking(where, next, summary);
  }

  /**
   * Runs the project's check on the branch's tip (decision 654), unless a check of the same
   * commands passed on that commit already: then its review (decision 716).
   */
  async function checking(
    where: ReviewPlace,
    record: HiveFile,
    known?: WorkspaceSummary,
  ): Promise<void> {
    const summary = known ?? (await workspaces.summaryOf(record.branch));
    if (!summary?.tip) return;
    const landing = await landingOf(record.branch, summary);
    if (landing) return leaveTo(where, record, landing);
    const tip = summary.tip;
    const check = await projectCheck(repo, root, tip).catch(() => null);
    const passed =
      check &&
      record.checks.findLast(
        (c) => c.at === tip && c.ok && sameCommands(c.commands, check.commands),
      );
    if (passed) {
      const next = await moveTo(
        where,
        record,
        { step: 'reviewing', checked: tip, note: undefined },
        'reviewing',
        { passed: passed.round },
      );
      return reviewing(where, next);
    }
    if (!check) {
      // No check, but a review all the same (decision 674): the note stays for the person.
      const note = 'no check is set or found';
      const next = await moveTo(
        where,
        record,
        { step: 'reviewing', checked: tip, note },
        'reviewing',
        { note },
      );
      return reviewing(where, next);
    }
    return act(
      record.branch,
      pushOut(where, record.branch, tip).then(() =>
        runCheck(where, record, tip, check.commands, summary.worktree.path),
      ),
    );
  }

  /**
   * The running check's place in its record (decisions 693, 694): read again, and written only
   * while the record is still checking and this runner still runs that check, so nothing written
   * meanwhile is undone by an older copy.
   */
  async function markCheck(
    where: ReviewPlace,
    branch: string,
    running: Running,
    check: NonNullable<HiveFile['check']>,
  ): Promise<void> {
    const fresh = await readHive(where, branch);
    if (fresh?.step !== 'checking' || checks.get(branch) !== running) return;
    const next: HiveFile = { ...fresh, check };
    delete next.interrupted;
    await save(where, next);
  }

  async function runCheck(
    where: ReviewPlace,
    record: HiveFile,
    tip: string,
    commands: string[],
    worktree: string,
  ): Promise<void> {
    const began = Date.now();
    const started = stamp();
    // Its log beside the record (decision 695): each command a step, its output as it comes.
    const id = hiveLogId(started);
    const log = hiveLogs(where, record.branch).of(id);
    let output = '';
    let failedCommand: string | undefined;
    const steps: HiveCheckStep[] = [];
    for (const [index, command] of commands.entries()) {
      if (closed) return;
      const since = Date.now();
      log.step('check', command);
      const running: Running = {
        run: run(command, worktree, { onOutput: (chunk) => log.out(chunk) }),
      };
      checks.set(record.branch, running);
      if (running.run.pid !== undefined) {
        await markCheck(where, record.branch, running, {
          pid: running.run.pid,
          started,
          at: tip,
          commands,
          step: index,
          since: stamp(),
          done: steps.map(({ ok, ms }) => ({ ok, ms })),
          log: id,
        });
      }
      if (index === 0) {
        await event(where, record.branch, 'check-started', {
          round: record.round,
          commit: tip,
          commands,
          log: id,
        });
      }
      const result = await running.run.done;
      checks.delete(record.branch);
      if (closed) return;
      if (running.stopped) return stoppedCheck(where, record.branch, running.stopped);
      const ok = result.code === 0;
      log.end(ok);
      steps.push({ command, ok, ms: Date.now() - since });
      output += result.output;
      if (!ok) {
        failedCommand = command;
        break;
      }
    }
    const fresh = (await readHive(where, record.branch)) ?? record;
    const ran: HiveCheck = {
      round: fresh.round,
      at: tip,
      ok: failedCommand === undefined,
      ms: Date.now() - began,
      ...(failedCommand ? { failed: failedCommand } : {}),
      output: lastLines(output),
      started,
      commands,
      steps,
      log: id,
    };
    const after: HiveFile = { ...fresh, checks: [...fresh.checks, ran] };
    delete after.check;
    await save(where, after);
    await event(where, record.branch, 'check', {
      round: ran.round,
      ok: ran.ok,
      ms: ran.ms,
      ...(ran.failed ? { failed: ran.failed } : {}),
    });
    // Merged or queued while it ran (HV3's record: a failure sent at 14:19:23, merged 14:22:42).
    const landing = await landingOf(record.branch);
    if (landing) return leaveTo(where, after, landing);
    if (ran.ok) {
      const next = await moveTo(
        where,
        after,
        { step: 'reviewing', checked: tip, note: undefined },
        'reviewing',
      );
      return reviewing(where, next);
    }
    await nextRound(
      where,
      after,
      'hive.check',
      {
        output: ran.output ?? '',
        command: failedCommand ?? '',
        branch: record.branch,
        at: tip.slice(0, 7),
        round: String(ran.round),
        rounds: String(after.rounds),
      },
      // The card's words: plain text, no Markdown.
      (rounds) => `the check failed ${plural(rounds, 'time')}: ${failedCommand ?? ''}`,
    );
  }

  /**
   * The running review of the commit the check passed on (HV3, decisions 674–679): its copy, the
   * reviewer and the rerun run beside the tick, as a check does. A commit reviewed and approved
   * already goes to landing as it is (decision 716).
   */
  async function reviewing(where: ReviewPlace, record: HiveFile): Promise<void> {
    const summary = await workspaces.summaryOf(record.branch);
    if (!summary) return;
    const landing = await landingOf(record.branch, summary);
    if (landing) return leaveTo(where, record, landing);
    const tip = record.checked ?? summary.tip;
    if (!tip) return;
    const approved = record.reviews.findLast((r) => r.at === tip);
    if (approved?.verdict === 'approved') {
      await moveTo(where, record, { step: 'landing', checked: tip }, 'landing', {
        reviewed: approved.round,
      });
      return;
    }
    const [claude, confine] = await Promise.all([reviewer.claude(), reviewer.confine()]);
    const check = await projectCheck(repo, root, tip).catch(() => null);
    const passed = record.checks.findLast((c) => c.at === tip && c.ok);
    const from = summary.from ? await mergeBase(repo, tip, summary.from).catch(() => null) : null;
    const base = from ?? summary.base;
    const diff = await git(repo.root, ['diff', base, tip]).catch(() => '');
    const last = record.reviews.at(-1);
    const thread = await readThreadEnd(symbioteFolder(where), record.branch);
    const report = thread.findLast((e) => e.kind === 'report');
    const installs = check ? installCommands(check.commands) : [];
    const before =
      last && last.verdict === 'changes' && last.round < record.round
        ? {
            round: last.round,
            findings: last.findings.filter((f) => f.kept),
            ...(report?.kind === 'report' ? { report: report.text } : {}),
          }
        : undefined;
    const prompt = reviewPrompt({
      brief: summary.brief,
      branch: record.branch,
      base,
      tip,
      diff,
      check: passed && check ? { ok: true, ms: passed.ms, commands: check.commands } : null,
      installs,
      ...(before ? { before } : {}),
    });
    const config = readReviewerConfig(root);
    const model = config.model ?? REVIEWER_MODEL;
    const effort = config.effort ?? REVIEWER_EFFORT;
    const id = `${stamp().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
    const at = stamp();
    // Its log beside the record (decisions 695, 696): what it runs, the reviewer's stream.
    const steps = hiveLogs(where, record.branch).of(id);
    let marked: Promise<void> = Promise.resolve();
    const running: Reviewing = {
      run: startReview(
        {
          source: repo.root,
          tip,
          round: record.round,
          folder: join(copiesOf(record.branch), id),
          log: join(cacheDir, 'hive-reviews', repo.id, `${slug(record.branch)}-${id}.jsonl`),
          installs,
          prompt,
          instructions: readPrompts(root).text['hive.reviewer'],
          model,
          effort,
        },
        {
          claude,
          confine,
          ...(reviewer.run ? { run: reviewer.run } : {}),
          ...(reviewer.spawn ? { spawn: reviewer.spawn } : {}),
          ...(reviewer.reviewerMs ? { reviewerMs: reviewer.reviewerMs } : {}),
          ...(reviewer.rerunMs ? { rerunMs: reviewer.rerunMs } : {}),
          steps,
          // Each process's leader in the record, for a new runner to end it (decision 655).
          onPid: (pid) => {
            marked = marked.then(async () => {
              const fresh = await readHive(where, record.branch);
              if (fresh?.step !== 'reviewing' || reviews.get(record.branch) !== running) return;
              const next: HiveFile = {
                ...fresh,
                review: { pid, started: at, at: tip, log: id },
              };
              delete next.interrupted;
              await save(where, next);
            });
          },
        },
      ),
    };
    reviews.set(record.branch, running);
    await event(where, record.branch, 'review-started', {
      round: record.round,
      commit: tip,
      model,
      effort,
    });
    return act(
      record.branch,
      running.run.done.then(async (outcome) => {
        await marked;
        if (reviews.get(record.branch) === running) reviews.delete(record.branch);
        // The branch's folder too, once it holds no other review's copy.
        await rmdir(copiesOf(record.branch)).catch(() => undefined);
        if (closed) return;
        if (running.stopped || !outcome) {
          return stoppedReview(where, record.branch, running.stopped ?? 'close');
        }
        return reviewed(where, record.branch, outcome, id);
      }),
    );
  }

  /** A review's end (decisions 674, 679): landing, the proven tests to the writer, or again. */
  async function reviewed(where: ReviewPlace, branch: string, outcome: ReviewOutcome, log: string) {
    const fresh = await readHive(where, branch);
    if (!fresh) return;
    // Its log, once anything was written in it (an unavailable reviewer writes nothing).
    const logged = await stat(hiveLogPath(where, branch, log)).then(
      () => true,
      () => false,
    );
    const review: HiveReview = { ...outcome.review, ...(logged ? { log } : {}) };
    const after: HiveFile = { ...fresh, reviews: [...fresh.reviews, review] };
    delete after.review;
    await save(where, after);
    const kept = review.findings.filter((f) => f.kept);
    await event(where, branch, 'review', {
      round: review.round,
      verdict: review.verdict,
      kept: kept.length,
      dropped: review.findings.length - kept.length,
      ms: review.ms,
      ...(review.cost !== undefined ? { cost: review.cost } : {}),
      ...(review.error ? { error: review.error } : {}),
    });
    // Merged or queued while it ran: its findings stay in the record, nothing goes to the writer.
    const landing = await landingOf(branch);
    if (landing) return leaveTo(where, after, landing);
    if (review.verdict === 'approved') {
      await moveTo(where, after, { step: 'landing', checked: review.at }, 'landing');
      return;
    }
    if (review.verdict === 'unavailable') {
      const note = `not reviewed: ${review.error ?? 'the reviewer could not run'}`;
      await moveTo(where, after, { step: 'landing', checked: review.at, note }, 'landing', {
        note,
      });
      return;
    }
    if (review.verdict === 'failed') {
      const failures = after.reviews.filter(
        (r) => r.round === review.round && r.at === review.at && r.verdict === 'failed',
      );
      if (failures.length < 2) {
        // Once more, at the next look.
        await moveTo(where, after, { step: 'reviewing' }, null);
        return;
      }
      const note = `the running review failed twice: ${review.error ?? 'no answer'}`;
      await moveTo(where, after, { step: 'landing', checked: review.at, note }, 'landing', {
        note,
      });
      return;
    }
    // Defects proven: their tests kept beside the record, and sent to the writer.
    const folder = hiveTestsDir(where, branch, review.round);
    for (const [path, text] of outcome.files) {
      await mkdir(dirname(join(folder, path)), { recursive: true });
      await writeFile(join(folder, path), text);
    }
    const values = {
      count: plural(kept.length, 'defect'),
      branch,
      at: review.at.slice(0, 7),
      round: String(review.round),
      rounds: String(after.rounds),
      folder,
    };
    const template = readPrompts(root).text['hive.review'];
    const room = MAX_BRIEF - fillPrompt(template, { ...values, findings: '' }).length - 200;
    await nextRound(
      where,
      after,
      'hive.review',
      { ...values, findings: findingsText(review.findings, outcome.files, folder, room) },
      (rounds) => `the reviewer proved defects in ${rounds} rounds`,
    );
  }

  /**
   * A review stopped before its end: no result, its copies gone; the step kept, the person's, or
   * the branch's landing.
   */
  async function stoppedReview(where: ReviewPlace, branch: string, why: Stop): Promise<void> {
    const record = await readHive(where, branch);
    if (!record || record.step === 'landed') return;
    if (why === 'merged' || why === 'queued') {
      return leaveTo(where, record, why, { stopped: 'review' });
    }
    if (why === 'took-over') {
      const turn = await turnOf(where, branch, record.since);
      await roundsAgain(where, record, turn?.prompt?.at ?? stamp());
      return;
    }
    const kept: HiveFile = { ...record, interrupted: true };
    delete kept.review;
    await save(where, kept);
    await event(where, branch, 'review-stopped', { why });
  }

  /**
   * While a review runs: the branch's landing stops it (decision 717), as does a message the writer
   * got (the person took over).
   */
  async function watchReview(where: ReviewPlace, record: HiveFile): Promise<void> {
    const running = reviews.get(record.branch);
    if (!running || running.stopped) return;
    const landing = await landingOf(record.branch);
    if (reviews.get(record.branch) !== running || running.stopped) return;
    if (landing) {
      running.stopped = landing;
      running.run.stop();
      return;
    }
    const thread = await readThreadEnd(symbioteFolder(where), record.branch);
    const prompt = thread.findLast((e) => e.kind === 'prompt');
    if (prompt && prompt.at > record.since) {
      running.stopped = 'took-over';
      running.run.stop();
    }
  }

  /** A check stopped before its end: no result; the step kept, the person's turn, or the landing. */
  async function stoppedCheck(where: ReviewPlace, branch: string, why: Stop): Promise<void> {
    const record = await readHive(where, branch);
    if (!record || record.step === 'landed') return;
    if (why === 'merged' || why === 'queued') {
      return leaveTo(where, record, why, { stopped: 'check' });
    }
    if (why === 'took-over') {
      const turn = await turnOf(where, branch, record.since);
      await roundsAgain(where, record, turn?.prompt?.at ?? stamp());
      return;
    }
    const kept: HiveFile = { ...record, interrupted: true };
    delete kept.check;
    await save(where, kept);
    await event(where, branch, 'check-stopped', { why });
  }

  /**
   * The person's message reached the writer: its turn, the rounds counted again. A request the
   * person closed is left behind (HV8): the next landing opens a new one.
   */
  async function roundsAgain(where: ReviewPlace, record: HiveFile, at: string): Promise<void> {
    if (record.request?.state === 'closed') {
      record = { ...record };
      delete record.request;
    }
    await moveTo(
      where,
      record,
      {
        step: 'writing',
        round: 1,
        since: at,
        message: undefined,
        note: undefined,
        check: undefined,
        review: undefined,
      },
      'rounds-again',
      { prompt: at },
    );
  }

  /**
   * Landing asked, or stopped for the person: merged, or the person's message, or new commits;
   * nothing while the merge queue has the branch (decision 717).
   */
  async function waiting(where: ReviewPlace, record: HiveFile): Promise<void> {
    const turn = await turnOf(where, record.branch, record.since);
    if (!turn) return;
    const { summary, prompt } = turn;
    const landing = await landingOf(record.branch, summary);
    if (landing === 'merged' || (landing === 'queued' && record.step !== 'landing')) {
      return leaveTo(where, record, landing);
    }
    if (landing) return;
    if (prompt && prompt.at > record.since) return roundsAgain(where, record, prompt.at);
    const moved =
      record.step === 'landing' &&
      record.checked !== undefined &&
      summary.tip !== null &&
      summary.tip !== record.checked &&
      summary.agent.state !== 'working' &&
      (summary.worktree.changed ?? 0) === 0;
    if (moved) {
      const next = await moveTo(where, record, { step: 'checking' }, 'checking', { moved: true });
      return checking(where, next, summary);
    }
  }

  /**
   * Pushes the workspace's branch to `origin` at `sha` (HV4, decision 768), never forced; the push
   * and git's words are in the record, and a refused one stops nothing.
   */
  async function pushOut(where: ReviewPlace, branch: string, sha: string): Promise<void> {
    if (!lander || closed) return;
    const remotes = await git(repo.root, ['remote']).catch(() => '');
    const result = remotes.split('\n').includes('origin')
      ? await pushBranch(repo, { remote: 'origin', sha, branch })
      : { ok: false as const, error: 'no remote named origin' };
    const fresh = await readHive(where, branch);
    if (!fresh || closed) return;
    const pushed = {
      at: stamp(),
      sha,
      ok: result.ok,
      ...(result.ok ? {} : { error: result.error }),
    };
    await save(where, { ...fresh, pushed });
    await event(where, branch, 'pushed', {
      commit: sha,
      ok: result.ok,
      ...(result.ok ? {} : { error: result.error }),
    });
  }

  /** What Hive's approval says it rests on: the check, the review, what did not run (767). */
  function approvalOf(record: HiveFile, tip: string): string {
    const check = record.checks.findLast((c) => c.at === tip && c.ok);
    const review = record.reviews.findLast((r) => r.at === tip);
    const checked = check
      ? `checked (${plural(check.commands?.length ?? 1, 'command')}, round ${check.round})`
      : 'not checked: no check is set or found';
    const reviewed =
      review?.verdict === 'approved'
        ? `reviewed (approved, round ${review.round})`
        : `not reviewed${record.note && record.note !== 'no check is set or found' ? `: ${record.note.replace(/^not reviewed: /, '')}` : ''}`;
    return `Approved by Hive at ${short(tip)}: ${checked}; ${reviewed}.`;
  }

  /**
   * At `landing` with a lander (HV4, decisions 767–770): the landing in flight followed, else the
   * commit Hive checked and reviewed approved and queued; new commits are checked first, and a
   * merge of the person's is theirs (717).
   */
  async function landing(where: ReviewPlace, record: HiveFile): Promise<void> {
    if (!lander) return waiting(where, record);
    const summary = await workspaces.summaryOf(record.branch);
    if (!summary) return;
    const last = record.landings?.at(-1);
    if (last?.via === 'request' && !last.outcome)
      return waitingForMerge(where, record, last, summary);
    if (last && !last.outcome) return follow(where, record, last, summary);
    if (summary.merged) return void (await moveTo(where, record, { step: 'landed' }, 'landed'));
    const queue = await merges().catch(() => null);
    if (!queue || queue.some((m) => m.branch === record.branch && QUEUED.has(m.state))) return;
    const moved =
      summary.tip !== null &&
      record.checked !== undefined &&
      summary.tip !== record.checked &&
      summary.agent.state !== 'working' &&
      (summary.worktree.changed ?? 0) === 0;
    if (moved) {
      const next = await moveTo(where, record, { step: 'checking' }, 'checking', { moved: true });
      return checking(where, next, summary);
    }
    if (!summary.tip || summary.tip !== record.checked) return;
    return act(record.branch, land(where, record.branch, summary));
  }

  /** Approves the checked commit as Hive's and queues it into the start branch (767). */
  async function land(where: ReviewPlace, branch: string, summary: WorkspaceSummary) {
    if (!lander) return;
    const tip = summary.tip;
    if (!tip) return;
    let record = await readHive(where, branch);
    if (!record || record.step !== 'landing' || closed) return;
    // HV8: by a pull or merge request where the repository says so, read at each landing.
    const requests = lander.requests?.by() === 'request' ? lander.requests : undefined;
    if (!record.pushed?.ok || record.pushed.sha !== tip) {
      await pushOut(where, branch, tip);
      record = (await readHive(where, branch)) ?? record;
    }
    const stop = async (note: string) =>
      void (await moveTo(where, record, { step: 'stuck', note }, 'stuck', { note }));
    if (requests && (!record.pushed?.ok || record.pushed.sha !== tip)) {
      // A request needs the branch on the forge (792).
      return stop(`the branch was not pushed to origin: ${record.pushed?.error ?? 'not pushed'}`);
    }
    const { info } = await lander.reviews.resolve(branch);
    if (info.head !== tip) return;
    const targets = await lander.merges.targets(branch);
    const into =
      summary.from && targets.branches.includes(summary.from) ? summary.from : targets.into;
    if (!into) return stop(`no branch to land ${branch} in`);
    let forge: Forge | undefined;
    if (requests) {
      const found = await requests.forge();
      if ('why' in found) return stop(`Hive lands by pull or merge request, but ${found.why}`);
      forge = found.forge;
    }
    await lander.reviews.finish(
      info,
      { event: 'approve', body: approvalOf(record, tip), comments: [], via: 'hive' },
      () => Promise.reject(new Error('a landing has no comment')),
    );
    if (requests && forge)
      return openRequest(where, branch, summary, { into, tip, forge, requests });
    const at = stamp();
    let entry: MergeEntry;
    try {
      entry = await lander.merges.enqueue({ branch, into, by: 'hive' });
    } catch (error) {
      // Refused before it is queued: a fast-forward its target cannot take, say (V67).
      const refused: HiveLanding = {
        round: record.round,
        at: tip,
        into,
        entry: 'none',
        queued: at,
        message: (error as Error).message,
      };
      const fresh = (await readHive(where, branch)) ?? record;
      return landingFailed(
        where,
        { ...fresh, landings: [...(fresh.landings ?? []), refused] },
        refused,
        {
          outcome: 'refused',
          why: (error as Error).message,
        },
      );
    }
    const attempt: HiveLanding = {
      round: record.round,
      at: tip,
      into,
      entry: entry.id,
      queued: entry.queued,
      state: entry.state,
    };
    const fresh = (await readHive(where, branch)) ?? record;
    await save(where, { ...fresh, landings: [...(fresh.landings ?? []), attempt] });
    await event(where, branch, 'land-queued', { into, entry: entry.id, commit: tip });
  }

  /** "pull request #12" or "merge request !12", for the notes a person reads (HV8). */
  const requestWords = (request: Pick<HiveRequest, 'forge' | 'number'>) => {
    const words = FORGE_WORDS[request.forge];
    return `${words.request} ${words.sign}${request.number}`;
  };

  /**
   * Opens the branch's pull or merge request into `into` (HV8, decisions 788, 790), or updates the
   * one open; ready, its description the brief and what ran; then Symbiote's graph review on it.
   * Recorded as a landing attempt that waits for the person's merge on the forge.
   */
  async function openRequest(
    where: ReviewPlace,
    branch: string,
    summary: WorkspaceSummary,
    {
      into,
      tip,
      forge,
      requests,
    }: { into: string; tip: string; forge: Forge; requests: HiveRequests },
  ): Promise<void> {
    const record = await readHive(where, branch);
    if (!record || closed) return;
    const prior = record.request;
    const stop = async (note: string) =>
      void (await moveTo(where, record, { step: 'stuck', note }, 'stuck', { note }));
    if (prior?.state === 'closed')
      return stop(`its ${requestWords(prior)} was closed without a merge`);
    const words = FORGE_WORDS[forge.kind];
    const body = requestBody(record, {
      brief: summary.brief,
      approval: approvalOf(record, tip),
      kind: forge.kind,
    });
    let request;
    let opened = false;
    try {
      if (prior?.state === 'open') {
        const read = await forge.getChangeRequest(prior.number);
        if (read.state === 'open') request = read;
        if (read.state === 'closed') {
          return stop(`its ${requestWords(prior)} was closed without a merge`);
        }
      }
      request ??= await forge.findOpenRequest(branch, into);
      if (request) {
        await forge.updateDescription(request, body);
      } else {
        request = await forge.openChangeRequest({
          head: branch,
          base: into,
          title: summary.title ?? branch,
          body,
        });
        opened = true;
      }
    } catch (error) {
      return stop(
        `the ${words.request} could not be opened on ${words.name}: ${(error as Error).message}`,
      );
    }
    const fresh = (await readHive(where, branch)) ?? record;
    const same = prior?.number === request.number && prior.state === 'open';
    const kept: HiveRequest = {
      forge: forge.kind,
      number: request.number,
      url: request.url,
      into,
      at: tip,
      opened: same ? prior.opened : stamp(),
      state: 'open',
      read: stamp(),
      ...(same && prior.review ? { review: prior.review } : {}),
    };
    const attempt: HiveLanding = {
      round: fresh.round,
      at: tip,
      into,
      entry: `${words.sign}${request.number}`,
      queued: stamp(),
      via: 'request',
    };
    const last = fresh.landings?.at(-1);
    const earlier =
      last?.via === 'request' && !last.outcome
        ? (fresh.landings ?? []).slice(0, -1)
        : (fresh.landings ?? []);
    await save(where, { ...fresh, request: kept, landings: [...earlier, attempt] });
    await event(where, branch, opened ? 'request-opened' : 'request-updated', {
      into,
      commit: tip,
      number: request.number,
      url: request.url,
    });
    await reviewRequest(where, branch, forge, requests);
  }

  /**
   * Symbiote's graph review on the request (decision 790), once a commit: its new findings posted
   * as a comment review; a failure recorded and tried again at the next reads, 3 times at most.
   */
  async function reviewRequest(
    where: ReviewPlace,
    branch: string,
    forge: Forge,
    requests: HiveRequests,
  ): Promise<void> {
    const record = await readHive(where, branch);
    const request = record?.request;
    if (!record || !request || request.state !== 'open' || closed) return;
    const before = request.review?.at === request.at ? request.review : undefined;
    if (before && (!before.error || (before.tries ?? 1) >= REVIEW_TRIES)) return;
    const tries = (before?.tries ?? 0) + 1;
    let review: NonNullable<HiveRequest['review']>;
    try {
      const read = await forge.getChangeRequest(request.number);
      const base = (await mergeBase(repo, request.into, request.at)) ?? request.into;
      const posted = await requests.review(forge, read, base, request.at);
      review = {
        at: request.at,
        posted: posted.posted,
        ...(posted.url ? { url: posted.url } : {}),
      };
    } catch (error) {
      review = { at: request.at, posted: 0, error: (error as Error).message, tries };
    }
    const fresh = (await readHive(where, branch)) ?? record;
    if (!fresh.request || fresh.request.number !== request.number) return;
    await save(where, { ...fresh, request: { ...fresh.request, review } });
    await event(where, branch, review.error ? 'request-review-failed' : 'request-reviewed', {
      posted: review.posted,
      ...(review.error ? { error: review.error } : {}),
    });
  }

  /**
   * At `landing`, waiting for the person's merge on the forge (HV8): the person's message starts
   * the rounds again (the request stays open); new commits are checked first; a commit checked
   * since updates the request; else the request is read (791).
   */
  async function waitingForMerge(
    where: ReviewPlace,
    record: HiveFile,
    last: HiveLanding,
    summary: WorkspaceSummary,
  ): Promise<void> {
    const turn = await turnOf(where, record.branch, record.since);
    if (turn?.prompt && turn.prompt.at > record.since && record.request?.state === 'open') {
      return roundsAgain(where, record, turn.prompt.at);
    }
    const moved =
      summary.tip !== null &&
      record.checked !== undefined &&
      summary.tip !== record.checked &&
      summary.agent.state !== 'working' &&
      (summary.worktree.changed ?? 0) === 0;
    if (moved) {
      const next = await moveTo(where, record, { step: 'checking' }, 'checking', { moved: true });
      return checking(where, next, summary);
    }
    if (summary.tip && summary.tip === record.checked && record.checked !== last.at) {
      return act(record.branch, land(where, record.branch, summary));
    }
    return watchRequest(where, record);
  }

  /** Whether the request is due a read (791). */
  const dueRead = (request: HiveRequest) =>
    !request.read || now().getTime() - Date.parse(request.read) >= requestPollMs;

  /**
   * Reads the workspace's request (HV8, decision 789), whatever the step: merged, the start branch
   * brought up and the workspace landed; closed, stopped at landing; cannot merge at landing, back
   * to the writer (769); open, its graph review posted if it is not yet.
   */
  async function watchRequest(where: ReviewPlace, given: HiveFile): Promise<void> {
    const requests = lander?.requests;
    const request = given.request;
    if (!requests || !request || closed) return;
    const waits = request.state === 'open' || (request.state === 'merged' && !request.pulled?.ok);
    if (!waits || !dueRead(request)) return;
    const found = await requests.forge();
    const record = (await readHive(where, given.branch)) ?? given;
    const mark = async (change: Partial<HiveRequest>) => {
      const fresh = (await readHive(where, given.branch)) ?? record;
      if (!fresh.request) return;
      await save(where, { ...fresh, request: { ...fresh.request, read: stamp(), ...change } });
    };
    if ('why' in found) return mark({ error: found.why });
    let read;
    try {
      read = await found.forge.getChangeRequest(request.number);
    } catch (error) {
      return mark({ error: (error as Error).message });
    }
    if (read.state === 'merged') return mergedOnForge(where, record, read.mergeCommit);
    if (read.state === 'closed') return closedOnForge(where, record);
    const last = record.landings?.at(-1);
    const waiting = record.step === 'landing' && last?.via === 'request' && !last.outcome;
    if (waiting && read.conflict && read.head.sha === request.at && last) {
      return conflictOnForge(where, record, last);
    }
    const fresh = (await readHive(where, given.branch)) ?? record;
    if (!fresh.request) return;
    const now: HiveRequest = { ...fresh.request, read: stamp() };
    delete now.error;
    if (read.conflict) now.conflict = true;
    else delete now.conflict;
    await save(where, { ...fresh, request: now });
    if (waiting) await reviewRequest(where, given.branch, found.forge, requests);
  }

  /**
   * Merged on the forge: the start branch fetched and fast-forwarded (770); the person's checkout
   * in the way, tried again at the next read; else landed — diverged, too: the forge merged it.
   */
  async function mergedOnForge(where: ReviewPlace, record: HiveFile, merge?: string) {
    const request = record.request;
    if (!request) return;
    const result = await bringUp(repo, request.into);
    const pulled = {
      at: stamp(),
      ok: result.ok,
      ...(result.ok ? {} : { error: result.error }),
    };
    const now: HiveRequest = {
      ...request,
      state: 'merged',
      read: stamp(),
      ...(merge ? { merge } : {}),
      pulled,
    };
    delete now.conflict;
    delete now.error;
    const last = record.landings?.at(-1);
    const open = last?.via === 'request' && !last.outcome ? last : undefined;
    if (!result.ok && result.refused) {
      const landings = open
        ? [
            ...(record.landings ?? []).slice(0, -1),
            { ...open, state: 'ready' as const, message: result.error },
          ]
        : record.landings;
      await save(where, { ...record, request: now, ...(landings ? { landings } : {}) });
      if (request.state !== 'merged') {
        await event(where, record.branch, 'request-merged', { pulled: false, error: result.error });
      }
      return;
    }
    const done: HiveLanding | undefined = open
      ? { ...open, outcome: 'landed', ended: stamp(), ...(merge ? { merge } : {}) }
      : undefined;
    if (done) {
      delete done.state;
      delete done.message;
    }
    const landings = done ? [...(record.landings ?? []).slice(0, -1), done] : record.landings;
    // A check or review still running ends: the branch landed (717).
    const running = checks.get(record.branch);
    if (running && !running.stopped) {
      running.stopped = 'merged';
      running.run.kill();
    }
    const reviewing = reviews.get(record.branch);
    if (reviewing && !reviewing.stopped) {
      reviewing.stopped = 'merged';
      reviewing.run.stop();
    }
    await moveTo(
      where,
      { ...record, request: now, ...(landings ? { landings } : {}) },
      { step: 'landed', message: undefined, check: undefined, review: undefined, note: undefined },
      'landed',
      {
        into: request.into,
        request: request.number,
        ...(merge ? { merge } : {}),
        pulled: result.ok,
        ...(result.ok ? {} : { error: result.error }),
      },
    );
  }

  /** Closed without a merge (789): stopped at landing, with why; at other steps, at the next one. */
  async function closedOnForge(where: ReviewPlace, record: HiveFile) {
    const request = record.request;
    if (!request) return;
    const now: HiveRequest = { ...request, state: 'closed', read: stamp() };
    delete now.error;
    delete now.conflict;
    const last = record.landings?.at(-1);
    const landings =
      last?.via === 'request' && !last.outcome
        ? [
            ...(record.landings ?? []).slice(0, -1),
            { ...last, outcome: 'closed' as const, ended: stamp() },
          ]
        : record.landings;
    const after: HiveFile = { ...record, request: now, ...(landings ? { landings } : {}) };
    await event(where, record.branch, 'request-closed', { number: request.number });
    if (record.step !== 'landing') return save(where, after);
    const note = `its ${requestWords(request)} was closed without a merge`;
    await moveTo(where, after, { step: 'stuck', note }, 'stuck', { note });
  }

  /**
   * The forge cannot merge it (789, as 769): the start branch brought up to the forge's, the files
   * found locally, `hive.land` to the writer; the request stays open and updates on the next push.
   */
  async function conflictOnForge(where: ReviewPlace, record: HiveFile, last: HiveLanding) {
    const request = record.request;
    if (!request) return;
    await bringUp(repo, request.into);
    const files = await conflictFiles(repo, request.into, request.at);
    const words = FORGE_WORDS[request.forge];
    const n = files.length;
    const what = n
      ? `${files.join(', ')} conflict${n === 1 ? 's' : ''} with ${request.into}`
      : `it conflicts with ${request.into}`;
    const why = `its ${requestWords(request)} cannot be merged on ${words.name}: ${what}.`;
    const done: HiveLanding = {
      ...last,
      outcome: 'conflict',
      ended: stamp(),
      ...(n ? { files } : {}),
      message: why,
    };
    const now: HiveRequest = { ...request, conflict: true, read: stamp() };
    delete now.error;
    const after: HiveFile = {
      ...record,
      request: now,
      landings: [...(record.landings ?? []).slice(0, -1), done],
    };
    return landingFailed(where, after, done, { outcome: 'conflict', why });
  }

  /** The landing in flight: landed, still merging, refused by the person's checkout, or failed. */
  async function follow(
    where: ReviewPlace,
    record: HiveFile,
    last: HiveLanding,
    summary: WorkspaceSummary,
  ): Promise<void> {
    if (!lander) return;
    const queue = await merges().catch(() => null);
    if (!queue) return;
    const entry = queue.find((e) => e.id === last.entry);
    const replace = (landing: HiveLanding): HiveFile => ({
      ...record,
      landings: [...(record.landings ?? []).slice(0, -1), landing],
    });
    if (!entry) {
      if (summary.merged) {
        const done: HiveLanding = { ...last, outcome: 'landed', ended: stamp() };
        delete done.state;
        await moveTo(where, replace(done), { step: 'landed' }, 'landed', { into: last.into });
        return;
      }
      // Taken out of the queue by the person: stopping beats guessing.
      const note = `its landing in ${last.into} was taken out of the merge queue`;
      const done: HiveLanding = { ...last, outcome: 'failed', ended: stamp(), message: note };
      delete done.state;
      await moveTo(where, replace(done), { step: 'stuck', note }, 'stuck', { note });
      return;
    }
    if (entry.state === 'landed') {
      const done: HiveLanding = {
        ...last,
        outcome: 'landed',
        ended: entry.landed ?? stamp(),
        ...(entry.merge ? { merge: entry.merge } : {}),
        ...(entry.pushed ? { pushed: entry.pushed } : {}),
      };
      delete done.state;
      delete done.message;
      await moveTo(where, replace(done), { step: 'landed' }, 'landed', {
        into: last.into,
        merge: entry.merge,
        pushed: entry.pushed?.ok ?? false,
      });
      return;
    }
    const said = {
      state: entry.state,
      ...(entry.message ? { message: entry.message } : {}),
    } as const;
    if (MERGING.has(entry.state)) {
      if (last.state !== entry.state || last.message !== entry.message) {
        const now: HiveLanding = { ...last, ...said };
        if (!entry.message) delete now.message;
        await save(where, replace(now));
      }
      return;
    }
    if (entry.state === 'ready') {
      // The person's checkout refused the fast-forward (770): Land again once a while has passed.
      const due = !last.tried || now().getTime() - Date.parse(last.tried) >= landRetryMs;
      await save(where, replace({ ...last, ...said, ...(due ? { tried: stamp() } : {}) }));
      if (due) await lander.merges.land(entry.id).catch(() => undefined);
      return;
    }
    // needs-you or failed: back to the writer (769).
    const outcome: NonNullable<HiveLanding['outcome']> = entry.diverged
      ? 'diverged'
      : entry.conflicts?.length
        ? 'conflict'
        : entry.behind
          ? 'cannot-fast-forward'
          : entry.check?.ok === false
            ? 'check-failed'
            : 'failed';
    const kept = await keepLog(where, record.branch, entry.id);
    const done: HiveLanding = {
      ...last,
      outcome,
      ended: stamp(),
      ...(entry.conflicts?.length ? { files: entry.conflicts } : {}),
      ...(entry.check?.ok === false && entry.check.failed
        ? { failed: entry.check.failed, output: lastLines(entry.check.output ?? '') }
        : {}),
      ...(entry.message ? { message: entry.message } : {}),
      ...(kept ? { log: kept } : {}),
    };
    delete done.state;
    // Out of the queue first: the target is free, and a message may go (717).
    await lander.merges.remove(entry.id);
    return landingFailed(where, replace(done), done, { outcome, why: whyOf(done, entry.into) });
  }

  /** What failed, for the writer: the files, or the command and its last lines. */
  function whyOf(landing: HiveLanding, into: string): string {
    if (landing.files?.length) {
      const n = landing.files.length;
      return `${landing.files.join(', ')} conflict${n === 1 ? 's' : ''} with ${into}.`;
    }
    if (landing.failed) {
      return `the check failed on the merge: \`${landing.failed}\`. Its last lines:\n\n\`\`\`\n${landing.output ?? ''}\n\`\`\``;
    }
    return `${landing.message ?? 'the merge failed'}.`;
  }

  /**
   * A landing that failed (769): written, then `hive.land` to the writer and the rounds again;
   * after 2 merges of the start branch, or a target diverged from its remote, Hive stops, with why.
   */
  async function landingFailed(
    where: ReviewPlace,
    record: HiveFile,
    landing: HiveLanding,
    { outcome, why }: { outcome: NonNullable<HiveLanding['outcome']>; why: string },
  ): Promise<void> {
    const done: HiveLanding = { ...landing, outcome, ended: landing.ended ?? stamp() };
    const after: HiveFile = {
      ...record,
      landings: [...(record.landings ?? []).slice(0, -1), done],
    };
    await save(where, after);
    await event(where, record.branch, 'land-failed', { outcome, into: done.into });
    const merges = (record.merges ?? 0) + 1;
    if (outcome === 'diverged' || merges > HIVE_MERGES) {
      const plain = why.split('\n')[0]?.replace(/[.:]$/, '') ?? why;
      const note =
        outcome === 'diverged'
          ? (done.message ?? plain)
          : `could not land in ${done.into} ${HIVE_MERGES + 1} times: ${plain.replace(/`/g, '')}`;
      const stuck: HiveFile = { ...after, step: 'stuck', since: stamp(), note };
      delete stuck.message;
      await save(where, stuck);
      await event(where, record.branch, 'stuck', { note });
      return;
    }
    const next = await queue(where, { ...after, merges, round: 1 }, 'hive.land', {
      why,
      branch: record.branch,
      at: short(done.at),
      into: done.into,
      merge: String(merges),
      merges: String(HIVE_MERGES),
    });
    await deliver(where, next);
  }

  /** A merge's log kept beside Hive's record, its entry about to be removed; its id. */
  async function keepLog(where: ReviewPlace, branch: string, entry: string) {
    const id = hiveLogId(stamp());
    const to = hiveLogPath(where, branch, id);
    try {
      await mkdir(dirname(to), { recursive: true });
      await copyFile(join(cacheDir, 'state', repo.id, 'merges', `${entry}.jsonl`), to);
      return id;
    } catch {
      return undefined;
    }
  }

  /**
   * While a check runs: the branch's landing stops it (decision 717), as does a message the writer
   * got (the person took over).
   */
  async function watchCheck(where: ReviewPlace, record: HiveFile): Promise<void> {
    const running = checks.get(record.branch);
    if (!running || running.stopped) return;
    const landing = await landingOf(record.branch);
    if (checks.get(record.branch) !== running || running.stopped) return;
    if (landing) {
      running.stopped = landing;
      running.run.kill();
      return;
    }
    const thread = await readThreadEnd(symbioteFolder(where), record.branch);
    const prompt = thread.findLast((e) => e.kind === 'prompt');
    if (prompt && prompt.at > record.since) {
      running.stopped = 'took-over';
      running.run.kill();
    }
  }

  /** Runs `work` as the workspace's one action in flight. */
  function act(branch: string, work: Promise<void>): Promise<void> {
    const done = work
      .catch((error: unknown) => {
        log?.warn({ branch, error: (error as Error).message }, 'hive step failed');
      })
      .finally(() => {
        if (actions.get(branch) === done) actions.delete(branch);
      });
    actions.set(branch, done);
    return Promise.resolve();
  }

  /** Hive turned off (decision 655): its checks killed, its working writers to stop. */
  async function turnOff(where: ReviewPlace, records: HiveFile[]): Promise<void> {
    for (const record of records) {
      const running = checks.get(record.branch);
      if (running) {
        running.stopped = 'off';
        running.run.kill();
      } else if (record.step === 'checking' && record.check) {
        killGroup(record.check.pid, 'SIGKILL');
      }
      const review = reviews.get(record.branch);
      if (review) {
        review.stopped = 'off';
        review.run.stop();
      } else if (record.step === 'reviewing' && record.review) {
        killGroup(record.review.pid, 'SIGKILL');
      }
      if (record.step === 'writing') toStop.add(record.branch);
      await event(where, record.branch, 'off', { step: record.step });
    }
    await stopWriters(where);
  }

  /** Stops each writer Hive off must stop, while it works or waits; a failure is tried again. */
  async function stopWriters(where: ReviewPlace): Promise<void> {
    for (const branch of [...toStop]) {
      const summary = await workspaces.summaryOf(branch).catch(() => null);
      const live = summary && ['working', 'needs-you'].includes(summary.agent.state);
      if (!live) {
        toStop.delete(branch);
        continue;
      }
      try {
        await workspaces.stopAgent(branch);
      } catch (error) {
        log?.warn({ branch, error: (error as Error).message }, 'hive could not stop a writer');
        continue;
      }
      toStop.delete(branch);
      const record = await readHive(where, branch);
      if (record) await save(where, { ...record, interrupted: true });
      await event(where, branch, 'stopped');
    }
  }

  /**
   * A new holder, or Hive on again (decision 655): checks left by a killed runner killed, to run
   * again; a writer Hive stopped told to continue, unless its turn went on meanwhile.
   */
  async function reconcile(where: ReviewPlace, records: HiveFile[]): Promise<void> {
    toStop.clear();
    for (const record of records) {
      if (reviews.has(record.branch)) continue;
      // Copies a review of another runner left (decision 675): none is running here.
      await rm(copiesOf(record.branch), { recursive: true, force: true }).catch(() => undefined);
      if (record.step === 'reviewing') {
        if (record.review && killGroup(record.review.pid, 'SIGKILL')) {
          await event(where, record.branch, 'orphan-killed', { pid: record.review.pid });
        }
        if (record.review || record.interrupted) {
          const again: HiveFile = { ...record };
          delete again.review;
          delete again.interrupted;
          await save(where, again);
          await event(where, record.branch, 'on', { step: 'reviewing' });
        }
        continue;
      }
      if (record.step === 'checking' && !checks.has(record.branch)) {
        if (record.check && killGroup(record.check.pid, 'SIGKILL')) {
          await event(where, record.branch, 'orphan-killed', { pid: record.check.pid });
        }
        if (record.check || record.interrupted) {
          const again: HiveFile = { ...record };
          delete again.check;
          delete again.interrupted;
          await save(where, again);
          await event(where, record.branch, 'on', { step: 'checking' });
        }
        continue;
      }
      if (record.step !== 'writing' || !record.interrupted) continue;
      const turn = await turnOf(where, record.branch, record.since);
      if (!turn) continue;
      const going = turn.ended || turn.summary.agent.state === 'working';
      if (going) {
        const kept: HiveFile = { ...record };
        delete kept.interrupted;
        await save(where, kept);
        await event(where, record.branch, 'on', { going: true });
        continue;
      }
      await event(where, record.branch, 'on');
      await queue(where, record, 'hive.resume', {});
    }
  }

  /** One look at every record. */
  async function once(): Promise<void> {
    if (closed) return;
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
    if (lastOn !== true) await reconcile(where, records);
    lastOn = true;
    for (const listed of records) {
      if (closed) return;
      let record = (await readHive(where, listed.branch)) ?? listed;
      // HV8: an open request is read whatever the step; at landing, by the landing step.
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
      } while (again && !closed);
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
    if (closed || interval <= 0) return;
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
      if (closed) return;
      for (const running of checks.values()) {
        running.stopped = 'close';
        running.run.kill();
      }
      for (const running of reviews.values()) {
        running.stopped = 'close';
        running.run.stop();
      }
      closed = true;
      clearTimeout(timer);
      await ticking;
      await Promise.all(actions.values());
      if (holding) await unlock(await reviewPlace(repo, cacheDir)).catch(() => undefined);
    },
    abandon() {
      closed = true;
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
