// Hive's record of a workspace it drives (HV2, decision 652): `symbiote/hive/<branch>.json`, its
// step, written whole after each one, and `<branch>.jsonl`, its events, one JSON line each; beside
// the workspace records, the branch's slashes as folders. What Hive needs to resume at the step a
// stop, Hive off or a killed `symbiote view` left: the writer's session and git hold the rest.
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type {
  HiveCheck,
  HiveCheckStep,
  HiveFinding,
  HiveLanding,
  HiveLive,
  HivePause,
  HivePush,
  HiveRequest,
  HiveReview,
  HiveStep,
  WorkspaceHive,
} from '@symbiote/core';
import { writeFileWhole } from './file-write.js';
import { sortKeys, type ReviewPlace } from './reviews.js';
import { symbioteFolder, workspacePath } from './workspace-record.js';

/** Rounds of the writer before Hive stops for the person (decision 651). */
export const HIVE_ROUNDS = 3;

/** Merges of the start branch into a workspace before Hive stops it (decisions 651, 690, 769). */
export const HIVE_MERGES = 2;

/** Hive's answers in place of the person's (a plan's OK, "no one answers") before it stops (773). */
export const HIVE_DECIDES = 3;

/** Hive's messages to the writer, by their prompt's key. */
export type HiveMessageKey =
  | 'hive.check'
  | 'hive.review'
  | 'hive.commit'
  | 'hive.resume'
  | 'hive.land'
  | 'hive.plan'
  | 'hive.decide';

/**
 * A message Hive sends the writer: written here first; `taken` once Claude Code took it (`reply`
 * answered), `sent` once its prompt is in the thread (decision 718; before it, `sent` was the
 * answer alone). `copy`: Claude Code took it into a copy of the session, whose hooks record nothing.
 */
export interface HiveMessage {
  key: HiveMessageKey;
  text: string;
  at: string;
  taken?: string;
  copy?: string;
  sent?: true;
  /** Sent with the writer's turn stopped: it waits on a question or a permission (HV4). */
  stop?: true;
}

/** A Hive workspace's state on disk. */
export interface HiveFile {
  branch: string;
  step: HiveStep;
  round: number;
  rounds: number;
  /**
   * When the step began. In `writing`, a turn counts as ended only once a prompt at least this
   * new reached the writer: before Hive's message arrives, the last report is the turn before.
   */
  since: string;
  /** When Hive took the workspace. */
  started: string;
  /** Hive off stopped its writer mid-turn, or its check (decision 655). */
  interrupted?: true;
  /**
   * The check running: its process group's leader, from when, on which commit; since decision
   * 693 its commands, the index of the one running and since when, those ended, and its log.
   */
  check?: {
    pid: number;
    started: string;
    at: string;
    commands?: string[];
    step?: number;
    since?: string;
    done?: { ok: boolean; ms: number }[];
    log?: string;
  };
  checks: HiveCheck[];
  /**
   * The commit the last check passed on: the one the running review is of (HV3), and the one
   * landing is asked for.
   */
  checked?: string;
  /**
   * The running review (HV3): its process group's leader now (the install, the reviewer or a
   * rerun), from when, on which commit. Its copies are in Symbiote's cache, by branch.
   */
  review?: { pid: number; started: string; at: string; log?: string };
  reviews: HiveReview[];
  message?: HiveMessage;
  /** Why it stopped for the person; that no check was found. */
  note?: string;
  /** Each landing Hive tried (HV4, decision 767), the last in flight while it has no outcome. */
  landings?: HiveLanding[];
  /** Merges of the start branch Hive asked the writer for after a landing failed (769). */
  merges?: number;
  /** The branch's last push to `origin` (768). */
  pushed?: HivePush;
  /**
   * Hive's answers in place of the person's: a plan's OK, "no one answers" (773); counted again
   * from the person's message (795).
   */
  decided?: number;
  /** Times Hive started a failed writer again (773). */
  restarted?: number;
  /** Its pull or merge request, when Hive lands by request (HV8). */
  request?: HiveRequest;
  /**
   * Hive holds its next start of an agent for usage (HV5, decision 800): a window at or over the
   * threshold until it resets, or usage unknown. Removed once the gate lets it start.
   */
  paused?: HivePause;
  /** Its writer was never started: the gate held it at the workspace's start (HV5). */
  unstarted?: true;
  /** Its writer's spend by Claude Code's own count, as Hive last read it (HV5, decision 801). */
  spent?: { writer: number; at: string };
}

/** Every Hive record's first key. */
export const HIVE_ABOUT =
  "Hive's record of a workspace it drives (HV2, HV3): Symbiote writes it after each step. Agents: do not edit it.";

const STEPS: readonly HiveStep[] = [
  'writing',
  'checking',
  'reviewing',
  'landing',
  'stuck',
  'landed',
  'answered',
];
const MESSAGE_KEYS: readonly HiveMessageKey[] = [
  'hive.check',
  'hive.review',
  'hive.commit',
  'hive.resume',
  'hive.land',
  'hive.plan',
  'hive.decide',
];
const VERDICTS: readonly HiveReview['verdict'][] = ['approved', 'changes', 'failed', 'unavailable'];

/** Where Hive's records are: `hive/` beside the workspace records. */
export const hiveDir = (where: ReviewPlace) => join(symbioteFolder(where), 'hive');

/** A Hive workspace's record. */
export const hivePath = (where: ReviewPlace, branch: string) =>
  workspacePath(hiveDir(where), branch);

/** A Hive workspace's events. */
export const hiveEventsPath = (where: ReviewPlace, branch: string) =>
  `${hivePath(where, branch).slice(0, -'.json'.length)}.jsonl`;

/**
 * Where the tests of a review's kept findings are kept for the writer (HV3, decision 679):
 * `hive/<branch>/r<round>/`, beside the record, their repo-relative paths below.
 */
export const hiveTestsDir = (where: ReviewPlace, branch: string, round: number) =>
  join(hivePath(where, branch).slice(0, -'.json'.length), `r${round}`);

/** The lock by which one `symbiote view` drives a repository's Hive (decision 656). */
export const hiveLockPath = (where: ReviewPlace) => join(hiveDir(where), 'runner.lock');

const text = (x: unknown) => (typeof x === 'string' ? x : '');
const count = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x > 0 ? x : 0);

const texts = (x: unknown) =>
  Array.isArray(x) ? x.filter((t): t is string => typeof t === 'string' && t !== '') : [];
const ms = (x: unknown) => (typeof x === 'number' && x >= 0 ? x : 0);

/** A command's end: how it went and how long it took. */
function endOf(value: unknown): { ok: boolean; ms: number } | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return typeof v.ok === 'boolean' ? { ok: v.ok, ms: ms(v.ms) } : null;
}

function stepOf(value: unknown): HiveCheckStep | null {
  const end = endOf(value);
  const command = text((value as Record<string, unknown> | null)?.command);
  return end && command ? { command, ...end } : null;
}

const ends = (x: unknown) =>
  Array.isArray(x) ? x.map(endOf).filter((e): e is { ok: boolean; ms: number } => e !== null) : [];

function checkOf(value: unknown): HiveCheck | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!count(v.round) || !text(v.at) || typeof v.ok !== 'boolean') return null;
  return {
    round: count(v.round),
    at: text(v.at),
    ok: v.ok,
    ms: ms(v.ms),
    ...(text(v.failed) ? { failed: text(v.failed) } : {}),
    ...(text(v.output) ? { output: text(v.output) } : {}),
    ...(text(v.started) ? { started: text(v.started) } : {}),
    ...(Array.isArray(v.commands) ? { commands: texts(v.commands) } : {}),
    ...(Array.isArray(v.steps)
      ? { steps: v.steps.map(stepOf).filter((s): s is HiveCheckStep => s !== null) }
      : {}),
    ...(text(v.log) ? { log: text(v.log) } : {}),
  };
}

/** The running check's fields of decision 693, when they are there. */
function runningCheck(v: Record<string, unknown>) {
  return {
    ...(Array.isArray(v.commands) ? { commands: texts(v.commands) } : {}),
    ...(typeof v.step === 'number' && Number.isInteger(v.step) && v.step >= 0
      ? { step: v.step }
      : {}),
    ...(text(v.since) ? { since: text(v.since) } : {}),
    ...(Array.isArray(v.done) ? { done: ends(v.done) } : {}),
    ...(text(v.log) ? { log: text(v.log) } : {}),
  };
}

function findingOf(value: unknown): HiveFinding | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!text(v.defect) || typeof v.kept !== 'boolean') return null;
  return {
    defect: text(v.defect),
    test: text(v.test),
    command: text(v.command),
    files: texts(v.files),
    kept: v.kept,
    ...(text(v.why) ? { why: text(v.why) } : {}),
    ...(typeof v.code === 'number' || v.code === null ? { code: v.code } : {}),
    ...(text(v.output) ? { output: text(v.output) } : {}),
  };
}

function reviewOf(value: unknown): HiveReview | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const verdict = VERDICTS.find((d) => d === v.verdict);
  if (!count(v.round) || !text(v.at) || !verdict) return null;
  return {
    round: count(v.round),
    at: text(v.at),
    verdict,
    ms: typeof v.ms === 'number' && v.ms >= 0 ? v.ms : 0,
    ...(typeof v.cost === 'number' && v.cost >= 0 ? { cost: v.cost } : {}),
    ...(text(v.summary) ? { summary: text(v.summary) } : {}),
    ...(text(v.ran) ? { ran: text(v.ran) } : {}),
    ...(text(v.error) ? { error: text(v.error) } : {}),
    ...(text(v.model) ? { model: text(v.model) } : {}),
    ...(text(v.effort) ? { effort: text(v.effort) } : {}),
    findings: Array.isArray(v.findings)
      ? v.findings.map(findingOf).filter((f): f is HiveFinding => f !== null)
      : [],
    ...(text(v.log) ? { log: text(v.log) } : {}),
  };
}

/** A record's fields Symbiote knows, or null when it is not one. */
const OUTCOMES: readonly NonNullable<HiveLanding['outcome']>[] = [
  'landed',
  'conflict',
  'check-failed',
  'cannot-fast-forward',
  'diverged',
  'failed',
  'refused',
  'closed',
];

/** A landing as the record keeps it (HV4); null when it is not one. */
function landingOf(value: unknown): HiveLanding | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!text(v.at) || !text(v.into) || !text(v.entry)) return null;
  const outcome = OUTCOMES.find((o) => o === v.outcome);
  const pushed = v.pushed as Record<string, unknown> | undefined;
  const optional = (
    key: 'state' | 'message' | 'tried' | 'ended' | 'failed' | 'output' | 'log' | 'merge',
  ) => (text(v[key]) ? { [key]: text(v[key]) } : {});
  return {
    round: count(v.round) || 1,
    at: text(v.at),
    into: text(v.into),
    entry: text(v.entry),
    queued: text(v.queued),
    ...(v.via === 'request' ? { via: 'request' as const } : {}),
    ...(optional('state') as Pick<HiveLanding, 'state'>),
    ...optional('message'),
    ...optional('tried'),
    ...optional('ended'),
    ...(outcome ? { outcome } : {}),
    ...(Array.isArray(v.files) ? { files: texts(v.files) } : {}),
    ...optional('failed'),
    ...optional('output'),
    ...optional('log'),
    ...optional('merge'),
    ...(pushed && typeof pushed.ok === 'boolean'
      ? {
          pushed: pushed.ok
            ? { ok: true as const, remote: text(pushed.remote) }
            : { ok: false as const, remote: text(pushed.remote), error: text(pushed.error) },
        }
      : {}),
  };
}

/** A pull or merge request as the record keeps it (HV8); null when it is not one. */
function requestOf(value: unknown): HiveRequest | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const forge = v.forge === 'github' || v.forge === 'gitlab' ? v.forge : null;
  const state = v.state === 'open' || v.state === 'merged' || v.state === 'closed' ? v.state : null;
  if (!forge || !state || !count(v.number) || !text(v.url) || !text(v.into)) return null;
  const review = v.review as Record<string, unknown> | undefined;
  const pulled = v.pulled as Record<string, unknown> | undefined;
  const optional = (key: 'read' | 'error' | 'merge') =>
    text(v[key]) ? { [key]: text(v[key]) } : {};
  return {
    forge,
    number: count(v.number),
    url: text(v.url),
    into: text(v.into),
    at: text(v.at),
    opened: text(v.opened),
    state,
    ...(v.conflict === true ? { conflict: true as const } : {}),
    ...optional('read'),
    ...optional('error'),
    ...optional('merge'),
    ...(review && text(review.at)
      ? {
          review: {
            at: text(review.at),
            posted: count(review.posted),
            ...(text(review.url) ? { url: text(review.url) } : {}),
            ...(text(review.error) ? { error: text(review.error) } : {}),
            ...(count(review.tries) ? { tries: count(review.tries) } : {}),
          },
        }
      : {}),
    ...(pulled && typeof pulled.ok === 'boolean'
      ? {
          pulled: {
            at: text(pulled.at),
            ok: pulled.ok,
            ...(text(pulled.error) ? { error: text(pulled.error) } : {}),
          },
        }
      : {}),
  };
}

/** A pause as the record keeps it (HV5); null when it is not one. */
export function pauseOf(value: unknown): HivePause | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const reason = v.reason === 'usage' || v.reason === 'unknown' ? v.reason : null;
  const number = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null);
  const pauseAt = number(v.pauseAt);
  if (!reason || pauseAt === null || !text(v.since)) return null;
  const minutes = number(v.minutes);
  const percent = number(v.percent);
  return {
    reason,
    ...(minutes ? { minutes } : {}),
    ...(text(v.scope) ? { scope: text(v.scope) } : {}),
    ...(percent !== null ? { percent } : {}),
    pauseAt,
    ...(text(v.until) ? { until: text(v.until) } : {}),
    ...(text(v.why) ? { why: text(v.why) } : {}),
    since: text(v.since),
  };
}

/** A push as the record keeps it (HV4); null when it is not one. */
function pushOf(value: unknown): HivePush | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!text(v.sha) || typeof v.ok !== 'boolean') return null;
  return {
    at: text(v.at),
    sha: text(v.sha),
    ok: v.ok,
    ...(text(v.error) ? { error: text(v.error) } : {}),
  };
}

export function parseHive(value: unknown): HiveFile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const step = STEPS.find((s) => s === v.step);
  if (!step || !text(v.branch) || !count(v.round) || !text(v.since)) return null;
  const running = v.check as Record<string, unknown> | undefined;
  const reviewing = v.review as Record<string, unknown> | undefined;
  const message = v.message as Record<string, unknown> | undefined;
  const key = MESSAGE_KEYS.find((k) => k === message?.key);
  return {
    branch: text(v.branch),
    step,
    round: count(v.round),
    rounds: count(v.rounds) || HIVE_ROUNDS,
    since: text(v.since),
    started: text(v.started) || text(v.since),
    ...(v.interrupted === true ? { interrupted: true as const } : {}),
    ...(running && count(running.pid)
      ? {
          check: {
            pid: count(running.pid),
            started: text(running.started),
            at: text(running.at),
            ...runningCheck(running),
          },
        }
      : {}),
    checks: Array.isArray(v.checks)
      ? v.checks.map(checkOf).filter((c): c is HiveCheck => c !== null)
      : [],
    ...(text(v.checked) ? { checked: text(v.checked) } : {}),
    ...(reviewing && count(reviewing.pid)
      ? {
          review: {
            pid: count(reviewing.pid),
            started: text(reviewing.started),
            at: text(reviewing.at),
            ...(text(reviewing.log) ? { log: text(reviewing.log) } : {}),
          },
        }
      : {}),
    reviews: Array.isArray(v.reviews)
      ? v.reviews.map(reviewOf).filter((r): r is HiveReview => r !== null)
      : [],
    ...(key && message && text(message.text) && text(message.at)
      ? {
          message: {
            key,
            text: text(message.text),
            at: text(message.at),
            ...(text(message.taken) ? { taken: text(message.taken) } : {}),
            ...(text(message.copy) ? { copy: text(message.copy) } : {}),
            ...(message.sent === true ? { sent: true as const } : {}),
            ...(message.stop === true ? { stop: true as const } : {}),
          },
        }
      : {}),
    ...(text(v.note) ? { note: text(v.note) } : {}),
    ...(Array.isArray(v.landings)
      ? { landings: v.landings.map(landingOf).filter((l): l is HiveLanding => l !== null) }
      : {}),
    ...(count(v.merges) ? { merges: count(v.merges) } : {}),
    ...(count(v.decided) ? { decided: count(v.decided) } : {}),
    ...(count(v.restarted) ? { restarted: count(v.restarted) } : {}),
    ...(pushOf(v.pushed) ? { pushed: pushOf(v.pushed) as HivePush } : {}),
    ...(requestOf(v.request) ? { request: requestOf(v.request) as HiveRequest } : {}),
    ...(pauseOf(v.paused) ? { paused: pauseOf(v.paused) as HivePause } : {}),
    ...(v.unstarted === true ? { unstarted: true as const } : {}),
    ...(spentOf(v.spent) ? { spent: spentOf(v.spent) as { writer: number; at: string } } : {}),
  };
}

/** The writer's spend as the record keeps it (HV5); null when it is not one. */
function spentOf(value: unknown): { writer: number; at: string } | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return typeof v.writer === 'number' && Number.isFinite(v.writer) && v.writer >= 0
    ? { writer: v.writer, at: text(v.at) }
    : null;
}

/**
 * A pause the card shows (HV5): the record's, while its step waits to start an agent (the writer's
 * turn or the running review).
 */
export const shownPause = (record: HiveFile): HivePause | undefined =>
  record.paused && (record.step === 'writing' || record.step === 'reviewing')
    ? record.paused
    : undefined;

/** A Hive workspace's record; null when there is none, or it is not one. */
export async function readHive(where: ReviewPlace, branch: string): Promise<HiveFile | null> {
  try {
    const record = parseHive(JSON.parse(await readFile(hivePath(where, branch), 'utf8')));
    return record?.branch === branch ? record : null;
  } catch {
    return null;
  }
}

/** Writes a Hive workspace's record whole, `about` first, its keys sorted. */
export async function writeHive(where: ReviewPlace, record: HiveFile): Promise<void> {
  const text = `${JSON.stringify(sortKeys({ ...record, about: HIVE_ABOUT }), null, 2)}\n`;
  await writeFileWhole(hivePath(where, record.branch), text);
}

/** Every Hive record in `where`; a file not its branch's is left out. */
export async function readHives(where: ReviewPlace): Promise<HiveFile[]> {
  const dir = hiveDir(where);
  const files = await readdir(dir, { recursive: true }).catch(() => [] as string[]);
  const list: HiveFile[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const record = await readFile(join(dir, file), 'utf8').then(
      (body) => parseHive(JSON.parse(body)),
      () => null,
    );
    if (record && relative(dir, hivePath(where, record.branch)) === file) list.push(record);
  }
  return list.sort((a, b) => a.started.localeCompare(b.started));
}

/** Appends one event to a Hive workspace's events: its time and kind first, never replaced. */
export async function hiveEvent(
  where: ReviewPlace,
  branch: string,
  at: string,
  kind: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  const path = hiveEventsPath(where, branch);
  const said = Object.entries(data).filter(([key]) => key !== 'at' && key !== 'kind');
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify({ at, kind, ...Object.fromEntries(said) })}\n`);
}

/**
 * A record as a workspace's card reads it (HV2, HV3); `paused` while Hive is off; what runs now
 * (`live`, decision 697) only while Hive is on.
 */
export function hiveSummary(record: HiveFile, on: boolean, live?: HiveLive): WorkspaceHive {
  const check = record.checks.at(-1);
  const review = record.reviews.at(-1);
  const waits = ['writing', 'checking', 'reviewing'].includes(record.step);
  return {
    step: record.step,
    round: record.round,
    rounds: record.rounds,
    ...(check ? { check } : {}),
    ...(review
      ? {
          review: {
            round: review.round,
            at: review.at,
            verdict: review.verdict,
            kept: review.findings.filter((f) => f.kept).length,
          },
        }
      : {}),
    ...(record.note ? { note: record.note } : {}),
    ...(on && live ? { live } : {}),
    ...(!on && waits ? { paused: true as const } : {}),
    ...(!on ? { off: true as const } : {}),
    ...(record.landings?.length ? { landing: record.landings.at(-1) } : {}),
    ...(record.pushed ? { pushed: record.pushed } : {}),
    ...(record.request ? { request: record.request } : {}),
    ...(shownPause(record) ? { pause: shownPause(record) } : {}),
  };
}

/** The record Hive starts a workspace with: its writer's first turn. */
export function firstRecord(branch: string, at: string): HiveFile {
  return {
    branch,
    step: 'writing',
    round: 1,
    rounds: HIVE_ROUNDS,
    since: at,
    started: at,
    checks: [],
    reviews: [],
  };
}
