// Hive's live progress (decisions 693–697): each check's and running review's log beside Hive's
// record, in the merge log's format (V46a), and what a workspace's card and Review tab read of the
// run in progress — the check's commands and the one running, the time of the last passing check
// of the same commands, the review's phase and the reviewer's last tool call from its log.
import { randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { HiveLive, HiveLogLine, HiveLogStep } from '@symbiote/core';
import { mergeLogs, type MergeLogs } from './merge-log.js';
import { hivePath, type HiveFile } from './hive-record.js';
import type { ReviewPlace } from './reviews.js';

/** A run's log id: when it started, and 6 random hex digits. */
export const hiveLogId = (at: string) =>
  `${at.replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;

const LOG_ID = /^[\w-]{1,80}$/;

/** Whether `id` can name a log (it becomes a file's name). */
export const isHiveLogId = (id: string) => LOG_ID.test(id);

/** Where a Hive workspace's logs are: `hive/<branch>/logs/`, beside its record and kept tests. */
export const hiveLogsDir = (where: ReviewPlace, branch: string) =>
  join(hivePath(where, branch).slice(0, -'.json'.length), 'logs');

/** A run's log file. */
export const hiveLogPath = (where: ReviewPlace, branch: string, id: string) =>
  join(hiveLogsDir(where, branch), `${id}.jsonl`);

/** A Hive workspace's logs, written and read as the merges' are. */
export const hiveLogs = (where: ReviewPlace, branch: string): MergeLogs<HiveLogStep> =>
  mergeLogs<HiveLogStep>(hiveLogsDir(where, branch));

const sameCommands = (a: readonly string[] | undefined, b: readonly string[]) =>
  a !== undefined && a.length === b.length && a.every((command, i) => command === b[i]);

/**
 * The time of the last passing check of `commands` in the repository's Hive records (decision
 * 697), and each command's; undefined when none ran them (a first check, other commands, records
 * from before decision 693): never a guess.
 */
export function expectedCheck(
  records: readonly HiveFile[],
  commands: readonly string[],
): { ms: number; steps: number[] } | undefined {
  let best: { started: string; ms: number; steps: number[] } | undefined;
  for (const record of records) {
    for (const check of record.checks) {
      if (!check.ok || !check.started || !sameCommands(check.commands, commands)) continue;
      const steps = check.steps ?? [];
      if (steps.length !== commands.length) continue;
      if (best && best.started >= check.started) continue;
      best = { started: check.started, ms: check.ms, steps: steps.map((s) => s.ms) };
    }
  }
  return best ? { ms: best.ms, steps: best.steps } : undefined;
}

/** What a review's log says it runs now: its last step, since when, the reviewer's last call. */
interface ReviewNow {
  /** The byte the next read starts from; a line not yet whole waits for it. */
  next: number;
  phase?: HiveLogStep;
  title?: string;
  since?: number;
  doing?: string;
}

/** The logs followed, by path: each read goes on from where the last one ended. */
const followed = new Map<string, ReviewNow>();
const FOLLOWED_MAX = 64;

/** A read's chunk: a log is followed a chunk at a time. */
const CHUNK = 256 * 1024;

/** One line's say on what the review runs now. */
function took(now: ReviewNow, line: HiveLogLine): void {
  if ('step' in line) {
    now.phase = line.step;
    now.title = line.title;
    now.since = line.at;
    delete now.doing;
  } else if ('agent' in line && 'tool' in line.agent) {
    now.doing = line.agent.input ? `${line.agent.tool}: ${line.agent.input}` : line.agent.tool;
  }
}

/**
 * What a running review's log says it runs now (decision 697), read from where the last read of
 * that log ended: the first read of a log takes it whole, a chunk at a time.
 */
export async function reviewNow(file: string): Promise<Omit<ReviewNow, 'next'>> {
  let now = followed.get(file);
  if (!now) {
    now = { next: 0 };
    if (followed.size >= FOLLOWED_MAX) {
      const oldest = followed.keys().next().value;
      if (oldest !== undefined) followed.delete(oldest);
    }
  }
  // The most recently asked last, so the oldest goes first.
  followed.delete(file);
  followed.set(file, now);
  let handle;
  try {
    handle = await open(file, 'r');
  } catch {
    return said(now);
  }
  try {
    const { size } = await handle.stat();
    if (size < now.next) Object.assign(now, { next: 0 });
    while (now.next < size) {
      const buffer = Buffer.alloc(Math.min(CHUNK, size - now.next));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, now.next);
      const end = buffer.subarray(0, bytesRead).lastIndexOf(0x0a);
      if (end < 0) {
        // One line longer than a chunk: skipped, the rest read on.
        if (bytesRead < CHUNK) break;
        now.next += bytesRead;
        continue;
      }
      for (const text of buffer.subarray(0, end).toString('utf8').split('\n')) {
        try {
          took(now, JSON.parse(text) as HiveLogLine);
        } catch {
          // A line no Symbiote wrote whole: left out.
        }
      }
      now.next += end + 1;
    }
  } finally {
    await handle.close();
  }
  return said(now);
}

const said = ({ phase, title, since, doing }: ReviewNow) => ({
  ...(phase ? { phase } : {}),
  ...(title ? { title } : {}),
  ...(since !== undefined ? { since } : {}),
  ...(doing ? { doing } : {}),
});

/**
 * What Hive runs now on a workspace (decision 697): its check or its review, from its record and,
 * for a review, its log; undefined when neither runs. `records` gives every Hive record of the
 * repository, read only for a check (its expected time).
 */
export async function hiveLive(
  where: ReviewPlace,
  record: HiveFile,
  records: () => Promise<readonly HiveFile[]>,
): Promise<HiveLive | undefined> {
  const check = record.check;
  if (record.step === 'checking' && check?.commands && check.step !== undefined && check.since) {
    const expected = expectedCheck(await records(), check.commands);
    return {
      kind: 'check',
      started: check.started,
      commands: check.commands,
      step: check.step,
      since: check.since,
      done: check.done ?? [],
      ...(check.log ? { log: check.log } : {}),
      ...(expected ? { expected } : {}),
    };
  }
  const review = record.review;
  if (record.step === 'reviewing' && review) {
    const now = review.log ? await reviewNow(hiveLogPath(where, record.branch, review.log)) : {};
    return {
      kind: 'review',
      started: review.started,
      ...(review.log ? { log: review.log } : {}),
      ...(now.phase ? { phase: now.phase } : {}),
      ...(now.title ? { title: now.title } : {}),
      ...(now.since !== undefined ? { since: new Date(now.since).toISOString() } : {}),
      ...(now.doing ? { doing: now.doing } : {}),
    };
  }
  return undefined;
}
