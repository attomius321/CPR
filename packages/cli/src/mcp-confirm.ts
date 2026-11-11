// The person's Confirm on Symbiote's MCP (decision 361): an ask held for them, answered, lapsed or
// gone; a batch's items done one by one and kept when one failed (MC3, decision 987); a lapsed ask
// kept for a late yes (decision 994); and Nucleus's calls recorded with their Confirms (NU2),
// numbered with the asks.
import type {
  ConfirmAnswer,
  ConfirmItem,
  McpAnswer,
  McpAsk,
  McpCaller,
  NucleusActivityLine,
  WithoutConfirm,
} from '@symbiote/core';
import { headOf } from './nucleus-activity.js';
import { MAX_COMMAND } from './tool-activity.js';
import type { Held, Lapsed, McpContext, McpOptions, Prepared } from './mcp-context.js';
import { ToolProblem, type Args } from './mcp-tools.js';

const callerKey = (c: McpCaller) =>
  c.via === 'nucleus' ? 'nucleus' : `mcp\u0000${c.client ?? ''}\u0000${c.folder ?? ''}`;

type Answer = 'yes' | 'no' | 'expired' | 'gone';

/** A batch's way to the person (MC3). */
type Batch = Extract<Prepared, { items: unknown }>;

/** What a batch's items came to: the call's answer per item, and whether one failed or could not. */
export interface BatchDone {
  results: Record<string, unknown>[];
  /** Something to read: an item failed, or could not be done. */
  keep: boolean;
  /** Nothing was done. */
  none: boolean;
}

/** An ask refused by the page's answer: its status and why. */
export class AnswerRefused extends Error {
  override name = 'AnswerRefused';
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

/** What a lapsed call tells its caller (MC3, decision 994). */
export const lapsedText = (words: string) =>
  `No answer from the person to: ${words}. Nothing was done yet: the ask stays on their Symbiote bar for 24 hours, and if they confirm it there, Symbiote does it then (overview says what became of it). Do not ask again unless they say so.`;

/** Asks held for the person, and Nucleus's calls recorded. */
export function mcpConfirm({
  options,
  now,
  askMs,
  keepMs,
  held,
  lapsed,
}: Pick<McpContext, 'now' | 'askMs' | 'keepMs' | 'held' | 'lapsed'> & {
  options: Pick<McpOptions, 'onAsks' | 'record'>;
}) {
  let asked = 0;
  let recorded = 0;
  const changed = () => options.onAsks?.();

  /** What makes an ask the same as another of its caller's: its tool, words and items. */
  const sameOf = (tool: string, prepared: Prepared, caller: McpCaller) =>
    JSON.stringify([
      callerKey(caller),
      tool,
      prepared.words,
      'items' in prepared ? prepared.items.map((i) => i.name) : [],
    ]);

  /** A lapsed ask's fate, for `overview`. */
  function fate(id: string, now_: Lapsed['now'], results?: Record<string, unknown>[]) {
    const known = lapsed.get(id);
    if (known) lapsed.set(id, { ...known, now: now_, ...(results ? { results } : {}) });
  }

  /** Lets a held ask go: answered, dropped or forgotten. */
  function drop(h: Held) {
    if (h.keep) clearTimeout(h.keep);
    held.delete(h.ask.id);
    changed();
  }

  /**
   * Holds `prepared`'s words (and a batch's items) for the person, for `caller`: their answer and
   * a batch's ticked items, and `done` to call once the call that asked is over. Unanswered by its
   * time it lapses, kept `keepMs` for a late yes made by `again`. Its caller's lapsed copy of the
   * same ask is replaced.
   */
  function ask(
    tool: string,
    prepared: Prepared,
    caller: McpCaller,
    signal: AbortSignal,
    { again, recording }: { again: () => Promise<Prepared>; recording: Recording | null },
  ) {
    const key = callerKey(caller);
    if ([...held.values()].some((h) => !h.ask.stage && callerKey(h.ask.by) === key)) {
      throw new ToolProblem(
        'An ask of yours waits for the person already: wait for their answer, then ask again',
      );
    }
    const same = sameOf(tool, prepared, caller);
    for (const h of [...held.values()]) {
      if (h.ask.stage !== 'lapsed' || h.same !== same) continue;
      h.recording?.answered(h.ask, 'replaced');
      lapsed.delete(h.ask.id);
      drop(h);
    }
    const at = now();
    const ask: McpAsk = {
      id: `a${++asked}-${at.getTime().toString(36)}`,
      tool,
      words: prepared.words,
      by: caller,
      at: at.toISOString(),
      until: new Date(at.getTime() + askMs).toISOString(),
      ...('items' in prepared
        ? {
            items: prepared.items.map((item, i) => ({
              id: `i${i + 1}`,
              name: item.name,
              words: item.words,
              ...(item.cant ? { cant: item.cant } : {}),
            })),
          }
        : {}),
    };
    let done = () => {};
    const finished = new Promise<void>((resolve) => (done = resolve));
    const answer = new Promise<{ answer: Answer; items?: readonly string[] }>((resolve) => {
      const timer = setTimeout(() => settle('expired'), askMs);
      const gone = () => settle('gone');
      function settle(answer: Answer, items?: readonly string[]) {
        if (entry.ask.stage) return;
        clearTimeout(timer);
        signal.removeEventListener('abort', gone);
        if (answer === 'expired') lapse(entry);
        else if (answer === 'yes' && 'items' in prepared) entry.ask.stage = 'doing';
        else held.delete(ask.id);
        changed();
        resolve({ answer, ...(items ? { items } : {}) });
      }
      const entry: Held = { ask, settle, finished, again, recording, same };
      if (signal.aborted) return settle('gone');
      signal.addEventListener('abort', gone);
      held.set(ask.id, entry);
      changed();
    });
    return { answer, done, ask };
  }

  /** Unanswered in time: kept, lapsed, until `keepMs` from now (decision 994). */
  function lapse(h: Held) {
    const at = now().getTime();
    h.ask.stage = 'lapsed';
    h.ask.kept = new Date(Date.parse(h.ask.until) + keepMs).toISOString();
    lapsed.set(h.ask.id, {
      words: h.ask.words,
      asked: h.ask.at,
      now: 'waiting',
      until: at + keepMs,
    });
    h.keep = setTimeout(() => {
      lapsed.delete(h.ask.id);
      drop(h);
    }, keepMs);
    h.keep.unref?.();
    for (const [id, l] of lapsed) if (l.until <= at) lapsed.delete(id);
  }

  /**
   * Does a batch's items in order (MC3, decision 987): the ticked ones (all without `ticked`), an
   * item that cannot be done never; each one's state on `h`'s row as it goes.
   */
  async function runBatch(
    h: Held | null,
    batch: Batch,
    ticked: readonly string[] | undefined,
  ): Promise<BatchDone> {
    const results: Record<string, unknown>[] = [];
    const rows = h?.ask.items;
    for (const [i, item] of batch.items.entries()) {
      const id = `i${i + 1}`;
      const row = rows?.[i];
      const set = (fields: Partial<NonNullable<typeof row>>) => {
        if (!row) return;
        Object.assign(row, fields);
        changed();
      };
      if (item.cant) {
        results.push({ branch: item.name, outcome: 'cant', error: item.cant });
        set({ outcome: 'cant' });
      } else if (ticked && !ticked.includes(id)) {
        results.push({ branch: item.name, outcome: 'declined' });
        set({ outcome: 'declined' });
      } else {
        set({ outcome: 'running' });
        try {
          const value = await item.act();
          results.push({ branch: item.name, outcome: batch.did, ...value });
          set({ outcome: 'done' });
        } catch (error) {
          const message = (error as Error).message;
          results.push({ branch: item.name, outcome: 'failed', error: message });
          set({ outcome: 'failed', error: message });
        }
      }
    }
    const keep = results.some((r) => r.outcome === 'failed' || r.outcome === 'cant');
    const none = !results.some((r) => r.outcome === batch.did);
    if (h) {
      if (keep) {
        h.ask.stage = 'done';
        changed();
      } else drop(h);
    }
    return { results, keep, none };
  }

  /** A batch's items as recorded once done (NU2). */
  const recordedItems = (results: Record<string, unknown>[], did: string): ConfirmItem[] =>
    results.map((r) => ({
      name: String(r.branch),
      outcome:
        r.outcome === did
          ? 'done'
          : (r.outcome as Exclude<ConfirmItem['outcome'], 'done' | undefined>),
      ...(typeof r.error === 'string' ? { error: r.error } : {}),
    }));

  /**
   * A late yes (decision 994): recorded, the call prepared again (checked again), then done; kept
   * with why when it failed or an item could not be done, for the person to close.
   */
  async function late(h: Held, ticked: readonly string[] | undefined): Promise<void> {
    h.recording?.answered(h.ask, 'late');
    if (h.keep) clearTimeout(h.keep);
    h.ask.stage = 'doing';
    changed();
    const failed = (message: string) => {
      h.ask.stage = 'done';
      h.ask.failed = message;
      h.recording?.done(h.ask, { error: message });
      fate(h.ask.id, 'failed');
      changed();
    };
    let prepared: Prepared;
    try {
      prepared = await h.again();
    } catch (error) {
      return failed((error as Error).message);
    }
    if ('items' in prepared) {
      // Its rows as checked now: the same items, in the same order (its arguments are the same).
      h.ask.items = prepared.items.map((item, i) => ({
        id: `i${i + 1}`,
        name: item.name,
        words: item.words,
        ...(item.cant ? { cant: item.cant } : {}),
      }));
      const out = await runBatch(h, prepared, ticked);
      h.recording?.done(h.ask, { items: recordedItems(out.results, prepared.did) });
      fate(h.ask.id, out.none ? 'failed' : 'done', out.results);
      return;
    }
    try {
      await prepared.act();
    } catch (error) {
      return failed((error as Error).message);
    }
    h.recording?.done(h.ask, {});
    fate(h.ask.id, 'done');
    drop(h);
  }

  /**
   * The person's answer from a page: to a waiting ask, Confirm (`items` ticked) or Decline; to a
   * lapsed one, a late yes or Dismiss; to a done one, Close. Resolves once what it asked is done,
   * or `answerMs` passed.
   */
  async function answer({ id, yes, items }: McpAnswer, answerMs: number): Promise<void> {
    const found = held.get(id);
    if (!found) throw new AnswerRefused(`no ask ${id}`, 404);
    const unknown = items?.find((item) => !found.ask.items?.some((row) => row.id === item));
    if (unknown) throw new AnswerRefused(`no item ${unknown}`, 400);
    let finished: Promise<void>;
    switch (found.ask.stage) {
      case 'done':
        return drop(found);
      case 'doing':
        throw new AnswerRefused(`${found.ask.words}: being done`, 409);
      case 'lapsed':
        if (!yes) {
          found.recording?.answered(found.ask, 'dismissed');
          fate(found.ask.id, 'dismissed');
          return drop(found);
        }
        finished = late(found, items);
        break;
      default:
        found.settle(yes ? 'yes' : 'no', items);
        finished = found.finished;
    }
    // Answered once it is done (30 s at most): the page reads what it changed then.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      finished,
      new Promise<void>((resolve) => (timer = setTimeout(resolve, answerMs))),
    ]);
    clearTimeout(timer);
  }

  /** Where Nucleus's calls are recorded (NU2): a call's start, its end, a Confirm's. */
  function recorder(name: string, args: Args, caller: McpCaller) {
    const record = options.record;
    if (!record || caller.via !== 'nucleus') return null;
    const started = now();
    const head = {
      session: 'symbiote',
      id: `m${++recorded}-${started.getTime().toString(36)}`,
      tool: name,
      source: 'symbiote' as const,
    };
    const put = (line: NucleusActivityLine) => {
      try {
        record(line);
      } catch {
        // A call is never failed by its record.
      }
    };
    const input = JSON.stringify(args);
    put({
      at: started.toISOString(),
      ...head,
      phase: 'start',
      ...(input !== '{}' ? { input: input.slice(0, MAX_COMMAND) } : {}),
    });
    /** A batch's items as asked (MC3). */
    const itemsOf = (ask: Pick<McpAsk, 'items'>): ConfirmItem[] | undefined =>
      ask.items?.map((i) => ({
        name: i.name,
        words: i.words,
        ...(i.cant ? { cant: i.cant } : {}),
      }));
    return {
      id: head.id,
      asked(ask: McpAsk) {
        const items = itemsOf(ask);
        put({
          at: ask.at,
          kind: 'confirm',
          ask: ask.id,
          tool: ask.tool,
          words: ask.words,
          call: head.id,
          stage: 'asked',
          until: ask.until,
          ...(items ? { items } : {}),
        });
      },
      /** A start that went without a Confirm (NU8, decision 785): its words and why. */
      skipped(tool: string, prepared: Prepared, why: WithoutConfirm) {
        const at = now();
        const id = `s${++asked}-${at.getTime().toString(36)}`;
        const items =
          'items' in prepared
            ? itemsOf({
                items: prepared.items.map((item, i) => ({ id: `i${i + 1}`, ...item })),
              })
            : undefined;
        put({
          at: at.toISOString(),
          kind: 'confirm',
          ask: id,
          tool,
          words: prepared.words,
          call: head.id,
          stage: 'skipped',
          why,
          ...(items ? { items } : {}),
        });
        return { id, tool, words: prepared.words };
      },
      answered(ask: McpAsk, answer: Answer | ConfirmAnswer) {
        const at = now();
        const words: ConfirmAnswer =
          answer === 'yes' ? 'confirmed' : answer === 'no' ? 'declined' : answer;
        put({
          at: at.toISOString(),
          kind: 'confirm',
          ask: ask.id,
          tool: ask.tool,
          words: ask.words,
          call: head.id,
          stage: 'ended',
          answer: words,
          ms: Math.max(0, at.getTime() - Date.parse(ask.at)),
        });
      },
      /** What a batch's items came to, or a late yes (MC3). */
      done(
        ask: Pick<McpAsk, 'id' | 'tool' | 'words'>,
        { items, error }: { items?: ConfirmItem[]; error?: string },
      ) {
        put({
          at: now().toISOString(),
          kind: 'confirm',
          ask: ask.id,
          tool: ask.tool,
          words: ask.words,
          call: head.id,
          stage: 'done',
          ...(items ? { items } : {}),
          ...(error ? { error } : {}),
        });
      },
      ended(done: { text: string; isError?: true } | null) {
        const at = now();
        put({
          at: at.toISOString(),
          ...head,
          phase: 'end',
          ms: Math.max(0, at.getTime() - started.getTime()),
          ...(done ? headOf(done.text) : {}),
          ...(done?.isError ? { failed: true as const } : {}),
          ...(done ? {} : { interrupted: true as const }),
        });
      },
    };
  }

  return { ask, runBatch, recordedItems, answer, recorder };
}

/** Where one call of Nucleus's is recorded (NU2). */
export type Recording = NonNullable<ReturnType<ReturnType<typeof mcpConfirm>['recorder']>>;
