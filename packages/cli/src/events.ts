// The page's one stream (V94a, decisions 897–899): `GET /api/events`, server-sent events of the
// shell's state — the five reads the sidenav polled and the asks — the whole of it on each
// connect, then only the parts whose JSON changed. A part is read when a trigger says it may have
// changed: a write in this process (a record whole, a write request), a change held in memory (an
// ask), and later (V94c) a file another process wrote or a hook's ping; and every minute while a
// page listens, in case one was missed. With no page connected nothing is read.
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import type { PageAgentState, WorkspaceList } from '@symbiote/core';
import { watchTree, type Watched } from './events-watch.js';
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
  /**
   * Between two reads of one part (decision 899): a burst of hooks makes a read every 250 ms. A
   * second made a change wait up to a second behind a read for another reason (V94c's e2e).
   */
  between: number;
  /** The safety read of every part, while a page is connected. */
  safety: number;
  /** An `alive` event, so a page tells a quiet stream from one gone silent (decision 897). */
  alive: number;
  /** Claude Code's list read while an agent is live and a page listens (decision 906). */
  live: number;
  /** After a hook's write to a thread, the list read again: it follows the hook by 0.1–0.3 s. */
  again: number;
}

const TIMING: EventTiming = {
  first: 30,
  between: 250,
  safety: 60_000,
  alive: 25_000,
  live: 5_000,
  again: 500,
};

/** The records' folders watched in the records' folder (decision 904); its own files too. */
const RECORD_FOLDERS = new Set(['reviews', 'workspaces', 'threads', 'activity', 'hive']);

export interface EventStreamOptions {
  /** Each part's read: the JSON its own route answers. A part without one is sent as null. */
  read: Partial<Record<EventPart, () => Promise<unknown>>>;
  /**
   * The folders whose files are records (`symbiote/`, or the cache's, and the merge queue's
   * folder): a write to one, by this process, is a trigger for the parts it holds.
   */
  roots?: () => Promise<string[]>;
  timing?: Partial<EventTiming>;
  /**
   * The terminals whose output a page may listen to on its stream (V94b, decision 903): one
   * connection per browser, not one per terminal. `listen` gives what it kept first, as
   * `/api/terminals/<id>` does.
   */
  terminals?: {
    listen(
      id: string,
      listener: { out(data: string): void; exit(code: number): void },
    ): (() => void) | undefined;
  };
  /** Git's common folder (V94c): its `refs/heads/`, `refs/remotes/` and `packed-refs` watched. */
  git?: string;
  /**
   * Claude Code's list read anew (`claude agents --json --all`, decision 99), every `live` while
   * an agent is live: the list can stay busy minutes after a Stop hook (the spike, 4 of 11), so
   * the hooks alone would miss its change (decision 906). A change reads the parts it shows.
   */
  sessions?: () => Promise<unknown>;
  /**
   * Codex's app server, heard while a Codex agent is live (V94c): each thread's status change, on
   * a connection that started no thread (V27a). Null when it does not answer: then its parts are
   * read every `live` instead.
   */
  codex?: (onChange: () => void) => Promise<{ stop(): void; closed: Promise<void> } | null>;
  /** A line for each read that sent a change, at debug (LG1). */
  log?: { debug(fields: Record<string, unknown>, message: string): void };
}

export interface EventStream {
  /** `GET /api/events`: the stream, until the page goes. */
  open(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** Something may have changed `parts`: they are read, and what changed is sent. */
  changed(parts: Iterable<EventPart>, why: string): void;
  /**
   * Sends a terminal's output on stream `stream` (`POST /api/events/listen`), or stops (`stop`)
   * once no tab of that browser shows it: `listening`, what it kept, then `out` and `exit`.
   */
  listen(stream: string, terminal: string, stop?: boolean): 'ok' | 'no-stream' | 'no-terminal';
  /** A write request this server answered (below 400): the parts it may have changed. */
  wrote(pathname: string): void;
  /**
   * A hook wrote (`POST /api/events/ping`, V94c, decision 905): a thread's entry (a state may have
   * changed: Claude Code's list read too) or a tool's start or end.
   */
  pinged(kind: 'thread' | 'activity' | undefined): void;
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

/**
 * What to hear while agents are live (decision 906), from the parts as last sent: Claude Code's
 * list while a Claude agent works or waits; Codex's app server while a Codex agent does, whose
 * status changes no hook announces (`codex`: the parts they show). Hermes's: the triggers and the
 * safety read only (the person's choice).
 */
export function liveOf(parts: { workspaces?: unknown; nucleus?: unknown; scribe?: unknown }): {
  sessions: boolean;
  codex: EventPart[];
} {
  const live = (state: string | undefined) => state === 'working' || state === 'needs-you';
  let sessions = false;
  const read = new Set<EventPart>();
  for (const workspace of (parts.workspaces as WorkspaceList | null | undefined)?.workspaces ??
    []) {
    const { state, kind } = workspace.agent;
    // Codex: while it is there at all, a turn typed in the person's own terminal starts it.
    if (kind === 'codex' && state !== 'stopped' && state !== 'no-agent') read.add('workspaces');
    else if (kind === 'claude' && live(state)) sessions = true;
  }
  for (const page of ['nucleus', 'scribe'] as const) {
    const conversation = (parts[page] as PageAgentState | null | undefined)?.conversation;
    if (!conversation) continue;
    if (conversation.kind === 'codex') read.add(page);
    else if (conversation.kind === 'claude' && live(conversation.state)) sessions = true;
  }
  return { sessions, codex: [...read] };
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
  /** Each open stream, from its first byte: the terminals it carries, each with its tabs' count. */
  const connections = new Map<
    string,
    { res: ServerResponse; terminals: Map<string, { tabs: number; stop: () => void }> }
  >();
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

  /** The watches (V94c): made with the first page, again when the records' folders move. */
  let watching: Watched[] = [];
  let watched = '';
  function watchAll(): void {
    const key = JSON.stringify(roots);
    if (closed || key === watched) return;
    watched = key;
    for (const w of watching) w.close();
    watching = roots.map((root) =>
      watchTree(
        root,
        (path) => onRecord(root, path),
        (rel) => RECORD_FOLDERS.has(rel.split(/[\\/]/)[0] ?? ''),
      ),
    );
    const git = options.git;
    if (!git) return;
    for (const refs of ['heads', 'remotes']) {
      watching.push(watchTree(join(git, 'refs', refs), (path) => onRef(path)));
    }
    watching.push(
      watchTree(
        git,
        (path) => {
          if (basename(path) === 'packed-refs') onRef(path);
        },
        () => false,
      ),
    );
  }

  const loadRoots = () =>
    options
      .roots?.()
      .then((found) => {
        roots = found;
        if (watched) watchAll();
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

  /** A record changed on disk (V94c): by another process, or this one (its write is news twice). */
  function onRecord(root: string, path: string): void {
    const rel = inside(root, path);
    if (rel === null) return;
    const parts = partsOfRecord(rel);
    if (parts.length === 0) return;
    touch(rel);
    // A hook's entry in a thread or in Nucleus's activity: a state may have changed in Claude
    // Code's list too, read first.
    if (rel.startsWith(`threads${sep}`) || /^(nucleus|scribe).*\.jsonl$/.test(rel)) {
      sessionsSoon(parts, 'file');
    } else changed(parts, 'file');
  }

  /**
   * Files a page reads beside the parts (a thread, an activity, Nucleus's activity), named when
   * they change (`touched`): a part's JSON may not change with them (V94c).
   */
  const touchedPaths = new Set<string>();
  let touching: ReturnType<typeof setTimeout> | undefined;
  function touch(rel: string): void {
    const path = rel.split(sep).join('/');
    if (!/^(threads|activity|hive)\/|^(nucleus|scribe)[^/]*\.jsonl$/.test(path)) return;
    if (closed || !listening()) return;
    touchedPaths.add(path);
    touching ??= setTimeout(() => {
      touching = undefined;
      const paths = [...touchedPaths];
      touchedPaths.clear();
      broadcast(event('touched', JSON.stringify({ paths })));
    }, timing.first);
  }

  /** A ref moved (a commit, a fetch, a merge, a branch made or deleted); git's locks are not. */
  function onRef(path: string): void {
    if (path.endsWith('.lock')) return;
    changed(['workspaces', 'reviews'], 'ref');
  }

  // Claude Code's list (decision 906).
  let sessionsText: string | undefined;
  let sessionsReading: Promise<void> | null = null;
  let sessionsAgain: ReturnType<typeof setTimeout> | undefined;
  /** Reads the list anew; a change reads the parts that show agents' states. */
  function readSessions(): Promise<void> {
    const read = options.sessions;
    if (!read || closed || !listening()) return Promise.resolve();
    sessionsReading ??= read()
      .then((value) => {
        const text = JSON.stringify(value ?? null);
        if (text === sessionsText) return;
        const first = sessionsText === undefined;
        sessionsText = text;
        if (!first) changed(['workspaces', 'nucleus', 'scribe'], 'sessions');
      })
      .catch(() => {})
      .finally(() => {
        sessionsReading = null;
      });
    return sessionsReading;
  }
  /** Now and once more `again` later: the list follows a hook by 0.1–0.3 s (the spike). */
  function sessionsSoon(parts: EventPart[], reason: string): void {
    if (!options.sessions) return changed(parts, reason);
    // The list first: the parts' read then takes it from its cache (2 s), the state with it.
    void readSessions().then(() => changed(parts, reason));
    clearTimeout(sessionsAgain);
    sessionsAgain = setTimeout(() => void readSessions(), timing.again);
  }
  const parsed = (part: EventPart): unknown => {
    const text = last.get(part);
    return text === undefined ? undefined : (JSON.parse(text) as unknown);
  };
  // Codex's app server (V94c): one connection while a Codex agent is live.
  let codexWatch: { stop(): void; closed: Promise<void> } | null = null;
  let codexOpening = false;
  const stopCodex = () => {
    codexWatch?.stop();
    codexWatch = null;
  };
  function hearCodex(parts: EventPart[]): void {
    if (codexWatch || codexOpening) return;
    const watch = options.codex;
    // No way to hear it: its parts read each tick, as the page did.
    if (!watch) return changed(parts, 'live');
    codexOpening = true;
    watch(() => changed(['workspaces', 'nucleus', 'scribe'], 'codex'))
      .then(
        (held) => {
          if (!held) return changed(parts, 'live');
          if (closed) return held.stop();
          codexWatch = held;
          // What changed before it listened (a page loading, the daemon restarting) is read now.
          changed(parts, 'codex');
          void held.closed.then(() => {
            if (codexWatch === held) codexWatch = null;
          });
        },
        () => changed(parts, 'live'),
      )
      .finally(() => (codexOpening = false));
  }
  /** Whether a Claude agent is listed in the parts as last sent: a workspace's, Nucleus, Scribe. */
  function claudeListed(): boolean {
    const workspaces = parsed('workspaces') as WorkspaceList | null | undefined;
    if (workspaces?.workspaces.some((w) => w.agent.kind === 'claude' && !w.finished)) return true;
    return (['nucleus', 'scribe'] as const).some(
      (page) =>
        (parsed(page) as PageAgentState | null | undefined)?.conversation?.kind === 'claude',
    );
  }

  /** When a terminal was last shown on a page (V94b's listens). */
  let terminalShownAt = 0;
  const live = setInterval(() => {
    // The connection is kept between two pages (a reload): only no Codex agent ends it.
    if (closed) return stopCodex();
    if (!listening()) return;
    const now = liveOf({
      workspaces: parsed('workspaces'),
      nucleus: parsed('nucleus'),
      scribe: parsed('scribe'),
    });
    // A terminal shown, or one just left: a turn typed there may start with no hook the page
    // hears (Scribe records none), as decision 161 read the list every 5 s for it.
    const shown = [...connections.values()].some((c) => c.terminals.size > 0);
    if (shown) terminalShownAt = Date.now();
    const typing = Date.now() - terminalShownAt < 2 * timing.live;
    if (now.sessions || (typing && claudeListed())) void readSessions();
    if (now.codex.length > 0) hearCodex(now.codex);
    else stopCodex();
  }, timing.live);

  /** Writes of records by this process: whole files (`writeFileWhole`). */
  const unlisten = onWritten((path) => {
    for (const root of roots) {
      const rel = inside(root, path);
      if (rel === null) continue;
      const parts = partsOfRecord(rel);
      if (parts.length > 0) {
        touch(rel);
        changed(parts, 'wrote');
      }
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
      connections.set(id, { res, terminals: new Map() });
      let gone = false;
      req.on('close', () => {
        gone = true;
        clients.delete(id);
        const shown = connections.get(id)?.terminals;
        if (shown?.size) terminalShownAt = Date.now();
        for (const listened of shown?.values() ?? []) listened.stop();
        connections.delete(id);
        if (!listening()) {
          pending.clear();
          schedule();
        }
      });
      if (closed) return void res.end();
      // Files are watched from the first page on (V94c).
      if (!watched) {
        await loadRoots();
        watchAll();
      }
      opening += 1;
      // Claude Code's list anew first, when a Claude agent is listed: the parts' read takes it
      // from its cache (2 s). The first page's read of the list is the workspaces' own.
      if (claudeListed()) await readSessions();
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
    listen(stream, terminal, stop = false) {
      const connection = connections.get(stream);
      if (!connection) return 'no-stream';
      const listened = connection.terminals.get(terminal);
      if (stop) {
        if (listened && --listened.tabs <= 0) {
          listened.stop();
          connection.terminals.delete(terminal);
          terminalShownAt = Date.now();
        }
        return 'ok';
      }
      // Another tab of the browser shows it too: one copy of its output, its replay again for it.
      listened?.stop();
      const { res } = connection;
      const send = (name: string, data: unknown) => res.write(event(name, JSON.stringify(data)));
      // What it kept comes as it is listened to: sent after `listening`, once it is known to be.
      let replay: string[] | null = [];
      const unlisten = options.terminals?.listen(terminal, {
        out: (data) => (replay ? replay.push(data) : send('out', { terminal, data })),
        exit: (code) => {
          send('exit', { terminal, code });
          connection.terminals.delete(terminal);
        },
      });
      if (!unlisten) {
        connection.terminals.delete(terminal);
        return 'no-terminal';
      }
      send('listening', { terminal });
      for (const data of replay) send('out', { terminal, data });
      replay = null;
      connection.terminals.set(terminal, { tabs: (listened?.tabs ?? 0) + 1, stop: unlisten });
      return 'ok';
    },
    wrote(pathname) {
      const parts = partsOfWrite(pathname);
      if (parts.length > 0) changed(parts, `wrote ${pathname}`);
    },
    pinged(kind) {
      if (kind === 'activity') changed(['workspaces'], 'ping activity');
      else sessionsSoon(['workspaces'], `ping ${kind ?? ''}`);
    },
    get connected() {
      return clients.size;
    },
    close() {
      closed = true;
      clearTimeout(timer);
      clearTimeout(sessionsAgain);
      clearTimeout(touching);
      clearInterval(alive);
      clearInterval(safety);
      clearInterval(live);
      stopCodex();
      unlisten();
      for (const w of watching) w.close();
      watching = [];
      for (const connection of connections.values()) {
        for (const listened of connection.terminals.values()) listened.stop();
        connection.res.end();
      }
      connections.clear();
      clients.clear();
      pending.clear();
    },
  };
}
