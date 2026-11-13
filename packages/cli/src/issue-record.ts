// An issue's record (HV9b, decision 1007): `symbiote/issues/<number>.json`, the classifier's last
// decision on it, and each step an event in `<number>.jsonl` (`classified`, `failed`,
// `classified-again`; HV10's and HV11's after). Kept beside Hive's switch (`repositorySwitch`):
// the main checkout's `symbiote/`, which git ignores, or Symbiote's cache. A record of another
// origin is never read.
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileWhole } from './file-write.js';
import type { IssueForge, IssueRecord } from '@symbiote/core';

/** Every issue record's first key: where an agent that opens one learns what it is. */
export const ISSUE_RECORD_ABOUT =
  "Symbiote's record of a forge issue: its classifier's last decision (HV9). Agents: do not start work from it yourself.";

export type IssueEventName = 'classified' | 'classified-again' | 'failed';

/** A classification's line of `<number>.jsonl`. */
export interface ClassifiedEvent {
  event: IssueEventName;
  at: string;
  decision: IssueRecord['decision'];
  /** The snapshot's hash: which text was classified. */
  hash?: string;
  cost?: number;
}

/**
 * How a take ended (decisions 1040, 1059), written from HV10 on: `right` when the person started
 * it and it did not end badly; wrong when declined, its request closed without a merge or its
 * workspace stopped by the person. A stop by Hive's limits is no judgement: no line. `identity`
 * is the classifier's that took it, counted only under that one.
 */
export interface JudgedEvent {
  event: 'judged';
  at: string;
  identity: string;
  right: boolean;
  /** How it ended, in a word: `landed`, `declined`, `closed`, `stopped`. */
  why: string;
}

/** A line of `<number>.jsonl`. */
export type IssueEvent = ClassifiedEvent | JudgedEvent;

const fileOf = (folder: string, number: number, ext: 'json' | 'jsonl') =>
  join(folder, 'issues', `${number}.${ext}`);

const sameForge = (a: IssueForge | undefined, b: IssueForge) =>
  a?.kind === b.kind && a.host === b.host && a.project === b.project;

/** The record of issue `number` on `forge` in `folder` (a `symbiote/`); null when there is none. */
export async function readIssueRecord(
  folder: string,
  number: number,
  forge: IssueForge,
): Promise<IssueRecord | null> {
  const text = await readFile(fileOf(folder, number, 'json'), 'utf8').catch(() => null);
  if (text === null) return null;
  let record: IssueRecord;
  try {
    record = JSON.parse(text) as IssueRecord;
  } catch {
    return null;
  }
  return record.number === number && sameForge(record.forge, forge) ? record : null;
}

/**
 * Writes `record` whole, its `about` first, and its event: `failed`, else `classified-again`
 * when the issue had a record, else `classified`.
 */
export async function writeIssueRecord(
  folder: string,
  record: IssueRecord,
): Promise<ClassifiedEvent> {
  const before = await readIssueRecord(folder, record.number, record.forge);
  const event: ClassifiedEvent = {
    event: record.decision === 'failed' ? 'failed' : before ? 'classified-again' : 'classified',
    at: record.run?.at ?? new Date().toISOString(),
    decision: record.decision,
    ...(record.snapshot?.hash ? { hash: record.snapshot.hash } : {}),
    ...(record.run ? { cost: record.run.cost } : {}),
  };
  // `about` first, Symbiote's words whatever the record held.
  const written: IssueRecord = { about: ISSUE_RECORD_ABOUT, ...record };
  written.about = ISSUE_RECORD_ABOUT;
  await writeFileWhole(
    fileOf(folder, record.number, 'json'),
    `${JSON.stringify(written, null, 2)}\n`,
  );
  await mkdir(join(folder, 'issues'), { recursive: true });
  await appendFile(fileOf(folder, record.number, 'jsonl'), `${JSON.stringify(event)}\n`);
  return event;
}

/** Every record on `forge` in `folder`, by number; a file that is not one is skipped. */
export async function readIssueRecords(folder: string, forge: IssueForge): Promise<IssueRecord[]> {
  const names = await readdir(join(folder, 'issues')).catch(() => [] as string[]);
  const numbers = names
    .map((name) => /^([1-9]\d{0,9})\.json$/.exec(name)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  const records = await Promise.all(numbers.map((n) => readIssueRecord(folder, n, forge)));
  return records.filter((r): r is IssueRecord => r !== null);
}

/** The events of issue `number`, oldest first; a line that is not JSON is skipped. */
export async function readIssueEvents(folder: string, number: number): Promise<IssueEvent[]> {
  const text = await readFile(fileOf(folder, number, 'jsonl'), 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as IssueEvent];
      } catch {
        return [];
      }
    });
}
