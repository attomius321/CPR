// Hive answers the issue (HV11b, decisions 1020–1023, 1071, 1073–1076). A step adds a `due` event
// to the issue's `<number>.jsonl` and a line to the outbox, `issues/answers.jsonl`; Hive's runner
// writes what is due at its tick, while Hive is on: the comment, the labels, the closing, each
// recorded as written or why not. One answer a step, 6 comments an issue; nothing on a closed or
// locked issue, but a landing on one its own `Closes #n` closed; a failed write tried at the first
// tick a minute later, 3 times at most. It never throws into the round: the landing is the work,
// the comment reports it.
import { appendFile, mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitRepo, HiveAnsweringSetting, HiveLanding, IssueForge } from '@symbiote/core';
import { ForgeError, type Env, type Forge, type TokenAccount } from '@symbiote/forge';
import type { Logger } from '@symbiote/log';
import { writeConfig } from './config-write.js';
import { HIVE_STOPS, type HiveStopKind } from './hive-record.js';
import { originForge } from './hive-request.js';
import { answerKey, answerOf, readAnswerConfig, type AnswerStep } from './issue-answer.js';
import {
  appendIssueEvent,
  readIssueEvents,
  type AnswerPart,
  type DueEvent,
  type IssueEvent,
  type NotWrittenEvent,
} from './issue-record.js';

/** Comments an issue gets at most (decision 1022). */
export const MAX_COMMENTS = 6;
/** Tries of a step's writes (decision 1023). */
export const MAX_TRIES = 3;
/** The least time between two tries (decision 1075), and after a request merged (1074). */
export const RETRY_MS = 60_000;

const OUTBOX = 'answers.jsonl';

/**
 * Adds `step` as due on issue `number` (decision 1071), unless `hive.issues.answer` is off or the
 * step is due already. True when it was added.
 */
export async function dueAnswer(
  folder: string,
  number: number,
  step: AnswerStep,
  { root, forge, at }: { root: string; forge: IssueForge; at: string },
): Promise<boolean> {
  if (!readAnswerConfig(root).answer) return false;
  const key = answerKey(step);
  const events = await readIssueEvents(folder, number);
  if (events.some((e) => e.event === 'due' && e.key === key)) return false;
  const event: DueEvent = { event: 'due', at, key, step, forge };
  await appendIssueEvent(folder, number, event);
  await mkdir(join(folder, 'issues'), { recursive: true });
  await appendFile(join(folder, 'issues', OUTBOX), `${JSON.stringify({ number, key, at })}\n`);
  return true;
}

/**
 * A Hive event as a step to answer (decisions 1020, 1072): a request opened, a landing (by the
 * queue, or by a request whose number its entry names), a stop with its kind. Null for any other,
 * and for a stop that names no kind: its note is never posted.
 */
export function answerOfHiveEvent(
  kind: string,
  data: Record<string, unknown>,
  { branch, at, landing }: { branch: string; at: string; landing?: HiveLanding },
): AnswerStep | null {
  if (kind === 'request-opened') {
    const { number, url } = data;
    return typeof number === 'number' && typeof url === 'string'
      ? { step: 'request', number, url }
      : null;
  }
  if (kind === 'landed') {
    if (!landing) return null;
    if (landing.via === 'request') {
      const number = Number(/^[#!]?(\d+)$/.exec(landing.entry)?.[1]);
      return number > 0
        ? { step: 'landed', branch, via: 'request', into: landing.into, number }
        : null;
    }
    return { step: 'landed', branch, via: 'queue', into: landing.into, sha: landing.at };
  }
  if (kind === 'stuck') {
    const stop = data.stop;
    return typeof stop === 'string' && (HIVE_STOPS as readonly string[]).includes(stop)
      ? { step: 'stopped', branch, stop: stop as HiveStopKind, at }
      : null;
  }
  return null;
}

export interface IssueAnswererOptions {
  /** The `symbiote/` folder that holds the issues' records. */
  folder: () => Promise<string>;
  /** Where `symbiote/config.json` is read: `hive.issues.answer` and the labels. */
  root: string;
  /** `origin`'s forge, with its token, or why not. */
  forge: () => Promise<{ forge: Forge } | { why: string }>;
  now?: () => Date;
  retryMs?: number;
  /** How long after a request merged its issue is read to close it (decision 1074). */
  settleMs?: number;
  log?: Pick<Logger, 'info' | 'warn'>;
}

export type IssueAnswerer = ReturnType<typeof issueAnswerer>;

/** The writer of what is due, ticked by Hive's runner. */
export function issueAnswerer({
  folder,
  root,
  forge,
  now = () => new Date(),
  retryMs = RETRY_MS,
  settleMs = RETRY_MS,
  log,
}: IssueAnswererOptions) {
  /** The outbox read so far, and the steps not done yet, by issue and key. */
  let outbox: string | undefined;
  let offset = 0;
  const pending = new Map<string, { number: number; key: string }>();

  /** The outbox's new whole lines since the last read. */
  async function readOutbox(dir: string): Promise<void> {
    const file = join(dir, 'issues', OUTBOX);
    if (file !== outbox) {
      outbox = file;
      offset = 0;
      pending.clear();
    }
    let text: string;
    try {
      const handle = await open(file, 'r');
      try {
        const { size } = await handle.stat();
        if (size < offset) offset = 0;
        if (size === offset) return;
        const buffer = Buffer.alloc(size - offset);
        await handle.read(buffer, 0, buffer.length, offset);
        const end = buffer.lastIndexOf(0x0a);
        if (end < 0) return;
        text = buffer.subarray(0, end + 1).toString('utf8');
        offset += end + 1;
      } finally {
        await handle.close();
      }
    } catch {
      return;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const { number, key } = JSON.parse(line) as { number?: unknown; key?: unknown };
        if (Number.isSafeInteger(number) && (number as number) > 0 && typeof key === 'string') {
          pending.set(`${number as number}\n${key}`, { number: number as number, key });
        }
      } catch {
        // not a line of the outbox
      }
    }
  }

  async function tick(): Promise<void> {
    try {
      const dir = await folder();
      await readOutbox(dir);
      if (pending.size === 0) return;
      const config = readAnswerConfig(root);
      let found: Promise<{ forge: Forge } | { why: string }> | undefined;
      const forgeOnce = () => (found ??= forge());
      for (const [id, item] of [...pending]) {
        if (await answer(dir, item, config, forgeOnce)) pending.delete(id);
      }
    } catch (error) {
      log?.warn({ error: (error as Error).message }, 'issue answers failed');
    }
  }

  /** Writes what is left of one step; true once nothing is left of it. */
  async function answer(
    dir: string,
    { number, key }: { number: number; key: string },
    config: ReturnType<typeof readAnswerConfig>,
    forgeOnce: () => Promise<{ forge: Forge } | { why: string }>,
  ): Promise<boolean> {
    const events = await readIssueEvents(dir, number);
    const mine = events.filter((e) => 'key' in e && e.key === key);
    const due = mine.find((e): e is DueEvent => e.event === 'due');
    if (!due) return true;
    const step = due.step;
    const written = answerOf(step, config.labels, due.forge.kind);
    const held = step.step === 'asked' && !step.question ? (step.held ?? 'empty') : undefined;
    const parts: AnswerPart[] = [
      ...(written.comment || held ? (['comment'] as const) : []),
      ...(written.add.length > 0 || written.remove.length > 0 ? (['labels'] as const) : []),
      ...(written.close ? (['close'] as const) : []),
    ];
    const done = doneParts(mine);
    const left = () => parts.filter((p) => !done.has(p));
    const at = () => now().toISOString();
    const record = (event: IssueEvent & { event: Exclude<IssueEvent['event'], 'due'> }) =>
      appendIssueEvent(dir, number, event as Parameters<typeof appendIssueEvent>[2]);
    const notWritten = async (of: AnswerPart[], why: NotWrittenEvent['why']) => {
      if (of.length === 0) return;
      await record({ event: 'not-written', at: at(), key, parts: of, why });
      for (const part of of) done.add(part);
    };
    if (left().length === 0) return true;

    const failures = mine.filter((e) => e.event === 'write-failed');
    if (failures.length >= MAX_TRIES) {
      await notWritten(left(), 'gave-up');
      return true;
    }
    const last = failures.at(-1);
    if (last && now().getTime() - Date.parse(last.at) < retryMs) return false;
    if (!config.answer) {
      await notWritten(left(), 'off');
      return true;
    }
    const found = await forgeOnce();
    if ('why' in found) return false;
    const f = found.forge;
    if (f.kind !== due.forge.kind || f.host !== due.forge.host || f.project !== due.forge.project) {
      await notWritten(left(), 'other-forge');
      return true;
    }
    if (!f.token) {
      await notWritten(left(), 'no-token');
      return true;
    }
    // A request's landing: the forge closes it by `Closes #n` into the default branch; a poll
    // later, Symbiote reads whether it did (decision 1074).
    const settled =
      written.close !== 'after-request' || now().getTime() - Date.parse(due.at) >= settleMs;

    let part: AnswerPart | 'state' = 'state';
    try {
      const state = await f.issueState(number);
      if (state.locked) {
        await notWritten(left(), 'locked');
        return true;
      }
      // A landing writes to an issue its own `Closes #n` closed (decision 1073); nothing else does.
      if (state.state === 'closed' && step.step !== 'landed') {
        await notWritten(left(), 'closed');
        return true;
      }
      if (left().includes('comment')) {
        part = 'comment';
        const comments = events.filter((e) => e.event === 'answered').length;
        if (held) await notWritten(['comment'], held);
        else if (comments >= MAX_COMMENTS) await notWritten(['comment'], 'limit');
        else {
          const { url } = await f.commentOnIssue(number, written.comment ?? '');
          await record({ event: 'answered', at: at(), key, url });
          done.add('comment');
        }
      }
      if (left().includes('labels')) {
        part = 'labels';
        const remove = written.remove.filter((name) => state.labels.includes(name));
        if (written.add.length > 0 || remove.length > 0) {
          await f.labelIssue(number, { add: written.add, remove });
        }
        await record({
          event: 'labelled',
          at: at(),
          key,
          add: written.add.map((l) => l.name),
          remove,
        });
        done.add('labels');
      }
      if (left().includes('close')) {
        part = 'close';
        if (!settled) return false;
        if (state.state === 'closed') {
          await record({ event: 'closed', at: at(), key, by: 'forge' });
        } else {
          await f.closeIssue(number, 'completed');
          await record({ event: 'closed', at: at(), key, by: 'symbiote' });
        }
        done.add('close');
      }
      return left().length === 0;
    } catch (error) {
      const tried = failures.length + 1;
      await record({
        event: 'write-failed',
        at: at(),
        key,
        part,
        try: tried,
        status: error instanceof ForgeError ? error.status : 0,
        answer: (error instanceof ForgeError ? error.answer : (error as Error).message).slice(
          0,
          300,
        ),
      });
      log?.warn({ issue: number, key, part, try: tried }, 'issue answer failed');
      if (tried >= MAX_TRIES) {
        await notWritten(left(), 'gave-up');
        return true;
      }
      return false;
    }
  }

  return { tick };
}

/** The parts of a step written, or recorded as not written. */
function doneParts(events: IssueEvent[]): Set<AnswerPart> {
  const done = new Set<AnswerPart>();
  for (const e of events) {
    if (e.event === 'answered') done.add('comment');
    else if (e.event === 'labelled') done.add('labels');
    else if (e.event === 'closed') done.add('close');
    else if (e.event === 'not-written') for (const part of e.parts) done.add(part);
  }
  return done;
}

/** How long Settings keeps the token's account it read (decision 1077). */
export const ACCOUNT_MS = 10 * 60_000;

/** Settings' answering (HV11): read, and `hive.issues.answer` set. */
export interface HiveAnsweringService {
  read(): Promise<HiveAnsweringSetting>;
  set(answer: boolean): Promise<HiveAnsweringSetting>;
}

/**
 * The setting of the project at `root`, `origin` read in `repo`; the token's account read at most
 * once in 10 minutes for a forge (decision 1077).
 */
export function hiveAnsweringService(
  repo: GitRepo,
  root: string,
  env: Env,
  {
    make,
    now = () => new Date(),
  }: { make?: (url: string, env: Env) => Forge; now?: () => Date } = {},
): HiveAnsweringService {
  const accounts = new Map<string, { at: number; account: Promise<TokenAccount> }>();

  async function read(): Promise<HiveAnsweringSetting> {
    const { answer, labels } = readAnswerConfig(root);
    const names = {
      working: labels.working.name,
      question: labels.question.name,
      declined: labels.declined.name,
      stopped: labels.stopped.name,
    };
    const found = await originForge(repo, env, make);
    const forge = found.forge
      ? { kind: found.forge.kind, host: found.forge.host, project: found.forge.project }
      : undefined;
    const base = { answer, labels: names, ...(forge ? { forge } : {}) };
    if ('why' in found) return { ...base, why: found.why };
    const key = `${found.forge.kind}\n${found.forge.host}\n${found.forge.project}`;
    const at = now().getTime();
    let kept = accounts.get(key);
    if (!kept || at - kept.at >= ACCOUNT_MS) {
      kept = { at, account: found.forge.tokenAccount() };
      accounts.set(key, kept);
      // A failed read is not kept: the next look reads again.
      kept.account.catch(() => accounts.delete(key));
    }
    try {
      return { ...base, account: await kept.account };
    } catch (error) {
      return { ...base, why: `the token's account could not be read: ${(error as Error).message}` };
    }
  }

  return {
    read,
    async set(answer) {
      // On is the default: written as no key.
      await writeConfig(root, ['hive', 'issues', 'answer'], answer ? undefined : false);
      return read();
    },
  };
}
