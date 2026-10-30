// Codex's Nucleus thread as its activity (NU2, decision 606): Symbiote reads the thread's newest
// turns in full while it is active (`page-agent.ts`) and writes what it had not: the person's
// messages, each item's start when first seen and its end once done, the turn's end (its answer,
// time and tokens; interrupted; failed) and its compactions. Codex's items carry no time: an item
// seen while its turn runs is timed when Symbiote saw it; one first read in a finished turn (after
// a restart) is untimed, at its turn's start, as V48f reads them.
import type { NucleusActivityLine, NucleusCall, TurnTokens } from '@symbiote/core';
import type { CodexItem, CodexThread, CodexTurn } from './app-server.js';
import { fileWindow } from './thread.js';

const iso = (seconds: number | undefined, fallback: string) =>
  seconds === undefined ? fallback : new Date(seconds * 1000).toISOString();

/** Whether an item still runs: by its status, or (none) as its running turn's last item. */
const runs = (item: CodexItem, turn: CodexTurn, index: number, count: number) =>
  item.status === undefined
    ? turn.status === 'inProgress' && index === count - 1
    : item.status === 'inProgress';

/** An item's start and end lines, by its kind. */
function itemLines(
  item: CodexItem,
  head: Omit<NucleusCall, 'phase'>,
): { start: NucleusCall; end: NucleusCall } {
  const input =
    item.kind === 'command'
      ? item.command
      : item.kind === 'mcp'
        ? item.mcp?.args
        : item.kind === 'webSearch' && (item.web?.queries.length ?? 0) > 1
          ? item.web?.queries.join('\n')
          : undefined;
  const start: NucleusCall = { ...head, phase: 'start', ...(input ? { input } : {}) };
  const failed = item.failed ? { failed: true as const } : {};
  if (item.kind === 'mcp') {
    const { answer, clipped, ms } = item.mcp ?? {};
    return {
      start,
      end: {
        ...head,
        phase: 'end',
        ...failed,
        ...(ms !== undefined ? { ms } : {}),
        ...(answer ? { output: answer } : {}),
        ...(clipped ? { clipped } : {}),
      },
    };
  }
  if (item.kind === 'webSearch') {
    const pages = (item.web?.pages ?? []).map((url) => ({ url }));
    return {
      start,
      end: { ...head, phase: 'end', ...failed, ...(pages.length > 0 ? { pages } : {}) },
    };
  }
  return {
    start,
    end: {
      ...head,
      phase: 'end',
      ...failed,
      ...(item.ms !== undefined ? { ms: item.ms } : {}),
      ...(item.exit !== undefined ? { exit: item.exit } : {}),
      ...(item.output !== undefined ? { output: item.output } : {}),
      ...(item.clipped ? { clipped: true as const } : {}),
    },
  };
}

/**
 * The lines of `read` not in `seen` (which they are added to), oldest first: `at` is when Symbiote
 * reads it; `tokens` a finished turn's, by its ID (`rolloutTokens`).
 */
export function codexLines(
  read: CodexThread,
  seen: Set<string>,
  at: string,
  tokens: ReadonlyMap<string, TurnTokens>,
): NucleusActivityLine[] {
  const lines: NucleusActivityLine[] = [];
  const of = { conversation: read.id, agent: 'codex' as const };
  const once = (key: string) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  for (const turn of read.turns) {
    const begun = iso(turn.startedAt, at);
    const ended = iso(turn.completedAt, at);
    const live = turn.status === 'inProgress';
    // Seen while it ran: its items are timed when seen; else they are untimed, at its start.
    if (live) seen.add(`open:${turn.id}`);
    const timed = seen.has(`open:${turn.id}`);
    turn.prompts.forEach((text, i) => {
      if (once(`prompt:${turn.id}:${i}`)) {
        lines.push({ at: begun, ...of, turn: turn.id, kind: 'prompt', text });
      }
    });
    const items = turn.items ?? [];
    items.forEach((item, index) => {
      if (item.kind === 'reasoning') return;
      const head = {
        at: timed ? at : begun,
        session: read.id,
        ...of,
        id: item.id,
        tool: item.kind,
        ...(item.subject ? { subject: item.subject } : {}),
        ...(timed ? {} : { untimed: true as const }),
      };
      const { start, end } = itemLines(item, head);
      if (once(`start:${item.id}`)) lines.push(start);
      if (!runs(item, turn, index, items.length) && once(`end:${item.id}`)) lines.push(end);
    });
    (turn.compactions ?? []).forEach((_, i) => {
      if (once(`compact:${turn.id}:${i}`)) {
        lines.push({ at: ended, ...of, turn: turn.id, kind: 'compact', stage: 'after' });
      }
    });
    if (live || !once(`end:${turn.id}`)) continue;
    const head = { at: ended, ...of, turn: turn.id };
    if (turn.status === 'interrupted') lines.push({ ...head, kind: 'interrupted' });
    else if (turn.status === 'failed') {
      lines.push({ ...head, kind: 'error', error: turn.error ?? 'the turn failed' });
    } else if (turn.report) {
      const used = tokens.get(turn.id);
      lines.push({
        ...head,
        kind: 'report',
        text: turn.report,
        ...(turn.ms !== undefined ? { ms: turn.ms } : {}),
        ...(used ? { tokens: used } : {}),
      });
    }
  }
  return lines;
}

/** What the file already holds of `thread`'s lines, as `codexLines` keys them (after a restart). */
export function seenOf(lines: readonly NucleusActivityLine[], thread: string): Set<string> {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  const next = (key: string) => {
    const n = counts.get(key) ?? 0;
    counts.set(key, n + 1);
    return `${key}:${n}`;
  };
  for (const line of lines) {
    if (line.conversation !== thread) continue;
    if ('phase' in line) {
      seen.add(`${line.phase}:${line.id}`);
      continue;
    }
    const turn = line.turn;
    if (!turn) continue;
    if (line.kind === 'prompt') {
      seen.add(next(`prompt:${turn}`));
      seen.add(`open:${turn}`);
    } else if (line.kind === 'compact') seen.add(next(`compact:${turn}`));
    else if (['report', 'interrupted', 'error'].includes(line.kind)) seen.add(`end:${turn}`);
  }
  return seen;
}

/** How much of Codex's session file is read for tokens. */
const ROLLOUT_END = 4 * 1024 * 1024;

interface Totals {
  at: number;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * The finished turns' tokens from Codex's session file at `path` (its `token_count` events, read
 * field by field: the file is Codex's own, not its protocol): the running total at a turn's end
 * (a 2 s leeway) less the total before its start; input read from the cache apart. A turn with no
 * count in it has none.
 */
export async function rolloutTokens(
  path: string,
  turns: readonly CodexTurn[],
): Promise<Map<string, TurnTokens>> {
  const found = new Map<string, TurnTokens>();
  const done = turns.filter((t) => t.status !== 'inProgress' && t.startedAt !== undefined);
  if (done.length === 0) return found;
  const { text } = await fileWindow(path, ROLLOUT_END);
  const totals: Totals[] = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"token_count"')) continue;
    try {
      const v = JSON.parse(line) as {
        timestamp?: unknown;
        payload?: { type?: unknown; info?: { total_token_usage?: Record<string, unknown> } };
      };
      const total = v.payload?.info?.total_token_usage;
      const at = Date.parse(typeof v.timestamp === 'string' ? v.timestamp : '');
      if (v.payload?.type !== 'token_count' || !total || Number.isNaN(at)) continue;
      totals.push({
        at,
        input: num(total.input_tokens),
        cached: num(total.cached_input_tokens),
        output: num(total.output_tokens),
        reasoning: num(total.reasoning_output_tokens),
      });
    } catch {
      // Not a line Symbiote reads.
    }
  }
  for (const turn of done) {
    const from = (turn.startedAt ?? 0) * 1000;
    const to = (turn.completedAt ?? Infinity) * 1000 + 2000;
    const before = totals.findLast((t) => t.at < from);
    const after = totals.findLast((t) => t.at >= from && t.at <= to);
    if (!after) continue;
    const less = (field: keyof Totals) => after[field] - (before?.[field] ?? 0);
    found.set(turn.id, {
      input: less('input') - less('cached'),
      cached: less('cached'),
      output: less('output'),
      reasoning: less('reasoning'),
    });
  }
  return found;
}
