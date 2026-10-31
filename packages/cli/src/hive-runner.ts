// Hive's runner (HV2, decisions 646, 653–656): in `symbiote view`'s process, it drives every
// workspace started while Hive is on. It reads what the workspace's card reads — the writer's
// session and the thread its hooks record — and acts on a turn's end: the project's check on the
// branch's tip, its failures sent back with `reply`, up to 3 rounds; then landing is asked of the
// person. Hive off stops Hive's writers and checks and keeps each step; Hive on, or a new runner
// after a killed one, looks at what the sessions show and goes on from there. One runner drives a
// repository, by a pid lock beside the records.
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  worktreeStatus,
  type GitRepo,
  type HiveCheck,
  type ThreadEntry,
  type WorkspaceSummary,
} from '@symbiote/core';
import type { Logger } from '@symbiote/log';
import type { HiveRecord } from './hive.js';
import {
  hiveEvent,
  hiveLockPath,
  readHive,
  readHives,
  writeHive,
  type HiveFile,
  type HiveMessageKey,
} from './hive-record.js';
import { projectCheck } from './merges.js';
import { killGroup, runGroup, type GroupRun, type RunGroup } from './programs.js';
import { fillPrompt, readPrompts } from './prompts.js';
import { reviewPlace, type ReviewPlace } from './reviews.js';
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
export type HiveWorkspaces = Pick<Workspaces, 'summaryOf' | 'reply' | 'stopAgent'>;

/** Lines of a check's output kept and sent, and their characters at most (a message's limit is 20,000). */
const OUTPUT_LINES = 60;
const OUTPUT_CHARS = 6_000;

const lastLines = (text: string) =>
  text.replace(/\n+$/, '').split('\n').slice(-OUTPUT_LINES).join('\n').slice(-OUTPUT_CHARS);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A check this runner runs, and why it was stopped, if it was. */
interface Running {
  run: GroupRun;
  stopped?: 'off' | 'took-over' | 'close';
}

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
  ): Promise<HiveFile> {
    const at = stamp();
    const text = fillPrompt(readPrompts(root).text[key], values).trim();
    const next: HiveFile = { ...record, step: 'writing', since: at, message: { key, text, at } };
    delete next.interrupted;
    await save(where, next);
    await event(where, record.branch, 'message', { key, round: next.round });
    return next;
  }

  /** Sends the record's message unless its session has it already; kept for a retry when refused. */
  async function deliver(where: ReviewPlace, record: HiveFile): Promise<void> {
    const message = record.message;
    if (!message || message.sent || closed) return;
    const thread = await readThreadEnd(symbioteFolder(where), record.branch);
    const arrived = thread.some(
      (e: ThreadEntry) => e.kind === 'prompt' && e.at >= message.at && e.text === message.text,
    );
    if (!arrived) {
      try {
        await workspaces.reply({ branch: record.branch, text: message.text });
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
    await save(where, { ...fresh, message: { ...message, sent: true } });
    await event(where, record.branch, 'sent', { key: message.key });
  }

  /** The next round with `key`'s message, or the person once the rounds are spent. */
  async function nextRound(
    where: ReviewPlace,
    record: HiveFile,
    key: 'hive.check' | 'hive.commit',
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

  /** The writer's turn (decision 653). */
  async function writing(where: ReviewPlace, record: HiveFile): Promise<void> {
    if (record.message && !record.message.sent) return deliver(where, record);
    const turn = await turnOf(where, record.branch, record.since);
    if (!turn) return;
    const { summary } = turn;
    if (summary.merged) return void (await moveTo(where, record, { step: 'landed' }, 'landed'));
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
        return void (await moveTo(where, record, { step: 'landing' }, 'landing', { commits: 0 }));
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

  /** Runs the project's check on the branch's tip (decision 654). */
  async function checking(
    where: ReviewPlace,
    record: HiveFile,
    known?: WorkspaceSummary,
  ): Promise<void> {
    const summary = known ?? (await workspaces.summaryOf(record.branch));
    if (!summary?.tip) return;
    const tip = summary.tip;
    const check = await projectCheck(repo, root, tip).catch(() => null);
    if (!check) {
      const note = 'no check is set or found: check it yourself before you land it';
      return void (await moveTo(where, record, { step: 'landing', checked: tip, note }, 'landing', {
        note,
      }));
    }
    return act(record.branch, runCheck(where, record, tip, check.commands, summary.worktree.path));
  }

  async function runCheck(
    where: ReviewPlace,
    record: HiveFile,
    tip: string,
    commands: string[],
    worktree: string,
  ): Promise<void> {
    const started = Date.now();
    let output = '';
    let failedCommand: string | undefined;
    let current = record;
    for (const command of commands) {
      if (closed) return;
      const running: Running = { run: run(command, worktree) };
      checks.set(record.branch, running);
      if (running.run.pid !== undefined) {
        current = { ...current, check: { pid: running.run.pid, started: stamp(), at: tip } };
        delete current.interrupted;
        await save(where, current);
      }
      if (command === commands[0]) {
        await event(where, record.branch, 'check-started', {
          round: record.round,
          commit: tip,
          commands,
        });
      }
      const result = await running.run.done;
      checks.delete(record.branch);
      if (closed) return;
      if (running.stopped) return stoppedCheck(where, record.branch, running.stopped);
      output += result.output;
      if (result.code !== 0) {
        failedCommand = command;
        break;
      }
    }
    const fresh = (await readHive(where, record.branch)) ?? current;
    const ran: HiveCheck = {
      round: fresh.round,
      at: tip,
      ok: failedCommand === undefined,
      ms: Date.now() - started,
      ...(failedCommand ? { failed: failedCommand } : {}),
      output: lastLines(output),
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
    if (ran.ok) {
      await moveTo(where, after, { step: 'landing', checked: tip, note: undefined }, 'landing');
      return;
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

  /** A check stopped before its end: no result; the step kept, or the person's turn. */
  async function stoppedCheck(
    where: ReviewPlace,
    branch: string,
    why: 'off' | 'took-over' | 'close',
  ): Promise<void> {
    const record = await readHive(where, branch);
    if (!record) return;
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

  /** The person's message reached the writer: its turn, the rounds counted again. */
  async function roundsAgain(where: ReviewPlace, record: HiveFile, at: string): Promise<void> {
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
      },
      'rounds-again',
      { prompt: at },
    );
  }

  /** Landing asked, or stopped for the person: merged, or the person's message, or new commits. */
  async function waiting(where: ReviewPlace, record: HiveFile): Promise<void> {
    const turn = await turnOf(where, record.branch, record.since);
    if (!turn) return;
    const { summary, prompt } = turn;
    if (summary.merged) return void (await moveTo(where, record, { step: 'landed' }, 'landed'));
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

  /** While a check runs: a message the writer got stops it (the person took over). */
  async function watchCheck(where: ReviewPlace, record: HiveFile): Promise<void> {
    const running = checks.get(record.branch);
    if (!running || running.stopped) return;
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
    const records = (await readHives(where)).filter((r) => r.step !== 'landed');
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
      const record = (await readHive(where, listed.branch)) ?? listed;
      if (checks.has(record.branch)) {
        await watchCheck(where, record);
        continue;
      }
      if (actions.has(record.branch)) continue;
      try {
        if (record.step === 'writing') await writing(where, record);
        else if (record.step === 'checking') await checking(where, record);
        else if (record.step === 'landing' || record.step === 'stuck') await waiting(where, record);
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
