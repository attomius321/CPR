import type { Graph } from '@cpr/core';

/** Two commits compared directly, by full SHA. */
export interface Pair {
  base: string;
  head: string;
}

/**
 * Analyzes a pair (`cpr view`: in a child process). Reports each phase as it starts; rejects with
 * the CLI's message when the analysis fails, and when `signal` stops it.
 */
export type RunDiff = (
  pair: Pair,
  run: { onPhase: (phase: string) => void; signal: AbortSignal },
) => Promise<Graph>;

export type DiffStatus =
  /** `queued`: analyses before this one. `elapsedMs`: since it was asked for. */
  | { status: 'queued'; queued: number; elapsedMs: number }
  /** `phase`: null until the analysis reports one. */
  | { status: 'running'; phase: string | null; elapsedMs: number }
  | { status: 'done'; graph: Graph }
  | { status: 'failed'; error: string };

type Entry =
  | { state: 'queued'; asked: number }
  | { state: 'running'; asked: number; phase: string | null; controller: AbortController }
  | { state: 'done'; graph: Graph }
  | { state: 'failed'; error: string };

export interface DiffsOptions {
  /** Graphs kept in memory, the least recently used dropped first. Default: 8. */
  keep?: number;
  now?: () => number;
}

export const pairKey = ({ base, head }: Pair): string => `${base}..${head}`;

/**
 * The diffs `cpr view` serves: analyzed one at a time in the order asked (an analysis takes up
 * to 90 s and most of the machine's memory), kept while the server runs.
 */
export class Diffs {
  /** In use order for done entries: a done entry moves to the end when used. */
  private readonly entries = new Map<string, Entry>();
  private readonly queue: Pair[] = [];
  /** The analysis running; a stopped one stays here until it has ended. */
  private current: Promise<unknown> | null = null;
  private readonly keep: number;
  private readonly now: () => number;

  constructor(
    private readonly run: RunDiff,
    { keep = 8, now = Date.now }: DiffsOptions = {},
  ) {
    this.keep = keep;
    this.now = now;
  }

  /** A diff analyzed elsewhere (`cpr view <base> [head]` before serving). */
  add(pair: Pair, graph: Graph): void {
    this.done(pairKey(pair), graph);
  }

  /** Starts analyzing a pair unless it is queued, running or done; a failed one runs again. */
  start(pair: Pair): void {
    const key = pairKey(pair);
    const entry = this.entries.get(key);
    if (entry && entry.state !== 'failed') return;
    this.entries.set(key, { state: 'queued', asked: this.now() });
    this.queue.push(pair);
    this.next();
  }

  /** Stops a queued or running analysis and forgets it; false when there is none. */
  stop(pair: Pair): boolean {
    const key = pairKey(pair);
    const entry = this.entries.get(key);
    if (entry?.state === 'running') entry.controller.abort();
    else if (entry?.state === 'queued') {
      this.queue.splice(
        this.queue.findIndex((p) => pairKey(p) === key),
        1,
      );
    } else return false;
    this.entries.delete(key);
    return true;
  }

  /** Stops every analysis queued or running (the server is stopping). */
  close(): void {
    for (const pair of [...this.queue]) this.stop(pair);
    for (const [key, entry] of this.entries) {
      if (entry.state === 'running') {
        entry.controller.abort();
        this.entries.delete(key);
      }
    }
  }

  status(pair: Pair): DiffStatus | undefined {
    const key = pairKey(pair);
    const entry = this.entries.get(key);
    switch (entry?.state) {
      case undefined:
        return undefined;
      case 'queued': {
        const ahead = this.queue.findIndex((p) => pairKey(p) === key);
        return {
          status: 'queued',
          queued: ahead + (this.current ? 1 : 0),
          elapsedMs: this.now() - entry.asked,
        };
      }
      case 'running':
        return { status: 'running', phase: entry.phase, elapsedMs: this.now() - entry.asked };
      case 'done':
        this.entries.delete(key);
        this.entries.set(key, entry);
        return { status: 'done', graph: entry.graph };
      case 'failed':
        return { status: 'failed', error: entry.error };
    }
  }

  private next(): void {
    if (this.current) return;
    const pair = this.queue.shift();
    if (!pair) return;
    const key = pairKey(pair);
    const queued = this.entries.get(key);
    const entry: Entry = {
      state: 'running',
      asked: queued?.state === 'queued' ? queued.asked : this.now(),
      phase: null,
      controller: new AbortController(),
    };
    this.entries.set(key, entry);
    // Only the entry this run made is updated: a stopped run's entry is gone, or replaced.
    const mine = () => this.entries.get(key) === entry;
    this.current = this.run(pair, {
      onPhase: (phase) => {
        if (mine()) entry.phase = phase;
      },
      signal: entry.controller.signal,
    })
      .then(
        (graph) => {
          if (mine()) this.done(key, graph);
        },
        (error: unknown) => {
          if (mine()) {
            this.entries.set(key, { state: 'failed', error: (error as Error).message });
          }
        },
      )
      .finally(() => {
        this.current = null;
        this.next();
      });
  }

  private done(key: string, graph: Graph): void {
    this.entries.delete(key);
    this.entries.set(key, { state: 'done', graph });
    const done = [...this.entries].filter(([, e]) => e.state === 'done');
    for (const [old] of done.slice(0, Math.max(0, done.length - this.keep))) {
      this.entries.delete(old);
    }
  }
}
