// The page's one stream (V94a, decisions 897–899): `GET /api/events`, server-sent events of the
// shell's state — the five reads the sidenav polled and the asks — the whole of it on each
// connect, then only the parts whose JSON changed. A part is read when a trigger says it may have
// changed: a write in this process (a record whole, a write request), a change held in memory (an
// ask), and later (V94c) a file another process wrote or a hook's ping; and every minute while a
// page listens, in case one was missed. With no page connected nothing is read.
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, relative, sep } from 'node:path';
import { onWritten } from './file-write.js';

/** The parts of the state, each a read the page made on its own (decision 898). */
export const EVENT_PARTS = [
  'workspaces',
  'reviews',
  'merges',
  'nucleus',
  'scribe',
  'asks',
] as const;
export type EventPart = (typeof EVENT_PARTS)[number];

/** How long the stream waits (milliseconds); tests make them short. */
export interface EventTiming {
  /** After a part's first trigger: more triggers of a burst arrive meanwhile. */
  first: number;
  /** Between two reads of one part (decision 899): a burst of hooks makes one read a second. */
  between: number;
  /** The safety read of every part, while a page is connected. */
  safety: number;
  /** An `alive` event, so a page tells a quiet stream from one gone silent (decision 897). */
  alive: number;
}

const TIMING: EventTiming = { first: 30, between: 1_000, safety: 60_000, alive: 25_000 };

export interface EventStreamOptions {
  /** Each part's read: the JSON its own route answers. A part without one is sent as null. */
  read: Partial<Record<EventPart, () => Promise<unknown>>>;
  /**
   * The folders whose files are records (`symbiote/`, or the cache's, and the merge queue's
   * folder): a write to one, by this process, is a trigger for the parts it holds.
   */
  roots?: () => Promise<string[]>;
  timing?: Partial<EventTiming>;
  /** A line for each read that sent a change, at debug (LG1). */
  log?: { debug(fields: Record<string, unknown>, message: string): void };
}

export interface EventStream {
  /** `GET /api/events`: the stream, until the page goes. */
  open(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** Something may have changed `parts`: they are read, and what changed is sent. */
  changed(parts: Iterable<EventPart>, why: string): void;
  /** A write request this server answered (below 400): the parts it may have changed. */
  wrote(pathname: string): void;
  /** How many pages listen. */
  readonly connected: number;
  /** Ends every stream, timer and listener: the server stops. */
  close(): void;
}

/**
 * The parts a record changes, by its path in the records' folder (POSIX or the platform's): a
 * review also changes what its workspace needs next, a workspace's record what its review counts
 * against. Temporary files and what Symbiote writes for itself change none.
 */
export function partsOfRecord(path: string): EventPart[] {
  const parts = path.split(/[\\/]/);
  const first = parts[0] ?? '';
  const name = parts.at(-1) ?? '';
  if (name.startsWith('.') || name.endsWith('.tmp')) return [];
  if (first === 'reviews') return ['reviews', 'workspaces'];
  if (first === 'workspaces') return ['workspaces', 'reviews'];
  if (first === 'threads' || first === 'activity') return ['workspaces'];
  if (first === 'hive' || first === 'hive.json') return ['workspaces'];
  if (first.startsWith('nucleus')) return ['nucleus'];
  if (first.startsWith('scribe')) return ['scribe'];
  if (first === 'merges.json') return ['merges', 'workspaces', 'reviews'];
  if (first === 'config.json') return ['merges', 'workspaces'];
  return [];
}

/**
 * The parts a write request may have changed (the server's own writes): what each page's action
 * reads again today. A start's draft, a terminal's keys and the pages' errors change none.
 */
export function partsOfWrite(pathname: string): EventPart[] {
  if (pathname.includes('/api/state/')) return ['reviews'];
  if (pathname === '/api/workspaces/draft') return [];
  if (pathname.startsWith('/api/workspaces')) return ['workspaces', 'reviews'];
  if (pathname.startsWith('/api/merges')) return ['merges', 'workspaces', 'reviews'];
  if (pathname === '/api/reviews') return ['reviews'];
  if (pathname.startsWith('/api/nucleus')) return ['nucleus', 'workspaces'];
  if (pathname.startsWith('/api/scribe')) return ['scribe'];
  if (pathname.startsWith('/api/mcp')) return ['asks', 'workspaces', 'reviews', 'merges'];
  if (pathname.startsWith('/api/hive')) return ['workspaces'];
  return [];
}

/** Whether `path` is inside `root`: its path there, else null. */
function inside(root: string, path: string): string | null {
  const rel = relative(root, path);
  return rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel) ? rel : null;
}

export function eventStream(options: EventStreamOptions): EventStream {
  const timing = { ...TIMING, ...options.timing };
  const reads = options.read;
  const known = EVENT_PARTS.filter((part) => reads[part]);
  const clients = new Map<string, ServerResponse>();
  /**
   * Pages whose first state is being read: they listen already, so a trigger meanwhile is kept and
   * read after it (an ask held as a page opened was lost until the safety read).
   */
  let opening = 0;
  const listening = () => clients.size + opening > 0;
  /** Each part's last JSON sent (or read for a page's state). */
  const last = new Map<EventPart, string>();
  /** Each part's reads in the order they started: an older read's answer never replaces a newer. */
  const started = new Map<EventPart, number>();
  const applied = new Map<EventPart, number>();
  /** The parts waiting to be read, and from when. */
  const pending = new Map<EventPart, number>();
  const lastRead = new Map<EventPart, number>();
  const reading = new Set<EventPart>();
  const why = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let roots: string[] = [];

  const loadRoots = () =>
    options
      .roots?.()
      .then((found) => {
        roots = found;
      })
      .catch(() => {});
  void loadRoots();

  const event = (name: string, data: string) => `event: ${name}\ndata: ${data}\n\n`;
  /** The parts as JSON, from the texts read: no value parsed and written again. */
  const partsJson = (texts: Iterable<[EventPart, string]>) =>
    `{"parts":{${[...texts].map(([part, text]) => `"${part}":${text}`).join(',')}}}`;

  function broadcast(text: string, except?: string): void {
    for (const [id, res] of clients) if (id !== except) res.write(text);
  }

  /**
   * Reads `parts` now: the ones whose JSON changed since it was last kept, as kept. A page's first
   * read is not `counted`: a trigger just after it is read at once, not a second later.
   */
  async function readParts(
    parts: readonly EventPart[],
    counted = true,
  ): Promise<Map<EventPart, string>> {
    const changed = new Map<EventPart, string>();
    await Promise.all(
      parts.map(async (part) => {
        const read = reads[part];
        if (!read) return;
        const seq = (started.get(part) ?? 0) + 1;
        started.set(part, seq);
        reading.add(part);
        if (counted) lastRead.set(part, Date.now());
        try {
          const text = JSON.stringify((await read()) ?? null);
          if (seq < (applied.get(part) ?? 0)) return;
          applied.set(part, seq);
          if (last.get(part) === text) return;
          last.set(part, text);
          changed.set(part, text);
        } catch {
          // A failed read sends nothing: what the page has stays, and the next read tries again.
        } finally {
          if (started.get(part) === seq) reading.delete(part);
        }
      }),
    );
    return changed;
  }

  /** When a waiting part may be read: its trigger's wait over, and `between` since its last read. */
  const dueAt = (part: EventPart) =>
    Math.max(pending.get(part) ?? 0, (lastRead.get(part) ?? -Infinity) + timing.between);

  function schedule(): void {
    clearTimeout(timer);
    timer = undefined;
    if (closed || !listening()) return;
    let next = Infinity;
    for (const part of pending.keys()) if (!reading.has(part)) next = Math.min(next, dueAt(part));
    if (next === Infinity) return;
    timer = setTimeout(run, Math.max(0, next - Date.now()));
  }

  function run(): void {
    timer = undefined;
    const now = Date.now();
    const due = [...pending.keys()].filter((part) => !reading.has(part) && dueAt(part) <= now);
    for (const part of due) pending.delete(part);
    const reasons = [...why];
    why.clear();
    const t0 = performance.now();
    void readParts(due).then((changed) => {
      if (changed.size > 0 && !closed) {
        broadcast(event('change', partsJson(changed)));
        options.log?.debug(
          {
            read: due,
            changed: [...changed.keys()],
            why: reasons,
            ms: Math.round(performance.now() - t0),
          },
          'events changed',
        );
      }
      schedule();
    });
    schedule();
  }

  function changed(parts: Iterable<EventPart>, reason: string): void {
    if (closed || !listening()) return;
    const at = Date.now() + timing.first;
    for (const part of parts) if (reads[part] && !pending.has(part)) pending.set(part, at);
    why.add(reason);
    schedule();
  }

  /** Writes of records by this process: whole files (`writeFileWhole`). */
  const unlisten = onWritten((path) => {
    for (const root of roots) {
      const rel = inside(root, path);
      if (rel === null) continue;
      const parts = partsOfRecord(rel);
      if (parts.length > 0) changed(parts, 'wrote');
      return;
    }
  });

  const alive = setInterval(() => {
    broadcast(event('alive', JSON.stringify({ at: Date.now() })));
  }, timing.alive);
  const safety = setInterval(() => {
    if (!listening()) return;
    void loadRoots();
    changed(known, 'safety');
  }, timing.safety);

  return {
    async open(req, res) {
      const id = randomBytes(8).toString('hex');
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(`retry: 1000\n\n${event('id', JSON.stringify({ id }))}`);
      let gone = false;
      req.on('close', () => {
        gone = true;
        clients.delete(id);
        if (!listening()) {
          pending.clear();
          schedule();
        }
      });
      if (closed) return void res.end();
      opening += 1;
      // Read anew for this page; a change found here is the other pages' news too.
      const fresh = await readParts(known, false).finally(() => (opening -= 1));
      if (fresh.size > 0) broadcast(event('change', partsJson(fresh)), id);
      if (gone || closed) {
        if (!listening()) pending.clear();
        return schedule();
      }
      res.write(
        event(
          'state',
          partsJson(
            EVENT_PARTS.map((part) => [part, last.get(part) ?? 'null'] as [EventPart, string]),
          ),
        ),
      );
      clients.set(id, res);
      // What was triggered while it was read is read now, for this page too.
      schedule();
    },
    changed,
    wrote(pathname) {
      const parts = partsOfWrite(pathname);
      if (parts.length > 0) changed(parts, `wrote ${pathname}`);
    },
    get connected() {
      return clients.size;
    },
    close() {
      closed = true;
      clearTimeout(timer);
      clearInterval(alive);
      clearInterval(safety);
      unlisten();
      for (const res of clients.values()) res.end();
      clients.clear();
      pending.clear();
    },
  };
}
