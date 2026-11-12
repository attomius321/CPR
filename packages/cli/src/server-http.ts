// The view server's answers and requests: statuses, JSON and bodies; a refusal's words; the
// checks of a page's write, one write of a kind at a time, a log streamed (they read the
// server's hosts, its one-at-a-time set and its streams).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EXPORT_FORMATS, type ActivityExport, type ExportFormat } from './activity-export.js';
import { WorkspaceRefused } from './workspace-record.js';
import { MergeRefused } from './merge-context.js';
import { PromptRefused } from './prompts.js';
import { PageAgentRefused } from './page-agent-context.js';
import { SkillRefused } from './skills.js';
import { McpRefused } from './mcp.js';
import type { ServerContext } from './server-context.js';

/** A GET answered with a value of the repository. */
export async function read(
  req: IncomingMessage,
  res: ServerResponse,
  value: () => Promise<unknown>,
): Promise<void> {
  if (req.method !== 'GET') return send(res, 405, 'method not allowed');
  return json(res, 200, await value());
}

/** A read about one workspace: `GET ?branch=`. */
export async function ofBranch(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  value: (branch: string) => Promise<unknown>,
): Promise<void> {
  if (req.method !== 'GET') return send(res, 405, 'method not allowed');
  const branch = url.searchParams.get('branch');
  if (!branch) return send(res, 400, "branch: a workspace's branch");
  return answer(res, () => value(branch));
}

/** The answer, or a workspace's, a merge's or a setting's refusal with its status and words. */
export async function answer(res: ServerResponse, task: () => Promise<unknown>): Promise<void> {
  return refusals(res, async () => json(res, 200, await task()));
}

/** An activity taken out (V84), as a file to save: its type, its name, never cached. */
export async function exported(
  res: ServerResponse,
  task: () => Promise<ActivityExport>,
): Promise<void> {
  return refusals(res, async () => {
    const { text, name, type } = await task();
    res.writeHead(200, {
      'content-type': type,
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
    });
    res.end(text);
  });
}

/** `send`, or a workspace's, a merge's or a setting's refusal with its status and words. */
async function refusals(res: ServerResponse, send: () => Promise<void>): Promise<void> {
  try {
    return await send();
  } catch (error) {
    if (
      error instanceof WorkspaceRefused ||
      error instanceof MergeRefused ||
      error instanceof PromptRefused ||
      error instanceof PageAgentRefused ||
      error instanceof SkillRefused
    )
      return json(res, error.status, { error: error.message });
    throw error;
  }
}

export const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

/** What a refusal for want of the page key says (SC1); the page knows it by its header. */
export const KEY_REFUSED = {
  error:
    'Open from Symbiote to write or answer: its window, the nexus, or the address symbiote view printed',
  refused: 'key',
};

/** Answers a request that lacks the page key: 403, `KEY_REFUSED`, `x-symbiote-refused: key`. */
export function refuseKey(res: ServerResponse): void {
  answers.set(res, KEY_REFUSED.error);
  res.writeHead(403, {
    'content-type': TYPES['.json'],
    'cache-control': 'no-store',
    'x-symbiote-refused': 'key',
  });
  res.end(JSON.stringify(KEY_REFUSED));
}

/** Largest review or state the viewer may send. */
export const MAX_BODY_BYTES = 1 << 20;

/** How often an open merge log's stream looks for new lines (V46a). */
const LOG_POLL_MS = 250;

/**
 * A request another site's page made — an image, a script, a frame or a fetch, sent with this
 * server's own host —, as the browser says (`Sec-Fetch-*`): a GET such as a review's address starts
 * work (fix/security-and-bugs). A link followed from that site is a page the person opens, and is
 * served, as is what this machine's pages ask for (the nexus).
 */
export function fromAnotherSite(req: IncomingMessage): boolean {
  return (
    req.headers['sec-fetch-site'] === 'cross-site' &&
    !(
      req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document'
    ) &&
    !fromThisMachine(req.headers.referer)
  );
}

/**
 * Whether a request came from a page on this machine (its `Referer`, which a page cannot set): the
 * nexus at localhost frames a Symbiote at 127.0.0.1, another site to the browser.
 */
function fromThisMachine(referer: string | undefined): boolean {
  try {
    const { protocol, hostname } = new URL(referer ?? '');
    return protocol === 'http:' && (hostname === '127.0.0.1' || hostname === 'localhost');
  } catch {
    return false;
  }
}

/** An export's format from `?format=` (V84): Markdown when none is asked; null for another. */
export function exportFormat(url: URL): ExportFormat | null {
  const asked = url.searchParams.get('format') ?? 'markdown';
  return (EXPORT_FORMATS as readonly string[]).includes(asked) ? (asked as ExportFormat) : null;
}

export const FORMAT_WORDS = `format: ${EXPORT_FORMATS.join(' or ')}`;

/** `value` as a JSON answer. */
export function json(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value), TYPES['.json']);
}

/** A permanent redirect to `location`. */
export function redirect(res: ServerResponse, location: string): void {
  res.writeHead(308, { location, 'cache-control': 'no-store' });
  res.end();
}

/** A refusal's or a failure's words, for its request's line (LG1): 500 characters at most. */
export const answers = new WeakMap<ServerResponse, string>();

/** An answer, never cached; a refusal's words kept for its request's line. */
export function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  type = 'text/plain',
): void {
  if (status >= 400) answers.set(res, body.toString().slice(0, 500));
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

/** A request's body over the most it may weigh: answered 413 with that most. */
export class BodyTooLarge extends Error {
  override name = 'BodyTooLarge';
}

/** A request's body refused: 413 over its limit, else 400 with what is wrong with it. */
export function badBody(res: ServerResponse, error: unknown): void {
  send(res, error instanceof BodyTooLarge ? 413 : 400, (error as Error).message);
}

/** `bytes` in words: `1 MB`, `32 KB`. */
const weight = (bytes: number) =>
  bytes >= 2 ** 20 ? `${Math.round(bytes / 2 ** 20)} MB` : `${Math.round(bytes / 1024)} KB`;

/**
 * A request's body as text; over `limit`, a `BodyTooLarge`, the rest read and dropped: cut off,
 * the request got no answer (fix/security-and-bugs).
 */
export function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
      else if (chunks.length > 0 || size - chunk.length <= limit) {
        chunks.length = 0;
        reject(new BodyTooLarge(`a request of at most ${weight(limit)}`));
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** The request helpers that read the server's state. */
export function serverHttp({
  hosts,
  busy,
  streams,
  keys,
}: Pick<ServerContext, 'hosts' | 'busy' | 'streams' | 'keys'>) {
  /**
   * A log as server-sent events (V46a; Hive's runs, decision 695): `lines` from `from` and the
   * offset to read on from, then each time it grows, read every 250 ms; `gone` once `read` finds
   * no log (a merge's entry removed).
   */
  async function streamLog(
    req: IncomingMessage,
    res: ServerResponse,
    from: number,
    read: (from: number) => Promise<{ lines: unknown[]; next: number } | null>,
    missing: string,
  ): Promise<void> {
    const first = await read(from);
    if (!first) return send(res, 404, missing);
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    const event = (name: string, data: unknown) =>
      res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    if (first.lines.length > 0) event('lines', first);
    else res.flushHeaders();
    streams.add(res);
    let next = first.next;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      clearTimeout(timer);
      streams.delete(res);
    };
    req.on('close', done);
    const poll = () => {
      timer = setTimeout(() => {
        read(next)
          .then((more) => {
            if (!streams.has(res)) return;
            if (!more) {
              event('gone', {});
              done();
              res.end();
              return;
            }
            if (more.lines.length > 0) event('lines', more);
            next = more.next;
            poll();
          })
          .catch(() => poll());
      }, LOG_POLL_MS);
    };
    poll();
  }

  /** A write about one workspace: `POST { branch }`. */
  async function onBranch(
    req: IncomingMessage,
    res: ServerResponse,
    act: (branch: string) => Promise<void>,
  ): Promise<void> {
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!writable(req)) return refused(req, res);
    let branch: string;
    try {
      const value = JSON.parse(await readBody(req, MAX_BODY_BYTES)) as { branch?: unknown } | null;
      if (typeof value?.branch !== 'string') throw new Error("branch: a workspace's branch");
      branch = value.branch;
    } catch (error) {
      return badBody(res, error);
    }
    return act(branch);
  }

  /** A write with a JSON body `parse` checks: 400 with its words when it does not. */
  async function written<T>(
    req: IncomingMessage,
    res: ServerResponse,
    parse: (text: string) => T,
    act: (request: T) => Promise<void>,
    limit = MAX_BODY_BYTES,
  ): Promise<void> {
    if (req.method === 'POST' && !writable(req)) return refused(req, res);
    return writtenOpen(req, res, parse, act, limit);
  }

  /**
   * `written` without the page key (SC1): for what any local process may write, a hook's ping
   * (decision 905) and a page's errors; still JSON, the custom header, our own origin.
   */
  async function writtenOpen<T>(
    req: IncomingMessage,
    res: ServerResponse,
    parse: (text: string) => T,
    act: (request: T) => Promise<void>,
    limit = MAX_BODY_BYTES,
  ): Promise<void> {
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!pageShaped(req)) return send(res, 403, 'forbidden');
    let request: T;
    try {
      request = parse(await readBody(req, limit));
    } catch (error) {
      return badBody(res, error);
    }
    return act(request);
  }

  /**
   * One such write at a time: another meanwhile is refused (409) with `words`, or what `said`
   * says (Alpha Ceph's name in Hive mode); `words` is the lock either way.
   */
  async function oneAtATime(
    res: ServerResponse,
    words: string,
    task: () => Promise<unknown>,
    said?: () => Promise<string>,
  ): Promise<void> {
    if (busy.has(words)) return json(res, 409, { error: said ? await said() : words });
    busy.add(words);
    try {
      return await answer(res, task);
    } finally {
      busy.delete(words);
    }
  }

  /** `oneAtATime` for Symbiote's MCP (MC1): its refusal is an `McpRefused`. */
  async function exclusive<T>(words: string, task: () => Promise<T>): Promise<T> {
    if (busy.has(words)) throw new McpRefused(words, 409);
    busy.add(words);
    try {
      return await task();
    } finally {
      busy.delete(words);
    }
  }

  /** One start at a time (a worktree and an agent each), from a page or Symbiote's MCP. */
  function startingOne(res: ServerResponse, task: () => Promise<unknown>): Promise<void> {
    return oneAtATime(res, 'a workspace is being started', task);
  }

  /**
   * A write from the viewer itself: JSON, the custom header, (if sent) our own origin, and the page
   * key (SC1, decision 930), which only a page Symbiote opened holds.
   */
  function writable(req: IncomingMessage): boolean {
    return pageShaped(req) && keys.isPage(req);
  }

  /**
   * A write `writable` refused: for want of the page key alone, `KEY_REFUSED` (the page then says
   * "Open from Symbiote"); else, as before, forbidden.
   */
  function refused(req: IncomingMessage, res: ServerResponse): void {
    if (pageShaped(req) && !keys.isPage(req)) return refuseKey(res);
    return send(res, 403, 'forbidden');
  }

  /**
   * A write shaped as a page sends one, with or without the page key: JSON, the custom header, and
   * (if sent) our own origin. Enough for what any local process may ask (SC1): a hook's ping, a
   * token's trade.
   */
  function pageShaped(req: IncomingMessage): boolean {
    return (
      req.headers['x-symbiote'] === '1' &&
      !!req.headers['content-type']?.startsWith('application/json') &&
      sameSite(req)
    );
  }

  /** No origin (a page's own request may send none), or our own. */
  function sameSite(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    return origin === undefined || hosts.has(origin.replace(/^http:\/\//, ''));
  }

  return {
    writable,
    refused,
    /** Whether a request holds the page key (SC1): a read only the page may make. */
    keyed: (req: IncomingMessage) => keys.isPage(req),
    writtenOpen,
    pageShaped,
    sameSite,
    written,
    onBranch,
    oneAtATime,
    exclusive,
    startingOne,
    streamLog,
  };
}

export type ServerHttp = ReturnType<typeof serverHttp>;
