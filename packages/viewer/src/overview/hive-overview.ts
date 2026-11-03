// Hive mode's Overview (V91, decisions 856–857): five figures, the stopped workspaces, those in
// flight, landed today, from the list's read and the day read. Pure: what Hive records.
import type {
  CostPoint,
  DayEvent,
  HiveDayRecord,
  HiveLanding,
  HiveSpend,
  HiveStep,
  WorkKind,
  WorkspaceDay,
  WorkspaceHive,
  WorkspaceSummary,
} from '@symbiote/core';
import { requestName } from '../workspaces/hive-rounds.js';
import { workspaceName } from '../workspaces/workspaces.js';
import { dayStart, isToday, median, perDay } from './day.js';

export interface HiveFigures {
  inFlight: {
    count: number;
    byStage: { write: number; check: number; review: number; land: number };
  };
  landed: { today: number; perDay: number[]; notPushed: number };
  defects: { today: number; fixed: number };
  timeToLand: { medianMs: number | null; count: number };
  spend: { today: number; perLanding: number | null; workspaces: number };
}

/** A workspace in flight: its summary, Hive's state of it, and what it spent (the day read's). */
export interface FlightRow {
  workspace: WorkspaceSummary;
  hive: WorkspaceHive;
  spend?: HiveSpend;
}

/** A workspace Hive stopped (decision 857). */
export interface StoppedRow {
  branch: string;
  title: string;
  note?: string;
  round: number;
  rounds: number;
}

/** A workspace landed, or a spike answered. */
export interface LandedRow {
  branch: string;
  title: string;
  kind?: WorkKind;
  at: string;
  rounds: number;
  defects: number;
  answered: boolean;
  merge?: string;
  /** Its target pushed: the queue's push, or the forge's merge (HV8). */
  pushed?: boolean;
  /** Landed through a request: "#12". */
  request?: string;
  spend: number;
}

/** Hive's steps in flight, and the stage each counts under. */
const FLIGHT: Partial<Record<HiveStep, keyof HiveFigures['inFlight']['byStage']>> = {
  writing: 'write',
  checking: 'check',
  reviewing: 'review',
  landing: 'land',
};

/** Hive drives it now (Hive on), at one of the four stages. */
const flying = (hive: WorkspaceHive | undefined): hive is WorkspaceHive =>
  hive !== undefined && !hive.off && FLIGHT[hive.step] !== undefined;

/** Hive's workspaces writing, checking, reviewing or landing, in the order they started. */
export function flightRows(
  list: readonly WorkspaceSummary[],
  day: WorkspaceDay | null,
): FlightRow[] {
  return list.flatMap((workspace) => {
    const { hive } = workspace;
    if (!flying(hive)) return [];
    const spend = day?.hive.find((r) => r.branch === workspace.branch)?.spend;
    return [{ workspace, hive, ...(spend ? { spend } : {}) }];
  });
}

/** The workspaces Hive stopped, the newest first. */
export function stoppedRows(list: readonly WorkspaceSummary[]): StoppedRow[] {
  return list
    .filter((w) => w.hive?.step === 'stuck' && !w.hive.off)
    .reverse()
    .map((workspace) => {
      const hive = workspace.hive as WorkspaceHive;
      return {
        branch: workspace.branch,
        title: workspaceName(workspace),
        ...(hive.note ? { note: hive.note } : {}),
        round: hive.round,
        rounds: hive.rounds,
      };
    });
}

/** Its last landing, when it landed. */
const landedBy = (record: HiveDayRecord): HiveLanding | undefined => {
  const last = record.landings?.at(-1);
  return last?.outcome === 'landed' && last.ended ? last : undefined;
};

/** When a spike was answered: its `answered` event. */
const answeredAt = (record: HiveDayRecord, events: readonly DayEvent[]) =>
  events.findLast((e) => e.source === 'hive' && e.branch === record.branch && e.kind === 'answered')
    ?.at;

/** What landed, or was answered, in the day read's week, the newest first. */
export function landedRows(
  day: WorkspaceDay | null,
  list: readonly WorkspaceSummary[],
): LandedRow[] {
  if (!day) return [];
  const rows = day.hive.flatMap((record): LandedRow[] => {
    const listed = list.find((w) => w.branch === record.branch);
    const base = {
      branch: record.branch,
      title: listed ? workspaceName(listed) : (record.title ?? record.branch),
      ...((listed?.kind ?? record.kind) ? { kind: listed?.kind ?? record.kind } : {}),
      defects: record.reviews.reduce((sum, r) => sum + r.kept, 0),
      spend: record.spend.total,
    };
    if (record.step === 'answered') {
      const at = answeredAt(record, day.events);
      return at ? [{ ...base, at, rounds: record.round, answered: true }] : [];
    }
    const landing = landedBy(record);
    if (!landing?.ended) return [];
    const request = landing.via === 'request' && record.request ? record.request : undefined;
    // By request, the forge merged it: on origin. By the queue, its push as the entry said.
    const pushed = request ? true : landing.pushed?.ok;
    return [
      {
        ...base,
        at: landing.ended,
        rounds: landing.round,
        answered: false,
        ...(landing.merge ? { merge: landing.merge } : {}),
        ...(pushed !== undefined ? { pushed } : {}),
        ...(request ? { request: requestName(request) } : {}),
      },
    ];
  });
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** A writer's spend since `from`: each transcript's last total, less its last before `from`. */
export function writerSpendSince(points: readonly CostPoint[], from: number): number {
  const transcripts = new Map<number, { before: number; last: number; since: boolean }>();
  for (const point of points) {
    const seen = transcripts.get(point.transcript) ?? { before: 0, last: 0, since: false };
    if (Date.parse(point.at) < from) seen.before = point.total;
    else seen.since = true;
    seen.last = point.total;
    transcripts.set(point.transcript, seen);
  }
  let total = 0;
  for (const { before, last, since } of transcripts.values()) {
    if (since) total += Math.max(0, last - before);
  }
  return total;
}

/** A workspace's spend since `from`: its reviews' costs then (their events), and its writer's. */
export function spendSince(
  record: HiveDayRecord,
  events: readonly DayEvent[],
  from: number,
): number {
  const reviews = events
    .filter(
      (e) =>
        e.source === 'hive' &&
        e.kind === 'review' &&
        e.branch === record.branch &&
        Date.parse(e.at) >= from,
    )
    .reduce((sum, e) => sum + (typeof e.data?.cost === 'number' ? e.data.cost : 0), 0);
  return reviews + writerSpendSince(record.writer ?? [], from);
}

/** Hive's five figures (decision 856). */
export function hiveFigures(
  list: readonly WorkspaceSummary[],
  day: WorkspaceDay | null,
  now: number,
): HiveFigures {
  const byStage = { write: 0, check: 0, review: 0, land: 0 };
  for (const { hive } of flightRows(list, day)) {
    const stage = FLIGHT[hive.step];
    if (stage) byStage[stage] += 1;
  }
  const rows = landedRows(day, list);
  const landings = rows.filter((row) => !row.answered);
  const landedToday = landings.filter((row) => isToday(row.at, now));
  const midnight = dayStart(now);
  const records = day?.hive ?? [];
  const started = (branch: string) => records.find((r) => r.branch === branch)?.started;
  const toLand = landedToday.flatMap((row) => {
    const from = started(row.branch);
    return from ? [Date.parse(row.at) - Date.parse(from)] : [];
  });
  // Defects proven today: kept findings of today's reviews; fixed, once their workspace landed.
  const reviewsToday = (day?.events ?? []).filter(
    (e) => e.source === 'hive' && e.kind === 'review' && isToday(e.at, now),
  );
  const kept = (e: DayEvent) => (typeof e.data?.kept === 'number' ? e.data.kept : 0);
  const landedBranches = new Set(landings.map((row) => row.branch));
  const spends = records
    .map((record) => spendSince(record, day?.events ?? [], midnight))
    .filter((spent) => spent > 0);
  const todays = rows.filter((row) => isToday(row.at, now));
  return {
    inFlight: { count: byStage.write + byStage.check + byStage.review + byStage.land, byStage },
    landed: {
      today: landedToday.length,
      perDay: perDay(
        landings.map((row) => row.at),
        now,
      ),
      notPushed: landedToday.filter((row) => row.pushed === false).length,
    },
    defects: {
      today: reviewsToday.reduce((sum, e) => sum + kept(e), 0),
      fixed: reviewsToday
        .filter((e) => landedBranches.has(e.branch))
        .reduce((sum, e) => sum + kept(e), 0),
    },
    timeToLand: { medianMs: median(toLand), count: toLand.length },
    spend: {
      today: spends.reduce((sum, spent) => sum + spent, 0),
      perLanding:
        todays.length > 0 ? todays.reduce((sum, row) => sum + row.spend, 0) / todays.length : null,
      workspaces: spends.length,
    },
  };
}
