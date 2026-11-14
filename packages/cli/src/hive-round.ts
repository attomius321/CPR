// A Hive round's moves (HV2, HV4, HV5): the record saved and its events, a message queued and
// delivered through the pacing gate, a step moved, the next round, a failed landing sent back,
// the branch pushed after a turn.
import {
  type MergeState,
  type ThreadEntry,
  type HivePause,
  git,
  pushBranch,
  type HiveLanding,
  type HiveRequest,
  type WorkspaceSummary,
} from '@symbiote/core';
import {
  HIVE_MERGES,
  hiveEvent,
  readHive,
  writeHive,
  type HiveFile,
  type HiveMessage,
  type HiveMessageKey,
} from './hive-record.js';
import { pauseEvent, spendOf } from './hive-pacing.js';
import { readPrompts } from './prompts.js';
import { fillPrompt } from './prompt-text.js';
import type { ReviewPlace } from './reviews.js';
import { readThreadEnd } from './thread.js';
import { readRecord, symbioteFolder } from './workspace-record.js';
import { answerOfHiveEvent, dueAnswer } from './issue-answering.js';
import { judgeTake } from './issue-record.js';
import type { HiveContext, WatchRequest, Landing } from './hive-context.js';

/** Lines of a check's output kept and sent, and their characters at most (a message's limit is 20,000). */
const OUTPUT_LINES = 60;

const OUTPUT_CHARS = 6_000;

export const lastLines = (text: string) =>
  text.replace(/\n+$/, '').split('\n').slice(-OUTPUT_LINES).join('\n').slice(-OUTPUT_CHARS);

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The merge queue's states while it has a branch: every one but its ends. */
export const QUEUED: ReadonlySet<MergeState> = new Set<MergeState>([
  'queued',
  'merging',
  'resolving',
  'checking',
  'needs-you',
  'ready',
]);

/** Whether `thread` has `message` as a prompt: its session took it with its hooks. */
export const arrived = (thread: ThreadEntry[], message: HiveMessage) =>
  thread.some((e) => e.kind === 'prompt' && e.at >= message.at && e.text === message.text);

export const short = (sha: string) => sha.slice(0, 7);

/** A branch as one folder's name in Symbiote's cache. */
export const slug = (branch: string) => branch.replace(/[^\w.-]+/g, '-');

/** The same pause as the record's: its reason, window and reset (HV5): an event once a pause. */
function samePause(recorded: HivePause | undefined, pause: HivePause): boolean {
  return (
    recorded !== undefined &&
    recorded.reason === pause.reason &&
    recorded.until === pause.until &&
    recorded.minutes === pause.minutes &&
    recorded.scope === pause.scope &&
    recorded.why === pause.why
  );
}

/** "$1.20". */
const dollars = (amount: number) => `$${amount.toFixed(2)}`;

/** A request Hive still waits on: open, or merged with the start branch not brought up yet. */
export function awaiting(request: HiveRequest | undefined): request is HiveRequest {
  return (
    request !== undefined &&
    (request.state === 'open' || (request.state === 'merged' && !request.pulled?.ok))
  );
}

/** The round step's functions. */
export function hiveRound(
  ctx: Pick<
    HiveContext,
    | 'actions'
    | 'closed'
    | 'lander'
    | 'log'
    | 'merges'
    | 'now'
    | 'pacing'
    | 'repo'
    | 'root'
    | 'workspaces'
  >,
  { watchRequest }: { watchRequest: WatchRequest },
) {
  const { actions, lander, log, merges, now, pacing, repo, root, workspaces } = ctx;
  /** Messages that failed once: their failure is an event once. */
  const failed = new Set<string>();

  const stamp = () => now().toISOString();

  /** Writes a record, unless this runner stopped: a killed process writes nothing. */
  async function save(where: ReviewPlace, record: HiveFile): Promise<void> {
    if (ctx.closed) return;
    await writeHive(where, record);
  }

  async function event(
    where: ReviewPlace,
    branch: string,
    kind: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    if (ctx.closed) return;
    const at = stamp();
    await hiveEvent(where, branch, at, kind, data);
    log?.info({ branch, hive: kind, ...data }, `hive ${kind}`);
    await judged(where, branch, kind, data, at);
    await answered(where, branch, kind, data, at);
  }

  /**
   * A step of a workspace from an issue, due to be answered on it (HV11, decision 1071): a request
   * opened, landed, stopped with its kind. Hive's runner writes it at its tick.
   */
  async function answered(
    where: ReviewPlace,
    branch: string,
    kind: string,
    data: Record<string, unknown>,
    at: string,
  ): Promise<void> {
    if (kind !== 'request-opened' && kind !== 'landed' && kind !== 'stuck') return;
    try {
      const workspace = await readRecord(where, branch).catch(() => null);
      if (!workspace?.issue) return;
      const landing =
        kind === 'landed' ? (await readHive(where, branch))?.landings?.at(-1) : undefined;
      const step = answerOfHiveEvent(kind, data, { branch, at, ...(landing ? { landing } : {}) });
      if (!step) return;
      const { issue } = workspace;
      await dueAnswer(symbioteFolder(where), issue.number, step, {
        root,
        forge: { kind: issue.forge, host: issue.host, project: issue.project },
        at,
      });
    } catch (error) {
      log?.warn({ branch, error: (error as Error).message }, 'issue answer not due');
    }
  }

  /**
   * A take judged by how its workspace ended (HV10, decision 1066): right once landed; wrong when
   * its request was closed without a merge. Hive's own stops judge nothing.
   */
  async function judged(
    where: ReviewPlace,
    branch: string,
    kind: string,
    data: Record<string, unknown>,
    at: string,
  ): Promise<void> {
    const closed =
      kind === 'stuck' &&
      typeof data.note === 'string' &&
      data.note.includes('closed without a merge');
    if (kind !== 'landed' && !closed) return;
    const workspace = await readRecord(where, branch).catch(() => null);
    if (!workspace?.issue) return;
    await judgeTake(symbioteFolder(where), workspace.issue.number, branch, {
      right: kind === 'landed',
      why: kind === 'landed' ? 'landed' : 'closed',
      at,
    }).catch(() => undefined);
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
    if (!message || message.sent || message.taken || ctx.closed) return;
    const landing = await landingOf(record.branch);
    if (landing) return leaveTo(where, record, landing);
    const symbiote = symbioteFolder(where);
    let copy: string | undefined;
    const thread = await readThreadEnd(symbiote, record.branch);
    if (!arrived(thread, message)) {
      // HV5: while Hive held its message, the person's reached the writer: theirs is the turn,
      // and the rounds start again (795), as at a stop.
      const prompt = thread.findLast((e) => e.kind === 'prompt');
      if (record.paused && prompt && prompt.at > message.at) {
        return roundsAgain(where, record, prompt.at);
      }
      // A resume starts a turn: through the gate (HV5, decision 796).
      if (!(await paced(where, record))) return;
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
    await event(where, record.branch, 'stuck', { note, stop: 'unseen', unseen: true });
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
    if (landing === 'merged' && awaiting(record.request)) {
      // HV8: merged on its forge or outside its request, the forge says which: at its next read.
      const kept: HiveFile = { ...record };
      for (const key of ['message', 'check', 'review', 'interrupted'] as const) delete kept[key];
      if (Object.keys(kept).length !== Object.keys(record).length) await save(where, kept);
      return void (await watchRequest(where, kept));
    }
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
      await event(where, record.branch, 'stuck', { note, stop: 'rounds' });
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
    // A pause holds a step's start (HV5): another step has none waiting.
    if (change.step !== undefined && change.step !== record.step) delete next.paused;
    await save(where, next);
    if (kind) await event(where, record.branch, kind, data);
    return next;
  }

  /** The writer's spend by Claude Code's count, written when it changed (HV5, decision 801). */
  async function noteSpent(
    where: ReviewPlace,
    record: HiveFile,
    writer: number | undefined,
  ): Promise<HiveFile> {
    if (writer === undefined || record.spent?.writer === writer) return record;
    const next: HiveFile = { ...record, spent: { writer, at: stamp() } };
    await save(where, next);
    return next;
  }

  /**
   * The one gate before an agent Hive starts (HV5, decisions 796–801): the writer's first start, a
   * message (a resume starts a turn), a restart, a running review. At or over its budget, the
   * workspace stops, with why. While Claude's usage is at or over the threshold, or unknown, the
   * start waits: the pause in the record (once a pause), the step kept. Once it may start, the
   * pause is gone. The record to start with; null: held or stopped. Without `pacing`, as before.
   */
  async function paced(where: ReviewPlace, given: HiveFile): Promise<HiveFile | null> {
    if (!pacing || ctx.closed) return given;
    const { budget } = pacing.config();
    const thread = await readThreadEnd(symbioteFolder(where), given.branch);
    let record = await noteSpent(where, given, await pacing.writer(thread));
    if (budget !== null) {
      const spend = spendOf(record, record.spent?.writer, budget);
      if (spend.total >= budget) {
        const writer =
          spend.writer === undefined
            ? "the writer's cost not read"
            : `the writer ${dollars(spend.writer)}`;
        const reviews = spend.reviewed
          ? `${plural(spend.reviewed, 'review')} ${dollars(spend.reviews)}`
          : 'no review';
        const note = `its spend reached its budget: ${dollars(spend.total)} of ${dollars(budget)} (${writer}, ${reviews}). Raise the budget in Settings, then send it a message to go on`;
        await moveTo(
          where,
          record,
          { step: 'stuck', note, message: undefined, paused: undefined },
          'stuck',
          { note, stop: 'budget', spent: spend.total, budget },
        );
        return null;
      }
    }
    const pause = await pacing.usage();
    if (pause) {
      if (!samePause(record.paused, pause)) {
        await save(where, { ...record, paused: pause });
        await event(where, record.branch, 'paused', pauseEvent(pause));
      }
      return null;
    }
    if (record.paused) {
      const next: HiveFile = { ...record };
      delete next.paused;
      await save(where, next);
      await event(where, record.branch, 'goes-on', { reason: record.paused.reason });
      record = next;
    }
    return record;
  }

  /**
   * The person's message reached the writer: its turn, the rounds and Hive's answers in the
   * person's place counted again (795). A request the person closed is left behind (HV8): the
   * next landing opens a new one.
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
        decided: undefined,
        paused: undefined,
      },
      'rounds-again',
      { prompt: at },
    );
  }

  /**
   * Pushes the workspace's branch to `origin` at `sha` (HV4, decision 768), never forced; the push
   * and git's words are in the record, and a refused one stops nothing.
   */
  async function pushOut(where: ReviewPlace, branch: string, sha: string): Promise<void> {
    if (!lander || ctx.closed) return;
    const remotes = await git(repo.root, ['remote']).catch(() => '');
    const result = remotes.split('\n').includes('origin')
      ? await pushBranch(repo, { remote: 'origin', sha, branch })
      : { ok: false as const, error: 'no remote named origin' };
    const fresh = await readHive(where, branch);
    if (!fresh || ctx.closed) return;
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
      await event(where, record.branch, 'stuck', { note, stop: 'landing' });
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

  return {
    stamp,
    save,
    event,
    turnOf,
    queue,
    deliver,
    seen,
    unseen,
    landingOf,
    leaveTo,
    nextRound,
    moveTo,
    noteSpent,
    paced,
    roundsAgain,
    pushOut,
    landingFailed,
    act,
  };
}

export type HiveRoundSteps = ReturnType<typeof hiveRound>;
