import type {
  Commit,
  HistoryPage,
  HistoryRow,
  HistoryScope,
  HistoryShape,
  HistoryState,
} from '@symbiote/core';

/** Where histories come from: git (`streamHistory` and the rest), or a fake in tests. */
export interface HistorySource {
  state(): Promise<HistoryState>;
  stream(scope: HistoryScope, onRows: (rows: HistoryRow[]) => void): Promise<void>;
  details(shas: readonly string[]): Promise<Commit[]>;
  /** The default branch and its tips (V10c), read once per listing; absent: none. */
  defaultBranch?(): Promise<{ name: string; tips: string[] } | null>;
  /** The commits of a scope whose message or author holds `query` (V66f). */
  find?(scope: HistoryScope, query: string): Promise<string[]>;
}

export interface HistoriesOptions {
  /** Called when a listing is done: how many rows, and how long git took. */
  onListed?: (scope: HistoryScope, rows: number, ms: number) => void;
}

/**
 * The commits page's histories (`symbiote view`): per scope, the order of every row, listed once by
 * git and kept until HEAD or a branch moves. Rows' details are read by SHA when asked for, so
 * the viewer never loads what it does not show (V10: CPython's 150,182 rows are 30.5 MB with
 * their details, 1.3 MB as a shape).
 */
export class Histories {
  private readonly listings = new Map<HistoryScope, Listing>();

  constructor(
    private readonly source: HistorySource,
    private readonly options: HistoriesOptions = {},
  ) {}

  /**
   * Rows `from` to `to` (excluded) with their details, once git has listed them. Without a
   * version: of the history as it is now, listed anew if HEAD or a branch moved. With one: of
   * that version, or null when it is stale.
   */
  async page(
    scope: HistoryScope,
    from: number,
    to: number,
    version?: string,
  ): Promise<HistoryPage | null> {
    const listing = version === undefined ? await this.current(scope) : this.of(scope, version);
    if (!listing) return null;
    await listing.listed(to);
    const shas = listing.shas.slice(from, to);
    const { state } = listing;
    return {
      version: state.version,
      branch: state.branch,
      head: state.head,
      from,
      commits: await this.source.details(shas),
      listed: listing.shas.length,
      done: listing.done,
    };
  }

  /**
   * The rows of `shas` in a listing, once it is done (tips sit deep): null for a SHA it does not
   * list; null for all when `version` is stale.
   */
  async tips(
    scope: HistoryScope,
    version: string,
    shas: readonly string[],
  ): Promise<(number | null)[] | null> {
    const listing = this.of(scope, version);
    if (!listing) return null;
    const rows = await listing.rows();
    return shas.map((sha) => rows.get(sha) ?? null);
  }

  /**
   * The rows a search finds (V66f, `GET /api/git/find`), top first: commits whose message or
   * author holds `query`, and those whose SHA starts with it; null when `version` is stale.
   */
  async find(
    scope: HistoryScope,
    version: string,
    query: string,
  ): Promise<{ rows: number[] } | null> {
    const listing = this.of(scope, version);
    if (!listing) return null;
    const words = query.trim().toLowerCase();
    if (words === '') return { rows: [] };
    const [rowOf, found] = await Promise.all([
      listing.rows(),
      this.source.find?.(scope, words) ?? Promise.resolve([]),
    ]);
    const rows = new Set(found.flatMap((sha) => rowOf.get(sha) ?? []));
    if (/^[0-9a-f]{4,64}$/.test(words)) {
      listing.shas.forEach((sha, row) => sha.startsWith(words) && rows.add(row));
    }
    return { rows: [...rows].sort((a, b) => a - b) };
  }

  /** Every row's parents as row numbers, once listed; null when `version` is stale. */
  async shape(scope: HistoryScope, version: string): Promise<HistoryShape | null> {
    const listing = this.of(scope, version);
    return listing
      ? listing.shape(() => this.source.defaultBranch?.() ?? Promise.resolve(null))
      : null;
  }

  private async current(scope: HistoryScope): Promise<Listing> {
    const state = await this.source.state();
    const kept = this.listings.get(scope);
    if (kept && kept.state.version === state.version && !kept.failed) return kept;
    const listing = new Listing(state, (onRows) => this.source.stream(scope, onRows), {
      onDone: (rows, ms) => this.options.onListed?.(scope, rows, ms),
    });
    this.listings.set(scope, listing);
    return listing;
  }

  private of(scope: HistoryScope, version: string): Listing | undefined {
    const listing = this.listings.get(scope);
    return listing?.state.version === version ? listing : undefined;
  }
}

/** One history as git lists it: rows arrive in order, and requests wait for theirs. */
class Listing {
  readonly shas: string[] = [];
  private readonly parents: string[][] = [];
  done = false;
  failed = false;
  private error: unknown;
  private waiting: { rows: number; resolve: () => void }[] = [];
  private readonly finished: Promise<void>;
  private shaped: Promise<HistoryShape> | undefined;
  private rowOf: Map<string, number> | undefined;

  constructor(
    readonly state: HistoryState,
    stream: (onRows: (rows: HistoryRow[]) => void) => Promise<void>,
    { onDone }: { onDone: (rows: number, ms: number) => void },
  ) {
    const started = performance.now();
    this.finished = stream((rows) => {
      for (const row of rows) {
        this.shas.push(row.sha);
        this.parents.push(row.parents);
      }
      this.wake();
    }).then(
      () => {
        this.done = true;
        this.wake();
        onDone(this.shas.length, performance.now() - started);
      },
      (error: unknown) => {
        this.failed = true;
        this.error = error;
        this.wake();
      },
    );
  }

  /** Resolves once `rows` rows are listed, or all of them are; rejects if git failed. */
  async listed(rows: number): Promise<void> {
    if (this.shas.length < rows && !this.done && !this.failed) {
      await new Promise<void>((resolve) => this.waiting.push({ rows, resolve }));
    }
    if (this.failed) throw this.error;
  }

  /** Each SHA's row, once listed. */
  async rows(): Promise<Map<string, number>> {
    await this.finished;
    if (this.failed) throw this.error;
    this.rowOf ??= new Map(this.shas.map((sha, i) => [sha, i]));
    return this.rowOf;
  }

  /** The shape, made once; `defaultBranch` is read then, with the listing done. */
  shape(
    defaultBranch: () => Promise<{ name: string; tips: string[] } | null>,
  ): Promise<HistoryShape> {
    // A failure is not kept: the next request tries again.
    this.shaped ??= this.makeShape(defaultBranch).catch((error: unknown) => {
      this.shaped = undefined;
      throw error;
    });
    return this.shaped;
  }

  private async makeShape(
    defaultBranch: () => Promise<{ name: string; tips: string[] } | null>,
  ): Promise<HistoryShape> {
    // Read while git may still be listing.
    const [row, main] = await Promise.all([this.rows(), defaultBranch()]);
    const { head, version } = this.state;
    const rows = (main?.tips ?? []).flatMap((tip) => row.get(tip) ?? []);
    return {
      version,
      rows: this.shas.length,
      head: head === null ? null : (row.get(head) ?? null),
      // A parent outside the history (a shallow clone's edge) is -1.
      parents: this.parents.map((parents) => parents.map((p) => row.get(p) ?? -1)),
      ...(main && rows.length > 0 ? { defaultBranch: { name: main.name, rows } } : {}),
    };
  }

  private wake(): void {
    const ready = (w: { rows: number }) => this.done || this.failed || this.shas.length >= w.rows;
    for (const w of this.waiting.filter(ready)) w.resolve();
    this.waiting = this.waiting.filter((w) => !ready(w));
  }
}

/** Above this, a listing is slow enough to say how to speed it up. */
const SLOW_LISTING_MS = 500;

/**
 * The hint `symbiote view` prints when git took long to list a history because the repository has
 * no commit-graph file (then git orders every commit before the first row: CPython 0.77 s, 6 ms
 * with the file). Symbiote does not write the file itself: that would change the user's repository.
 */
export function slowListingHint(rows: number, ms: number, commitGraph: boolean): string | null {
  if (ms < SLOW_LISTING_MS || commitGraph) return null;
  return (
    `hint: listing ${rows.toLocaleString('en-US')} commits took ${(ms / 1000).toFixed(1)} s; ` +
    '`git commit-graph write --reachable` (or `git maintenance start`) lets git list them at once\n'
  );
}
