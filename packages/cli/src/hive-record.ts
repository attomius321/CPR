// Hive's record of a workspace it drives (HV2, decision 652): `symbiote/hive/<branch>.json`, its
// step, written whole after each one, and `<branch>.jsonl`, its events, one JSON line each; beside
// the workspace records, the branch's slashes as folders. What Hive needs to resume at the step a
// stop, Hive off or a killed `symbiote view` left: the writer's session and git hold the rest.
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { HiveCheck, HiveStep, WorkspaceHive } from '@symbiote/core';
import { writeFileWhole } from './file-write.js';
import { sortKeys, type ReviewPlace } from './reviews.js';
import { symbioteFolder, workspacePath } from './workspace-record.js';

/** Rounds of the writer before Hive stops for the person (decision 651). */
export const HIVE_ROUNDS = 3;

/** Hive's messages to the writer, by their prompt's key. */
export type HiveMessageKey = 'hive.check' | 'hive.commit' | 'hive.resume';

/** A message Hive sends the writer: written here first, `sent` once its session took it. */
export interface HiveMessage {
  key: HiveMessageKey;
  text: string;
  at: string;
  sent?: true;
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
  /** The check running: its process group's leader, from when, on which commit. */
  check?: { pid: number; started: string; at: string };
  checks: HiveCheck[];
  /** The commit the last check passed on. */
  checked?: string;
  message?: HiveMessage;
  /** Why it stopped for the person; that no check was found. */
  note?: string;
}

/** Every Hive record's first key. */
export const HIVE_ABOUT =
  "Hive's record of a workspace it drives (HV2): Symbiote writes it after each step. Agents: do not edit it.";

const STEPS: readonly HiveStep[] = ['writing', 'checking', 'landing', 'stuck', 'landed'];
const MESSAGE_KEYS: readonly HiveMessageKey[] = ['hive.check', 'hive.commit', 'hive.resume'];

/** Where Hive's records are: `hive/` beside the workspace records. */
export const hiveDir = (where: ReviewPlace) => join(symbioteFolder(where), 'hive');

/** A Hive workspace's record. */
export const hivePath = (where: ReviewPlace, branch: string) =>
  workspacePath(hiveDir(where), branch);

/** A Hive workspace's events. */
export const hiveEventsPath = (where: ReviewPlace, branch: string) =>
  `${hivePath(where, branch).slice(0, -'.json'.length)}.jsonl`;

/** The lock by which one `symbiote view` drives a repository's Hive (decision 656). */
export const hiveLockPath = (where: ReviewPlace) => join(hiveDir(where), 'runner.lock');

const text = (x: unknown) => (typeof x === 'string' ? x : '');
const count = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x > 0 ? x : 0);

function checkOf(value: unknown): HiveCheck | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!count(v.round) || !text(v.at) || typeof v.ok !== 'boolean') return null;
  return {
    round: count(v.round),
    at: text(v.at),
    ok: v.ok,
    ms: typeof v.ms === 'number' && v.ms >= 0 ? v.ms : 0,
    ...(text(v.failed) ? { failed: text(v.failed) } : {}),
    ...(text(v.output) ? { output: text(v.output) } : {}),
  };
}

/** A record's fields Symbiote knows, or null when it is not one. */
export function parseHive(value: unknown): HiveFile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const step = STEPS.find((s) => s === v.step);
  if (!step || !text(v.branch) || !count(v.round) || !text(v.since)) return null;
  const running = v.check as Record<string, unknown> | undefined;
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
      ? { check: { pid: count(running.pid), started: text(running.started), at: text(running.at) } }
      : {}),
    checks: Array.isArray(v.checks)
      ? v.checks.map(checkOf).filter((c): c is HiveCheck => c !== null)
      : [],
    ...(text(v.checked) ? { checked: text(v.checked) } : {}),
    ...(key && message && text(message.text) && text(message.at)
      ? {
          message: {
            key,
            text: text(message.text),
            at: text(message.at),
            ...(message.sent === true ? { sent: true as const } : {}),
          },
        }
      : {}),
    ...(text(v.note) ? { note: text(v.note) } : {}),
  };
}

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

/** A record as a workspace's card reads it (HV2); `paused` while Hive is off. */
export function hiveSummary(record: HiveFile, on: boolean): WorkspaceHive {
  const check = record.checks.at(-1);
  const waits = record.step === 'writing' || record.step === 'checking';
  return {
    step: record.step,
    round: record.round,
    rounds: record.rounds,
    ...(check ? { check } : {}),
    ...(record.note ? { note: record.note } : {}),
    ...(!on && waits ? { paused: true as const } : {}),
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
  };
}
