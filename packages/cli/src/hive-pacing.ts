// Hive paces itself (HV5, decisions 796–801): one gate before every agent Hive starts. It reads
// Claude's windows through the view's usage copy and pauses every start of every Hive workspace
// while one is at or over `hive.usage.pauseAt` (90 %), until that window resets; usage unread for
// 15 min pauses as unknown. It also says what a workspace spent by Claude Code's own count — its
// writer's `cost-state` and its running reviews' `cost` — against `hive.budget`. The runner
// (`hive-runner.ts`, `paced`) and the workspaces' start record what it answers.
import { existsSync, readFileSync } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type {
  HivePacingSetting,
  HivePause,
  HiveReview,
  HiveSpend,
  ThreadEntry,
} from '@symbiote/core';
import { CONFIG_FILES } from './plugins.js';
import { PromptRefused } from './prompts.js';
import { writeConfig } from './config-write.js';
import { fileWindow } from './thread.js';
import type { ClaudeUsageRead } from './usage.js';

/** The threshold without the project's (the brief: 90 %). */
export const PAUSE_AT = 90;

/** How old a copy of Claude's numbers the gate takes before it reads again (798): the copy's age. */
export const USAGE_MAX_AGE_MS = 5 * 60_000;

/** How long the last live read stands when no read succeeds (799). */
export const USAGE_STALE_MS = 15 * 60_000;

/** The most a budget may be: a typo's guard, not a limit anyone reaches. */
const MAX_BUDGET = 1_000_000;

/** `hive.usage.pauseAt` (1–100, or `false`: no pause by usage) and `hive.budget` (dollars). */
export interface HivePacingConfig {
  pauseAt: number | false;
  budget: number | null;
}

const isPauseAt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100;
const isBudget = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_BUDGET;

/** The project's pacing (decisions 797, 801), read at each ask: Settings changes it at any time. */
export function readPacingConfig(root: string): HivePacingConfig {
  const fallback: HivePacingConfig = { pauseAt: PAUSE_AT, budget: null };
  const file = CONFIG_FILES.find((name) => existsSync(join(root, name)));
  if (!file) return fallback;
  let hive: unknown;
  try {
    hive = (JSON.parse(readFileSync(join(root, file), 'utf8')) as { hive?: unknown } | null)?.hive;
  } catch {
    return fallback;
  }
  if (!hive || typeof hive !== 'object') return fallback;
  const { usage, budget } = hive as { usage?: unknown; budget?: unknown };
  const pauseAt = usage && typeof usage === 'object' ? (usage as { pauseAt?: unknown }).pauseAt : 0;
  return {
    pauseAt: pauseAt === false ? false : isPauseAt(pauseAt) ? pauseAt : PAUSE_AT,
    budget: isBudget(budget) ? budget : null,
  };
}

/**
 * Sets `hive.usage.pauseAt` and `hive.budget` (Settings); the defaults (90, no budget) are written
 * as no key. A value that is neither is refused.
 */
export async function setPacing(
  root: string,
  change: { pauseAt?: number | false; budget?: number | null },
): Promise<void> {
  const { pauseAt, budget } = change;
  if (pauseAt !== undefined && pauseAt !== false && !isPauseAt(pauseAt)) {
    throw new PromptRefused(
      `Hive pauses at a whole percent from 1 to 100, or false, not ${JSON.stringify(pauseAt)}`,
      400,
    );
  }
  if (budget !== undefined && budget !== null && !isBudget(budget)) {
    throw new PromptRefused(
      `a budget is dollars above 0 and at most ${MAX_BUDGET}, or null, not ${JSON.stringify(budget)}`,
      400,
    );
  }
  if (pauseAt !== undefined) {
    await writeConfig(
      root,
      ['hive', 'usage', 'pauseAt'],
      pauseAt === PAUSE_AT ? undefined : pauseAt,
    );
  }
  if (budget !== undefined) await writeConfig(root, ['hive', 'budget'], budget ?? undefined);
}

/** When a window resets, in ms; one that does not say resets last of all. */
const resetOf = (resetsAt: string | undefined) =>
  resetsAt ? Date.parse(resetsAt) : Number.POSITIVE_INFINITY;

/**
 * The pause a read of Claude's numbers gives at `now` (decisions 797, 799), without its `since`:
 * none with usage off or every window under `pauseAt`; of the windows not reset and at or over it,
 * the one that resets last; `unknown` when the last live read is older than 15 min, or there is
 * none.
 */
export function usagePause(
  read: ClaudeUsageRead,
  pauseAt: number,
  now: number,
): Omit<HivePause, 'since'> | null {
  if (read.off) return null;
  const { subscription } = read;
  const age = subscription ? now - Date.parse(subscription.at) : Number.NaN;
  if (!subscription || !(age <= USAGE_STALE_MS)) {
    return { reason: 'unknown', pauseAt, why: read.failed ?? "Claude's usage has not been read" };
  }
  const over = subscription.windows.filter(
    (w) => w.usedPercent >= pauseAt && resetOf(w.resetsAt) > now,
  );
  const last = over.reduce<(typeof over)[number] | undefined>(
    (found, w) => (!found || resetOf(w.resetsAt) > resetOf(found.resetsAt) ? w : found),
    undefined,
  );
  if (!last) return null;
  return {
    reason: 'usage',
    minutes: last.minutes,
    ...(last.scope ? { scope: last.scope } : {}),
    percent: last.usedPercent,
    pauseAt,
    ...(last.resetsAt ? { until: last.resetsAt } : {}),
  };
}

/** What a pause's event says (HV5): the pause but its `since`, which is the event's time. */
export function pauseEvent(pause: HivePause): Record<string, unknown> {
  return Object.fromEntries(Object.entries(pause).filter(([key]) => key !== 'since'));
}

/** The same pause still: its reason, its window and its reset. */
const samePause = (a: Omit<HivePause, 'since'>, b: Omit<HivePause, 'since'>) =>
  a.reason === b.reason && a.until === b.until && a.minutes === b.minutes && a.scope === b.scope;

/** One gate before every agent Hive starts (decision 796), for a repository's `symbiote view`. */
export interface HivePacing {
  /** The pause now, read when the one held has ended; null: Hive may start an agent. */
  usage(): Promise<HivePause | null>;
  /** The pause held now, without a read (Settings says it). */
  current(): HivePause | null;
  /** The pauses Hive recorded (a new runner, Hive on again): the one that ends last is held. */
  prime(pauses: readonly HivePause[]): void;
  /** The project's threshold and budget, read now. */
  config(): HivePacingConfig;
  /** The writer's spend by Claude Code's own count, from the transcripts its thread names. */
  writer(thread: readonly ThreadEntry[]): Promise<number | undefined>;
}

/**
 * The gate of the project at `root` (decisions 796–799): Claude's numbers through `usage` (the
 * view's copy, read again once older than 5 min); a pause is held without a read until its window
 * resets, unless the threshold was raised past it; usage unknown is asked again at each look.
 */
export function hivePacing({
  root,
  usage,
  now = () => new Date(),
}: {
  root: string;
  usage: (maxAgeMs: number) => Promise<ClaudeUsageRead>;
  now?: () => Date;
}): HivePacing {
  let held: HivePause | null = null;
  const costs = transcriptCosts();
  /** The pause held, while it holds: its window not reset, the threshold not raised past it. */
  const holding = (pauseAt: number): HivePause | null =>
    held?.reason === 'usage' &&
    held.until !== undefined &&
    Date.parse(held.until) > now().getTime() &&
    (held.percent ?? 0) >= pauseAt
      ? held
      : null;
  return {
    async usage() {
      const { pauseAt } = readPacingConfig(root);
      if (pauseAt === false) {
        held = null;
        return null;
      }
      const holds = holding(pauseAt);
      if (holds) return holds;
      const read = await usage(USAGE_MAX_AGE_MS).catch((error: unknown): ClaudeUsageRead => ({
        subscription: null,
        failed: (error as Error).message,
      }));
      const found = usagePause(read, pauseAt, now().getTime());
      held = found
        ? { ...found, since: held && samePause(held, found) ? held.since : now().toISOString() }
        : null;
      return held;
    },
    current() {
      const { pauseAt } = readPacingConfig(root);
      if (pauseAt === false || !held) return null;
      return held.reason === 'unknown' ? held : holding(pauseAt);
    },
    prime(pauses) {
      const at = now().getTime();
      for (const pause of pauses) {
        if (pause.reason !== 'usage' || !pause.until || Date.parse(pause.until) <= at) continue;
        if (!held?.until || Date.parse(pause.until) > Date.parse(held.until)) held = pause;
      }
    },
    config: () => readPacingConfig(root),
    async writer(thread) {
      let total: number | undefined;
      for (const path of writerTranscripts(thread)) {
        const cost = await costs.of(path);
        if (cost !== undefined) total = (total ?? 0) + cost;
      }
      return total;
    },
  };
}

/**
 * Claude Code's own count of a session in its transcript (decision 801): the last `cost-state`
 * line's `totalCostUSD`, written at each turn's end and kept through resumes. None without one.
 */
export function costIn(text: string): number | undefined {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    // Most lines are not counts: parse only those that may be.
    if (!line.includes('"cost-state"')) continue;
    try {
      const value = JSON.parse(line) as { type?: unknown; totalCostUSD?: unknown };
      if (
        value.type === 'cost-state' &&
        typeof value.totalCostUSD === 'number' &&
        Number.isFinite(value.totalCostUSD) &&
        value.totalCostUSD >= 0
      ) {
        return value.totalCostUSD;
      }
    } catch {
      // A line cut by the window: an older one.
    }
  }
  return undefined;
}

/** How much of a transcript's end is read for its count: at rest it is the last line. */
const COST_END = 256 * 1024;

/**
 * Reads transcripts' counts, each again only when its size or time changed: its last 256 KB, the
 * whole file once when that end holds none (HV8's 9.5 MB transcript: the count was its last line).
 * An end without one keeps the count read before; a file gone keeps it too.
 */
export function transcriptCosts({ window = fileWindow }: { window?: typeof fileWindow } = {}): {
  of(path: string): Promise<number | undefined>;
} {
  const reads = new Map<string, { size: number; mtimeMs: number; cost: number | undefined }>();
  return {
    async of(path) {
      const before = reads.get(path);
      const file = await stat(path).catch(() => null);
      if (!file) return before?.cost;
      if (before && before.size === file.size && before.mtimeMs === file.mtimeMs)
        return before.cost;
      let cost = costIn((await window(path, COST_END)).text);
      if (cost === undefined && !before && file.size > COST_END) {
        cost = costIn((await window(path, file.size)).text);
      }
      cost ??= before?.cost;
      reads.set(path, { size: file.size, mtimeMs: file.mtimeMs, cost });
      return cost;
    },
  };
}

/**
 * The writer's transcripts, as its hooks named them in the workspace's thread: each absolute
 * `.jsonl` path once, in order (a thread is a file in the repository: it names nothing else).
 */
export function writerTranscripts(thread: readonly ThreadEntry[]): string[] {
  const paths: string[] = [];
  for (const entry of thread) {
    if (entry.kind !== 'start' && entry.kind !== 'prompt') continue;
    const path = entry.transcript;
    if (path && isAbsolute(path) && path.endsWith('.jsonl') && !paths.includes(path)) {
      paths.push(path);
    }
  }
  return paths;
}

/** Dollars to the cent: what a sum of floating counts shows and is compared at. */
const cents = (dollars: number) => Math.round(dollars * 100) / 100;

/** What a workspace spent (decision 801): its writer, if read, and its reviews with a cost. */
export function spendOf(
  record: { reviews: readonly Pick<HiveReview, 'cost'>[] },
  writer: number | undefined,
  budget: number | null,
): HiveSpend {
  const costs = record.reviews.flatMap((r) => (r.cost === undefined ? [] : [r.cost]));
  const reviews = cents(costs.reduce((sum, cost) => sum + cost, 0));
  return {
    ...(writer !== undefined ? { writer: cents(writer) } : {}),
    reviews,
    reviewed: costs.length,
    total: cents((writer ?? 0) + reviews),
    ...(budget !== null ? { budget } : {}),
  };
}

/** Settings' pacing (HV5): `GET`/`POST /api/hive/pacing`. */
export interface HivePacingService {
  read(): Promise<HivePacingSetting>;
  set(change: { pauseAt?: number | false; budget?: number | null }): Promise<HivePacingSetting>;
}

/**
 * The pacing of the project at `root` as Settings shows it: the threshold, the budget, whether
 * usage is read at all (`read`: false with `SYMBIOTE_USAGE=off`), and the gate's pause now.
 */
export function hivePacingService(
  root: string,
  pacing: Pick<HivePacing, 'current'>,
  { read: reading }: { read: boolean },
): HivePacingService {
  const read = (): Promise<HivePacingSetting> => {
    const pause = reading ? pacing.current() : null;
    return Promise.resolve({
      ...readPacingConfig(root),
      read: reading,
      ...(pause ? { pause } : {}),
    });
  };
  return {
    read,
    async set(change) {
      await setPacing(root, change);
      return read();
    },
  };
}

/** A total by Claude Code's count (decision 856) and its time. */
export interface TimedCost {
  at: string;
  total: number;
}

/** A line's `"timestamp"`, read without parsing the line: most lines are long messages. */
const TIMESTAMP = /"timestamp":"([^"]+)"/;

/**
 * A transcript's `cost-state` totals (V91, decision 856), each timed by the nearest line before it
 * with a `timestamp`: Claude Code writes the total at a turn's end, after the turn's last line
 * (`turn_duration` for 41 of 63 on this repository's Hive writers). One with no time before it is
 * left out. `before`: the time the text's first line follows, when it is read on from an offset.
 */
export function costPointsIn(text: string, before?: string): TimedCost[] {
  const points: TimedCost[] = [];
  let last = before;
  for (const line of text.split('\n')) {
    if (line.includes('"cost-state"')) {
      const total = costIn(line);
      if (total !== undefined && last !== undefined) points.push({ at: last, total });
      continue;
    }
    const at = TIMESTAMP.exec(line)?.[1];
    if (at && Number.isFinite(Date.parse(at))) last = at;
  }
  return points;
}

/**
 * Reads transcripts' timed totals (V91), each from where the last read ended: a transcript only
 * grows. Its whole lines are read; a line still being written waits for the next read.
 */
export function transcriptPoints(): { of(path: string): Promise<TimedCost[]> } {
  const reads = new Map<
    string,
    { read: number; mtimeMs: number; last?: string; points: TimedCost[] }
  >();
  return {
    async of(path) {
      const before = reads.get(path);
      const file = await stat(path).catch(() => null);
      if (!file) return before?.points ?? [];
      if (before && before.mtimeMs === file.mtimeMs && before.read <= file.size)
        return before.points;
      // Shorter than read: written anew; read it whole.
      const from = before && before.read <= file.size ? before.read : 0;
      const handle = await open(path, 'r');
      try {
        const buffer = Buffer.alloc(file.size - from);
        await handle.read(buffer, 0, buffer.length, from);
        const end = buffer.lastIndexOf(0x0a) + 1;
        const text = buffer.subarray(0, end).toString('utf8');
        const kept = from === 0 ? undefined : before;
        const points = [...(kept?.points ?? []), ...costPointsIn(text, kept?.last)];
        let last = kept?.last;
        for (const line of text.split('\n')) {
          const at = TIMESTAMP.exec(line)?.[1];
          if (at && !line.includes('"cost-state"') && Number.isFinite(Date.parse(at))) last = at;
        }
        reads.set(path, {
          read: from + end,
          mtimeMs: file.mtimeMs,
          ...(last ? { last } : {}),
          points,
        });
        return points;
      } finally {
        await handle.close();
      }
    },
  };
}
